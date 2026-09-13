"""Acesso restrito às abas CONDEC e Estatísticas CAGED.

O token vem da variável de ambiente RESTRICTED_ACCESS_TOKEN (Railway).
Sem a variável, as abas ficam públicas (desenvolvimento local).
A sessão dura ACCESS_IDLE_MINUTES (padrão 15) sem mouse ou teclado.
"""

from __future__ import annotations

import hashlib
import hmac
import os

COOKIE_NAME = "obs_restrito"
ENV_TOKEN = "RESTRICTED_ACCESS_TOKEN"
ENV_IDLE_MINUTES = "ACCESS_IDLE_MINUTES"
IDLE_MINUTES_PADRAO = 15
ABAS_RESTRITAS = frozenset({"condec", "caged_estatisticas"})


def idle_minutos() -> int:
    bruto = (os.environ.get(ENV_IDLE_MINUTES) or "").strip()
    if not bruto:
        return IDLE_MINUTES_PADRAO
    try:
        valor = int(bruto)
    except ValueError:
        return IDLE_MINUTES_PADRAO
    return max(1, min(valor, 24 * 60))


def cookie_max_age() -> int:
    return idle_minutos() * 60


def token_configurado() -> bool:
    return bool((os.environ.get(ENV_TOKEN) or "").strip())


def token_esperado() -> str:
    return (os.environ.get(ENV_TOKEN) or "").strip()


def _carimbo() -> str:
    return hmac.new(
        token_esperado().encode("utf-8"),
        b"observatorio-restrito",
        hashlib.sha256,
    ).hexdigest()


def cookie_valido(valor: str | None) -> bool:
    if not token_configurado():
        return True
    atual = (valor or "").strip()
    if not atual:
        return False
    return hmac.compare_digest(atual, _carimbo())


def cookie_para_gravar() -> str:
    return _carimbo()


def token_confere(informado: str) -> bool:
    esperado = token_esperado()
    if not esperado:
        return True
    return hmac.compare_digest((informado or "").strip(), esperado)


def caminho_restrito(path: str) -> bool:
    if path.startswith("/static/data/condec"):
        return True
    if path.startswith("/api/caged/estatisticas"):
        return True
    return False


def cookie_secure(request) -> bool:
    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return forwarded == "https" or request.url.scheme == "https"


def aplicar_cookie(request, response) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=cookie_para_gravar(),
        max_age=cookie_max_age(),
        httponly=True,
        samesite="lax",
        secure=cookie_secure(request),
        path="/",
    )


def limpar_cookie(response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
