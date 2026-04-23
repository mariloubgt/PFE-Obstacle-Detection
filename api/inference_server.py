"""
Phase 3 — mobile inference API for VisionAid / YOLO testing.

Run on your PC (same Wi‑Fi as the phone):
  cd PFE-Obstacle-Detection
  pip install -r api/requirements-api.txt
  python api/inference_server.py

Default model: YOLOv8n — project fine-tuned weights if present, else yolov8n.pt.
Optional: set YOLO_MODEL_PATH to another .pt file.

Then in the app Settings, set the URL to: http://YOUR_PC_LAN_IP:8787
"""

from __future__ import annotations

import io
import os
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from ultralytics import YOLO
import uvicorn

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_INDOOR_V8N = _PROJECT_ROOT / "runs" / "detect" / "yolov8n_indoor4" / "weights" / "best.pt"
_DEFAULT_OOD_V8N = _PROJECT_ROOT / "runs" / "detect" / "yolov8n_ood" / "weights" / "best.pt"


def _default_model_path() -> str:
    """Prefer project YOLOv8n trained weights; fall back to Ultralytics yolov8n.pt."""
    if _DEFAULT_INDOOR_V8N.is_file():
        return str(_DEFAULT_INDOOR_V8N)
    if _DEFAULT_OOD_V8N.is_file():
        return str(_DEFAULT_OOD_V8N)
    return "yolov8n.pt"


MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", _default_model_path())
CONF = float(os.environ.get("YOLO_CONF", "0.25"))
PORT = int(os.environ.get("PORT", "8787"))

app = FastAPI(title="VisionAid YOLO Inference", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model: YOLO | None = None


@app.get("/")
def root() -> dict[str, Any]:
    """So http://IP:8787/ in the phone browser is not a 404 — only /health and /predict existed before."""
    return {
        "service": "VisionAid inference API",
        "docs": "GET /health  |  POST /predict (multipart image)",
        "health": "/health",
        "predict": "/predict",
    }


@app.on_event("startup")
def load_model() -> None:
    global model
    print(f"Loading YOLO model: {MODEL_PATH}")
    model = YOLO(MODEL_PATH)
    print("Model ready.")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": model is not None,
        "model_path": MODEL_PATH,
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)) -> dict[str, Any]:
    if model is None:
        return {"error": "model not loaded", "detections": []}

    raw = await file.read()
    t0 = time.perf_counter()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size

    results = model.predict(img, conf=CONF, verbose=False)[0]
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    detections: list[dict[str, Any]] = []
    raw_names = results.names or {}
    if isinstance(raw_names, list):
        names_map = {i: n for i, n in enumerate(raw_names)}
    else:
        names_map = raw_names

    for box in results.boxes:
        xyxy = box.xyxy[0].cpu().numpy()
        x1, y1, x2, y2 = [float(v) for v in xyxy]
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        name = names_map.get(cls_id, str(cls_id))
        detections.append(
            {
                "name": name,
                "confidence": round(conf, 4),
                "x1": round(x1 / w, 6),
                "y1": round(y1 / h, 6),
                "x2": round(x2 / w, 6),
                "y2": round(y2 / h, 6),
            }
        )

    return {
        "detections": detections,
        "inference_ms": round(elapsed_ms, 2),
        "image_width": w,
        "image_height": h,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
