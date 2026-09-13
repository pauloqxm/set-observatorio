"""
ETL do painel RAIS x CONDEC.

Le BASE_CONDEC.csv (protocolos de incentivo) e base_rais.csv.gz (vinculos formais),
cruza pelo CNPJ normalizado, consolida filiais pela raiz de 8 digitos, classifica
a atividade economica em 6 setores e grava os JSON colunares consumidos pela aba
CONDEC do observatorio.

Uso (na raiz do projeto):  py backend/etl/condec_preparar_dados.py
"""

import csv
import gzip
import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
SAIDA = RAIZ / "frontend" / "data" / "condec"

CONDEC_CSV = RAIZ / "BASE_CONDEC.csv"
RAIS_CSV_GZ = RAIZ / "base_rais.csv.gz"
RAIS_CSV = RAIZ / "base_rais.csv"
ENDERECOS_CSV = RAIZ / "empresas_enderecos.csv"
GEO_MUNICIPIOS = RAIZ / "frontend" / "geo" / "ce_regioes.geojson"
GEO_SEDES = RAIZ / "frontend" / "geo" / "CE_bacia_populacao.geojson"

# Ordem fixa; os indices sao gravados nos arquivos e lidos pelo front.
SETORES = ["Serviços", "Comércio", "Indústria", "Construção", "Agropecuária", "Não identificado"]
S_SERV, S_COM, S_IND, S_CONST, S_AGRO, S_NI = range(6)

PROGRAMAS = ["PROVIN", "PCDM", "PROADE", "PIER"]

# CNAE 95 classe 99999: a RAIS nao converteu o CNAE 2.0 e rotulou tudo como
# "Cultivo de melao". No Ceara esse balde e o estoque formal agro (CAGED
# 12/2025 = 28.297 vinculos privados; a RAIS tem ~28.8 mil nesse codigo).
CNAE95_BALDE = "99999"

csv.field_size_limit(1 << 24)


def log(*args):
    print(*args, flush=True)


def abrir_rais():
    """A base fica versionada compactada; o .csv solto e aceito para rodar local."""
    if RAIS_CSV_GZ.exists():
        return gzip.open(RAIS_CSV_GZ, "rt", encoding="utf-8-sig", newline="")
    if RAIS_CSV.exists():
        return open(RAIS_CSV, encoding="utf-8-sig", newline="")
    raise FileNotFoundError(f"base da RAIS nao encontrada em {RAIS_CSV_GZ} nem {RAIS_CSV}")


def dig(valor):
    return re.sub(r"\D", "", valor or "")


def cnpj14(valor):
    d = dig(valor)
    return d.zfill(14) if d else ""


def sem_acento(texto):
    base = unicodedata.normalize("NFKD", (texto or "").strip().upper())
    return "".join(c for c in base if not unicodedata.combining(c))


def num(valor):
    if not valor:
        return 0.0
    try:
        return float(str(valor).strip().replace(",", "."))
    except ValueError:
        return 0.0


def chave_ref(texto):
    """Ordena competências da RAIS (MM/AAAA ou AAAA) da mais antiga para a mais nova."""
    t = (texto or "").strip()
    m = re.match(r"^(\d{1,2})/(\d{4})$", t)
    if m:
        return (int(m.group(2)), int(m.group(1)))
    m = re.match(r"^(\d{4})$", t)
    if m:
        return (int(m.group(1)), 12)
    return (0, 0)


def parse_coord(valor):
    s = str(valor or "").strip().replace(" ", "")
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def ler_coordenadas():
    """CNPJ 14 dígitos -> (lon, lat) quando a geocodificação em empresas_enderecos.csv deu certo."""
    coords = {}
    if not ENDERECOS_CSV.exists():
        return coords
    with open(ENDERECOS_CSV, encoding="utf-8-sig", newline="") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            cnpj = cnpj14(linha.get("cnpj") or linha.get("cruz_cnpj") or "")
            if not cnpj:
                continue
            status = (linha.get("Status_Geocodificacao") or "").strip().lower()
            if status != "ok":
                continue
            lat = parse_coord(linha.get("Latitude"))
            lon = parse_coord(linha.get("Longitude"))
            if lat is None or lon is None:
                continue
            if not (-9.0 <= lat <= -2.0 and -42.0 <= lon <= -37.0):
                continue
            coords[cnpj] = (round(lon, 6), round(lat, 6))
    return coords


