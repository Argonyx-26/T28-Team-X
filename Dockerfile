# The API: FastAPI + the question bank. Built from the repo root so data/ ships with the app.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATA_DIR=/app/data DB_PATH=/tmp/gurugraph.db
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/app ./app
COPY data ./data
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1
