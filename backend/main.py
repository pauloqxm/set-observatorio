from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .services.sheets import get_indicadores, get_sheet_data, get_sheet_names

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


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


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


@app.get("/api/abas/{sheet_name}")
def api_aba(sheet_name: str) -> dict:
    if sheet_name not in get_sheet_names():
        raise HTTPException(status_code=404, detail="Aba nao encontrada")
    data = get_sheet_data(sheet_name)
    return {"aba": sheet_name, "total": len(data), "dados": data}
