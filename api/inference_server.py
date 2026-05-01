"""
VisionAid / YOLO inference API.
Uses PFE Phase 3 logic (Gemini Vision scene + Trig Depth).
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

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from ultralytics import YOLO
import uvicorn

from api.vision_pipeline import estimate_distance_m, run_gemini, scene_top5_cached
from api.llava_navigation import run_llava_navigation_if_enabled

_DEFAULT_COCO = "yolov8n.pt"
# Chemin poids : config par défaut, ou YOLO_WEIGHTS=yolov8n.pt pour COCO 80 classes
# si ton best.pt ne voit qu’une « person » (jeu de données d’entraînement).
_w = (os.environ.get("YOLO_WEIGHTS") or "").strip()
MODEL_PATH = _w if _w else "yolov8n.pt" # Force Nano for speed unless ENV specified
_mp = Path(MODEL_PATH)
if not _mp.is_absolute() and not MODEL_PATH.endswith(".pt"):
    MODEL_PATH = str(_PROJECT_ROOT / _mp)

CONF = float(os.environ.get("YOLO_CONF", "0.2"))
YOLO_IOU = float(os.environ.get("YOLO_IOU", str(config.YOLO_IOU)))
YOLO_MAX_DET = int(os.environ.get("YOLO_MAX_DET", "40"))
YOLO_IMGSZ = int(os.environ.get("YOLO_IMGSZ", str(config.IMG_SIZE)))
PORT = int(os.environ.get("PORT", "8787"))
HFOV_DEG = float(os.environ.get("CAMERA_HORIZONTAL_FOV_DEG", "56.0")) # iPhone 14 Pro Portrait
# Global default distance multiplier (client can override per request with depth_scale form field)
DEPTH_SCALE_ENV = float(os.environ.get("DEPTH_SCALE", "1.0"))


def _parse_opt_float(value: str | None, default: float, lo: float, hi: float) -> float:
    if value is None or str(value).strip() == "":
        x = default
    else:
        try:
            x = float(value)
        except ValueError:
            x = default
    return max(lo, min(hi, x))


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
    print(
        f"Loading YOLO from {MODEL_PATH} "
        f"(conf={CONF}, iou={YOLO_IOU}, imgsz={YOLO_IMGSZ}, max_det={YOLO_MAX_DET})..."
    )
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
        "yolo_conf": CONF,
        "yolo_imgsz": YOLO_IMGSZ,
        "horizontal_fov_deg": HFOV_DEG,
        "depth_scale_default": DEPTH_SCALE_ENV,
        "engine": "PFE-Phase3-Hybrid",
    }

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    use_gemini: str = Form("true"),
    detailed: str = Form("false"),
    hfov_deg: str | None = Form(None),
    depth_scale: str | None = Form(None),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    content = await file.read()
    img = Image.open(io.BytesIO(content)).convert("RGB")
    img = ImageOps.exif_transpose(img) # Fix iPhone portrait rotation
    w, h = img.size

    req_hfov = _parse_opt_float(hfov_deg, HFOV_DEG, 40.0, 95.0)
    req_scale = _parse_opt_float(depth_scale, DEPTH_SCALE_ENV, 0.35, 2.5)
    is_detailed = str(detailed).strip().lower() in ("1", "true", "yes", "on")

    results = model.predict(
        img,
        conf=CONF,
        iou=YOLO_IOU,
        imgsz=YOLO_IMGSZ,
        max_det=YOLO_MAX_DET,
        verbose=False,
    )[0]
    yolo_ms = (time.perf_counter() - t0) * 1000.0

    detections: list[dict[str, Any]] = []
    names_map = results.names
    
    for box in results.boxes:
        xyxy = box.xyxy[0].cpu().numpy()
        x1, y1, x2, y2 = [float(v) for v in xyxy]
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        name = names_map.get(cls_id, str(cls_id))
        
        # Use corrected depth model (now uses both height AND width)
        dist_m, depth_method = estimate_distance_m(x1, y1, x2, y2, w, h, name, req_hfov)
        if dist_m is not None:
            dist_m = round(
                max(
                    0.12,
                    min(float(dist_m) * req_scale, float(getattr(config, "MAX_DISTANCE_M", 15.0))),
                ),
                2,
            )

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

    # Scene caption (Gemini Vision) — désactivable pour perf / offline (ENABLE_SCENE=0)
    if os.environ.get("ENABLE_SCENE", "1").strip().lower() in ("0", "false", "no", "off"):
        scene_list = None
    else:
        scene_list = scene_top5_cached(img)

    # Gemini (Optional translation)
    if str(use_gemini).strip().lower() in ("0", "false", "no", "off"):
        gem = {
            "text": None,
            "darija": None,
            "risk": None,
            "focus": None,
            "error": "Skipped (client use_gemini=false).",
        }
    else:
        gem = run_gemini(img, detections, scene_list, req_hfov, detailed=is_detailed)

    navigation = run_llava_navigation_if_enabled(img, detections, w, h, scene_list)

    return {
        "detections": detections,
        "inference_ms": round(yolo_ms, 2),
        "scene": {"top5": scene_list},
        "gemini": gem,
        "navigation": navigation,
        "pipeline_ms": round((time.perf_counter() - t0) * 1000.0, 2)
    }

@app.post("/voice-query")
async def voice_query(
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    hfov_deg: str | None = Form(None),
) -> dict[str, Any]:
    """
    Multimodal endpoint: takes an image and a voice recording.
    Returns Gemini's Darija answer.
    """
    t0 = time.perf_counter()
    
    # Read Image
    img_content = await image.read()
    img = Image.open(io.BytesIO(img_content)).convert("RGB")
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    
    # Read Audio
    audio_content = await audio.read()
    audio_mime = audio.content_type or "audio/wav"

    req_hfov = _parse_opt_float(hfov_deg, HFOV_DEG, 40.0, 95.0)

    # 1. Run YOLO to get context
    results = model.predict(img, conf=CONF, iou=YOLO_IOU, imgsz=YOLO_IMGSZ, verbose=False)[0]
    detections = []
    for box in results.boxes:
        xyxy = box.xyxy[0].cpu().numpy()
        dist_m, _ = estimate_distance_m(xyxy[0], xyxy[1], xyxy[2], xyxy[3], w, h, results.names[int(box.cls[0])], req_hfov)
        detections.append({"name": results.names[int(box.cls[0])], "distance_m": dist_m})

    # 2. Run Scene Model
    scene_list = scene_top5_cached(img)

    # 3. Run Gemini Multimodal (Audio + Image)
    from api.vision_pipeline import run_voice_query
    res = run_voice_query(img, audio_content, audio_mime, detections, scene_list)

    return {
        "answer": res.get("darija"),
        "user_said": res.get("user_said"),
        "risk": res.get("risk"),
        "focus": res.get("focus"),
        "pipeline_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        "error": res.get("error")
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
