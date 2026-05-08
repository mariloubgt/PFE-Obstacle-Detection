"""
Groq + Llama 4 Scout multimodal navigation/scene reasoning for VisionAid.

Replaces Gemini Vision + LLaVA local. Single REST call returns:
    - scene caption
    - navigation guidance (English)
    - risk level (danger | caution | ok)
    - focus object

Stateless except for an in-memory cache (last good result + cooldown lock)
so repeated frames don't hammer the API.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
import time
from typing import Any

import requests
from PIL import Image


GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = os.environ.get(
    "GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
).strip()
DEFAULT_TIMEOUT_S = float(os.environ.get("GROQ_TIMEOUT_S", "4.0"))
DEFAULT_MIN_INTERVAL_S = float(os.environ.get("GROQ_MIN_INTERVAL_S", "1.0"))
DEFAULT_MAX_TOKENS = int(os.environ.get("GROQ_MAX_TOKENS", "220"))
DEFAULT_IMAGE_SIDE = int(os.environ.get("GROQ_IMAGE_MAX_SIDE", "640"))
DEFAULT_JPEG_QUALITY = int(os.environ.get("GROQ_JPEG_QUALITY", "70"))


_state_lock = threading.Lock()
_last_call_mono: float = 0.0
_in_flight: bool = False
_last_result: dict[str, Any] | None = None


def _enabled() -> bool:
    return os.environ.get("ENABLE_GROQ", "1").strip().lower() in ("1", "true", "yes", "on")


def _api_key() -> str | None:
    key = (os.environ.get("GROQ_API_KEY") or "").strip()
    return key or None


def _resize_for_api(pil_rgb: Image.Image) -> Image.Image:
    w, h = pil_rgb.size
    side = max(w, h)
    if side <= DEFAULT_IMAGE_SIDE:
        return pil_rgb
    scale = DEFAULT_IMAGE_SIDE / float(side)
    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
    return pil_rgb.resize(new_size, Image.LANCZOS)


def _encode_image_data_url(pil_rgb: Image.Image) -> str:
    img = _resize_for_api(pil_rgb.convert("RGB"))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=DEFAULT_JPEG_QUALITY)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _format_detections(detections: list[dict[str, Any]]) -> str:
    items = [d for d in (detections or []) if isinstance(d.get("distance_m"), (int, float))]
    items.sort(key=lambda d: float(d["distance_m"]))
    out: list[str] = []
    for d in items[:6]:
        name = str(d.get("name", "object"))
        dist = float(d["distance_m"])
        x1 = float(d.get("x1", 0.0))
        x2 = float(d.get("x2", 1.0))
        cx = (x1 + x2) / 2.0
        if cx < 1.0 / 3.0:
            side = "left"
        elif cx < 2.0 / 3.0:
            side = "center"
        else:
            side = "right"
        out.append(f"- {name}: {dist:.1f} m, {side} of view")
    if not out:
        return "No close obstacles detected with reliable distance."
    return "\n".join(out)


def _build_prompt(detections: list[dict[str, Any]]) -> str:
    det_text = _format_detections(detections)
    return f"""You are an assistant for a blind pedestrian. Use the camera image and the obstacle list to give a short, conservative navigation suggestion.

Obstacles (sorted by distance):
{det_text}

Reply with ONE JSON object only, no markdown, no extra text:
{{
  "scene": "<short English description of the scene, max 14 words>",
  "guidance_en": "<one short English instruction for text-to-speech, max 18 words>",
  "risk": "<one of: danger | caution | ok>",
  "focus": "<single object name that matters most, or empty string>"
}}

