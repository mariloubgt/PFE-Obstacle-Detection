"""
Optional LLaVA-1.5-7B navigation hints for visually impaired pedestrians.
Loads lazily; safe to disable via ENABLE_LLAVA_NAV=0 — API stays up without CUDA/VRAM.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from typing import Any

from PIL import Image

# ── Globals (lazy) ───────────────────────────────────────────────────────────
_llava_model = None
_llava_processor = None
_llava_load_error: str | None = None
_llava_lock = threading.Lock()
_last_nav_call_mono: float = 0.0
_last_nav_result: dict[str, Any] | None = None

MAX_GUIDANCE_CHARS = int(os.environ.get("LLAVA_MAX_GUIDANCE_CHARS", "220"))

def _enabled() -> bool:
    return os.environ.get("ENABLE_LLAVA_NAV", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)).strip())
    except ValueError:
        return default


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)).strip())
    except ValueError:
        return default


def _lateral_from_norm(cx: float) -> str:
    """cx in [0,1] — image center horizontal."""
    if cx < 1.0 / 3.0:
        return "left"
    if cx < 2.0 / 3.0:
        return "center"
    return "right"


def _build_detection_context(
    detections: list[dict[str, Any]], image_w: int, image_h: int
) -> str:
    """Sorted by distance; include lateral band from normalized boxes."""
    with_dist = [
        d
        for d in detections
        if isinstance(d.get("distance_m"), (int, float))
        and d["distance_m"] is not None
    ]
    with_dist.sort(key=lambda x: float(x["distance_m"]))
    lines: list[str] = []
    for d in with_dist[:8]:
        name = str(d.get("name", "object"))
        dist_m = float(d["distance_m"])
        x1 = float(d.get("x1", 0))
        x2 = float(d.get("x2", 1))
        cx = (x1 + x2) / 2.0
        lateral = _lateral_from_norm(cx)
        lines.append(f"- {name}: ~{dist_m:.1f} m, appears in {lateral} of view")
    if not lines:
        return "No objects with estimated distance."
    return "\n".join(lines)


def _parse_json_blob(text: str) -> dict[str, Any]:
    raw = text.strip()
    raw = raw.replace("\r", "").strip()

    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.I)
    if fenced:
        raw = fenced.group(1).strip()

    brace = re.search(r"\{[\s\S]*\}", raw)
    if brace:
        raw = brace.group(0)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    cleaned = raw.split("ASSISTANT:")[-1].strip()
    brace2 = re.search(r"\{[\s\S]*\}", cleaned)
    if brace2:
        try:
            return json.loads(brace2.group(0))
        except json.JSONDecodeError:
            pass

    raise ValueError("No valid JSON object in model output")


def _clip(s: str, n: int) -> str:
    t = (s or "").strip()
    if len(t) <= n:
        return t
    return t[: max(0, n - 3)] + "..."


def _llava_torch_dtype_and_device_map_nonquant(imported_torch):
    """
    Avoid device_map=\"auto\" on macOS: offload moves fp16 layers to CPU where
    LayerNorm-half breaks. Default on macOS: MPS only (CPU inference is deliberately
    unsupported — far too slow for 7B).

    User overrides: LLAVA_DEVICE_MAP=mps | cuda:N  (never cpu / auto on macOS)
                     LLAVA_FORCE_FP32=1
    """
    torch = imported_torch

    dm_env = (os.environ.get("LLAVA_DEVICE_MAP") or "").strip()
    force_fp32 = os.environ.get("LLAVA_FORCE_FP32", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )

    def pick_dtype(prefer_half: bool):
        if force_fp32:
            return torch.float32
        return torch.float16 if prefer_half else torch.float32

    if sys.platform == "darwin":
        if dm_env in ("cpu", "auto"):
            raise RuntimeError(
                "LLAVA_NAV: on macOS, LLAVA_DEVICE_MAP=cpu and =auto are disabled "
                "(CPU is too slow; auto can offload to CPU). Unset LLAVA_DEVICE_MAP "
                "to use MPS, or set LLAVA_DEVICE_MAP=mps explicitly."
            )
        if not torch.backends.mps.is_available():
            raise RuntimeError(
                "LLAVA_NAV: macOS requires Apple MPS (GPU) for LLaVA — CPU is disabled. "
                "torch.backends.mps.is_available() is False. Use a machine with MPS "
                "(Apple Silicon + recent PyTorch) or run LLaVA on Linux+NVIDIA, or "
                "set ENABLE_LLAVA_NAV=0."
            )

    if dm_env:
        if dm_env == "auto":
            return pick_dtype(True), "auto"
        if dm_env == "cpu":
            raise RuntimeError(
                "LLAVA_NAV: LLAVA_DEVICE_MAP=cpu is disabled (too slow); use NVIDIA "
                "(cuda) hardware or Apple MPS via unset / mps on macOS."
            )
        if dm_env == "mps" or dm_env.startswith("cuda"):
            return pick_dtype(dm_env != "cpu"), {"": dm_env}
        # allow pass-through strings accelerate understands
        return pick_dtype(True), dm_env

    # Default: Linux/Windows prefers single CUDA if available logic is user's job;
    # "auto" uses GPU without forcing CPU-only.
    if sys.platform == "darwin":
        return pick_dtype(True), {"": "mps"}

    return pick_dtype(True), "auto"


def _ensure_model():
    """Load model + processor once; capture failure reason."""
    global _llava_model, _llava_processor, _llava_load_error

    if _llava_load_error is not None:
        return False
    if _llava_model is not None and _llava_processor is not None:
        return True

    with _llava_lock:
        if _llava_load_error is not None:
            return False
        if _llava_model is not None:
            return True

        model_id = (
            os.environ.get("LLAVA_MODEL_ID") or "llava-hf/llava-1.5-7b-hf"
        ).strip()

        try:
            import torch
            from transformers import AutoProcessor, LlavaForConditionalGeneration
        except Exception as e:
            _llava_load_error = f"import error: {e}"
            print(f"[LLaVA NAV] {_llava_load_error}")
            return False

        raw_4bit = os.environ.get("LLAVA_USE_4BIT")
        if raw_4bit is not None and str(raw_4bit).strip():
            use_4bit = str(raw_4bit).strip().lower() in (
                "1",
                "true",
                "yes",
                "on",
            )
        else:
            # macOS/arm64 wheels for bitsandbytes are old; FP16 on MPS avoids bnb. Linux defaults to 4-bit.
            use_4bit = sys.platform != "darwin"

        try:
            if use_4bit:
                from transformers import BitsAndBytesConfig

                q_cfg = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                )
                _llava_model = LlavaForConditionalGeneration.from_pretrained(
                    model_id,
                    quantization_config=q_cfg,
                    device_map=os.environ.get("LLAVA_DEVICE_MAP", "auto").strip()
                    or "auto",
                    low_cpu_mem_usage=True,
                    trust_remote_code=True,
                )
            else:
                dt, dm = _llava_torch_dtype_and_device_map_nonquant(torch)
                kwargs = dict(
                    torch_dtype=dt,
                    device_map=dm,
                    trust_remote_code=True,
                )
                if dm == "auto":
                    kwargs["low_cpu_mem_usage"] = True
                _llava_model = LlavaForConditionalGeneration.from_pretrained(
                    model_id,
                    **kwargs,
                )

            _llava_processor = AutoProcessor.from_pretrained(
                model_id, trust_remote_code=True
            )
            if use_4bit:
                print(f"[LLaVA NAV] Loaded {model_id} (4bit=True).")
            else:
                print(
                    f"[LLaVA NAV] Loaded {model_id} (4bit=False, "
                    f"device_map={dm}, dtype={dt})."
                )
            return True
        except Exception as e:
            err = str(e)
            if use_4bit:
                print(
                    f"[LLaVA NAV] 4-bit load failed: {err}\n"
                    f"[LLaVA NAV] Retrying FP16 / MPS without bitsandbytes…"
                )
                try:
                    dt, dm = _llava_torch_dtype_and_device_map_nonquant(torch)
                    kwargs = dict(
                        torch_dtype=dt,
                        device_map=dm,
                        trust_remote_code=True,
                    )
                    if dm == "auto":
                        kwargs["low_cpu_mem_usage"] = True
                    _llava_model = LlavaForConditionalGeneration.from_pretrained(
                        model_id,
                        **kwargs,
                    )
                    _llava_processor = AutoProcessor.from_pretrained(
                        model_id, trust_remote_code=True
                    )
                    print(
                        f"[LLaVA NAV] Loaded {model_id} (4bit=False, fallback "
                        f"device_map={dm}, dtype={dt})."
                    )
                    return True
                except Exception as e2:
                    _llava_load_error = str(e2)
                    print(f"[LLaVA NAV] Fallback load failed: {_llava_load_error}")
                    return False
            _llava_load_error = err
            print(f"[LLaVA NAV] Load failed: {_llava_load_error}")
            return False


def run_llava_navigation_if_enabled(
    pil_rgb: Image.Image,
    detections: list[dict[str, Any]],
    image_w: int,
    image_h: int,
    scene_top: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """
    Returns navigation dict for /predict (always same keys).
    """
    global _last_nav_call_mono, _last_nav_result

    empty = {
        "guidance_en": None,
        "guidance_dz": None,
        "ms": 0.0,
        "error": None,
    }

    if not _enabled():
        empty["error"] = "LLaVA navigation disabled (ENABLE_LLAVA_NAV)."
        return empty

    max_dist = _env_float("LLAVA_NAV_MAX_DIST_M", 5.0)
    min_interval = _env_float("LLAVA_MIN_INTERVAL_SEC", 2.0)
    max_new_tokens = _env_int("LLAVA_MAX_NEW_TOKENS", 96)

    with_dist = [
        d
        for d in detections
        if isinstance(d.get("distance_m"), (int, float))
        and d["distance_m"] is not None
    ]
    if not with_dist:
        empty["error"] = "No detections with distance."
        return empty

    closest = min(with_dist, key=lambda x: float(x["distance_m"]))
    if float(closest["distance_m"]) > max_dist:
        empty["error"] = (
            f"Closest object beyond LLAVA_NAV_MAX_DIST_M ({max_dist} m)."
        )
        return empty

    now = time.monotonic()
    if (
        _last_nav_result
        and _last_nav_result.get("guidance_en")
        and (now - _last_nav_call_mono) < min_interval
    ):
        r = dict(_last_nav_result)
        r["ms"] = 0.0
        return r

    if not _ensure_model():
        empty["error"] = _llava_load_error or "LLaVA model not available."
        return empty

    scene_hint = ""
    if scene_top and isinstance(scene_top[0], dict):
        lab = scene_top[0].get("label")
        if isinstance(lab, str) and lab.strip():
            scene_hint = f"\nRough scene caption: {lab.strip()[:200]}"

    det_text = _build_detection_context(detections, image_w, image_h)

    user_prompt = f"""You help a blind pedestrian move safely. Use the image and the sensor list.
