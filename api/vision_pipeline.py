"""
Phase 3 — mobile inference API backend.
Integrated with PFE Phase 3 logic (Gemini Vision scene caption + Trig Depth).
Includes Gemini multimodal vision for navigation context.
"""

from __future__ import annotations
import io
import os
import sys
import json
import concurrent.futures
import urllib.request
import urllib.error
import ssl
from pathlib import Path
from typing import Any
from PIL import Image
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# Import our optimized PFE modules
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from pfe.phase3.depth_estimator import estimate_distance
from pfe.phase3.gemini_scene_caption import gemini_caption_image
from pfe.phase3 import config

# ── MoonDream2 (local lightweight VLM) ─────────────────────────────────────
_MOONDREAM_MODEL_ID = os.environ.get("MOONDREAM_MODEL_ID", "vikhyatk/moondream2").strip()
_MOONDREAM_QUESTION = os.environ.get("MOONDREAM_QUESTION", "What obstacles are ahead?").strip() or "What obstacles are ahead?"
_MOONDREAM_BACKEND = os.environ.get("MOONDREAM_BACKEND", "auto").strip().lower()  # auto|mlx|transformers
_BLIP_MODEL = os.environ.get("HF_BLIP_MODEL", "Salesforce/blip-image-captioning-base").strip()
_BLIP_API_URL = f"https://router.huggingface.co/fal-ai/models/{_BLIP_MODEL}"
_gemini_client = None
_moondream_model = None
_moondream_tokenizer = None
_moondream_error: str | None = None
_moondream_runtime = None

def _get_gemini_client():
    """Kept for voice-query/navigation modules that still rely on Gemini."""
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client
    key = (os.environ.get("GEMINI_API_KEY") or config.GEMINI_API_KEY or "").strip()
    if not key:
        return None
    try:
        from google import genai
        _gemini_client = genai.Client(api_key=key)
        print("[Gemini] Client initialized (singleton).")
        return _gemini_client
    except Exception as e:
        print(f"[Gemini] Failed to create client: {e}")
        return None

def _get_moondream():
    """Return cached MoonDream model/tokenizer, loading once."""
    global _moondream_model, _moondream_tokenizer, _moondream_error, _moondream_runtime
    if _moondream_model is not None and _moondream_tokenizer is not None:
        return _moondream_model, _moondream_tokenizer

    # Prefer MLX on Apple Silicon when available.
    if _MOONDREAM_BACKEND in ("auto", "mlx"):
        try:
            # Apple MLX package for MoonDream2.
            from mlx_vlm import load  # type: ignore
            model, processor = load(_MOONDREAM_MODEL_ID)
            _moondream_model = model
            _moondream_tokenizer = processor
            _moondream_runtime = "mlx"
            _moondream_error = None
            print(f"[MoonDream] Loaded with MLX backend ({_MOONDREAM_MODEL_ID}).")
            return _moondream_model, _moondream_tokenizer
        except Exception as exc:
            _moondream_error = f"MLX load failed: {exc}"
            if _MOONDREAM_BACKEND == "mlx":
                print(f"[MoonDream] {_moondream_error}")
                return None, None

    try:
        _moondream_model = AutoModelForCausalLM.from_pretrained(
            _MOONDREAM_MODEL_ID,
            trust_remote_code=True,
        )
        _moondream_tokenizer = AutoTokenizer.from_pretrained(_MOONDREAM_MODEL_ID)
        _moondream_runtime = "transformers"
        _moondream_error = None
        return _moondream_model, _moondream_tokenizer
    except Exception as exc:
        _moondream_error = str(exc)
        print(f"[MoonDream] Load failed: {exc}")
        return None, None


def _moondream_describe_image(pil_rgb: Image.Image, question: str | None = None) -> str | None:
    model, tokenizer = _get_moondream()
    if model is None or tokenizer is None:
        return None
    try:
        if _moondream_runtime == "mlx":
            from mlx_vlm import generate  # type: ignore
            answer = generate(
                model=model,
                processor=tokenizer,
                image=pil_rgb,
                prompt=question or _MOONDREAM_QUESTION,
                verbose=False,
            )
        else:
            with torch.inference_mode():
                enc = model.encode_image(pil_rgb)
                answer = model.answer_question(enc, question or _MOONDREAM_QUESTION, tokenizer)
        txt = str(answer or "").strip()
        return txt or None
    except Exception as exc:
        print(f"[MoonDream] Inference failed: {exc}")
        return None


def moondream_status() -> dict[str, Any]:
    """Local model readiness for startup/health."""
    model, tokenizer = _get_moondream()
    return {
        "enabled": True,
        "model": _MOONDREAM_MODEL_ID,
        "backend": _moondream_runtime or _MOONDREAM_BACKEND,
        "ok": bool(model is not None and tokenizer is not None),
        "error": _moondream_error,
    }


def _get_hf_token() -> str:
    return (os.environ.get("HF_API_TOKEN") or os.environ.get("HUGGINGFACE_API_KEY") or "").strip()


