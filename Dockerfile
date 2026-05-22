# VisionAid inference API — CPU-friendly image for a VPS (YOLOv8n + Groq/Gemini optional).
# Build from repo root:  docker build -t visionaid-api .
# Run:                   docker run --env-file .env -p 8787:8787 visionaid-api

FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU wheels keep the image smaller than default CUDA Torch pulls.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY api/requirements_api.txt /tmp/requirements_api.txt
RUN pip install --no-cache-dir -r /tmp/requirements_api.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -sf http://127.0.0.1:${PORT}/health | grep -q '"ok"' || exit 1

CMD ["python", "api/inference_server.py"]
