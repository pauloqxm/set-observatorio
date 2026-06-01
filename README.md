# Portal de Empregabilidade

Projeto com estrutura profissional separando frontend e backend.

## Estrutura

- `backend/`: API FastAPI e integracao com Google Sheets
- `frontend/`: interface web (HTML, CSS e JavaScript)
- `run_server.bat`: script para instalar dependencias e iniciar o servidor

## Como executar

### Local (Windows)

1. Execute `run_server.bat`
2. Abra: `http://127.0.0.1:8000`

### Docker

```bash
docker build -t set-observatorio .
docker run --rm -p 8000:8000 set-observatorio
```

Abra: `http://127.0.0.1:8000`

Variáveis opcionais: `HOST` (padrão `0.0.0.0`), `PORT` (padrão `8000`).

## Endpoint principal

- `GET /api/indicadores`
  - Filtros opcionais: `tema`, `categoria`, `ano`, `mes`