def ano(data):
    m = re.search(r"(\d{4})", data or "")
    return int(m.group(1)) if m else 0


def offset_pinos(n, passo=32.0):
    """Deslocamento em pixels em aneis hexagonais. O primeiro ponto fica na sede."""
    pts = [(0.0, 0.0)]
    k = 1
    anel = 1
    while k < n:
        qtd = 6 * anel
        giro = (math.pi / qtd) if anel % 2 else 0.0
        for i in range(qtd):
            if k >= n:
                break
            ang = 2 * math.pi * i / qtd + giro
            raio = passo * anel
            pts.append((round(raio * math.cos(ang), 1), round(raio * math.sin(ang), 1)))
            k += 1
        anel += 1
    return pts


# Natureza jurídica IBGE: 1xxx = administração pública; 201-1 empresa pública;
# 203-8 economia mista; 306-9/307-7/308-5 fundações públicas de direito privado.
PUB_PRIV, PUB_PUB, PUB_NI = 0, 1, 2
PUB_CODIGOS = {2011, 2038, 3069, 3077, 3085, 201, 203, 306, 307, 308}


def classe_institucional(codigo):
    """0 = privado, 1 = público, 2 = não informado."""
    d = re.sub(r"\D", "", str(codigo or ""))
    if not d or d in ("0", "00", "0000", "9999"):
        return PUB_NI
    n = int(d)
    if 1000 <= n <= 1999 or 100 <= n <= 199 or n in PUB_CODIGOS:
        return PUB_PUB
    return PUB_PRIV


# Faixas oficiais do MTE/RAIS, na ordem crescente. A descrição do CSV vem
# deslocada (código 2 = 1 a 4 vínculos, mas o texto diz "5 a 9").
FAIXAS_TAMANHO = [
    "0 vínculos",
    "1 a 4 vínculos",
    "5 a 9 vínculos",
    "10 a 19 vínculos",
    "20 a 49 vínculos",
    "50 a 99 vínculos",
    "100 a 249 vínculos",
    "250 a 499 vínculos",
    "500 a 999 vínculos",
    "1000 ou mais vínculos",
]
TAM_NI = "Não informado"


def classe_tamanho(vinculos):
    """Índice em FAIXAS_TAMANHO a partir da quantidade real de vínculos da linha."""
    v = int(vinculos or 0)
    if v <= 0:
        return 0
    if v <= 4:
        return 1
    if v <= 9:
        return 2
    if v <= 19:
        return 3
    if v <= 49:
        return 4
    if v <= 99:
        return 5
    if v <= 249:
        return 6
    if v <= 499:
        return 7
    if v <= 999:
        return 8
    return 9


# Producao primaria agro. Nao inclui comercio, fabricacao ou maquinas agricolas.
_AGRO_DESC_EXCLUI = (
    "COMERCIO", "FABRICACAO", "MANUTENCAO", "REPARACAO",
    "MAQUINAS", "APARELHOS", "ARTEFATOS", "ATACADISTA", "VAREJISTA",
)
_AGRO_DESC_INCLUI = (
    "CULTIVO DE",
    "CRIACAO DE",
    "HORTICULTURA",
    "SILVICULTURA",
    "AQUICULTURA",
    "PESCA DE",
    "COLETA DE PRODUTOS",
    "ATIVIDADES DE APOIO A PECUARIA",
    "ATIVIDADES DE APOIO A AGRICULTURA",
    "ATIVIDADES DE APOIO A PRODUCAO FLORESTAL",
    "PRODUCAO FLORESTAL",
    "EXPLORACAO FLORESTAL",
)


