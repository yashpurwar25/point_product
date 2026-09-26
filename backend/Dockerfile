FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git libgomp1 libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements*.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements-model.txt
COPY convert_frames.py ./
COPY backend ./backend
ENV POINT_MATRIX_RUNTIME=/app/.runtime
ENV MODEL_DEVICE=cpu
EXPOSE 8000
CMD ["sh", "-c", "python -m backend.setup_runtime && uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
