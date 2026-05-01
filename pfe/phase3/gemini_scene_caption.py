"""Short English scene captions via Gemini Vision (replaces local BLIP)."""
from __future__ import annotations

import concurrent.futures
import io

from PIL import Image

from . import config

_SCENE_PROMPT = """You assist blind pedestrian navigation. Describe this image in exactly one concise English sentence (max 25 words): visible objects, spatial layout, and any hazards. Output plain text only — no JSON, bullets, or preamble."""


def gemini_caption_image(
    pil_rgb: Image.Image,
    client,
    *,
    timeout_s: float | None = None,
    model: str | None = None,
) -> str | None:
    """Call Gemini with the image; return English caption text or None on failure."""
    from google.genai import types

    t = timeout_s if timeout_s is not None else config.GEMINI_TIMEOUT_S
    m = model or config.GEMINI_TTS_MODEL

    buf = io.BytesIO()
    pil_rgb.save(buf, format="JPEG", quality=72)
    img_bytes = buf.getvalue()
    image_part = types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")
    text_part = types.Part.from_text(text=_SCENE_PROMPT)

    def _call():
        return client.models.generate_content(
            model=m,
            contents=[types.Content(role="user", parts=[image_part, text_part])],
        )

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(_call)
            response = future.result(timeout=t)
        text = (response.text or "").strip()
        return text if text else None
    except concurrent.futures.TimeoutError:
        print(f"[Gemini Scene] Timeout (>{t}s)")
        return None
    except Exception as e:
        print(f"[Gemini Scene] {e}")
        return None
