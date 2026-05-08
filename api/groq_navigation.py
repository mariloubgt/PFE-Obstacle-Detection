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


def _format_detections_for_nav(detections: list[dict[str, Any]]) -> str:
    """Format YOLO detections as a positional list for navigation prompts."""
    items = [d for d in (detections or []) if isinstance(d.get("distance_m"), (int, float))]
    items.sort(key=lambda d: float(d["distance_m"]))
    out: list[str] = []
    for d in items[:8]:
        name = str(d.get("name", "object"))
        dist = float(d["distance_m"])
        x1 = float(d.get("x1", 0.0))
        x2 = float(d.get("x2", 1.0))
        cx = (x1 + x2) / 2.0
        if cx < 1.0 / 3.0:
            side = "on your left"
        elif cx < 2.0 / 3.0:
            side = "directly ahead"
        else:
            side = "on your right"
        out.append(f"- {name}: {dist:.1f} meters, {side}")
    if not out:
        return "No close obstacles detected."
    return "\n".join(out)


def _build_navigation_prompt(detections: list[dict[str, Any]]) -> str:
    """Navigation prompt: always ends with a concrete action verb the person must execute."""
    det_text = _format_detections_for_nav(detections)
    return f"""You are guiding a blind person. Use the obstacle list below to give ONE clear walking instruction.

Obstacle list (nearest first):
{det_text}

YOUR OUTPUT MUST ALWAYS END WITH ONE OF THESE ACTIONS:
- "Step left."
- "Step right."
- "Stop."
- "Slow down."
- "Continue forward."
- "Turn around."

RULES:
- The action is MANDATORY. Never give a sentence without an action at the end.
- If obstacle is directly ahead → pick left OR right (whichever side is clear from the image).
- If obstacle < 1.5 m → action is "Stop." or "Step left." or "Step right." (urgent).
- If obstacle 1.5–3 m → action is "Slow down." + direction to take.
- If no close obstacles → "Continue forward."
- Never say "directly ahead" without also giving the action to avoid it.
- Max 20 words total for guidance_en.
- BANNED: appears, seem, possibly, perhaps, maybe, might, I think, probably.

GOOD examples:
- "Person 1 meter ahead. Step left."
- "Chair 2 meters on the right. Continue forward on the left."
- "Wall close ahead. Stop."
- "Path is clear. Continue forward."
- "Person 3 meters ahead. Slow down and step right."

BAD examples (never do this):
- "Person directly ahead." ← NO ACTION
- "There is a chair on the left." ← NO ACTION
- "Obstacle detected." ← NO ACTION

Reply with ONE JSON object only — no markdown:
{{
  "scene": "<max 10 words, what type of place is this>",
  "guidance_en": "<max 20 words. Obstacle + distance + action. MUST end with an action verb.>",
  "risk": "<danger | caution | ok>",
  "focus": "<main obstacle name, or 'path' if clear>"
}}"""


def _build_prompt(detections: list[dict[str, Any]]) -> str:  # noqa: ARG001
    """BLIP-style image-only DESCRIPTION prompt. No navigation instructions.
    The VLM looks at the image and tells the blind person what is visible — that's it."""
    return """You are describing a scene to a blind person. Look at the image and tell them what is visible.

DO NOT give navigation instructions. DO NOT say "move", "stop", "continue", "turn", "go", "step", or any action verb directed at the person. The user has a separate obstacle detection system for that. Your job is ONLY to describe what is in the image.

ABSOLUTE BANNED WORDS — never output any of these:
appears, appear, appearing, seems, seem, seeming, possibly, perhaps, maybe, might, could be, looks like, kind of, sort of, I think, I believe, probably, likely, presumably, supposedly.

Speak in plain present tense, in concrete factual sentences:
- BAD:  "The scene appears to be a hallway, possibly with a chair on the right. You should move left."
- GOOD: "A hallway with white walls. A wooden chair stands on the right. A door is at the end."
- BAD:  "It looks like there might be a person ahead. Stop."
- GOOD: "A person stands a few meters ahead, wearing a dark jacket. Books are on a table next to them."

Mention positions when useful (left, right, in front, behind, above, below) and approximate distance only if obvious (close, a few meters away, far). Mention colors, materials, or notable details that help paint the scene.

Reply with ONE JSON object only — no markdown, no extra text:
{
  "scene": "<short factual sentence naming the place or main subject, max 14 words, present tense, no hedging, no actions>",
  "guidance_en": "<one or two factual sentences describing what is visible — objects, positions, notable details. Max 35 words. Pure description, no navigation, no actions, no hedging.>",
  "risk": "<one of: danger | caution | ok — based only on what you see, not as advice>",
  "focus": "<the main visible object or person, or 'open space' if nothing prominent>"
}

Never invent details, names, or text that are not visible."""


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


