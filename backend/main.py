from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .services.sheets import get_indicadores, get_meta, get_sheet_data, get_sheet_names
from .services.home_qualificacao import get_qualificacao_home_summary
from .services.caged_estatisticas import opcoes_filtros as caged_estats_opcoes
from .services.caged_estatisticas import resumo_estatisticas as caged_estats_resumo
from .services.caged_estatisticas import resumo_perfil_vinculo as caged_perfil_vinculo

app = FastAPI(
    title="Portal de Empregabilidade",
    version="1.0.0",
    description="API para indicadores de empregabilidade e empreendedorismo do Ceara.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
logger = logging.getLogger(__name__)


@app.on_event("startup")
def _warmup_caged_estatisticas() -> None:
    try:
        caged_estats_opcoes()
    except Exception as exc:
        logger.warning("Warmup das estatísticas CAGED ignorado: %s", exc)


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/mapa")
def mapa_page() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "mapa.html")


@app.get("/favicon.ico")
def favicon() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "favicon.svg", media_type="image/svg+xml")


@app.get("/api/indicadores")
def api_indicadores(
    tema: str | None = Query(default=None),
    categoria: str | None = Query(default=None),
    ano: str | None = Query(default=None),
    mes: str | None = Query(default=None),
) -> dict:
    rows = get_indicadores()

    def include(item: dict) -> bool:
        if tema and item.get("tema") != tema:
            return False
        if categoria and item.get("categoria") != categoria:
            return False
        if ano and item.get("ano") != ano:
            return False
        if mes and item.get("mes") != mes:
            return False
        return True

    filtered = [item for item in rows if include(item)]
    return {
        "total": len(filtered),
        "dados": filtered,
    }


@app.get("/api/abas")
def api_abas() -> dict:
    sheets = get_sheet_names()
    return {"total": len(sheets), "abas": sheets}


@app.get("/api/meta")
def api_meta() -> dict:
    return get_meta()


@app.get("/api/home/qualificacao")
def api_home_qualificacao() -> dict:
    try:
        return get_qualificacao_home_summary()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/caged/estatisticas/opcoes")
def api_caged_estatisticas_opcoes() -> dict:
    try:
        return caged_estats_opcoes()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/caged/estatisticas")
def api_caged_estatisticas(
    anos: str | None = Query(default=None),
    competencias: str | None = Query(default=None),
    meses: str | None = Query(default=None),
    municipios: str | None = Query(default=None),
    regioes: str | None = Query(default=None),
    grupamentos: str | None = Query(default=None),
    agregacoes: str | None = Query(default=None),
) -> dict:
    try:
        return caged_estats_resumo(
            anos=anos,
            competencias=competencias,
            meses=meses,
            municipios=municipios,
            regioes=regioes,
            grupamentos=grupamentos,
            agregacoes=agregacoes,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/home/caged-perfil")
def api_home_caged_perfil(
    ano: int | None = Query(default=None),
    mes: int | None = Query(default=None),
) -> dict:
    try:
        return caged_perfil_vinculo(ano=ano, mes=mes)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/abas/{sheet_name}")
def api_aba(sheet_name: str) -> dict:
    if sheet_name not in get_sheet_names():
        raise HTTPException(status_code=404, detail="Aba nao encontrada")
    data = get_sheet_data(sheet_name)
    return {"aba": sheet_name, "total": len(data), "dados": data}