def _image_to_jpeg_bytes(pil_rgb: Image.Image, quality: int = 75) -> bytes:
    buf = io.BytesIO()
    pil_rgb.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _blip_caption_image(pil_rgb: Image.Image) -> str | None:
    token = _get_hf_token()
    if not token:
        return None
    payload = _image_to_jpeg_bytes(pil_rgb, quality=72)
    req = urllib.request.Request(
        url=_BLIP_API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "image/jpeg",
            "Accept": "application/json",
        },
    )
    try:
        try:
            import certifi
            ssl_context = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            ssl_context = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=12, context=ssl_context) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        parsed = json.loads(body)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = str(exc)
        print(f"[BLIP] HTTP error ({_BLIP_API_URL}): {exc.code} {body[:200]}")
        return None
    except Exception as exc:
        print(f"[BLIP] Request failed ({_BLIP_API_URL}): {exc}")
        return None

    if isinstance(parsed, list) and parsed:
        first = parsed[0] if isinstance(parsed[0], dict) else {}
        txt = str(first.get("generated_text", "")).strip()
        return txt or None
    if isinstance(parsed, dict) and "generated_text" in parsed:
        txt = str(parsed.get("generated_text", "")).strip()
        return txt or None
    if isinstance(parsed, dict) and parsed.get("error"):
        print(f"[BLIP] API error: {parsed.get('error')}")
    return None


def blip_auth_status() -> dict[str, Any]:
    token = _get_hf_token()
    status: dict[str, Any] = {
        "enabled": bool(token),
        "model": _BLIP_MODEL,
        "ok": False,
        "error": None,
        "endpoint": _BLIP_API_URL,
    }
    if not token:
        status["error"] = "Missing HF_API_TOKEN"
        return status
    tiny = Image.new("RGB", (1, 1), (127, 127, 127))
    ok = _blip_caption_image(tiny)
    status["ok"] = bool(ok)
    if not status["ok"]:
        status["error"] = "BLIP auth/check failed"
    return status


# ── Distance Calculation ──────────────────────────────────────────────────
def estimate_distance_m(
    x1_px: float,
    y1_px: float,
    x2_px: float,
    y2_px: float,
    image_w_px: int,
    image_h_px: int,
    class_name: str,
    fov_deg: float,
) -> tuple[float, str]:
    """Pinhole depth from horizontal FOV + typical object size (height / width fusion)."""
    dist = estimate_distance(
        class_name,
        x1_px,
        y1_px,
        x2_px,
        y2_px,
        image_w_px,
        image_h_px,
        horizontal_fov_deg=fov_deg,
    )
    return dist, "pinhole_hfov_v2"


# ── Scene caption (MoonDream2 local) ───────────────────────────────────────

def scene_top5_cached(pil_rgb: Image.Image) -> list[dict[str, Any]] | None:
    """One English scene sentence from Gemini Vision."""
    client = _get_gemini_client()
    if client is None:
        return None
    caption = gemini_caption_image(pil_rgb, client, timeout_s=config.GEMINI_TIMEOUT_S)
    if not caption:
        return None
    return [{"label": caption, "probability": 1.0}]


# ── Gemini Multimodal Vision (image-only, BLIP-style) ─────────────────────
def _build_structured_prompt() -> str:
    """Direct image-to-navigation prompt. No YOLO data. Decisive language only."""
    return """You are guiding a blind person walking forward in Algeria.
Look at the image. Say what you see and what to do.

Rules:
- Be DECISIVE. Never use "possibly", "perhaps", "maybe", "I think", "it seems".
- State facts: "There is X in front", "The path is clear", "A wall is on your right".
- Give ONE action: "move left", "move right", "stop", "continue forward".

Respond ONLY with this JSON (no markdown):
{
  "darija": "<one short sentence in Algerian Darija (Latin script). What you see + action. Max 12 words.>",
  "risk": "<danger | caution | ok>",
  "focus": "<the main visible obstacle, or 'path' if clear>"
}

Examples of good darija:
- "Kayen bnadem qoddamek, dir lyssar."
- "Triq khawya, kemmel goddam."
- "Hbes! Kayen hit qriba."
- "Atention koursi 3la lymin."

Use ONLY Latin script. NO ARABIC SCRIPT."""


def _build_detailed_description_prompt() -> str:
    """Direct image-to-detailed-description. No YOLO data. Decisive language only."""
    return """You are describing the scene to a blind person in Algeria.
Look at the image and describe what is actually there.

Rules:
- Be DECISIVE. Never say "possibly", "perhaps", "maybe", "I think", "it appears".
- State concrete facts about objects, layout, and surfaces.
- Mention positions (left, right, in front, behind) and approximate proximity (close, far).

Respond ONLY with this JSON (no markdown):
{
  "darija": "<detailed description in Algerian Darija (Latin script). What is visible + safe direction. Max 40 words.>",
  "risk": "<danger | caution | ok>",
  "focus": "<the main visible obstacle, or 'path' if clear>"
}

Use ONLY Latin script. NO ARABIC SCRIPT."""


