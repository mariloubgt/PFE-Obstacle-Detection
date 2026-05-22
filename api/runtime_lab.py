"""
Runtime overrides for VisionAid AI lab testing (no server restart for most flags).
"""

from __future__ import annotations

import os
import threading
from copy import deepcopy
from typing import Any, Optional

_lock = threading.Lock()

# Defaults mirror env; PUT /lab/config patches this dict.
_state: dict[str, Any] = {
    "yolo_conf": None,
    "yolo_imgsz": None,
    "yolo_weights": None,
    "groq_model": None,
    "enable_groq": None,
    "enable_gemini": None,
    "groq_min_interval_s": None,
}


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def get_yolo_conf(default: float) -> float:
    with _lock:
        v = _state.get("yolo_conf")
    return float(v) if v is not None else default


def get_yolo_imgsz(default: int) -> int:
    with _lock:
        v = _state.get("yolo_imgsz")
    return int(v) if v is not None else default


def get_groq_model(default: str) -> str:
    with _lock:
        v = _state.get("groq_model")
    return str(v).strip() if v else default


def get_enable_groq(default: bool) -> bool:
    with _lock:
        v = _state.get("enable_groq")
    if v is None:
        return default
    return bool(v)


def get_enable_gemini(default: bool) -> bool:
    with _lock:
        v = _state.get("enable_gemini")
    if v is None:
        return default
    return bool(v)


def get_groq_min_interval(default: float) -> float:
    with _lock:
        v = _state.get("groq_min_interval_s")
    return float(v) if v is not None else default


def get_snapshot(
    *,
    model_path: str,
    default_conf: float,
    default_imgsz: int,
    default_groq_model: str,
    port: int,
    lan_ip: Optional[str],
) -> dict[str, Any]:
    with _lock:
        overrides = {k: v for k, v in _state.items() if v is not None}

    base_url_lan = f"http://{lan_ip}:{port}" if lan_ip else None
    return {
        "overrides": overrides,
        "effective": {
            "yolo_weights": overrides.get("yolo_weights") or model_path,
            "yolo_conf": get_yolo_conf(default_conf),
            "yolo_imgsz": get_yolo_imgsz(default_imgsz),
            "groq_model": get_groq_model(default_groq_model),
            "enable_groq": get_enable_groq(_env_bool("ENABLE_GROQ", True)),
            "enable_gemini": get_enable_gemini(
                _env_bool("ENABLE_GEMINI", False)
            ),
            "groq_min_interval_s": get_groq_min_interval(
                float(os.environ.get("GROQ_MIN_INTERVAL_S", "1.0"))
            ),
        },
        "urls": {
            "localhost": f"http://127.0.0.1:{port}",
            "lan": base_url_lan,
        },
        "env_models": {
            "yolo_weights": os.environ.get("YOLO_WEIGHTS") or "(default yolov8n.pt)",
            "groq_model": os.environ.get("GROQ_MODEL")
            or "meta-llama/llama-4-scout-17b-16e-instruct",
            "gemini_model": os.environ.get("GEMINI_MODEL", ""),
        },
    }


def apply_patch(patch: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "yolo_conf",
        "yolo_imgsz",
        "yolo_weights",
        "groq_model",
        "enable_groq",
        "enable_gemini",
        "groq_min_interval_s",
    }
    applied: dict[str, Any] = {}
    with _lock:
        for key, val in patch.items():
            if key not in allowed:
                continue
            if val is None or val == "":
                _state[key] = None
            else:
                _state[key] = val
            applied[key] = _state[key]
    return applied


def reset() -> None:
    with _lock:
        for k in _state:
            _state[k] = None


def export_state() -> dict[str, Any]:
    with _lock:
        return deepcopy(_state)