Rules:
- If the closest object is under 1.5 m, risk should be "danger" and guidance must say to stop or step aside.
- If between 1.5 m and 3 m, risk is usually "caution" and guidance should slow down or adjust direction.
- If nothing is close, risk is "ok" and guidance can say it is safe to continue.
- Do not invent road names, signs, or details not visible.
"""


def _parse_json_blob(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise ValueError("Empty response from Groq.")
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.I)
    if fenced:
        text = fenced.group(1).strip()
    brace = re.search(r"\{[\s\S]*\}", text)
    if brace:
        text = brace.group(0)
    return json.loads(text)


def _normalize_risk(value: Any) -> str:
    if not isinstance(value, str):
        return "unknown"
    v = value.strip().lower()
    if v in ("danger", "caution", "ok"):
        return v
    if v in ("warning", "warn"):
        return "caution"
    if v in ("safe", "clear"):
        return "ok"
    return "unknown"


def _empty_result(error: str | None) -> dict[str, Any]:
    return {
        "scene": None,
        "guidance_en": None,
        "risk": None,
        "focus": None,
        "ms": 0.0,
        "model": DEFAULT_MODEL,
        "error": error,
    }


def run_groq_navigation(
    pil_rgb: Image.Image,
    detections: list[dict[str, Any]],
) -> dict[str, Any]:
    """Call Groq + Llama 4 Scout. Always returns the same dict shape."""
    global _last_call_mono, _in_flight, _last_result

    if not _enabled():
        return _empty_result("Groq disabled (ENABLE_GROQ=0).")

    key = _api_key()
    if not key:
        return _empty_result("Missing GROQ_API_KEY.")

    now = time.monotonic()
    with _state_lock:
        if _in_flight and _last_result is not None:
            cached = dict(_last_result)
            cached["ms"] = 0.0
            cached["error"] = "Cached (call already in flight)."
            return cached

        if (
            _last_result is not None
            and (now - _last_call_mono) < DEFAULT_MIN_INTERVAL_S
        ):
            cached = dict(_last_result)
            cached["ms"] = 0.0
            cached["error"] = "Cached (cooldown)."
            return cached

        _in_flight = True

    t0 = time.perf_counter()
    try:
        data_url = _encode_image_data_url(pil_rgb)
        prompt = _build_prompt(detections)
        payload = {
            "model": DEFAULT_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            "temperature": 0.2,
            "max_tokens": DEFAULT_MAX_TOKENS,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        resp = requests.post(GROQ_URL, json=payload, headers=headers, timeout=DEFAULT_TIMEOUT_S)
        resp.raise_for_status()
        body = resp.json()
        raw_text = body["choices"][0]["message"]["content"]

        parsed = _parse_json_blob(raw_text)
        result = {
            "scene": (parsed.get("scene") or "").strip() or None,
            "guidance_en": (parsed.get("guidance_en") or "").strip() or None,
            "risk": _normalize_risk(parsed.get("risk")),
            "focus": (parsed.get("focus") or "").strip() or None,
            "ms": round((time.perf_counter() - t0) * 1000.0, 2),
            "model": DEFAULT_MODEL,
            "error": None,
        }

        with _state_lock:
            _last_call_mono = time.monotonic()
            _last_result = dict(result)

        return result
    except requests.Timeout:
        msg = f"Groq timeout (>{DEFAULT_TIMEOUT_S}s)."
        return _empty_result(msg)
    except requests.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.response.text[:200]
        except Exception:
            pass
        return _empty_result(f"Groq HTTP {exc.response.status_code}: {body_text}")
    except (KeyError, IndexError, ValueError, json.JSONDecodeError) as exc:
        return _empty_result(f"Groq parse error: {exc}")
    except Exception as exc:  # noqa: BLE001
        return _empty_result(f"Groq error: {exc}")
    finally:
        with _state_lock:
            _in_flight = False


def status() -> dict[str, Any]:
    return {
        "enabled": _enabled(),
        "model": DEFAULT_MODEL,
        "has_key": bool(_api_key()),
        "min_interval_s": DEFAULT_MIN_INTERVAL_S,
        "timeout_s": DEFAULT_TIMEOUT_S,
        "image_max_side": DEFAULT_IMAGE_SIDE,
    }
