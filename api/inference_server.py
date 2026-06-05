"""
VisionAid / YOLO inference API.
Uses PFE Phase 3 logic (Gemini Vision scene + Trig Depth).
Dual YOLO: outdoor best.pt + indoor best indoor.pt (merged detections).
"""

from __future__ import annotations
import io
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(_PROJECT_ROOT / ".env")
except ImportError:
    pass

from pfe.phase3 import config

from fastapi import Body, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from ultralytics import YOLO
import uvicorn

from api.vision_pipeline import estimate_distance_m, run_gemini, scene_top5_cached
from api.llava_navigation import run_llava_navigation_if_enabled
from api.groq_navigation import prepare_image_data_url, run_groq_navigation, status as groq_status
from api.nav_detection import filter_nav_detections, strip_stale_outdoor_person
from api import runtime_lab


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
HFOV_DEG = float(os.environ.get("CAMERA_HORIZONTAL_FOV_DEG", "57.0"))
DEPTH_SCALE_ENV = float(os.environ.get("DEPTH_SCALE", "1.0"))


def _parse_opt_float(value: Optional[str], default: float, lo: float, hi: float) -> float:
    if value is None or str(value).strip() == "":
        x = default
    else:
        try:
            x = float(value)
        except ValueError:
            x = default
    return max(lo, min(hi, x))


YOLO_ROUTE = os.environ.get("YOLO_ROUTE", "auto").strip().lower()
YOLO_INDOOR_EVERY_N = max(1, int(os.environ.get("YOLO_INDOOR_EVERY_N", "1")))
YOLO_OUTDOOR_EVERY_N = max(1, int(os.environ.get("YOLO_OUTDOOR_EVERY_N", "3")))
YOLO_MAX_LONG_EDGE = max(640, int(os.environ.get("YOLO_MAX_LONG_EDGE", "960")))
_fast_frame_counter = 0
_last_outdoor_dets: list[dict[str, Any]] = []
_last_indoor_dets: list[dict[str, Any]] = []

# Class → preferred head when both models see the same object (smart merge).
INDOOR_PREFERRED = frozenset(
    {
        "stairs",
        "chair",
        "couch",
        "bed",
        "dining_table",
        "toilet",
        "tv",
        "laptop",
        "microwave",
        "oven",
        "refrigerator",
        "sink",
        "bench",
        "crutch",
        "door",
        "table",
        "potted_plant",
        "exit",
        "fireextinguisher",
        "fire_extinguisher",
        "printer",
        "screen",
        "trashbin",
        "clock",
    }
)
OUTDOOR_PREFERRED = frozenset(
    {
        "car",
        "bus",
        "truck",
        "motorcycle",
        "bicycle",
        "curb",
        "bus_stop",
        "pole",
        "street_light",
        "traffic_light",
        "stop_sign",
        "fire_hydrant",
        "warning_column",
        "spherical_roadblock",
        "train",
        "waste_container",
    }
)


def _merge_rank(d: dict[str, Any]) -> float:
    """Higher = keep this detection when indoor/outdoor overlap."""
    conf = float(d.get("confidence", 0))
    name = str(d.get("name", "")).lower()
    source = str(d.get("model", "")).lower()
    if name in INDOOR_PREFERRED:
        if source == "indoor":
            conf += 0.12
        elif source == "outdoor":
            conf -= 0.08
    elif name in OUTDOOR_PREFERRED:
        if source == "outdoor":
            conf += 0.12
        elif source == "indoor":
            conf -= 0.08
    return conf


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
    ranked = sorted(
        items,
        key=lambda d: (-_merge_rank(d), float(d.get("distance_m") or 99)),
    )
    kept: list[dict[str, Any]] = []
    for d in ranked:
        if any(d["name"] == k["name"] and _box_iou(d, k) > 0.45 for k in kept):
            continue
        kept.append(d)
    kept.sort(key=lambda d: float(d.get("distance_m") or 99))
    return kept


def _detect_lan_ip() -> Optional[str]:
    import socket

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


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


