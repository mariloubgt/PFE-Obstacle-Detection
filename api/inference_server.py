"""
VisionAid / YOLO inference API.
Uses PFE Phase 3 logic (BLIP-Large + Trig Depth).
"""

from __future__ import annotations
import io
import os
import sys
import time
from pathlib import Path
from typing import Any

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# Load local PFE config
from pfe.phase3 import config

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from ultralytics import YOLO
import uvicorn

from api.vision_pipeline import estimate_distance_m, run_gemini, scene_top5_cached

_DEFAULT_COCO = os.environ.get("COCO_YOLO_MODEL", "yolov8n.pt")
# Prioritize our best.pt model
MODEL_PATH = os.path.normpath(os.path.join("C:/Users/admin/Downloads", "best.pt"))
CONF = float(os.environ.get("YOLO_CONF", "0.25"))
PORT = int(os.environ.get("PORT", "8787"))
HFOV_DEG = float(os.environ.get("CAMERA_HORIZONTAL_FOV_DEG", str(config.CAMERA_VFOV)))

app = FastAPI(title="VisionAid YOLO Inference", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model: YOLO | None = None

@app.on_event("startup")
def load_model():
    global model
    print(f"Loading YOLO from {MODEL_PATH}...")
    model = YOLO(MODEL_PATH)

@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "VisionAid inference API (Phase 3 Optimized)",
        "docs": "GET /health  |  POST /predict",
        "health": "/health",
        "predict": "/predict",
    }

@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": model is not None,
        "model_path": MODEL_PATH,
        "horizontal_fov_deg": HFOV_DEG,
        "engine": "PFE-Phase3-Hybrid"
    }

@app.post("/predict")
async def predict(file: UploadFile = File(...)) -> dict[str, Any]:
    t0 = time.perf_counter()
    content = await file.read()
    img = Image.open(io.BytesIO(content)).convert("RGB")
    w, h = img.size

    results = model.predict(img, conf=CONF, verbose=False)[0]
    yolo_ms = (time.perf_counter() - t0) * 1000.0

    detections: list[dict[str, Any]] = []
    names_map = results.names
    
    for box in results.boxes:
        xyxy = box.xyxy[0].cpu().numpy()
        x1, y1, x2, y2 = [float(v) for v in xyxy]
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        name = names_map.get(cls_id, str(cls_id))
        
        # Use our high-precision depth logic
        dist_m, depth_method = estimate_distance_m(x1, y1, x2, y2, w, h, name, HFOV_DEG)
        
        detections.append({
            "name": name,
            "confidence": round(conf, 4),
            "x1": round(x1 / w, 6),
            "y1": round(y1 / h, 6),
            "x2": round(x2 / w, 6),
            "y2": round(y2 / h, 6),
            "distance_m": dist_m,
            "depth_method": depth_method,
        })

    # Scene Analysis (BLIP-Large)
    t_scene = time.perf_counter()
    scene_list = scene_top5_cached(img)
    scene_ms = (time.perf_counter() - t_scene) * 1000.0

    # Gemini (Optional translation)
    t_g = time.perf_counter()
    gem = run_gemini(img, detections, scene_list, HFOV_DEG)
    gemini_ms = (time.perf_counter() - t_g) * 1000.0

    return {
        "detections": detections,
        "inference_ms": round(yolo_ms, 2),
        "scene": {"top5": scene_list},
        "gemini": gem,
        "pipeline_ms": round((time.perf_counter() - t0) * 1000.0, 2)
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
