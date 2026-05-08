"""
Voice navigation: summarize danger/caution YOLO detections + one English instruction via Gemini.

Uses same distance bands as Phase 3 (DANGER_CLOSE_M / WARNING_M from config).
"""

from __future__ import annotations

import concurrent.futures
import io
import json
import os
import re
import time
from typing import Any

from PIL import Image

from pfe.phase3 import config


def _lateral_band(cx_norm: float) -> str:
    if cx_norm < 1.0 / 3.0:
        return "left"
    if cx_norm < 2.0 / 3.0:
        return "center"
    return "right"


def _proximity_band(d_m: float) -> str:
    if d_m < 2.0:
        return "near"
    if d_m < 4.0:
        return "medium"
    return "far"


def _risk_level(d_m: float, danger_m: float, caution_max_m: float) -> str | None:
    if d_m <= danger_m:
        return "danger"
    if d_m <= caution_max_m:
        return "caution"
    return None


def filter_and_summarize_detections(
    detections: list[dict[str, Any]],
    danger_m: float,
    caution_max_m: float,
) -> tuple[list[dict[str, Any]], str]:
    """
    Keep only danger + caution obstacles; return structured rows + single text block for Gemini.
    """
    rows: list[dict[str, Any]] = []
    lines: list[str] = []

    for d in sorted(
        detections,
        key=lambda x: (
            float(x["distance_m"])
            if x.get("distance_m") is not None
            else 999.0
        ),
    ):
        dist_m = d.get("distance_m")
        if dist_m is None:
            continue
        try:
            dm = float(dist_m)
        except (TypeError, ValueError):
            continue
        level = _risk_level(dm, danger_m, caution_max_m)
        if level is None:
            continue
        cx = ((float(d.get("x1", 0)) + float(d.get("x2", 1))) / 2.0) if d else 0.5
        lateral = _lateral_band(cx)
        band = _proximity_band(dm)
        label = str(d.get("name", "object")).replace("_", " ")
        row = {
            "name": label,
            "risk": level,
            "zone": lateral,
            "proximity": band,
            "distance_m": round(dm, 2),
        }
        rows.append(row)
        lines.append(f"- {label}: {level} — {band} (~{dm:.1f} m), in {lateral} of view.")

    blob = (
        "(No obstacle in danger or caution range — path should be comparatively open.)\n"
        if not lines
        else "\n".join(lines)
    )
    return rows, blob


def _parse_instruction_json(raw: str) -> str | None:
    t = raw.strip()
    if t.startswith("```"):
        t = t.split("```")[1]
        if t.lower().startswith("json"):
            t = t[4:]
        t = t.strip()
    m = re.search(r"\{[\s\S]*\}", t)
    if m:
        t = m.group(0)
    try:
        obj = json.loads(t)
        en = obj.get("instruction_en")
        if isinstance(en, str) and en.strip():
            return en.strip()
    except json.JSONDecodeError:
        pass
    return None


def _fallback_instruction(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "Path looks clear ahead. Proceed slowly."
    d0 = rows[0]
    z = d0["zone"]
    rsk = d0["risk"]
    nm = d0["name"]
    if rsk == "danger":
        if z == "left":
            return f"Stop. {nm.title()} close on your left. Move right carefully."
        if z == "right":
            return f"Stop. {nm.title()} close on your right. Move left carefully."
        return f"Stop. {nm.title()} ahead, very close. Slow down."
    if z == "left":
        return f"Proceed slowly. Watch {nm.title()} on the left."
    if z == "right":
        return f"Proceed slowly. Watch {nm.title()} on the right."
    return f"Proceed slowly. {nm.title()} detected ahead."


def run_navigation_instruction(
    pil_rgb: Image.Image,
    detections: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Gemini vision + obstacle summary → one imperative English sentence for TTS.
    Falls back to rules if Gemini is off / errors.
    """
    t0 = time.perf_counter()
    danger_m = float(
        os.environ.get("NAV_DANGER_M", str(float(config.DANGER_CLOSE_M))),
    )
    caution_max_m = float(
        os.environ.get("NAV_CAUTION_MAX_M", str(float(config.WARNING_M))),
    )

    rows, summary_blob = filter_and_summarize_detections(
        detections, danger_m, caution_max_m
    )

    if not rows:
        ms = (time.perf_counter() - t0) * 1000.0
        fb = _fallback_instruction(rows)
        return {
            "instruction_en": fb,
            "obstacles_used": [],
            "summary_lines": "",
            "source": "default",
            "ms": round(ms, 2),
            "error": None,
        }

    gemini_ok = (
        os.environ.get("ENABLE_GEMINI", "1").strip().lower()
        in ("1", "true", "yes", "on")
        and getattr(config, "ENABLE_GEMINI", True)
    )
    from api.vision_pipeline import _get_gemini_client  # singleton

    client = _get_gemini_client() if gemini_ok else None

    prompt = f"""You help a blind pedestrian walk safely using the LIVE camera photo and this obstacle list
(only dangers and cautions, with horizontal zone left/center/right and proximity near/medium/far):

{summary_blob}

Respond with ONE JSON object only, no markdown:
{{"instruction_en":"<single short imperative sentence in plain English for text-to-speech, max 22 words>"
}}

Examples of tone (do not quote literally): Stop before the obstacle; Step slightly left to pass; Slow down — something blocking the center.
Be conservative."""

    fb = _fallback_instruction(rows)

    if client is None:
        ms = (time.perf_counter() - t0) * 1000.0
        return {
            "instruction_en": fb,
            "obstacles_used": rows,
            "summary_lines": summary_blob,
            "source": "fallback_no_gemini",
            "ms": round(ms, 2),
            "error": None,
        }

    try:
        from google.genai import types

        buf = io.BytesIO()
        q = int(os.environ.get("GEMINI_IMAGE_JPEG_QUALITY", "72"))
        q = max(40, min(q, 95))
        pil_rgb.convert("RGB").save(buf, format="JPEG", quality=q)
        image_part = types.Part.from_bytes(
            data=buf.getvalue(),
            mime_type="image/jpeg",
        )
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

        tout = float(
            getattr(config, "GEMINI_TIMEOUT_S", 8)
            + float(os.environ.get("NAV_GEMINI_EXTRA_TIMEOUT_S", "2")),
        )
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(_call)
            response = future.result(timeout=tout)

        raw_text = (response.text or "").strip()
        inst = _parse_instruction_json(raw_text) or fb
        ms = (time.perf_counter() - t0) * 1000.0
        return {
            "instruction_en": inst,
            "obstacles_used": rows,
            "summary_lines": summary_blob,
            "source": "gemini",
            "ms": round(ms, 2),
            "error": None,
        }
    except concurrent.futures.TimeoutError:
        ms = (time.perf_counter() - t0) * 1000.0
        return {
            "instruction_en": fb,
            "obstacles_used": rows,
            "summary_lines": summary_blob,
            "source": "fallback_timeout",
            "ms": round(ms, 2),
            "error": "Gemini navigation timeout.",
        }
    except Exception as e:
        ms = (time.perf_counter() - t0) * 1000.0
        return {
            "instruction_en": fb,
            "obstacles_used": rows,
            "summary_lines": summary_blob,
            "source": "fallback_error",
            "ms": round(ms, 2),
            "error": str(e)[:400],
        }
