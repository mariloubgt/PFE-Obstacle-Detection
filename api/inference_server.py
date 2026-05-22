"""
VisionAid / YOLO inference API.
Uses PFE Phase 3 logic (Gemini Vision scene + Trig Depth).
Dual YOLO: outdoor best.pt + indoor best indoor.pt (merged detections).
"""

from __future__ import annotations
import io
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from pfe.phase3 import config

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from ultralytics import YOLO
import uvicorn

from api.vision_pipeline import estimate_distance_m, run_gemini, scene_top5_cached
from api.llava_navigation import run_llava_navigation_if_enabled
from api.groq_navigation import run_groq_navigation, status as groq_status


def _resolve_weights(raw: str) -> Path:
    p = Path(raw)
    if not p.is_absolute():
        p = _PROJECT_ROOT / p
    return p.resolve()


OUTDOOR_PATH = _resolve_weights(config.YOLO_WEIGHTS)
INDOOR_PATH = _resolve_weights(config.YOLO_WEIGHTS_INDOOR)

CONF = float(os.environ.get("YOLO_CONF", str(config.YOLO_CONF)))
YOLO_IOU = float(os.environ.get("YOLO_IOU", str(config.YOLO_IOU)))
YOLO_MAX_DET = int(os.environ.get("YOLO_MAX_DET", "40"))
YOLO_IMGSZ = int(os.environ.get("YOLO_IMGSZ", str(config.IMG_SIZE)))
PORT = int(os.environ.get("PORT", "8787"))
HFOV_DEG = float(os.environ.get("CAMERA_HORIZONTAL_FOV_DEG", "56.0"))
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


