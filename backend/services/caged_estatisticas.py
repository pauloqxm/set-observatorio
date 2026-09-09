from __future__ import annotations

import csv
import gzip
import logging
import threading
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Any, TextIO

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[2]
CSV_GZ_PATH = ROOT_DIR / "caged_base.csv.gz"
CSV_PATH = ROOT_DIR / "caged_base.csv"
DADOS_CAGED_PATH = ROOT_DIR / "frontend" / "data" / "dados_caged.csv"

ESTOQUE_BASE_CE_202512 = 1_374_628
SALARIO_TRIM = 0.02

MESES_PT = (
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
)

SECAO_NOMES = {
    "A": "Agricultura, pecuária, produção florestal, pesca e aquicultura",
    "B": "Indústrias extrativas",
    "C": "Indústrias de transformação",
    "D": "Eletricidade e gás",
    "E": "Água, esgoto, atividades de gestão de resíduos e descontaminação",
    "F": "Construção",
    "G": "Comércio; reparação de veículos automotores e motocicletas",
    "H": "Transporte, armazenagem e correio",
    "I": "Alojamento e alimentação",
    "J": "Informação e comunicação",
    "K": "Atividades financeiras, de seguros e serviços relacionados",
    "L": "Atividades imobiliárias",
    "M": "Atividades profissionais, científicas e técnicas",
    "N": "Atividades administrativas e serviços complementares",
    "O": "Administração pública, defesa e seguridade social",
    "P": "Educação",
    "Q": "Saúde humana e serviços sociais",
    "R": "Artes, cultura, esporte e recreação",
    "S": "Outras atividades de serviços",
    "T": "Serviços domésticos",
    "U": "Organismos internacionais e outras instituições extraterritoriais",
}

SECAO_TO_GRUP = {
    "A": "Agropecuária",
    "B": "Indústria",
    "C": "Indústria",
    "D": "Indústria",
    "E": "Indústria",
    "F": "Construção",
    "G": "Comércio",
}

GRUPAMENTOS = ("Agropecuária", "Indústria", "Construção", "Comércio", "Serviços")

SEXO_LABEL = {"1": "Homem", "3": "Mulher"}
RACA_LABEL = {
    "1": "Branca",
    "2": "Preta",
    "3": "Parda",
    "4": "Amarela",
    "5": "Indígena",
}
GRAU_LABEL = {
    "1": "Analfabeto",
    "2": "Até 5º incompleto",
    "3": "5º completo fundamental",
    "4": "6º a 9º fundamental",
    "5": "Fundamental completo",
    "6": "Médio incompleto",
    "7": "Médio completo",
    "8": "Superior incompleto",
    "9": "Superior completo",
    "10": "Mestrado",
    "11": "Doutorado",
}
TIPO_MOV_LABEL = {
    "10": "Primeiro emprego",
    "20": "Reemprego",
    "25": "Contrato por prazo determinado",
    "35": "Reintegração",
    "70": "Transferência com ônus",
    "97": "Admissão — tipo ignorado",
    "31": "Demissão sem justa causa",
    "32": "Demissão com justa causa",
    "33": "Culpa recíproca",
    "40": "Desligamento a pedido",
    "43": "Término de contrato determinado",
    "45": "Término de contrato",
    "50": "Aposentadoria",
    "60": "Morte",
    "80": "Transferência sem ônus",
    "90": "Desligamento — tipo ignorado",
}

FAIXAS_IDADE = (
    ("Até 17", lambda i: i <= 17),
    ("18 a 24", lambda i: 18 <= i <= 24),
    ("25 a 29", lambda i: 25 <= i <= 29),
    ("30 a 39", lambda i: 30 <= i <= 39),
    ("40 a 49", lambda i: 40 <= i <= 49),
    ("50 a 64", lambda i: 50 <= i <= 64),
    ("65 ou mais", lambda i: i >= 65),
)

FAIXAS_TEMPO = (
    ("Até 3 meses", lambda t: t <= 3),
    ("3–6 meses", lambda t: 3 < t <= 6),
    ("6–12 meses", lambda t: 6 < t <= 12),
    ("1–2 anos", lambda t: 12 < t <= 24),
    ("2–5 anos", lambda t: 24 < t <= 60),
    ("5–10 anos", lambda t: 60 < t <= 120),
    ("10+ anos", lambda t: t > 120),
)

JOVEM_IDADE_MIN = 18
JOVEM_IDADE_MAX = 29
TIPO_CONTRATO_DETERMINADO = "25"
RACA_BRANCA = "1"
RACA_PRETA = "2"
RACA_PARDA = "3"

_LOCK = threading.Lock()
_ROWS: list[tuple] | None = None
_OPCOES: dict[str, Any] | None = None
_PERFIL_CACHE: dict[str, dict[str, Any]] = {}
_ESTOQUE_MUN_ROWS: list[tuple[str, str, str, float]] | None = None


