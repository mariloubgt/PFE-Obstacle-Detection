"""Short English scene line from Gemini vision (API + optional pipeline HUD)."""

from __future__ import annotations

import concurrent.futures
import io
import os
from typing import Any

from PIL import Image

_gemini_scene_client: Any = None


def _get_scene_client():
    """Separate singleton from api.vision_pipeline to avoid circular imports."""
    global _gemini_scene_client
    if _gemini_scene_client is not None:
        return _gemini_scene_client
    from . import config

    key = (os.environ.get("GEMINI_API_KEY") or config.GEMINI_API_KEY or "").strip()
    if not key:
        return None
    try:
        from google import genai

        _gemini_scene_client = genai.Client(api_key=key)
        return _gemini_scene_client
    except Exception:
        return None


def brief_english_scene_caption(pil_rgb: Image.Image) -> str | None:
    """
    One concise English phrase for Gemini /prompt context.
    Returns None if Gemini disabled, no key, timeout, or error.
    """
    enabled = os.environ.get("ENABLE_GEMINI", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if not enabled:
        return None

    from . import config

    if not getattr(config, "ENABLE_GEMINI", True):
        return None

    client = _get_scene_client()
    if client is None:
        return None

    from google.genai import types

    max_words = int(os.environ.get("GEMINI_SCENE_MAX_WORDS", "32"))
    timeout_s = float(os.environ.get("GEMINI_SCENE_TIMEOUT_S", "8"))

    buf = io.BytesIO()
    q_raw = (
        os.environ.get("GEMINI_SCENE_JPEG_QUALITY")
        or os.environ.get("GEMINI_IMAGE_JPEG_QUALITY")
        or os.environ.get("BLIP_SCENE_JPEG_QUALITY")
        or "72"
    )
    q = max(40, min(int(q_raw), 95))
    pil_rgb.convert("RGB").save(buf, format="JPEG", quality=q)
    image_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg")

    prompt = f"""Look at this image. Write ONE short English sentence describing the scene for a blind pedestrian
(context: type of place, path, main visible objects). Max {max_words} words. Factual only; do not invent details."""

    text_part = types.Part.from_text(text=prompt)

    def _call():
        return client.models.generate_content(
            model=config.GEMINI_TTS_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[image_part, text_part],
                )
            ],
        )

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_call)
            response = fut.result(timeout=timeout_s)
        text = (response.text or "").strip()
        if not text:
            return None
        one_line = " ".join(text.split())
        return one_line[:800] if len(one_line) > 800 else one_line
    except concurrent.futures.TimeoutError:
        print("[Scene/Gemini] Scene caption timeout.")
        return None
    except Exception as e:
        print(f"[Scene/Gemini] Scene caption error: {e}")
        return None