def _box_iou(a: dict[str, Any], b: dict[str, Any]) -> float:
    ax1, ay1, ax2, ay2 = a["x1"], a["y1"], a["x2"], a["y2"]
    bx1, by1, bx2, by2 = b["x1"], b["y1"], b["x2"], b["y2"]
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _merge_detections(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep union of both models; drop duplicate boxes (same class + high IoU), keep higher confidence."""
    ranked = sorted(
        items,
        key=lambda d: (-float(d.get("confidence", 0)), float(d.get("distance_m") or 99)),
    )
    kept: list[dict[str, Any]] = []
    for d in ranked:
        if any(d["name"] == k["name"] and _box_iou(d, k) > 0.45 for k in kept):
            continue
        kept.append(d)
    kept.sort(key=lambda d: float(d.get("distance_m") or 99))
    return kept


app = FastAPI(title="VisionAid YOLO Inference", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model_outdoor: YOLO | None = None
model_indoor: YOLO | None = None
_yolo_pool = ThreadPoolExecutor(max_workers=2)
_gemini_status: dict[str, Any] = {"enabled": False, "model": None, "ok": False, "error": "Not checked yet"}


def _extract_detections(result, img_w: int, img_h: int, req_hfov: float, req_scale: float, source: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    names_map = result.names
    for box in result.boxes:
        xyxy = box.xyxy[0].cpu().numpy()
        x1, y1, x2, y2 = [float(v) for v in xyxy]
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        name = names_map.get(cls_id, str(cls_id))
        dist_m, depth_method = estimate_distance_m(x1, y1, x2, y2, img_w, img_h, name, req_hfov)
        if dist_m is not None:
            dist_m = round(
                max(
                    0.12,
                    min(float(dist_m) * req_scale, float(getattr(config, "MAX_DISTANCE_M", 15.0))),
                ),
                2,
            )
        out.append(
            {
                "name": name,
                "confidence": round(conf, 4),
                "x1": round(x1 / img_w, 6),
                "y1": round(y1 / img_h, 6),
                "x2": round(x2 / img_w, 6),
                "y2": round(y2 / img_h, 6),
                "distance_m": dist_m,
                "depth_method": depth_method,
                "model": source,
            }
        )
    return out


def _predict_one(yolo_model: YOLO, img: Image.Image, source: str, req_hfov: float, req_scale: float) -> tuple[list[dict[str, Any]], float]:
    t0 = time.perf_counter()
    result = yolo_model.predict(
        img,
        conf=CONF,
        iou=YOLO_IOU,
        imgsz=YOLO_IMGSZ,
        max_det=YOLO_MAX_DET,
        verbose=False,
    )[0]
    ms = (time.perf_counter() - t0) * 1000.0
    w, h = img.size
    return _extract_detections(result, w, h, req_hfov, req_scale, source), ms


def _run_dual_yolo(img: Image.Image, req_hfov: float, req_scale: float) -> tuple[list[dict[str, Any]], float]:
    jobs: list[tuple[YOLO, str]] = []
    if model_outdoor is not None:
        jobs.append((model_outdoor, "outdoor"))
    if model_indoor is not None:
        jobs.append((model_indoor, "indoor"))
    if not jobs:
        return [], 0.0
    if len(jobs) == 1:
        dets, ms = _predict_one(jobs[0][0], img, jobs[0][1], req_hfov, req_scale)
        return dets, ms

    futures = [
        _yolo_pool.submit(_predict_one, m, img, src, req_hfov, req_scale)
        for m, src in jobs
    ]
    combined: list[dict[str, Any]] = []
    total_ms = 0.0
    for fut in futures:
        dets, ms = fut.result()
        combined.extend(dets)
        total_ms = max(total_ms, ms)
    return _merge_detections(combined), total_ms


@app.on_event("startup")
def load_model():
    global model_outdoor, model_indoor, _gemini_status
    loaded: list[str] = []
    if OUTDOOR_PATH.is_file():
        print(f"Loading outdoor YOLO: {OUTDOOR_PATH}")
        model_outdoor = YOLO(str(OUTDOOR_PATH))
        loaded.append("outdoor")
    else:
        print(f"[WARN] Outdoor weights missing: {OUTDOOR_PATH}")
        model_outdoor = None

    if INDOOR_PATH.is_file():
        print(f"Loading indoor YOLO: {INDOOR_PATH}")
        model_indoor = YOLO(str(INDOOR_PATH))
        loaded.append("indoor")
    else:
        print(f"[WARN] Indoor weights missing: {INDOOR_PATH}")
        model_indoor = None

    if not loaded:
        raise FileNotFoundError(
            f"No YOLO weights found. Expected {OUTDOOR_PATH} and/or {INDOOR_PATH}"
        )

    print(
        f"YOLO ready ({', '.join(loaded)}) — conf={CONF}, iou={YOLO_IOU}, "
        f"imgsz={YOLO_IMGSZ}, max_det={YOLO_MAX_DET}"
    )

    gst = groq_status()
    if gst.get("has_key") and gst.get("enabled"):
        print(f"[Groq] Ready (model={gst.get('model')}).")
    else:
        reason = "Missing GROQ_API_KEY" if not gst.get("has_key") else "Disabled (ENABLE_GROQ=0)"
        print(f"[Groq] Not ready: {reason}")
    has_gem_key = bool((os.environ.get("GEMINI_API_KEY") or config.GEMINI_API_KEY or "").strip())
    _gemini_status = {
        "enabled": has_gem_key,
        "model": config.GEMINI_TTS_MODEL,
        "ok": has_gem_key,
        "error": None if has_gem_key else "Missing GEMINI_API_KEY",
    }
    print(f"[Gemini] Standby (key={'set' if has_gem_key else 'missing'}).")


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
        "ok": model_outdoor is not None or model_indoor is not None,
        "model_path": str(OUTDOOR_PATH),
        "model_path_indoor": str(INDOOR_PATH),
        "outdoor_loaded": model_outdoor is not None,
        "indoor_loaded": model_indoor is not None,
        "yolo_conf": CONF,
        "yolo_imgsz": YOLO_IMGSZ,
        "horizontal_fov_deg": HFOV_DEG,
        "depth_scale_default": DEPTH_SCALE_ENV,
        "engine": "PFE-Phase3-Dual-YOLO",
        "gemini": _gemini_status,
        "groq": groq_status(),
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    use_gemini: str = Form("false"),
    use_groq: str = Form("true"),
    groq_mode: str = Form("describe"),
    detailed: str = Form("false"),
    hfov_deg: str | None = Form(None),
    depth_scale: str | None = Form(None),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    content = await file.read()
    img = Image.open(io.BytesIO(content)).convert("RGB")
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    print(f"\n[/predict] New request — image={w}x{h}, detailed={detailed}, use_groq={use_groq}({groq_mode}), use_gemini={use_gemini}")

    req_hfov = _parse_opt_float(hfov_deg, HFOV_DEG, 40.0, 95.0)
    req_scale = _parse_opt_float(depth_scale, DEPTH_SCALE_ENV, 0.35, 2.5)
    is_detailed = str(detailed).strip().lower() in ("1", "true", "yes", "on")

    detections, yolo_ms = _run_dual_yolo(img, req_hfov, req_scale)

    if str(use_groq).strip().lower() in ("1", "true", "yes", "on"):
        groq_result = run_groq_navigation(img, detections, mode=groq_mode)
    else:
        groq_result = {
            "scene": None,
            "guidance_en": None,
            "risk": None,
            "focus": None,
            "ms": 0.0,
            "model": None,
            "mode": None,
            "error": "Skipped (use_groq=false).",
        }

    scene_list = None
    if groq_result.get("scene"):
        scene_list = [{"label": groq_result["scene"], "probability": 1.0}]
    elif os.environ.get("ENABLE_SCENE", "0").strip().lower() in ("1", "true", "yes", "on"):
        scene_list = scene_top5_cached(img)

    if str(use_gemini).strip().lower() not in ("1", "true", "yes", "on"):
        gem = {
            "text": None,
            "darija": None,
            "risk": None,
            "focus": None,
            "error": "Skipped (client use_gemini=false).",
        }
    elif os.environ.get("ENABLE_GEMINI", "0").strip().lower() not in ("1", "true", "yes", "on"):
        gem = {
            "text": None,
            "darija": None,
            "risk": None,
            "focus": None,
            "error": "Gemini disabled (ENABLE_GEMINI=0). Groq is main.",
        }
    else:
        gem = run_gemini(img, detections, scene_list, req_hfov, detailed=is_detailed)

    navigation = run_llava_navigation_if_enabled(img, detections, w, h, scene_list)

    total_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    det_names = (
        [f"{d['name']} {d['distance_m']}m ({d.get('model', '?')})" for d in detections]
        if detections
        else ["none"]
    )
    groq_scene = (groq_result.get("scene") or "—")[:120]
    groq_guide = (groq_result.get("guidance_en") or groq_result.get("error") or "—")[:120]
    groq_risk = groq_result.get("risk") or "—"
    groq_focus = groq_result.get("focus") or "—"
    print(f"[/predict] YOLO={round(yolo_ms,1)}ms | detections={det_names}")
    print(f"[/predict] Groq ({groq_result.get('ms')}ms) | risk={groq_risk} | focus={groq_focus}")
    print(f"[/predict]   scene    : {groq_scene}")
    print(f"[/predict]   guidance : {groq_guide}")
    print(f"[/predict] total={total_ms}ms")
    return {
        "detections": detections,
        "inference_ms": round(yolo_ms, 2),
        "scene": {"top5": scene_list},
        "groq": groq_result,
        "gemini": gem,
        "navigation": navigation,
        "pipeline_ms": total_ms,
    }


@app.post("/voice-query")
async def voice_query(
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    hfov_deg: str | None = Form(None),
) -> dict[str, Any]:
    t0 = time.perf_counter()

    img_content = await image.read()
    img = Image.open(io.BytesIO(img_content)).convert("RGB")
    img = ImageOps.exif_transpose(img)

    audio_content = await audio.read()
    audio_mime = audio.content_type or "audio/m4a"

    from api.groq_navigation import run_groq_voice_query

    res = run_groq_voice_query(img, audio_content, audio_mime)

    print(
        f"[voice-query] user_said={res.get('user_said')!r} | "
        f"answer={str(res.get('answer', ''))[:80]!r} | "
        f"error={res.get('error')!r} | "
        f"{round((time.perf_counter() - t0) * 1000)}ms"
    )

    return {
        "answer": res.get("answer"),
        "user_said": res.get("user_said"),
        "pipeline_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        "error": res.get("error"),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