def _call_gemini_with_timeout(
    client,
    pil_rgb: Image.Image,
    prompt: str,
) -> dict[str, Any]:
    """Call Gemini vision API with image + prompt, enforcing a timeout."""
    from google.genai import types

    # Encode image as JPEG bytes for multimodal input
    buf = io.BytesIO()
    pil_rgb.save(buf, format="JPEG", quality=70)
    img_bytes = buf.getvalue()

    image_part = types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")
    text_part  = types.Part.from_text(text=prompt)

    def _call():
        return client.models.generate_content(
            model=config.GEMINI_TTS_MODEL,
            contents=[types.Content(role="user", parts=[image_part, text_part])],
        )

    # Run with timeout on a thread so we never block the FastAPI loop
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        future = ex.submit(_call)
        response = future.result(timeout=config.GEMINI_TIMEOUT_S)

    return response


def run_gemini(
    pil_rgb: Image.Image,
    detections: list[dict[str, Any]],
    scene_top: list[dict[str, Any]] | None,
    fov_deg: float,
    detailed: bool = False,
) -> dict[str, Any]:
    """Call Gemini with the image only (BLIP-style). Detections are ignored on purpose."""
    enabled = os.environ.get("ENABLE_GEMINI", "1").strip().lower() in ("1", "true", "yes", "on")
    if not config.ENABLE_GEMINI or not enabled:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": "Gemini disabled."}

    client = _get_gemini_client()
    if client is None:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": "Missing GEMINI_API_KEY"}

    prompt = _build_detailed_description_prompt() if detailed else _build_structured_prompt()

    try:
        response = _call_gemini_with_timeout(client, pil_rgb, prompt)
        raw_text = (response.text or "").strip()
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            raw_text = raw_text.strip()
        parsed = json.loads(raw_text)
        return {
            "darija": parsed.get("darija"),
            "risk": parsed.get("risk", "ok"),
            "focus": parsed.get("focus"),
            "text": raw_text,
            "error": None,
        }
    except concurrent.futures.TimeoutError:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": f"Gemini timeout (>{config.GEMINI_TIMEOUT_S}s)"}
    except json.JSONDecodeError as e:
        raw = getattr(response, "text", "") if "response" in dir() else ""
        return {"text": raw, "darija": raw or None, "risk": "unknown", "focus": None, "error": f"JSON parse error: {e}"}
    except Exception as e:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": str(e)}


def run_voice_query(
    pil_rgb: Image.Image,
    audio_bytes: bytes,
    audio_mime: str,
    detections: list[dict[str, Any]],
    scene_top: list[dict[dict, Any]] | None,
) -> dict[str, Any]:
    """
    Call Gemini with Image + Audio + Detections context.
    Returns structured JSON: {darija, risk, focus, text, error}.
    """
    enabled = os.environ.get("ENABLE_GEMINI", "1").strip().lower() in ("1", "true", "yes", "on")
    if not config.ENABLE_GEMINI or not enabled:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": "Gemini disabled."}

    client = _get_gemini_client()
    if client is None:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": "Missing GEMINI_API_KEY"}

    prompt = """You are guiding a blind person in Algeria.
Look at the image. Listen to the user's voice (Darija or English). Answer based on what you SEE.

Rules:
- Be DECISIVE. Never use "possibly", "perhaps", "maybe", "I think", "it seems".
- State concrete facts about what is visible.
- If they ask to describe the environment, give layout + objects + a safe direction.

Respond ONLY with this JSON (no markdown):
{
  "darija": "<answer in Algerian Darija (Latin script), max 40 words>",
  "risk": "<danger | caution | ok>",
  "focus": "<main visible object, or 'path' if clear>",
  "user_said": "<transcription of what the user said>"
}

Use ONLY Latin script. NO ARABIC SCRIPT."""

    from google.genai import types
    import io

    # Image Part
    buf = io.BytesIO()
    pil_rgb.save(buf, format="JPEG", quality=75)
    img_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg")

    # Audio Part
    audio_part = types.Part.from_bytes(data=audio_bytes, mime_type=audio_mime)

    # Text Part
    text_part = types.Part.from_text(text=prompt)

    try:
        def _call():
            return client.models.generate_content(
                model=config.GEMINI_TTS_MODEL,
                contents=[types.Content(role="user", parts=[img_part, audio_part, text_part])],
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(_call)
            response = future.result(timeout=15) # Audio takes longer

        raw_text = (response.text or "").strip()
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            raw_text = raw_text.strip()

        parsed = json.loads(raw_text)
        return {
            "darija": parsed.get("darija"),
            "risk":   parsed.get("risk", "ok"),
            "focus":  parsed.get("focus"),
            "user_said": parsed.get("user_said"),
            "text":   raw_text,
            "error":  None,
        }
    except Exception as e:
        return {"text": None, "darija": f"Error: {e}", "error": str(e)}