def _flag_on(raw: Any) -> bool:
    s = str(raw or "").strip().replace(",", ".")
    if not s:
        return False
    try:
        return int(float(s)) == 1
    except ValueError:
        return s.lower() in {"s", "sim", "true"}


def _tipo_code(raw: Any) -> str:
    s = str(raw or "").strip().replace(",", ".")
    if not s:
        return ""
    try:
        return str(int(float(s)))
    except ValueError:
        return str(raw or "").strip()


def _parse_int(raw: str) -> int | None:
    s = str(raw or "").strip().replace(" ", "")
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return int(float(s))
    except ValueError:
        return None


def _parse_float(raw: str) -> float | None:
    s = str(raw or "").strip().replace(" ", "")
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _norm_mun(raw: str) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if not digits:
        return ""
    n = int(digits)
    if n >= 1_000_000:
        n = n // 10
    return str(n)


def _secao_grup(secao: str) -> str:
    return SECAO_TO_GRUP.get(secao.upper(), "Serviços")


def _comp_label(comp: str) -> str:
    if len(comp) != 6 or not comp.isdigit():
        return comp
    mes = int(comp[4:6])
    if mes < 1 or mes > 12:
        return comp
    return f"{MESES_PT[mes - 1]}/{comp[:4]}"


def _comp_sort(comp: str) -> int:
    return int(comp) if comp.isdigit() else 0


def _shift_competencia(comp: str, delta_meses: int) -> str:
    if len(comp) != 6 or not comp.isdigit():
        return comp
    year = int(comp[:4])
    month = int(comp[4:6]) + int(delta_meses)
    while month < 1:
        month += 12
        year -= 1
    while month > 12:
        month -= 12
        year += 1
    return f"{year:04d}{month:02d}"


def _janela_competencias(comp: str, n: int) -> list[str]:
    n = max(1, min(int(n or 1), 12))
    return [_shift_competencia(comp, -i) for i in range(n)]


def _idade_faixa(idade: int | None) -> str | None:
    if idade is None:
        return None
    for label, pred in FAIXAS_IDADE:
        if pred(idade):
            return label
    return None


def _tempo_faixa(tempo: float | None) -> str | None:
    if tempo is None:
        return None
    for label, pred in FAIXAS_TEMPO:
        if pred(tempo):
            return label
    return None


def _trimmed_mean(values: list[float], trim: float = 0.05) -> float | None:
    if not values:
        return None
    xs = sorted(values)
    n = len(xs)
    k = int(n * trim)
    sliced = xs[k : n - k] if n - 2 * k >= 1 else xs
    return float(mean(sliced))


def _items(counter: dict[str, float], *, sort_abs: bool = True, top: int | None = None) -> list[dict[str, Any]]:
    rows = [{"label": k, "valor": float(v)} for k, v in counter.items() if k]
    if sort_abs:
        rows.sort(key=lambda r: abs(r["valor"]), reverse=True)
    if top is not None:
        rows = rows[:top]
    return rows


def _resolve_csv_path() -> Path:
    if CSV_GZ_PATH.exists():
        return CSV_GZ_PATH
    if CSV_PATH.exists():
        return CSV_PATH
    raise FileNotFoundError(f"Arquivo CAGED não encontrado: {CSV_GZ_PATH} ou {CSV_PATH}")


def _open_caged_csv(path: Path) -> TextIO:
    if path.name.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def _ensure_loaded() -> None:
    global _ROWS, _OPCOES
    if _ROWS is not None:
        return
    with _LOCK:
        if _ROWS is not None:
            return
        source = _resolve_csv_path()
        logger.info("Carregando %s", source)
        rows: list[tuple] = []
        anos: set[str] = set()
        comps: set[str] = set()
        muns: dict[str, str] = {}
        grups: set[str] = set()
        with _open_caged_csv(source) as fh:
            reader = csv.DictReader(fh, delimiter=";")
            for rec in reader:
                comp = "".join(ch for ch in str(rec.get("competênciamov") or "") if ch.isdigit())
                if len(comp) != 6:
                    continue
                mun = _norm_mun(rec.get("município") or "")
                if not mun:
                    continue
                secao = str(rec.get("seção") or "").strip().upper()
                origem = str(rec.get("origem_caged") or "mov").strip().lower()
                saldo = _parse_int(rec.get("saldomovimentação") or "0") or 0
                if origem == "exc":
                    saldo = -saldo
                if saldo == 0:
                    continue
                grup = _secao_grup(secao)
                mun_nome = str(rec.get("municipio_nome") or "").strip() or f"Código {mun}"
                rows.append(
                    (
                        comp,
                        mun,
                        mun_nome,
                        secao,
                        grup,
                        saldo,
                        str(rec.get("cbo_descricao") or "").strip() or "Não informado",
                        str(rec.get("graudeinstrução") or "").strip(),
                        _parse_int(rec.get("idade") or ""),
                        _parse_float(rec.get("tempoemprego") or ""),
                        str(rec.get("raçacor") or "").strip(),
                        str(rec.get("sexo") or "").strip(),
                        str(rec.get("tipomovimentação") or "").strip(),
                        _parse_float(rec.get("salário") or ""),
                        _flag_on(rec.get("indtrabintermitente")),
                        _flag_on(rec.get("indtrabparcial")),
                    )
                )
                anos.add(comp[:4])
                comps.add(comp)
                muns[mun] = mun_nome
                grups.add(grup)
        _ROWS = rows
        _OPCOES = {
            "anos": sorted(anos),
            "meses": [
                {"valor": c, "label": _comp_label(c)} for c in sorted(comps, key=_comp_sort)
            ],
            "municipios": [
                {"valor": cod, "label": muns[cod]} for cod in sorted(muns, key=lambda k: muns[k])
            ],
            "grupamentos": [{"valor": g, "label": g} for g in GRUPAMENTOS if g in grups or True],
            "arquivo": str(source),
            "arquivo_nome": source.name,
            "total_linhas": len(rows),
        }
        logger.info("CAGED estatísticas: %s linhas", f"{len(rows):,}")