_HEDGE_PATTERNS = [
    (re.compile(r"\b(?:it\s+)?appears?(?:\s+to\s+be)?\b", re.I), "is"),
    (re.compile(r"\bappearing(?:\s+to\s+be)?\b", re.I), "is"),
    (re.compile(r"\bseems?(?:\s+to\s+be)?\b", re.I), "is"),
    (re.compile(r"\bseeming(?:\s+to\s+be)?\b", re.I), "is"),
    (re.compile(r"\blooks?\s+like\b", re.I), "is"),
    (re.compile(r"\b(?:could|might|may)\s+be\b", re.I), "is"),
    (re.compile(r"\b(?:i\s+)?(?:think|believe|guess)\b\s*", re.I), ""),
    (re.compile(r"\b(?:possibly|perhaps|maybe|probably|likely|presumably|supposedly)\b\s*,?\s*", re.I), ""),
    (re.compile(r"\b(?:kind|sort)\s+of\b\s*", re.I), ""),
]


def _strip_hedging(text: str | None) -> str | None:
    if not text:
        return text
    out = text
    for pat, repl in _HEDGE_PATTERNS:
        out = pat.sub(repl, out)
    out = re.sub(r"\s{2,}", " ", out).strip(" ,.;:")
    if out:
        out = out[0].upper() + out[1:]
        if not out.endswith((".", "!", "?")):
            out += "."
    return out or None


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
        "mode": None,
        "error": error,
    }


_DESCRIBE_SYSTEM = (
    "You are a scene describer for a blind person. "
    "You ONLY describe what is visible. You NEVER give navigation "
    "instructions, NEVER tell the person to move, stop, turn, continue, "
    "or take any action. A separate obstacle detection system handles "
    "navigation. Your sole job is pure description. "
    "You speak in direct, factual present-tense statements. "
    "You NEVER use the words: appears, appear, appearing, seems, seem, "
    "seeming, possibly, perhaps, maybe, might, could, looks like, "
    "kind of, sort of, I think, I believe, probably, likely, presumably. "
    "If you are uncertain, describe what is most clearly visible "
    "without hedging. You always reply with valid JSON only."
)

_NAVIGATE_SYSTEM = (
    "You are a navigation assistant for a blind pedestrian. "
    "Every response MUST end with one concrete action: Step left. Step right. Stop. Slow down. Continue forward. Turn around. "
    "Never describe a situation without telling the person what to DO. "
    "If an obstacle is directly ahead, pick the clearer side (left or right) and say to step there. "
    "You speak in direct present-tense statements, max 20 words. "
    "You NEVER use: appears, seem, possibly, perhaps, maybe, might, I think, probably. "
    "You always reply with valid JSON only."
)


