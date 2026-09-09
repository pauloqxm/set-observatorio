from __future__ import annotations

import csv
import io
import logging
import time
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

PUBLICACOES_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vRCMFBVJhmeBYRO9ElghRPlk2M9xbUhC83bYcLI2wpd1RL4fYqDv2IIGRQQmRAoSdgY9V6q0brUq7ia/"
    "pub?gid=300642060&single=true&output=csv"
)

CACHE_TTL_SECONDS = 300

_CACHE: list[dict[str, Any]] | None = None
_CACHE_TS: float | None = None


def _decode_csv_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _fetch_csv_text() -> str:
    request = Request(
        PUBLICACOES_CSV_URL,
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
            logger.warning("Publicações CSV tentativa %s falhou: %s", attempt + 1, exc)
            time.sleep(1.5 * (attempt + 1))
    raise last_error or RuntimeError("Falha ao baixar CSV de Publicações.")


def _norm_header(raw: str) -> str:
    return str(raw or "").strip().lower().replace(" ", "_")


def _parse_rows(text: str) -> list[dict[str, Any]]:
    reader = csv.reader(io.StringIO(text))
    try:
        headers = [_norm_header(h) for h in next(reader)]
    except StopIteration:
        return []
    items: list[dict[str, Any]] = []
    for row in reader:
        record: dict[str, Any] = {}
        for idx, header in enumerate(headers):
            if not header:
                continue
            record[header] = str(row[idx]).strip() if idx < len(row) else ""
        if any(str(v).strip() for v in record.values()):
            items.append(record)
    items.sort(key=lambda item: int(str(item.get("ordem") or "0") or "0"))
    return items


def get_publicacoes_rows() -> list[dict[str, Any]]:
    global _CACHE, _CACHE_TS
    now = time.time()
    if _CACHE is not None and _CACHE_TS and (now - _CACHE_TS) < CACHE_TTL_SECONDS:
        return _CACHE
    try:
        rows = _parse_rows(_fetch_csv_text())
        _CACHE = rows
        _CACHE_TS = now
        return rows
    except Exception as exc:
        logger.error("Falha ao carregar publicações: %s", exc)
        if _CACHE is not None:
            logger.warning("Usando cache expirado de publicações.")
            return _CACHE
        return []
