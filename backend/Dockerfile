# Build from the repo root:  docker build -f backend/Dockerfile -t silentsignal .
# Stage 1 builds the frontend so one container serves API + UI.
FROM node:22-slim AS web
WORKDIR /src
COPY shared ./shared
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

FROM python:3.13-slim
WORKDIR /srv/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared /srv/shared
COPY backend /srv/backend
COPY --from=web /src/frontend/dist /srv/frontend/dist
ENV SHARED_DIR=/srv/shared FRONTEND_DIST=/srv/frontend/dist PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
