FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Bases do painel CONDEC; o ETL materializa frontend/data/condec/ no build,
# para o container nao pagar o cruzamento RAIS x CONDEC a cada subida.
COPY BASE_CONDEC.csv base_rais.csv.gz empresas_enderecos.csv ./
RUN python3 backend/etl/condec_preparar_dados.py

ENV HOST=0.0.0.0
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "export HOST=${HOST:-0.0.0.0}; export PORT=${PORT:-8000}; exec python3 -m uvicorn backend.main:app --host \"$HOST\" --port \"$PORT\""]