def opcoes_filtros() -> dict[str, Any]:
    _ensure_loaded()
    assert _OPCOES is not None
    return dict(_OPCOES)


def _split_csv_param(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [p.strip() for p in str(raw).split(",") if p.strip()]


def _comp_from_mes_ano(raw: str) -> str:
    parts = str(raw or "").strip().replace("-", "/").split("/")
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
        mes, ano = int(parts[0]), int(parts[1])
        if ano >= 1000 and 1 <= mes <= 12:
            return f"{ano:04d}{mes:02d}"
    return ""


def _ensure_estoque_mun_rows() -> list[tuple[str, str, str, float]]:
    """Estoque oficial por município/mês (mesmo CSV do mapa CAGED)."""
    global _ESTOQUE_MUN_ROWS
    if _ESTOQUE_MUN_ROWS is not None:
        return _ESTOQUE_MUN_ROWS
    with _LOCK:
        if _ESTOQUE_MUN_ROWS is not None:
            return _ESTOQUE_MUN_ROWS
        rows: list[tuple[str, str, str, float]] = []
        if DADOS_CAGED_PATH.exists():
            with DADOS_CAGED_PATH.open("r", encoding="utf-8-sig", newline="") as fh:
                reader = csv.reader(fh)
                next(reader, None)
                for cells in reader:
                    if len(cells) < 4:
                        continue
                    mun = _norm_mun(cells[0])
                    comp = _comp_from_mes_ano(cells[2])
                    est = _parse_float(cells[3])
                    if not mun or not comp or est is None:
                        continue
                    nome = str(cells[1] or "").strip() or f"Código {mun}"
                    rows.append((comp, mun, nome, float(est)))
        _ESTOQUE_MUN_ROWS = rows
        logger.info("CAGED estoque municipal: %s linhas", f"{len(rows):,}")
    return _ESTOQUE_MUN_ROWS


def _estoque_fim_por_municipio(
    mun_list: list[str],
    last_comp: str,
    mun_nome: dict[str, str],
) -> dict[str, float]:
    """Estoque do último mês do recorte (ou o mais recente até essa competência)."""
    mun_set = {_norm_mun(m) for m in mun_list if m}
    mun_set.discard("")
    last_key = _comp_sort(last_comp)
    best: dict[str, tuple[int, float]] = {}
    for comp, mun, nome, est in _ensure_estoque_mun_rows():
        ck = _comp_sort(comp)
        if ck > last_key:
            continue
        if mun_set and mun not in mun_set:
            continue
        prev = best.get(mun)
        if prev is None or ck > prev[0]:
            best[mun] = (ck, est)
            if mun not in mun_nome:
                mun_nome[mun] = nome
    return {mun: val for mun, (_ck, val) in best.items()}


def _norm_comp_param(raw: str) -> str:
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 6:
        return digits
    # 2026-01 → 202601
    parts = raw.replace("/", "-").split("-")
    if len(parts) == 2 and len(parts[0]) == 4 and parts[1].isdigit():
        return f"{parts[0]}{int(parts[1]):02d}"
    return digits


def _filter_rows(
    anos: list[str],
    competencias: list[str],
    municipios: list[str],
    grupamentos: list[str],
    *,
    ignore_time: bool = False,
) -> list[tuple]:
    _ensure_loaded()
    assert _ROWS is not None
    ano_set = {a.strip() for a in anos if a.strip()}
    comp_set = {_norm_comp_param(c) for c in competencias if c.strip()}
    mun_set = {_norm_mun(m) for m in municipios if m.strip()}
    mun_set.discard("")
    grup_set = {g.strip() for g in grupamentos if g.strip()}

    if not ignore_time and not ano_set and not comp_set:
        years = {r[0][:4] for r in _ROWS}
        if years:
            ano_set = {max(years)}

    out = []
    for row in _ROWS:
        comp = row[0]
        if not ignore_time:
            if comp_set and comp not in comp_set:
                continue
            if ano_set and comp[:4] not in ano_set:
                continue
        if mun_set and row[1] not in mun_set:
            continue
        if grup_set and row[4] not in grup_set:
            continue
        out.append(row)
    return out


def _unidade(municipios: list[str], grupamentos: list[str]) -> str:
    if len(municipios) == 1:
        return "Município"
    if municipios:
        return "Recorte municipal"
    if grupamentos:
        return "Recorte setorial"
    return "Ceará"


def _series_mensal(rows: list[tuple]) -> dict[str, dict[str, float]]:
    by: dict[str, dict[str, float]] = {}
    for row in rows:
        comp = row[0]
        saldo = row[5]
        slot = by.setdefault(comp, {"admissoes": 0.0, "desligamentos": 0.0, "saldo": 0.0})
        if saldo > 0:
            slot["admissoes"] += saldo
        elif saldo < 0:
            slot["desligamentos"] += -saldo
        slot["saldo"] += saldo
    return by


def _encadear_estoque(
    by_comp: dict[str, dict[str, float]],
    *,
    estoque_inicial: float,
    indice_base: float | None = None,
    indice_ref_comp: str | None = None,
) -> tuple[dict[str, dict[str, Any]], float | None]:
    comps = sorted(by_comp, key=_comp_sort)
    e = float(estoque_inicial)
    out: dict[str, dict[str, Any]] = {}
    for comp in comps:
        slot: dict[str, Any] = dict(by_comp[comp])
        slot["estoque_inicio"] = e
        e = e + slot["saldo"]
        slot["estoque_fim"] = e
        out[comp] = slot

    base = indice_base
    if base is None or base <= 0:
        if indice_ref_comp and indice_ref_comp in out:
            ref_e = out[indice_ref_comp].get("estoque_fim")
            if isinstance(ref_e, (int, float)) and ref_e > 0:
                base = float(ref_e)
        if base is None or base <= 0:
            for comp in comps:
                fim = out[comp].get("estoque_fim")
                if isinstance(fim, (int, float)) and fim > 0:
                    base = float(fim)
                    break
        if base is not None and base <= 0:
            base = None

    for slot in out.values():
        ini = slot["estoque_inicio"]
        a = slot["admissoes"]
        d = slot["desligamentos"]
        slot["variacao_relativa"] = (slot["saldo"] / ini * 100.0) if ini > 0 else None
        slot["taxa_rotatividade"] = (min(a, d) / ini * 100.0) if ini > 0 else None
        slot["indice"] = (slot["estoque_fim"] / base * 100.0) if base else None
    return out, base


def _lv(comp: str, valor: float | None) -> dict[str, Any]:
    return {"label": _comp_label(comp), "valor": None if valor is None else float(valor)}


def resumo_estatisticas(
    *,
    anos: str | None = None,
    competencias: str | None = None,
    meses: str | None = None,
    municipios: str | None = None,
    regioes: str | None = None,
    grupamentos: str | None = None,
    agregacoes: str | None = None,
) -> dict[str, Any]:
    ano_list = _split_csv_param(anos)
    comp_list = _split_csv_param(competencias) or _split_csv_param(meses)
    mun_list = [_norm_mun(m) for m in _split_csv_param(municipios)]
    mun_list = [m for m in mun_list if m]
    grup_list = _split_csv_param(grupamentos) or _split_csv_param(agregacoes)
    regioes_list = _split_csv_param(regioes)

    usa_base_oficial = not grup_list and not mun_list and not regioes_list
    rows = _filter_rows(ano_list, comp_list, mun_list, grup_list)
    if usa_base_oficial:
        chain_rows = _filter_rows(ano_list, [], mun_list, grup_list)
        by_all = _series_mensal(chain_rows if chain_rows else rows)
        enc, indice_base = _encadear_estoque(
            by_all,
            estoque_inicial=float(ESTOQUE_BASE_CE_202512),
            indice_base=float(ESTOQUE_BASE_CE_202512),
        )
        estoque_base_valor = float(ESTOQUE_BASE_CE_202512)
    else:
        hist_rows = _filter_rows([], [], mun_list, grup_list, ignore_time=True)
        by_all = _series_mensal(hist_rows if hist_rows else rows)
        enc, indice_base = _encadear_estoque(
            by_all,
            estoque_inicial=0.0,
            indice_ref_comp="202512",
        )
        estoque_base_valor = float(indice_base) if indice_base else 0.0
    display_comps = sorted({r[0] for r in rows}, key=_comp_sort)
    if not display_comps:
        display_comps = sorted(enc, key=_comp_sort)

    adm = sum(enc[c]["admissoes"] for c in display_comps if c in enc)
    dem = sum(enc[c]["desligamentos"] for c in display_comps if c in enc)
    var_abs_periodo = adm - dem
    first = display_comps[0] if display_comps else ""
    last = display_comps[-1] if display_comps else ""
    e_ini = enc.get(first, {}).get("estoque_inicio") if first else None
    e_fim = enc.get(last, {}).get("estoque_fim") if last else None
    indice_fim = enc.get(last, {}).get("indice") if last else None
    var_rel = ((var_abs_periodo / e_ini) * 100.0) if e_ini and e_ini > 0 else None
    tr = ((min(adm, dem) / e_ini) * 100.0) if e_ini and e_ini > 0 else None
    indice_periodo = (e_fim / e_ini * 100.0) if e_ini and e_ini > 0 and e_fim is not None else None

    flut_adm = [_lv(c, enc[c]["admissoes"]) for c in display_comps if c in enc]
    flut_dem = [_lv(c, enc[c]["desligamentos"]) for c in display_comps if c in enc]
    var_abs = [_lv(c, enc[c]["saldo"]) for c in display_comps if c in enc]
    var_rel_mes = [_lv(c, enc[c]["variacao_relativa"]) for c in display_comps if c in enc]
    indice_mes = [
        _lv(c, (enc[c]["indice"] - 100.0) if enc[c]["indice"] is not None else None)
        for c in display_comps
        if c in enc
    ]
    tr_mes = [_lv(c, enc[c]["taxa_rotatividade"]) for c in display_comps if c in enc]

    tipo_adm: dict[str, float] = defaultdict(float)
    tipo_dem: dict[str, float] = defaultdict(float)
    tipo_dem_mes: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    sexo_adm: dict[str, float] = defaultdict(float)
    sexo_dem: dict[str, float] = defaultdict(float)
    faixa_adm: dict[str, float] = defaultdict(float)
    faixa_dem: dict[str, float] = defaultdict(float)
    sexo_faixa_adm: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    sexo_faixa_dem: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cbo_adm: dict[str, float] = defaultdict(float)
    cbo_dem: dict[str, float] = defaultdict(float)
    mun_adm: dict[str, float] = defaultdict(float)
    mun_dem: dict[str, float] = defaultdict(float)
    mun_nome: dict[str, str] = {}
    secao_adm: dict[str, float] = defaultdict(float)
    secao_dem: dict[str, float] = defaultdict(float)
    agreg_adm: dict[str, float] = defaultdict(float)
    agreg_dem: dict[str, float] = defaultdict(float)
    esc_adm: dict[str, float] = defaultdict(float)
    esc_dem: dict[str, float] = defaultdict(float)
    raca_adm: dict[str, float] = defaultdict(float)
    raca_dem: dict[str, float] = defaultdict(float)
    tempo_fx: dict[str, float] = defaultdict(float)
    tempo_vals: dict[str, list[float]] = defaultdict(list)
    sal_geral: dict[str, list[float]] = defaultdict(list)
    sal_sexo: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    sal_agreg: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    for row in rows:
        comp, mun, nome, secao, grup, saldo, cbo, grau, idade, tempo, raca, sexo, tipo, salario = row[:14]
        qty = abs(float(saldo))
        tipo_l = TIPO_MOV_LABEL.get(tipo, f"Tipo {tipo or '—'}")
        sexo_l = SEXO_LABEL.get(sexo, "Não informado")
        raca_l = RACA_LABEL.get(raca, "Não informada")
        grau_l = GRAU_LABEL.get(grau, "Não identificado")
        secao_l = SECAO_NOMES.get(secao, secao or "Não informado")
        fx = _idade_faixa(idade)
        mun_nome[mun] = nome
        if saldo > 0:
            tipo_adm[tipo_l] += qty
            sexo_adm[sexo_l] += qty
            if fx:
                faixa_adm[fx] += qty
                sexo_faixa_adm[sexo_l][fx] += qty
            cbo_adm[cbo] += qty
            mun_adm[mun] += qty
            secao_adm[secao_l] += qty
            agreg_adm[grup] += qty
            esc_adm[grau_l] += qty
            raca_adm[raca_l] += qty
            if salario is not None and salario > 0:
                sal_geral[comp].append(salario)
                sal_sexo[sexo_l][comp].append(salario)
                sal_agreg[grup][comp].append(salario)
        else:
            tipo_dem[tipo_l] += qty
            tipo_dem_mes[tipo_l][comp] += qty
            sexo_dem[sexo_l] += qty
            if fx:
                faixa_dem[fx] += qty
                sexo_faixa_dem[sexo_l][fx] += qty
            cbo_dem[cbo] += qty
            mun_dem[mun] += qty
            secao_dem[secao_l] += qty
            agreg_dem[grup] += qty
            esc_dem[grau_l] += qty
            raca_dem[raca_l] += qty
            tf = _tempo_faixa(tempo)
            if tf:
                tempo_fx[tf] += qty
            if tempo is not None:
                tempo_vals[comp].append(tempo)

    labels = [_comp_label(c) for c in display_comps]
    sal_periodo_vals = [v for c in display_comps for v in sal_geral.get(c, [])]
    salario_periodo = _trimmed_mean(sal_periodo_vals, trim=SALARIO_TRIM)
    salario_series = [
        {
            "label": "Salário médio geral",
            "valores": [_trimmed_mean(sal_geral.get(c, []), trim=SALARIO_TRIM) for c in display_comps],
        },
        {
            "label": "Salário médio homem",
            "valores": [_trimmed_mean(sal_sexo.get("Homem", {}).get(c, []), trim=SALARIO_TRIM) for c in display_comps],
        },
        {
            "label": "Salário médio mulher",
            "valores": [_trimmed_mean(sal_sexo.get("Mulher", {}).get(c, []), trim=SALARIO_TRIM) for c in display_comps],
        },
    ]
    salario_agreg = {
        "labels": labels,
        "series": [
            {
                "label": g,
                "valores": [_trimmed_mean(sal_agreg.get(g, {}).get(c, []), trim=SALARIO_TRIM) for c in display_comps],
            }
            for g in GRUPAMENTOS
        ],
    }

    top4_dem = sorted(tipo_dem.items(), key=lambda kv: kv[1], reverse=True)[:4]
    dem_top4 = {
        "labels": labels,
        "series": [
            {"label": nome_t, "valores": [tipo_dem_mes[nome_t].get(c, 0.0) for c in display_comps]}
            for nome_t, _ in top4_dem
        ],
    }

    fx_labels = [lab for lab, _ in FAIXAS_IDADE]
    sexo_labels = ["Homem", "Mulher"]

    def _sexo_faixa_block(src: dict[str, dict[str, float]]) -> dict[str, Any]:
        return {
            "labels": fx_labels,
            "series": [
                {"label": sx, "valores": [src.get(sx, {}).get(fx, 0.0) for fx in fx_labels]}
                for sx in sexo_labels
            ],
        }

    mun_saldo = {k: mun_adm.get(k, 0.0) - mun_dem.get(k, 0.0) for k in set(mun_adm) | set(mun_dem)}
    estoque_ok = not grup_list
    mun_est = _estoque_fim_por_municipio(mun_list, last, mun_nome) if estoque_ok and last else {}
    cbo_saldo = {k: cbo_adm.get(k, 0.0) - cbo_dem.get(k, 0.0) for k in set(cbo_adm) | set(cbo_dem)}
    secao_saldo = {k: secao_adm.get(k, 0.0) - secao_dem.get(k, 0.0) for k in set(secao_adm) | set(secao_dem)}
    agreg_saldo = {k: agreg_adm.get(k, 0.0) - agreg_dem.get(k, 0.0) for k in set(agreg_adm) | set(agreg_dem)}
    esc_saldo = {k: esc_adm.get(k, 0.0) - esc_dem.get(k, 0.0) for k in set(esc_adm) | set(esc_dem)}
    raca_saldo = {k: raca_adm.get(k, 0.0) - raca_dem.get(k, 0.0) for k in set(raca_adm) | set(raca_dem)}
    sexo_saldo = {k: sexo_adm.get(k, 0.0) - sexo_dem.get(k, 0.0) for k in set(sexo_adm) | set(sexo_dem)}

    def _mun_items(src: dict[str, float]) -> list[dict[str, Any]]:
        return _items({mun_nome.get(k, k): v for k, v in src.items()})

    ref_estado = None
    if not usa_base_oficial:
        ref_rows = _filter_rows(ano_list, [], [], [])
        ref_enc, _ = _encadear_estoque(
            _series_mensal(ref_rows),
            estoque_inicial=float(ESTOQUE_BASE_CE_202512),
            indice_base=float(ESTOQUE_BASE_CE_202512),
        )
        ref_estado = {
            "variacao_relativa_mes": [_lv(c, ref_enc[c]["variacao_relativa"]) for c in display_comps if c in ref_enc],
            "indice_emprego_encadeado": [
                _lv(c, (ref_enc[c]["indice"] - 100.0) if ref_enc[c]["indice"] is not None else None)
                for c in display_comps
                if c in ref_enc
            ],
            "taxa_rotatividade_mes": [_lv(c, ref_enc[c]["taxa_rotatividade"]) for c in display_comps if c in ref_enc],
        }

    periodo_label = (
        _comp_label(first)
        if first == last
        else f"{_comp_label(first)} – {_comp_label(last)}"
        if first and last
        else "—"
    )

    return {
        "arquivo": str(_resolve_csv_path()),
        "arquivo_nome": _resolve_csv_path().name,
        "arquivo_ativo": _resolve_csv_path().name,
        "unidade": _unidade(mun_list, grup_list),
        "total_linhas": len(rows),
        "filtros": {
            "anos": ano_list,
            "competencias": [_norm_comp_param(c) for c in comp_list],
            "municipios": mun_list,
            "regioes": regioes_list,
            "grupamentos": grup_list,
        },
        "periodo": {
            "admissoes": adm,
            "desligamentos": dem,
            "variacao_absoluta": var_abs_periodo,
            "variacao_relativa": var_rel,
            "taxa_rotatividade": tr,
            "estoque_inicio": e_ini,
            "estoque_fim": e_fim,
            "indice_emprego_encadeado": indice_fim,
            "indice_emprego_periodo": indice_periodo,
            "n_meses": len(display_comps),
            "label": periodo_label,
            "salario_medio": salario_periodo,
        },
        "estoque_base": {
            "valor": estoque_base_valor,
            "aplicavel": True,
            "oficial": usa_base_oficial,
            "aviso": None,
        },
        "formulas": {
            "variacao_absoluta": "A − D",
            "variacao_relativa": "(A − D) / E(1º dia) × 100",
            "taxa_rotatividade": "min(A, D) / E(1º dia) × 100",
            "indice": (
                "E_fim / estoque base 12/2025 × 100"
                if usa_base_oficial
                else "E_fim / saldo acumulado na série da base × 100"
            ),
            "salario": "Média aparada 2% nas admissões",
        },
        "referencia_estado": ref_estado,
        "flutuacao_admissoes": flut_adm,
        "flutuacao_desligamentos": flut_dem,
        "variacao_absoluta_mes": var_abs,
        "variacao_relativa_mes": var_rel_mes,
        "indice_emprego_encadeado": indice_mes,
        "taxa_rotatividade_mes": tr_mes,
        "admissoes_por_tipo": _items(tipo_adm),
        "desligamentos_por_tipo": _items(tipo_dem),
        "desligamentos_top4_mensal": dem_top4,
        "salario_medio": {
            "labels": labels,
            "series": salario_series,
            "agregacao": salario_agreg,
            "metodo": "média aparada 2% nas admissões",
        },
        "permanencia": {
            "faixas_desligados": [
                {"label": lab, "valor": tempo_fx.get(lab, 0.0)} for lab, _ in FAIXAS_TEMPO
            ],
            "serie_mensal": {
                "labels": labels,
                "series": [
                    {
                        "label": "Mediana (meses)",
                        "valores": [
                            (sorted(tempo_vals.get(c, []))[len(tempo_vals.get(c, [])) // 2]
                            if tempo_vals.get(c)
                            else None)
                            for c in display_comps
                        ],
                    },
                    {
                        "label": "Média aparada (meses)",
                        "valores": [_trimmed_mean(tempo_vals.get(c, [])) for c in display_comps],
                    },
                ],
            },
            "unidade": "meses",
        },
        "perfil_demografico": {
            "admissoes_sexo": _items(sexo_adm, sort_abs=False),
            "desligamentos_sexo": _items(sexo_dem, sort_abs=False),
            "saldo_sexo": _items(sexo_saldo, sort_abs=False),
            "admissoes_faixa": [{"label": lab, "valor": faixa_adm.get(lab, 0.0)} for lab, _ in FAIXAS_IDADE],
            "desligamentos_faixa": [{"label": lab, "valor": faixa_dem.get(lab, 0.0)} for lab, _ in FAIXAS_IDADE],
            "admissoes_sexo_faixa": _sexo_faixa_block(sexo_faixa_adm),
            "desligamentos_sexo_faixa": _sexo_faixa_block(sexo_faixa_dem),
        },
        "rankings": {
            "contratacoes": _items(cbo_adm, top=15),
            "desligamentos": _items(cbo_dem, top=15),
            "saldo": _items(cbo_saldo, top=15),
            "admissoes_municipio": _mun_items(mun_adm),
            "demissoes_municipio": _mun_items(mun_dem),
            "saldo_municipio": _mun_items(mun_saldo),
            "estoque_municipio": _mun_items(mun_est) if estoque_ok else [],
            "estoque_disponivel": estoque_ok,
        },
        "setores": {
            "contratacoes_secao": _items(secao_adm),
            "desligamentos_secao": _items(secao_dem),
            "saldo_secao": _items(secao_saldo),
            "contratacoes_agregacao": _items(agreg_adm, sort_abs=False),
            "desligamentos_agregacao": _items(agreg_dem, sort_abs=False),
            "saldo_agregacao": _items(agreg_saldo, sort_abs=False),
        },
        "escolaridade": {
            "contratacoes": _items(esc_adm),
            "desligamentos": _items(esc_dem),
            "saldo": _items(esc_saldo),
        },
        "raca_cor": {
            "contratacoes": _items(raca_adm),
            "desligamentos": _items(raca_dem),
            "saldo": _items(raca_saldo),
        },
    }


def _round_or_none(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _pct(part: float, whole: float) -> float | None:
    if whole <= 0:
        return None
    return round(100.0 * part / whole, 2)


def _new_acc() -> dict[str, Any]:
    return {
        "admissoes": 0.0,
        "desligamentos": 0.0,
        "adm_regulares": 0.0,
        "salarios": [],
        "tempos": [],
    }


def _is_jovem(idade: int | None) -> bool:
    return idade is not None and JOVEM_IDADE_MIN <= idade <= JOVEM_IDADE_MAX


def _is_regular(tipo: Any, intermitente: Any, parcial: Any) -> bool:
    if _tipo_code(tipo) == TIPO_CONTRATO_DETERMINADO:
        return False
    if intermitente:
        return False
    if parcial:
        return False
    return True


def _latest_competencia() -> str | None:
    _ensure_loaded()
    assert _OPCOES is not None
    meses = _OPCOES.get("meses") or []
    if not meses:
        return None
    return max((str(item.get("valor") or "") for item in meses), key=_comp_sort)


def _bloco_perfil(acc: dict[str, Any]) -> dict[str, Any]:
    adm = float(acc["admissoes"])
    return {
        "regularidade": _pct(float(acc["adm_regulares"]), adm),
        "salario_medio": _round_or_none(_trimmed_mean(acc["salarios"], trim=SALARIO_TRIM), 2),
        "permanencia_media": _round_or_none(_trimmed_mean(acc["tempos"], trim=SALARIO_TRIM), 1),
        "admissoes": adm,
        "desligamentos": float(acc["desligamentos"]),
    }


def resumo_perfil_vinculo(
    ano: int | None = None,
    mes: int | None = None,
    janela: int = 1,
) -> dict[str, Any]:
    """Indicadores da home: regularidade, salário e permanência por recorte."""
    _ensure_loaded()
    competencia = ""
    if ano and mes and 1 <= int(mes) <= 12:
        competencia = f"{int(ano):04d}{int(mes):02d}"
    if not competencia:
        competencia = _latest_competencia() or ""
    n_janela = 3 if int(janela or 1) >= 3 else 1
    comps = _janela_competencias(competencia, n_janela) if competencia else []
    cache_key = f"v6:{competencia}:j{n_janela}"
    if cache_key in _PERFIL_CACHE:
        return _PERFIL_CACHE[cache_key]

    rows = _filter_rows([], comps, [], []) if comps else []

    buckets = {
        "geral": _new_acc(),
        "homens": _new_acc(),
        "mulheres": _new_acc(),
        "jovens": _new_acc(),
        "negros": _new_acc(),
    }

    for row in rows:
        saldo = row[5]
        if not saldo:
            continue
        idade = row[8]
        tempo = row[9]
        raca = str(row[10] or "").strip()
        sexo = str(row[11] or "").strip()
        tipo = row[12]
        salario = row[13]
        intermitente = bool(row[14]) if len(row) > 14 else False
        parcial = bool(row[15]) if len(row) > 15 else False
        qty = abs(float(saldo))
        admissao = saldo > 0
        regular = admissao and _is_regular(tipo, intermitente, parcial)

        keys: list[str] = ["geral"]
        if sexo == "1":
            keys.append("homens")
        elif sexo == "3":
            keys.append("mulheres")
        if _is_jovem(idade):
            keys.append("jovens")
        if raca in {RACA_PRETA, RACA_PARDA}:
            keys.append("negros")

        for key in keys:
            acc = buckets[key]
            if admissao:
                acc["admissoes"] += qty
                if regular:
                    acc["adm_regulares"] += qty
                if salario is not None and salario > 0:
                    acc["salarios"].append(float(salario))
            else:
                acc["desligamentos"] += qty
                if tempo is not None and tempo >= 0:
                    acc["tempos"].append(float(tempo))

    recortes = {nome: _bloco_perfil(acc) for nome, acc in buckets.items()}
    comps_ord = sorted(comps, key=_comp_sort)
    if n_janela > 1 and len(comps_ord) >= 2:
        periodo_label = f"{_comp_label(comps_ord[0])} a {_comp_label(comps_ord[-1])}"
    else:
        periodo_label = _comp_label(competencia) if competencia else ""

    payload = {
        "periodo": {
            "competencia": competencia,
            "ano": int(competencia[:4]) if len(competencia) == 6 else None,
            "mes": int(competencia[4:6]) if len(competencia) == 6 else None,
            "janela": n_janela,
            "competencias": comps_ord,
            "label": periodo_label,
        },
        "recortes": recortes,
        "notas": {
            "fonte": "CAGED microdados (UF Ceará)",
            "jovens": f"{JOVEM_IDADE_MIN} a {JOVEM_IDADE_MAX} anos",
            "negros": "Preta + parda (IBGE)",
            "regularidade": "Percentual de admissões sem contrato determinado, intermitente ou parcial",
            "salario": "Média aparada 2% do salário de admissão",
            "permanencia": "Média aparada 2% do tempo de emprego nos desligamentos, em meses",
        },
    }
    if competencia:
        _PERFIL_CACHE[cache_key] = payload
    return payload