def run_groq_navigation(
    pil_rgb: Image.Image,
    detections: list[dict[str, Any]],
    mode: str = "describe",
) -> dict[str, Any]:
    """Call Groq + Llama 4 Scout. mode='describe' (default) or 'navigate'."""
    global _last_call_mono, _in_flight, _last_result

    if not _enabled():
        return _empty_result("Groq disabled (ENABLE_GROQ=0).")

    key = _api_key()
    if not key:
        return _empty_result("Missing GROQ_API_KEY.")

    is_nav = str(mode).strip().lower() == "navigate"

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
            and _last_result.get("mode") == ("navigate" if is_nav else "describe")
        ):
            cached = dict(_last_result)
            cached["ms"] = 0.0
            cached["error"] = "Cached (cooldown)."
            return cached

        _in_flight = True

    t0 = time.perf_counter()
    try:
        data_url = _encode_image_data_url(pil_rgb)
        prompt = _build_navigation_prompt(detections) if is_nav else _build_prompt(detections)
        system_msg = _NAVIGATE_SYSTEM if is_nav else _DESCRIBE_SYSTEM
        payload = {
            "model": DEFAULT_MODEL,
            "messages": [
                {"role": "system", "content": system_msg},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            "temperature": 0.0,
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
        scene_clean = _strip_hedging((parsed.get("scene") or "").strip() or None)
        guidance_clean = _strip_hedging((parsed.get("guidance_en") or "").strip() or None)
        result = {
            "scene": scene_clean,
            "guidance_en": guidance_clean,
            "risk": _normalize_risk(parsed.get("risk")),
            "focus": (parsed.get("focus") or "").strip() or None,
            "ms": round((time.perf_counter() - t0) * 1000.0, 2),
            "model": DEFAULT_MODEL,
            "mode": "navigate" if is_nav else "describe",
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


GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_WHISPER_MODEL = "whisper-large-v3"


def run_groq_voice_query(
    pil_rgb: Image.Image,
    audio_bytes: bytes,
    audio_mime: str,
) -> dict[str, Any]:
    """
    1. Transcribe user audio with Groq Whisper.
    2. Send image + transcribed question to Groq Llama 4 Scout.
    Returns {answer, user_said, error}.
    """
    if not _enabled():
        return {"answer": None, "user_said": None, "error": "Groq disabled."}

    key = _api_key()
    if not key:
        return {"answer": None, "user_said": None, "error": "Missing GROQ_API_KEY."}

    headers_auth = {"Authorization": f"Bearer {key}"}

    # --- Step 1: Transcribe audio ---
    ext = "m4a"
    if "wav" in audio_mime:
        ext = "wav"
    elif "webm" in audio_mime:
        ext = "webm"
    elif "mp4" in audio_mime or "m4a" in audio_mime:
        ext = "m4a"
    elif "ogg" in audio_mime:
        ext = "ogg"

    try:
        transcribe_resp = requests.post(
            GROQ_WHISPER_URL,
            headers=headers_auth,
            files={"file": (f"audio.{ext}", audio_bytes, audio_mime)},
            data={"model": GROQ_WHISPER_MODEL},
            timeout=25.0,
        )
        transcribe_resp.raise_for_status()
        user_said = transcribe_resp.json().get("text", "").strip()
    except Exception as exc:  # noqa: BLE001
        return {"answer": None, "user_said": None, "error": f"Whisper transcription failed: {exc}"}

    if not user_said:
        return {"answer": None, "user_said": "", "error": "Could not understand audio."}

    # --- Step 2: Answer with image ---
    data_url = _encode_image_data_url(pil_rgb)
    system = (
        "You are a helpful assistant for a blind person. "
        "You see the image they are looking at. Answer their question "
        "based strictly on what is visible. Be concise (max 40 words). "
        "Use plain factual English. Never hedge with 'possibly' or 'perhaps'."
    )
    user_prompt = f'The user asked: "{user_said}"\n\nDescribe what you see in the image that is relevant to this question.'

    try:
        chat_resp = requests.post(
            GROQ_URL,
            json={
                "model": DEFAULT_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
                "temperature": 0.0,
                "max_tokens": 120,
            },
            headers={**headers_auth, "Content-Type": "application/json"},
            timeout=25.0,
        )
        chat_resp.raise_for_status()
        answer = chat_resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:  # noqa: BLE001
        return {"answer": None, "user_said": user_said, "error": f"Groq answer failed: {exc}"}

    return {"answer": answer, "user_said": user_said, "error": None}


def status() -> dict[str, Any]:
    return {
        "enabled": _enabled(),
        "model": DEFAULT_MODEL,
        "has_key": bool(_api_key()),
        "min_interval_s": DEFAULT_MIN_INTERVAL_S,
        "timeout_s": DEFAULT_TIMEOUT_S,
        "image_max_side": DEFAULT_IMAGE_SIDE,
    }
