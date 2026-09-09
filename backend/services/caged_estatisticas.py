from __future__ import annotations

import csv
import logging
import threading
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Any

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT_DIR / "caged_base.csv"

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

_LOCK = threading.Lock()
_ROWS: list[tuple] | None = None
_OPCOES: dict[str, Any] | None = None


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


def _ensure_loaded() -> None:
    global _ROWS, _OPCOES
    if _ROWS is not None:
        return
    with _LOCK:
        if _ROWS is not None:
            return
        if not CSV_PATH.exists():
            raise FileNotFoundError(f"Arquivo CAGED não encontrado: {CSV_PATH}")
        logger.info("Carregando %s", CSV_PATH)
        rows: list[tuple] = []
        anos: set[str] = set()
        comps: set[str] = set()
        muns: dict[str, str] = {}
        grups: set[str] = set()
        with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as fh:
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
            "arquivo": str(CSV_PATH),
            "arquivo_nome": CSV_PATH.name,
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
    for comp, _mun, _nome, _secao, _grup, saldo, _cbo, _grau, _idade, _tempo, _raca, _sexo, _tipo, _sal in rows:
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
        comp, mun, nome, secao, grup, saldo, cbo, grau, idade, tempo, raca, sexo, tipo, salario = row
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
    cbo_saldo = {k: cbo_adm.get(k, 0.0) - cbo_dem.get(k, 0.0) for k in set(cbo_adm) | set(cbo_dem)}
    secao_saldo = {k: secao_adm.get(k, 0.0) - secao_dem.get(k, 0.0) for k in set(secao_adm) | set(secao_dem)}
    agreg_saldo = {k: agreg_adm.get(k, 0.0) - agreg_dem.get(k, 0.0) for k in set(agreg_adm) | set(agreg_dem)}
    esc_saldo = {k: esc_adm.get(k, 0.0) - esc_dem.get(k, 0.0) for k in set(esc_adm) | set(esc_dem)}
    raca_saldo = {k: raca_adm.get(k, 0.0) - raca_dem.get(k, 0.0) for k in set(raca_adm) | set(raca_dem)}
    sexo_saldo = {k: sexo_adm.get(k, 0.0) - sexo_dem.get(k, 0.0) for k in set(sexo_adm) | set(sexo_dem)}

    def _mun_items(src: dict[str, float]) -> list[dict[str, Any]]:
        return _items({mun_nome.get(k, k): v for k, v in src.items()}, top=15)

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
        "arquivo": str(CSV_PATH),
        "arquivo_nome": CSV_PATH.name,
        "arquivo_ativo": CSV_PATH.name,
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
            "estoque_municipio": [],
            "estoque_disponivel": False,
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