Obstacles (estimated distance and side of view — use as hints only):
{det_text}{scene_hint}

Reply with ONE JSON object only, no markdown, no extra text:
{{"guidance_en":"<one short English sentence for text-to-speech: where the main hazard is and a safe conservative action>","guidance_dz":"<optional very short Latin-script Darija phrase or empty string>"}}

Rules:
- Be conservative: suggest stop, slow down, or step sideways; do not invent street names or traffic lights not in the image.
- Max ~35 words total in guidance_en."""

    conversation = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": user_prompt},
            ],
        },
    ]

    t0 = time.perf_counter()
    try:
        import torch

        assert _llava_processor is not None and _llava_model is not None

        rgb = pil_rgb.convert("RGB")
        prompt = _llava_processor.apply_chat_template(
            conversation,
            add_generation_prompt=True,
        )
        inputs = _llava_processor(
            images=rgb,
            text=prompt,
            return_tensors="pt",
        )

        device = next(_llava_model.parameters()).device
        dtype = next(_llava_model.parameters()).dtype
        inputs = inputs.to(device)
        if getattr(inputs, "pixel_values", None) is not None:
            inputs["pixel_values"] = inputs["pixel_values"].to(dtype=dtype)

        with torch.inference_mode():
            out_ids = _llava_model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
            )

        prompt_len = inputs["input_ids"].shape[1]
        new_tokens = out_ids[0][prompt_len:]
        raw_text = _llava_processor.decode(
            new_tokens, skip_special_tokens=True
        )

        blob = _parse_json_blob(raw_text)
        guidance_en = blob.get("guidance_en") or blob.get("guidance")
        guidance_dz = blob.get("guidance_dz")

        if isinstance(guidance_en, str):
            guidance_en = _clip(guidance_en, MAX_GUIDANCE_CHARS)
        else:
            guidance_en = _clip(raw_text.replace("\n", " "), MAX_GUIDANCE_CHARS)

        if isinstance(guidance_dz, str):
            guidance_dz = _clip(guidance_dz, MAX_GUIDANCE_CHARS)
        else:
            guidance_dz = None

        ms = (time.perf_counter() - t0) * 1000.0
        result = {
            "guidance_en": guidance_en if guidance_en else None,
            "guidance_dz": guidance_dz,
            "ms": round(ms, 2),
            "error": None,
        }
        if result.get("guidance_en"):
            _last_nav_call_mono = time.monotonic()
            _last_nav_result = dict(result)
        return result

    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000.0
        err = str(e)
        print(f"[LLaVA NAV] inference error: {err}")
        return {
            "guidance_en": None,
            "guidance_dz": None,
            "ms": round(ms, 2),
            "error": err[:500],
        }
