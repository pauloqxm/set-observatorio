from __future__ import annotations

import csv
import io
import logging
import re
import time
import unicodedata
from datetime import date
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

QUALIFICACAO_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vSX4leER0WfjxQAuMkPJR9O3mpi1r8XlBaL9ef0bVW7Pb8muKdyJrYB2RvpE5PqSEbCWIAyVj0Wh-L6/"
    "pub?gid=1427271035&single=true&output=csv"
)

CACHE_TTL_SECONDS = 300
MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float | None = None


def _norm_key(raw: str) -> str:
    text = unicodedata.normalize("NFD", str(raw or "").strip().lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", text)


def _compact_key(raw: str) -> str:
    return re.sub(r"[aeiou]", "", _norm_key(raw))


def _header_index(headers: list[str], candidates: list[str]) -> int:
    norms = [_norm_key(h) for h in headers]
    by_key = {key: idx for idx, key in enumerate(norms) if key}
    for candidate in candidates:
        idx = by_key.get(_norm_key(candidate))
        if idx is not None:
            return idx
    for candidate in candidates:
        compact = _compact_key(candidate)
        if not compact:
            continue
        for idx, key in enumerate(norms):
            if key and _compact_key(key) == compact:
                return idx
    return -1


def _parse_number(raw: str) -> float:
    text = str(raw or "").strip()
    if not text:
        return 0.0
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        value = float(text)
        return value if value == value else 0.0  # NaN guard
    except ValueError:
        return 0.0


def _normalize_codigo(raw: str) -> int | None:
    digits = re.sub(r"\D", "", str(raw or ""))
    if not digits:
        return None
    try:
        code = int(digits)
    except ValueError:
        return None
    if code <= 0:
        return None
    if code >= 1_000_000:
        code = code // 10
    return code


def _parse_termino(raw: str) -> tuple[int, int, int] | None:
    text = str(raw or "").strip()
    if not text:
        return None
    text = re.sub(r"\s+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?.*$", "", text).strip()
    iso = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if iso:
        year, month, day = (int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
    else:
        parts = text.split("/")
        if len(parts) != 3:
            return None
        try:
            day = int(re.sub(r"\D.*", "", parts[0]) or "0")
            month = int(re.sub(r"\D.*", "", parts[1]) or "0")
            year = int(re.sub(r"\D.*", "", parts[2]) or "0")
        except ValueError:
            return None
        if month > 12 and 1 <= day <= 12:
            day, month = month, day
    if month < 1 or month > 12 or day < 1 or day > 31 or year < 1900 or year > 2200:
        return None
    return year, month, day


def _mes_ano_key(parts: tuple[int, int, int]) -> str:
    return f"{parts[0]}-{parts[1]:02d}"


def _mes_ano_rank(key: str) -> int:
    try:
        year, month = key.split("-")
        return int(year) * 12 + int(month)
    except (ValueError, AttributeError):
        return 0


def _mes_ano_label(key: str) -> str:
    try:
        year, month = key.split("-")
        mi = int(month)
        if 1 <= mi <= 12:
            return f"{MESES_ABREV[mi - 1]}/{year}"
    except (ValueError, AttributeError):
        pass
    return ""


def _is_concluida_por_data(parts: tuple[int, int, int], today: date) -> bool:
    year, month, day = parts
    if year != today.year:
        return year < today.year
    if month != today.month:
        return month < today.month
    return day <= today.day


def _decode_csv_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _fetch_csv_text() -> str:
    request = Request(
        QUALIFICACAO_CSV_URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/csv,text/plain,*/*",
            "Accept-Language": "pt-BR,pt;q=0.9",
        },
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=25) as response:
                return _decode_csv_bytes(response.read())
        except (URLError, OSError, TimeoutError) as exc:
            last_error = exc
            logger.warning("Qualificação CSV tentativa %s falhou: %s", attempt + 1, exc)
            time.sleep(1.5 * (attempt + 1))
    raise last_error or RuntimeError("Falha ao baixar CSV da Qualificação.")


def _summarize_from_text(text: str) -> dict[str, Any]:
    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        return _empty_summary()

    idx_cod = _header_index(headers, ["COD_IBGE", "Codigo_IBGE", "Código IBGE", "codibge"])
    idx_vagas = _header_index(headers, ["VAGAS OFERTADAS", "Vagas Ofertadas"])
    idx_concludentes = _header_index(headers, ["CONCLUDENTES"])
    idx_termino = _header_index(headers, ["DATA TÉRMINO", "DATA TERMINO", "Data Término", "data_termino"])
    if idx_cod < 0 or idx_termino < 0:
        logger.warning("Qualificação: colunas COD_IBGE/DATA TÉRMINO não encontradas: %s", headers)
        return _empty_summary()

    today = date.today()
    latest_key = ""
    latest_rows: list[dict[str, Any]] = []

    def consider(row: list[str]) -> None:
        nonlocal latest_key, latest_rows
        if idx_cod >= len(row):
            return
        codigo = _normalize_codigo(row[idx_cod])
        if codigo is None:
            return
        termino = _parse_termino(row[idx_termino] if idx_termino < len(row) else "")
        if termino is None or not _is_concluida_por_data(termino, today):
            return
        key = _mes_ano_key(termino)
        rank = _mes_ano_rank(key)
        latest_rank = _mes_ano_rank(latest_key)
        item = {
            "codigo": codigo,
            "vagas": _parse_number(row[idx_vagas] if 0 <= idx_vagas < len(row) else ""),
            "concludentes": _parse_number(row[idx_concludentes] if 0 <= idx_concludentes < len(row) else ""),
        }
        if rank > latest_rank:
            latest_key = key
            latest_rows = [item]
        elif rank == latest_rank:
            latest_rows.append(item)

    for row in reader:
        consider(row)

    municipios = {item["codigo"] for item in latest_rows}
    return {
        "cursos": len(latest_rows),
        "vagas": int(round(sum(item["vagas"] for item in latest_rows))),
        "concludentes": int(round(sum(item["concludentes"] for item in latest_rows))),
        "municipios": len(municipios),
        "referenciaLabel": _mes_ano_label(latest_key),
    }


def _empty_summary() -> dict[str, Any]:
    return {
        "cursos": 0,
        "vagas": 0,
        "concludentes": 0,
        "municipios": 0,
        "referenciaLabel": "",
    }


def get_qualificacao_home_summary() -> dict[str, Any]:
    global _CACHE, _CACHE_TS
    now = time.time()
    if _CACHE is not None and _CACHE_TS and (now - _CACHE_TS) < CACHE_TTL_SECONDS:
        return _CACHE
    try:
        text = _fetch_csv_text()
        summary = _summarize_from_text(text)
    except (URLError, OSError, csv.Error, ValueError) as exc:
        logger.error("Falha ao resumir Qualificação para a home: %s", exc)
        if _CACHE is not None:
            logger.warning("Usando cache expirado da Qualificação.")
            return _CACHE
        raise RuntimeError("Não foi possível carregar os dados da Qualificação.") from exc
    _CACHE = summary
    _CACHE_TS = now
    return summary