def descricao_e_producao_agro(desc):
    """True se a descricao e atividade primaria agro (nao comercio/industria)."""
    d = sem_acento(desc)
    if not d:
        return False
    if any(p in d for p in _AGRO_DESC_EXCLUI):
        return False
    return any(p in d for p in _AGRO_DESC_INCLUI)


def setor_cnae95(codigo):
    """Classe CNAE 95/1.0 com 5 digitos -> indice de setor.

    A RAIS frequentemente entrega o codigo sem o zero a esquerda (`1414` em vez
    de `01414`). Sem completar, a divisao vira 14 (industria) e some a
    Agropecuaria. Divisoes 01-05 cobrem CNAE 95 (01, 02, 05) e CNAE 2.0 (01-03).
    """
    codigo = dig(codigo)
    if not codigo:
        return S_NI
    if codigo == CNAE95_BALDE or codigo.zfill(5) == CNAE95_BALDE:
        return S_AGRO
    codigo = codigo.zfill(5)
    try:
        div = int(codigo[:2])
    except ValueError:
        return S_NI
    if 1 <= div <= 5:
        return S_AGRO
    if 10 <= div <= 37 or div in (40, 41):
        return S_IND
    if div == 45:
        return S_CONST
    if div in (50, 51, 52):
        return S_COM
    if 55 <= div <= 99:
        return S_SERV
    return S_NI


def setor_cnae20(codigo):
    """Subclasse CNAE 2.0 com 7 digitos -> indice de setor."""
    codigo = dig(codigo)
    if len(codigo) < 2:
        return S_NI
    codigo = codigo.zfill(7)
    div = int(codigo[:2])
    if 1 <= div <= 3:
        return S_AGRO
    if 5 <= div <= 33 or 35 <= div <= 39:
        return S_IND
    if 41 <= div <= 43:
        return S_CONST
    if 45 <= div <= 47:
        return S_COM
    if 49 <= div <= 97:
        return S_SERV
    return S_NI


def classificar_setor(codigo95, desc=None, cnae20=None):
    """Setor do estabelecimento: CNAE 2.0 do protocolo, senao CNAE 95 + descricao.

    Codigos de 5 digitos sem o zero (`11207` = cultivo de algodao, `14222` =
    criacao de equinos, `51187` = pesca) colidem com industria ou comercio.
    A descricao de producao primaria recupera esses casos. O balde 99999
    ("Cultivo de melao") e o estoque agro sem CNAE convertido — no Ceara
    coincide com o estoque CAGED da Agropecuaria.
    """
    if cnae20:
        setor = setor_cnae20(cnae20)
        if setor != S_NI:
            return setor
    setor = setor_cnae95(codigo95)
    if setor == S_AGRO:
        return setor
    codigo = dig(codigo95)
    if not codigo:
        return S_NI
    if descricao_e_producao_agro(desc):
        return S_AGRO
    return setor


