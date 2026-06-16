# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend ----
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Production build -> api.js uses same-origin (FastAPI serves it). No VITE_API_BASE needed.
RUN npm run build

# ---- Stage 2: backend + bundled static frontend ----
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
COPY --from=web /web/dist ./frontend/dist

# Data is NOT baked into the image — mount it at /data at run time.
ENV DATA_DIR=/data
ENV WARM_EXPIRIES=2
EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