def _extract_detections(
    result,
    img_w: int,
    img_h: int,
    req_hfov: float,
    req_scale: float,
    source: str,
    box_scale: float = 1.0,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    names_map = result.names
    for box in result.boxes:
        xyxy = box.xyxy[0].cpu().numpy()
        x1, y1, x2, y2 = [float(v) * box_scale for v in xyxy]
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
        conf_r = round(conf, 4)
        out.append(
            {
                "name": name,
                "confidence": conf_r,
                "raw_confidence": conf_r,
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


def _downscale_for_yolo(img: Image.Image) -> tuple[Image.Image, float]:
    """Shrink huge phone photos before YOLO (boxes stay mapped to original size)."""
    w, h = img.size
    long_edge = max(w, h)
    if long_edge <= YOLO_MAX_LONG_EDGE:
        return img, 1.0
    scale = YOLO_MAX_LONG_EDGE / long_edge
    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
    return img.resize(new_size, Image.LANCZOS), scale


def _predict_one(yolo_model: YOLO, img: Image.Image, source: str, req_hfov: float, req_scale: float) -> tuple[list[dict[str, Any]], float]:
    orig_w, orig_h = img.size
    yolo_img, scale = _downscale_for_yolo(img)
    t0 = time.perf_counter()
    yolo_conf = runtime_lab.get_yolo_conf(CONF)
    yolo_imgsz = runtime_lab.get_yolo_imgsz(YOLO_IMGSZ)
    result = yolo_model.predict(
        yolo_img,
        conf=yolo_conf,
        iou=YOLO_IOU,
        imgsz=yolo_imgsz,
        max_det=YOLO_MAX_DET,
        verbose=False,
    )[0]
    ms = (time.perf_counter() - t0) * 1000.0
    box_scale = 1.0 / scale if scale != 1.0 else 1.0
    return _extract_detections(
        result, orig_w, orig_h, req_hfov, req_scale, source, box_scale=box_scale
    ), ms


def _finalize_nav_detections(
    items: list[dict[str, Any]], img: Image.Image, yolo_ms: float
) -> tuple[list[dict[str, Any]], float]:
    w, h = img.size
    return filter_nav_detections(items, img_w=w, img_h=h), yolo_ms


def _run_dual_yolo(
    img: Image.Image,
    req_hfov: float,
    req_scale: float,
    profile: str = "auto",
) -> tuple[list[dict[str, Any]], float]:
    global _fast_frame_counter, _last_outdoor_dets, _last_indoor_dets

    profile = (profile or "auto").strip().lower()
    route = runtime_lab.get_yolo_route(YOLO_ROUTE)
    if route not in ("auto", "both", "outdoor", "indoor", "fast"):
        route = "auto"

    if profile == "indoor" and model_indoor is not None:
        dets, ms = _predict_one(model_indoor, img, "indoor", req_hfov, req_scale)
        return _finalize_nav_detections(dets, img, ms)
    if profile == "outdoor" and model_outdoor is not None:
        dets, ms = _predict_one(model_outdoor, img, "outdoor", req_hfov, req_scale)
        return _finalize_nav_detections(dets, img, ms)

    if route == "outdoor" and model_outdoor is not None:
        dets, ms = _predict_one(model_outdoor, img, "outdoor", req_hfov, req_scale)
        return _finalize_nav_detections(dets, img, ms)
    if route == "indoor" and model_indoor is not None:
        dets, ms = _predict_one(model_indoor, img, "indoor", req_hfov, req_scale)
        return _finalize_nav_detections(dets, img, ms)

    # Auto/fast: indoor every frame; outdoor every Nth (cached). Strip weak outdoor person when skipping.
    if route in ("auto", "fast"):
        total_ms = 0.0
        _fast_frame_counter += 1
        run_outdoor = model_outdoor is not None and (
            _fast_frame_counter % YOLO_OUTDOOR_EVERY_N == 0
        )
        run_indoor = model_indoor is not None and (
            _fast_frame_counter % YOLO_INDOOR_EVERY_N == 0
        )
        if not run_outdoor:
            _last_outdoor_dets = strip_stale_outdoor_person(_last_outdoor_dets)

        jobs: list[tuple[YOLO, str]] = []
        if run_outdoor:
            jobs.append((model_outdoor, "outdoor"))
        if run_indoor:
            jobs.append((model_indoor, "indoor"))

        if len(jobs) == 2:
            futures = [
                _yolo_pool.submit(_predict_one, m, img, src, req_hfov, req_scale)
                for m, src in jobs
            ]
            for (m, src), fut in zip(jobs, futures):
                dets, ms = fut.result()
                total_ms = max(total_ms, ms)
                if src == "outdoor":
                    _last_outdoor_dets = dets
                else:
                    _last_indoor_dets = dets
        elif len(jobs) == 1:
            m, src = jobs[0]
            dets, ms = _predict_one(m, img, src, req_hfov, req_scale)
            total_ms = ms
            if src == "outdoor":
                _last_outdoor_dets = dets
            else:
                _last_indoor_dets = dets

        combined = list(_last_outdoor_dets) + list(_last_indoor_dets)
        merged = _merge_detections(combined)
        w, h = img.size
        return _finalize_nav_detections(merged, img, total_ms)

    jobs: list[tuple[YOLO, str]] = []
    if model_outdoor is not None:
        jobs.append((model_outdoor, "outdoor"))
    if model_indoor is not None and route in ("auto", "both"):
        jobs.append((model_indoor, "indoor"))
    if not jobs:
        return [], 0.0
    if len(jobs) == 1:
        dets, ms = _predict_one(jobs[0][0], img, jobs[0][1], req_hfov, req_scale)
        return _finalize_nav_detections(dets, img, ms)

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
    merged = _merge_detections(combined)
    return _finalize_nav_detections(merged, img, total_ms)


def _load_yolo_models(outdoor_path: Path, indoor_path: Path) -> list[str]:
    global model_outdoor, model_indoor
    loaded: list[str] = []
    if outdoor_path.is_file():
        print(f"Loading outdoor YOLO: {outdoor_path}")
        model_outdoor = YOLO(str(outdoor_path))
        loaded.append("outdoor")
    else:
        print(f"[WARN] Outdoor weights missing: {outdoor_path}")
        model_outdoor = None

    if indoor_path.is_file():
        print(f"Loading indoor YOLO: {indoor_path}")
        model_indoor = YOLO(str(indoor_path))
        loaded.append("indoor")
    else:
        print(f"[WARN] Indoor weights missing: {indoor_path}")
        model_indoor = None
    return loaded


@app.on_event("startup")
def load_model():
    global _gemini_status
    loaded = _load_yolo_models(OUTDOOR_PATH, INDOOR_PATH)
    if not loaded:
        raise FileNotFoundError(
            f"No YOLO weights found. Expected {OUTDOOR_PATH} and/or {INDOOR_PATH}"
        )

    print(
        f"YOLO ready ({', '.join(loaded)}) — route={YOLO_ROUTE}, conf={CONF}, "
        f"iou={YOLO_IOU}, imgsz={YOLO_IMGSZ}, max_det={YOLO_MAX_DET}, "
        f"outdoor_every={YOLO_OUTDOOR_EVERY_N}, indoor_every={YOLO_INDOOR_EVERY_N}"
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
    lan = _detect_lan_ip()
    gst = groq_status()
    snap = runtime_lab.get_snapshot(
        model_path=str(OUTDOOR_PATH),
        default_conf=CONF,
        default_imgsz=YOLO_IMGSZ,
        default_groq_model=gst.get("model") or "meta-llama/llama-4-scout-17b-16e-instruct",
        port=PORT,
        lan_ip=lan,
    )
    return {
        "ok": model_outdoor is not None or model_indoor is not None,
        "model_path": str(OUTDOOR_PATH),
        "model_path_indoor": str(INDOOR_PATH),
        "outdoor_loaded": model_outdoor is not None,
        "indoor_loaded": model_indoor is not None,
        "yolo_route": snap["effective"].get("yolo_route", YOLO_ROUTE),
        "yolo_conf": snap["effective"]["yolo_conf"],
        "yolo_imgsz": snap["effective"]["yolo_imgsz"],
        "horizontal_fov_deg": HFOV_DEG,
        "depth_scale_default": DEPTH_SCALE_ENV,
        "engine": "PFE-Phase3-Dual-YOLO",
        "gemini": _gemini_status,
        "groq": gst,
        "lab": snap,
        "urls": snap.get("urls"),
    }


@app.get("/lab/config")
def lab_config_get() -> dict[str, Any]:
    lan = _detect_lan_ip()
    gst = groq_status()
    snap = runtime_lab.get_snapshot(
        model_path=str(OUTDOOR_PATH),
        default_conf=CONF,
        default_imgsz=YOLO_IMGSZ,
        default_groq_model=gst.get("model") or "meta-llama/llama-4-scout-17b-16e-instruct",
        port=PORT,
        lan_ip=lan,
    )
    snap["model_path_indoor"] = str(INDOOR_PATH)
    return snap


@app.put("/lab/config")
def lab_config_put(body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    applied = runtime_lab.apply_patch(body if isinstance(body, dict) else {})
    return {"applied": applied, "lab": lab_config_get()}


@app.post("/lab/reset")
def lab_config_reset() -> dict[str, Any]:
    runtime_lab.reset()
    return lab_config_get()


@app.post("/lab/reload-yolo")
def lab_reload_yolo(body: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Reload outdoor YOLO (optional path). Indoor weights path stays from config."""
    payload = body or {}
    outdoor = OUTDOOR_PATH
    weights = (payload.get("yolo_weights") or "").strip()
    if weights:
        outdoor = _resolve_weights(weights)
        runtime_lab.apply_patch({"yolo_weights": str(outdoor)})
    loaded = _load_yolo_models(outdoor, INDOOR_PATH)
    return {
        "ok": bool(loaded),
        "loaded": loaded,
        "model_path": str(outdoor),
        "model_path_indoor": str(INDOOR_PATH),
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    use_gemini: str = Form("false"),
    use_groq: str = Form("true"),
    groq_mode: str = Form("describe"),
    detailed: str = Form("false"),
    hfov_deg: Optional[str] = Form(None),
    depth_scale: Optional[str] = Form(None),
    yolo_profile: Optional[str] = Form("auto"),
    skip_yolo: str = Form("false"),
    detections_json: Optional[str] = Form(None),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    content = await file.read()
    img = Image.open(io.BytesIO(content)).convert("RGB")
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    print(f"\n[/predict] New request — image={w}x{h}, route={runtime_lab.get_yolo_route(YOLO_ROUTE)}, detailed={detailed}, use_groq={use_groq}({groq_mode}), use_gemini={use_gemini}")

    req_hfov = _parse_opt_float(hfov_deg, HFOV_DEG, 40.0, 95.0)
    req_scale = _parse_opt_float(depth_scale, DEPTH_SCALE_ENV, 0.35, 2.5)
    is_detailed = str(detailed).strip().lower() in ("1", "true", "yes", "on")

    yolo_prof = (yolo_profile or "auto").strip().lower()
    if yolo_prof not in ("auto", "indoor", "outdoor", "dual"):
        yolo_prof = "auto"

    groq_on = str(use_groq).strip().lower() in ("1", "true", "yes", "on")
    groq_on = groq_on and runtime_lab.get_enable_groq(True)
    groq_mode_norm = "navigate" if str(groq_mode).strip().lower() == "navigate" else "describe"
    skip_yolo_on = str(skip_yolo).strip().lower() in ("1", "true", "yes", "on")

    encode_fut = None
    if groq_on and not skip_yolo_on:
        encode_fut = _yolo_pool.submit(
            prepare_image_data_url, img, navigate=(groq_mode_norm == "navigate")
        )

    if skip_yolo_on and detections_json:
        try:
            parsed = json.loads(detections_json)
            detections = parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            detections = []
        yolo_ms = 0.0
    else:
        detections, yolo_ms = _run_dual_yolo(img, req_hfov, req_scale, profile=yolo_prof)

    if groq_on:
        preencoded = encode_fut.result() if encode_fut is not None else None
        groq_result = run_groq_navigation(
            img,
            detections,
            mode=groq_mode,
            image_data_url=preencoded,
        )
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
    elif groq_result.get("error") and detections:
        parts = []
        for d in detections[:6]:
            name = str(d.get("name", "object")).replace("_", " ")
            dist = d.get("distance_m")
            if isinstance(dist, (int, float)):
                parts.append(f"{name} at {dist} m")
            else:
                parts.append(name)
        scene_list = [{"label": "Visible: " + ", ".join(parts) + ".", "probability": 1.0}]

    if str(use_gemini).strip().lower() not in ("1", "true", "yes", "on"):
        gem = {
            "text": None,
            "darija": None,
            "risk": None,
            "focus": None,
            "error": "Skipped (client use_gemini=false).",
        }
    elif not runtime_lab.get_enable_gemini(
        os.environ.get("ENABLE_GEMINI", "0").strip().lower() in ("1", "true", "yes", "on")
    ):
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
        "yolo_route": runtime_lab.get_yolo_route(YOLO_ROUTE),
        "yolo_profile": yolo_prof,
        "staged": skip_yolo_on,
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
    hfov_deg: Optional[str] = Form(None),
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