def carregar_geografia():
    """Codigo IBGE de 6 digitos -> nome, regiao administrativa, sede e populacao."""
    municipios = {}
    with open(GEO_MUNICIPIOS, encoding="utf-8") as f:
        for feat in json.load(f).get("features", []):
            p = feat.get("properties") or {}
            geo = p.get("GEO_CODI")
            if geo is None:
                continue
            cod = str(int(geo) // 10)
            municipios[cod] = {
                "cod": cod,
                "nome": p.get("Municipio") or "",
                "regiao": p.get("Região") or p.get("Regiao") or "",
                "lat": None,
                "lon": None,
                "pop": 0,
            }
    with open(GEO_SEDES, encoding="utf-8") as f:
        for feat in json.load(f).get("features", []):
            p = feat.get("properties") or {}
            geo = p.get("GEOCODIGO")
            if geo is None:
                continue
            cod = str(int(geo) // 10)
            alvo = municipios.get(cod)
            if not alvo:
                continue
            coord = (feat.get("geometry") or {}).get("coordinates") or [None, None]
            alvo["lon"] = num(p.get("Longitude")) or coord[0]
            alvo["lat"] = num(p.get("Latitude")) or coord[1]
            alvo["pop"] = int(num(p.get("populacao")))
    return municipios


def ler_condec():
    protocolos = []
    with open(CONDEC_CSV, encoding="utf-8-sig", newline="") as f:
        for linha in csv.DictReader(f):
            cnpj = cnpj14(linha.get("CNPJ"))
            if not cnpj:
                continue
            cnae_bruto = (linha.get("CNAE (ATIVIDADE PRINCIPAL)") or "").strip()
            cnae_cod, _, cnae_desc = cnae_bruto.partition(" - ")
            protocolos.append(
                {
                    "id": (linha.get("ID") or "").strip(),
                    "cnpj": cnpj,
                    "raiz": cnpj[:8],
                    "cgf": (linha.get("CGF") or "").strip(),
                    "empresa": " ".join((linha.get("EMPRESA") or "").split()),
                    "municipio": (linha.get("MUNICÍPIO") or "").strip(),
                    "cnae20": dig(cnae_cod),
                    "cnae20_desc": cnae_desc.strip(),
                    "inicio": ano(linha.get("DATA INÍCIO")),
                    "vigencia": ano(linha.get("VIGÊNCIA")),
                    "programa": (linha.get("PROGRAMA") or "").strip().upper(),
                    "pi": int(num(dig(linha.get("EMPREGOS PI")))),
                    "obs": (linha.get("OBS") or "").strip(),
                    "status": (linha.get("Status") or "").strip(),
                    "spe": (linha.get("Parceira SPE") or "").strip().upper(),
                }
            )
    return protocolos


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    SAIDA.mkdir(parents=True, exist_ok=True)

    geo = carregar_geografia()
    log(f"geografia: {len(geo)} municipios")

    protocolos = ler_condec()
    log(f"CONDEC: {len(protocolos)} protocolos")

    por_cnpj = {p["cnpj"]: p for p in protocolos}
    raizes_incentivadas = defaultdict(list)
    for p in protocolos:
        raizes_incentivadas[p["raiz"]].append(p)
    log(f"CONDEC: {len(raizes_incentivadas)} raizes de CNPJ")

    # Dimensoes descobertas na leitura da RAIS, para manter os indices estaveis.
    mun_idx, municipios = {}, []
    for cod in sorted(geo):
        mun_idx[cod] = len(municipios)
        municipios.append(geo[cod])
    mun_por_nome = {sem_acento(m["nome"]): i for i, m in enumerate(municipios)}

    cnae_idx, cnaes = {}, []
    tamanhos = list(FAIXAS_TAMANHO) + [TAM_NI]
    i_tam_ni = len(FAIXAS_TAMANHO)
    cele_idx, celetistas = {}, []
    calc_idx, calcadistas = {}, []
    raiz_idx, raizes = {}, []

    col = {
        "mun": [], "cnae": [], "setor": [], "calc": [], "tam": [], "cele": [],
        "inc": [], "sr": [], "pp": [], "prog": [], "spe": [], "ini": [], "fim": [],
        "pi": [], "v": [], "rem": [], "raiz": [], "ref": [], "pub": [],
    }
    cnpjs, razoes = [], []
    ref_idx, referencias = {}, []

    linhas_rais = 0
    vistos_condec = set()
    vistos_pp = set()
    # Agregacao por CNPJ para a camada de pontos e para o consolidado das empresas.
    agg_cnpj = defaultdict(lambda: {"v": 0, "massa": 0.0, "mun": -1, "razao": "", "n": 0})

    def indice(mapa, lista, chave, valor=None):
        i = mapa.get(chave)
        if i is None:
            i = len(lista)
            mapa[chave] = i
            lista.append(valor if valor is not None else chave)
        return i

    with abrir_rais() as f:
        for linha in csv.DictReader(f, delimiter=";"):
            linhas_rais += 1
            cnpj = cnpj14(linha["CNPJ / CEI"])
            raiz = cnpj[:8]
            proto = por_cnpj.get(cnpj)
            protos_raiz = raizes_incentivadas.get(raiz)

            cod_mun = (linha["Município - Código"] or "").strip()
            i_mun = mun_idx.get(cod_mun, -1)

            cnae_cod = (linha["CNAE 95 Classe - Código"] or "").strip()
            cnae_desc = (linha["CNAE 95 Classe - Descrição"] or "").strip()
            i_cnae = indice(
                cnae_idx, cnaes, cnae_cod,
                {"cod": cnae_cod, "desc": cnae_desc},
            )
            # Protocolo tem CNAE 2.0, mais preciso; filial sem protocolo fica com
            # o CNAE 95, completado e conferido pela descricao de producao agro.
            setor = classificar_setor(
                cnae_cod,
                desc=cnae_desc,
                cnae20=proto["cnae20"] if proto else None,
            )

            vinculos = int(num(linha["qtd_vinculos"]))
            rem = num(linha["Vl Rem Média Nom"])
            ref_txt = (linha.get("Referência") or "").strip() or "sem referência"
            i_ref = indice(ref_idx, referencias, ref_txt)

            # Um CNPJ pode ter mais de uma linha na RAIS (uma por CNAE declarado).
            # O protocolo é ancorado uma vez por competência, para o PI não
            # desaparecer ao filtrar outro ano nem ser somado duas vezes no mesmo.
            principal = 0
            if proto:
                inc, protos = 2, [proto]
                chave_pp = (cnpj, ref_txt)
                if chave_pp not in vistos_pp:
                    principal = 1
                    vistos_pp.add(chave_pp)
                vistos_condec.add(cnpj)
            elif protos_raiz:
                inc, protos = 1, protos_raiz
            else:
                inc, protos = 0, []

            mascara_prog = 0
            mascara_spe = 0
            for p in protos:
                if p["programa"] in PROGRAMAS:
                    mascara_prog |= 1 << PROGRAMAS.index(p["programa"])
                mascara_spe |= 1 if p["spe"] == "SIM" else 2
            anos_ini = [p["inicio"] for p in protos if p["inicio"]]
            anos_fim = [p["vigencia"] for p in protos if p["vigencia"]]

            col["mun"].append(i_mun)
            col["cnae"].append(i_cnae)
            col["setor"].append(setor)
            col["calc"].append(indice(calc_idx, calcadistas, (linha["Calçadista"] or "").strip() or "Não informado"))
            col["tam"].append(classe_tamanho(vinculos))
            col["cele"].append(indice(cele_idx, celetistas, (linha["Celetista ou Estatutário"] or "").strip() or "Não informado"))
            col["inc"].append(inc)
            col["sr"].append(0)
            col["pp"].append(principal)
            col["prog"].append(mascara_prog)
            col["spe"].append(mascara_spe)
            col["ini"].append(min(anos_ini) if anos_ini else 0)
            col["fim"].append(max(anos_fim) if anos_fim else 0)
            col["pi"].append(proto["pi"] if principal else 0)
            col["v"].append(vinculos)
            col["rem"].append(round(rem, 2))
            col["raiz"].append(indice(raiz_idx, raizes, raiz))
            col["ref"].append(i_ref)
            col["pub"].append(classe_institucional(linha.get("Natureza Jurídica - Código")))

            razao = " ".join((linha["Razão Social"] or "").split())
            cnpjs.append(cnpj)
            razoes.append(razao)

            a = agg_cnpj[cnpj]
            a["v"] += vinculos
            a["massa"] += rem * vinculos
            a["n"] += 1
            if a["mun"] < 0:
                a["mun"] = i_mun
            if not a["razao"]:
                a["razao"] = razao

    # Indices na ordem de aparição no CSV; o painel precisa da cronológica
    # (mais nova por último) para o filtro default e o gráfico de linhas.
    ordem = sorted(range(len(referencias)), key=lambda i: chave_ref(referencias[i]))
    remap = {antigo: novo for novo, antigo in enumerate(ordem)}
    col["ref"] = [remap[i] for i in col["ref"]]
    referencias = [referencias[i] for i in ordem]
    i_nova = len(referencias) - 1
    log(f"RAIS: {linhas_rais} linhas, referencias={', '.join(referencias) or '—'}")
    log(f"match exato de CNPJ: {len(vistos_condec)} de {len(protocolos)} protocolos")

    # Protocolos sem nenhum estabelecimento na RAIS entram como registros sem emprego,
    # para nao desaparecerem dos KPIs de compromisso nem da tabela.
    sem_rais = [p for p in protocolos if p["cnpj"] not in vistos_condec]
    i_cnae_ni = indice(cnae_idx, cnaes, "", {"cod": "", "desc": "Sem informação na RAIS"})
    for p in sem_rais:
        col["mun"].append(mun_por_nome.get(sem_acento(p["municipio"]), -1))
        col["cnae"].append(i_cnae_ni)
        col["setor"].append(setor_cnae20(p["cnae20"]) if p["cnae20"] else S_NI)
        col["calc"].append(indice(calc_idx, calcadistas, "Não informado"))
        col["tam"].append(i_tam_ni)
        col["cele"].append(indice(cele_idx, celetistas, "Não informado"))
        col["inc"].append(2)
        col["sr"].append(1)
        col["pp"].append(1)
        col["prog"].append(1 << PROGRAMAS.index(p["programa"]) if p["programa"] in PROGRAMAS else 0)
        col["spe"].append(1 if p["spe"] == "SIM" else 2)
        col["ini"].append(p["inicio"])
        col["fim"].append(p["vigencia"])
        col["pi"].append(p["pi"])
        col["v"].append(0)
        col["rem"].append(0)
        col["raiz"].append(indice(raiz_idx, raizes, p["raiz"]))
        col["ref"].append(-1)
        col["pub"].append(PUB_NI)
        cnpjs.append(p["cnpj"])
        razoes.append(p["empresa"])
    log(f"protocolos sem estabelecimento na RAIS: {len(sem_rais)}")

    agg_nova = defaultdict(lambda: {"v": 0, "massa": 0.0, "mun": -1, "razao": "", "n": 0})
    for i, cnpj in enumerate(cnpjs):
        if col["ref"][i] != i_nova:
            continue
        a = agg_nova[cnpj]
        a["v"] += col["v"][i]
        a["massa"] += col["v"][i] * col["rem"][i]
        a["n"] += 1
        if a["mun"] < 0:
            a["mun"] = col["mun"][i]
        if not a["razao"]:
            a["razao"] = razoes[i]

    # ---------- consolidado por raiz incentivada ----------
    posicoes_por_raiz = defaultdict(list)
    for i, r in enumerate(col["raiz"]):
        posicoes_por_raiz[r].append(i)

    empresas = []
    for raiz in sorted(raizes_incentivadas):
        protos = raizes_incentivadas[raiz]
        estabs = [
            i for i in posicoes_por_raiz.get(raiz_idx.get(raiz, -1), [])
            if col["ref"][i] < 0 or col["ref"][i] == i_nova
        ]
        vinculos = sum(col["v"][i] for i in estabs)
        massa = sum(col["v"][i] * col["rem"][i] for i in estabs)
        muns = [col["mun"][i] for i in estabs if col["mun"][i] >= 0]
        empresas.append(
            {
                "raiz": raiz,
                "ridx": raiz_idx.get(raiz, -1),
                "nome": max((p["empresa"] for p in protos), key=len),
                "protocolos": [
                    {
                        "id": p["id"], "cnpj": p["cnpj"], "cgf": p["cgf"], "programa": p["programa"],
                        "pi": p["pi"], "inicio": p["inicio"], "vigencia": p["vigencia"],
                        "spe": p["spe"], "status": p["status"], "municipio": p["municipio"],
                        "cnae20": p["cnae20"], "cnae20_desc": p["cnae20_desc"], "obs": p["obs"],
                        "na_rais": p["cnpj"] in vistos_condec,
                    }
                    for p in sorted(protos, key=lambda x: x["cnpj"])
                ],
                "estabelecimentos": len(estabs),
                "com_protocolo": sum(1 for i in estabs if col["pp"][i] == 1 and col["sr"][i] == 0),
                "filiais_extras": sum(1 for i in estabs if col["inc"][i] == 1),
                "pi": sum(p["pi"] for p in protos),
                "vinculos": vinculos,
                "rem": round(massa / vinculos, 2) if vinculos else 0,
                "municipios": sorted(set(muns)),
                "setores": sorted({col["setor"][i] for i in estabs}),
            }
        )
    log(f"empresas consolidadas: {len(empresas)}")
    log(f"estabelecimentos das raizes incentivadas: {sum(e['estabelecimentos'] for e in empresas)}")
    log(f"vinculos das raizes incentivadas: {sum(e['vinculos'] for e in empresas)}")

    # ---------- pontos das unidades incentivadas ----------
    # Coordenadas reais de empresas_enderecos.csv (geocodificação ok). Sem match,
    # o protocolo fica na sede municipal — o front agrupa pinos no mesmo ponto.
    coords_end = ler_coordenadas()
    log(f"enderecos geocodificados: {len(coords_end)} CNPJs")
    por_municipio = defaultdict(list)
    for p in protocolos:
        agg = agg_cnpj.get(p["cnpj"])
        i_mun = agg["mun"] if agg and agg["mun"] >= 0 else mun_por_nome.get(sem_acento(p["municipio"]), -1)
        if i_mun >= 0:
            por_municipio[i_mun].append(p)

    feats = []
    n_endereco = 0
    n_sede = 0
    for i_mun, lista in por_municipio.items():
        m = municipios[i_mun]
        if m["lat"] is None or m["lon"] is None:
            continue
        ordenada = sorted(lista, key=lambda x: (-(agg_cnpj.get(x["cnpj"]) or {}).get("v", 0), x["cnpj"]))
        for p in ordenada:
            xy = coords_end.get(p["cnpj"])
            if xy:
                lon, lat = xy
                origem = "endereco"
                n_endereco += 1
            else:
                lon, lat = round(m["lon"], 6), round(m["lat"], 6)
                origem = "sede"
                n_sede += 1
            snap = agg_nova.get(p["cnpj"])
            agg = snap or agg_cnpj.get(p["cnpj"])
            feats.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "cnpj": p["cnpj"],
                        "unidade": p["empresa"],
                        "municipio": m["nome"],
                        "cod_ibge": m["cod"],
                        "programa": p["programa"],
                        "setor": SETORES[setor_cnae20(p["cnae20"]) if p["cnae20"] else S_NI],
                        "pi": p["pi"],
                        "vinculos": snap["v"] if snap else 0,
                        "rem": round(snap["massa"] / snap["v"], 2) if snap and snap["v"] else 0,
                        "inicio": p["inicio"],
                        "vigencia": p["vigencia"],
                        "spe": p["spe"],
                        "na_rais": bool(agg),
                        "geo": origem,
                        "ox": 0,
                        "oy": 0,
                        "ioff": [0, 0],
                    },
                }
            )
    log(f"pontos de unidades: {len(feats)} (endereco={n_endereco}, sede={n_sede})")

    # ---------- gravacao ----------
    def grava(nome, obj):
        # O tamanho vem do texto serializado: em pastas sincronizadas na nuvem o
        # stat() logo após a escrita costuma devolver um valor defasado.
        texto = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        (SAIDA / nome).write_text(texto, encoding="utf-8")
        log(f"  {nome}: {len(texto.encode('utf-8')) / 1024 / 1024:.2f} MB")

    n = len(col["v"])
    stats_ref = [{"registros": 0, "vinculos": 0, "massa": 0.0} for _ in referencias]
    for i, r in enumerate(col["ref"]):
        if r < 0 or r >= len(stats_ref):
            continue
        stats_ref[r]["registros"] += 1
        stats_ref[r]["vinculos"] += col["v"][i]
        stats_ref[r]["massa"] += col["v"][i] * col["rem"][i]
    por_referencia = [
        {
            "nome": nome,
            "registros": s["registros"],
            "vinculos": s["vinculos"],
            "rem_media": round(s["massa"] / s["vinculos"], 2) if s["vinculos"] else 0,
        }
        for nome, s in zip(referencias, stats_ref)
    ]
    nova = por_referencia[-1] if por_referencia else {"vinculos": 0, "rem_media": 0, "nome": ""}

    dimensoes = {
        "referencia": nova["nome"],
        "referencias": referencias,
        "setores": SETORES,
        "programas": PROGRAMAS,
        "municipios": municipios,
        "cnaes": cnaes,
        "tamanhos": tamanhos,
        "celetistas": celetistas,
        "calcadistas": calcadistas,
        "totais": {
            "registros": n,
            "raizes": len(raizes),
            "linhas_rais": linhas_rais,
            "vinculos_rais": nova["vinculos"],
            "rem_media_rais": nova["rem_media"],
            "por_referencia": por_referencia,
            "protocolos": len(protocolos),
            "raizes_incentivadas": len(raizes_incentivadas),
            "protocolos_na_rais": len(vistos_condec),
            "protocolos_sem_rais": len(sem_rais),
            "pi_total": sum(p["pi"] for p in protocolos),
        },
    }

    log("gravando:")
    grava("dimensoes.json", dimensoes)
    grava("estab_num.json", {"n": n, **col})
    grava("estab_texto.json", {"cnpj": cnpjs, "razao": razoes, "raizes": raizes})
    grava("empresas.json", empresas)
    grava("unidades.geojson", {"type": "FeatureCollection", "features": feats})

    # O front rele este CSV a cada carga da aba, para uma empresa nova entrar no
    # mapa sem rerodar o ETL; por isso ele tambem vai para a pasta servida.
    if ENDERECOS_CSV.exists():
        (SAIDA / "empresas_enderecos.csv").write_bytes(ENDERECOS_CSV.read_bytes())
        log("  empresas_enderecos.csv: copiado para a pasta servida")

    log(f"conferencia: protocolos ancorados na ref nova={sum(1 for r, p in zip(col['ref'], col['pp']) if r == i_nova and p)} | empregos comprometidos={sum(p['pi'] for p in protocolos)}")
    dist = defaultdict(int)
    for s, v, r in zip(col["setor"], col["v"], col["ref"]):
        if r == i_nova:
            dist[SETORES[s]] += v
    log("vinculos por setor (" + nova["nome"] + "): " + ", ".join(f"{k}={v}" for k, v in sorted(dist.items(), key=lambda x: -x[1])))
    inst = defaultdict(int)
    nomes_inst = {PUB_PRIV: "privado", PUB_PUB: "publico", PUB_NI: "nao informado"}
    for p, v, r in zip(col["pub"], col["v"], col["ref"]):
        if r == i_nova:
            inst[nomes_inst.get(p, p)] += v
    log("vinculos por setor institucional (" + nova["nome"] + "): " + ", ".join(f"{k}={v}" for k, v in sorted(inst.items(), key=lambda x: -x[1])))
    log("concluido")


if __name__ == "__main__":
    main()
