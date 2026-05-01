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
from pathlib import Path
from typing import Any
from PIL import Image

# Import our optimized PFE modules
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from pfe.phase3.depth_estimator import estimate_distance
from pfe.phase3.gemini_scene_caption import gemini_caption_image
from pfe.phase3 import config

# ── Singleton Gemini client (created once, reused every request) ──────────
_gemini_client = None

def _get_gemini_client():
    """Return a cached Gemini client, or None if key is missing."""
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


# ── Scene caption (Gemini Vision) ─────────────────────────────────────────

def scene_top5_cached(pil_rgb: Image.Image) -> list[dict[str, Any]] | None:
    """One English scene sentence from Gemini Vision (same shape as legacy BLIP top-1)."""
    client = _get_gemini_client()
    if client is None:
        return None

    caption = gemini_caption_image(pil_rgb, client, timeout_s=config.GEMINI_TIMEOUT_S)
    if not caption:
        return None
    return [{"label": caption, "probability": 1.0}]


# ── Gemini Multimodal Vision ─────────────────────────────────────────────
def _build_structured_prompt(
    detections: list[dict[str, Any]],
    scene_desc: str,
) -> str:
    """Build a safety-focused prompt for Gemini."""
    # On trie pour que Gemini voit l'objet le plus proche en premier
    sorted_dets = sorted(
        [d for d in detections if d.get('distance_m') is not None],
        key=lambda x: x['distance_m']
    )
    
    objects_text = ""
    for d in sorted_dets[:4]:
        objects_text += f"- {d['name']} at {d['distance_m']}m\n"

    return f"""Context: Navigating a blind person in Algeria.
Scene description: {scene_desc}
Nearby objects:
{objects_text}

Task: Provide security guidance.
Respond ONLY with this JSON:
{{
  "darija": "<short safety warning in Algerian Darija, Latin script, max 10 words>",
  "risk": "<danger | caution | ok>",
  "focus": "<most critical object name>"
}}

Guidelines:
- If distance < 2m, risk is "danger", use words like "Hbes", "Attention", "Trebel".
- If no objects near, risk is "ok".
- Use ONLY Algerian Darija in LATIN script (phonetics). Example: "Kousina", "Bit rgad", "Atention kayein koursi".
- NO ARABIC SCRIPT.
- Max 10 words."""


def _build_detailed_description_prompt(
    detections: list[dict[str, Any]],
    scene_desc: str,
) -> str:
    """Build a detailed environment description prompt for Gemini."""
    objects_text = ""
    for d in detections[:10]:
        objects_text += f"- {d['name']} at {d['distance_m']}m\n"

    return f"""Context: Navigating a blind person in Algeria.
Scene description: {scene_desc}
Nearby objects:
{objects_text}

Task: Describe the entire environment in detail.
Respond ONLY with this JSON:
{{
  "darija": "<detailed description of the scene in Algerian Darija, Latin script, max 40 words>",
  "risk": "<danger | caution | ok>",
  "focus": "<most critical object name>"
}}

Guidelines:
- Describe the layout, main objects, and general atmosphere.
- Use ONLY Algerian Darija in LATIN script (phonetics).
- NO ARABIC SCRIPT.
- Max 40 words."""


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
    """
    Call Gemini with the actual image + detections.
    Returns structured JSON: {darija, risk, focus, text, error}.
    """
    # Check both config and environment variable
    enabled = os.environ.get("ENABLE_GEMINI", "1").strip().lower() in ("1", "true", "yes", "on")
    if not config.ENABLE_GEMINI or not enabled:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": "Gemini disabled."}

    client = _get_gemini_client()
    if client is None:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": "Missing GEMINI_API_KEY"}

    scene_desc = scene_top[0]["label"] if scene_top else "unknown scene"
    
    if detailed:
        prompt = _build_detailed_description_prompt(detections, scene_desc)
    else:
        prompt = _build_structured_prompt(detections, scene_desc)

    try:
        response = _call_gemini_with_timeout(client, pil_rgb, prompt)
        raw_text = (response.text or "").strip()

        # Parse the JSON response
        # Strip markdown code fences if Gemini wraps the JSON
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
            "text":   raw_text,   # keep raw for debugging
            "error":  None,
        }

    except concurrent.futures.TimeoutError:
        return {"text": None, "darija": None, "risk": None, "focus": None, "error": f"Gemini timeout (>{config.GEMINI_TIMEOUT_S}s)"}
    except json.JSONDecodeError as e:
        # Gemini didn't return valid JSON — return raw text as darija fallback
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

    scene_desc = scene_top[0]["label"] if scene_top else "unknown scene"
    objects_text = ""
    for d in detections[:8]:
        objects_text += f"- {d['name']} at {d['distance_m']}m\n"

    prompt = f"""Context: Navigating a blind person in Algeria.
Scene description: {scene_desc}
Nearby objects:
{objects_text}

Task: Listen to the user's voice message (in Darija or English) and answer their question based on the image.
Respond ONLY with this JSON:
{{
  "darija": "<your helpful answer in Algerian Darija, Latin script, max 40 words>",
  "risk": "<danger | caution | ok>",
  "focus": "<most critical object name>",
  "user_said": "<transcription of what the user said in the audio>"
}}

Guidelines:
- If they ask to 'describe the environment' (e.g. 'wash kayen qodami', 'describe environment'), give a detailed description.
- Use ONLY Algerian Darija in LATIN script (phonetics).
- NO ARABIC SCRIPT.
- Max 40 words."""

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
