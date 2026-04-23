"""
Phase 3 — mobile inference API backend.
Integrated with PFE Phase 3 logic (BLIP-Large + Trig Depth).
Includes Gemini multimodal fallback.
"""

from __future__ import annotations
import os
import sys
import json
import math
import re
from pathlib import Path
from typing import Any
import torch
from PIL import Image

# Import our optimized PFE modules
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from pfe.phase3.depth_estimator import estimate_distance
from pfe.phase3.scene_analyzer import SceneAnalyzer
from pfe.phase3 import config

# --- Distance Calculation ---
def estimate_distance_m(
    x1_px: float,
    y1_px: float,
    x2_px: float,
    y2_px: float,
    image_w_px: int,
    image_h_px: int,
    class_name: str,
    horizontal_fov_deg: float,
) -> tuple[float, str]:
    """Uses the new PFE Trigonometric Model."""
    box_h = int(y2_px - y1_px)
    dist = estimate_distance(class_name, box_h, image_h_px)
    return dist, "pfe_trigonometric_pinhole"

# --- Scene Recognition (BLIP-Large) ---
_blip_analyzer: SceneAnalyzer | None = None

def scene_top5_cached(pil_rgb: Image.Image) -> list[dict[str, Any]] | None:
    """Uses BLIP-Large to provide a descriptive scene caption."""
    global _blip_analyzer
    if _blip_analyzer is None:
        print("[API] Initializing BLIP-Large for mobile server...")
        _blip_analyzer = SceneAnalyzer(interval=0)
        
    import cv2
    import numpy as np
    cv_img = cv2.cvtColor(np.array(pil_rgb), cv2.COLOR_RGB2BGR)
    
    try:
        rgb_frame = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb_frame)
        inputs = _blip_analyzer.processor(pil_img, return_tensors="pt").to(_blip_analyzer.device)
        out = _blip_analyzer.model.generate(
            **inputs, 
            max_new_tokens=50, 
            min_length=15, 
            num_beams=3
        )
        caption = _blip_analyzer.processor.decode(out[0], skip_special_tokens=True)
        return [{"label": caption, "probability": 1.0}]
    except Exception as e:
        print(f"[API Scene Error]: {e}")
        return None

# --- Gemini Support (Restored and Improved) ---
def _depth_risk_tier(m: Any) -> str:
    if m is None: return "unknown"
    try: d = float(m)
    except: return "unknown"
    if d < 1.0: return "danger"
    if d < 2.5: return "caution"
    return "ok"

def run_gemini(
    pil_rgb: Image.Image,
    detections: list[dict[str, Any]],
    scene_top: list[dict[str, Any]] | None,
    fov_deg: float,
) -> dict[str, Any]:
    if os.environ.get("ENABLE_GEMINI", "1").strip().lower() in ("0", "false", "no", "off"):
        return {"text": None, "darija": None, "error": "Gemini disabled."}
    
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key: return {"text": None, "darija": None, "error": "Missing GEMINI_API_KEY"}

    try:
        from google import genai
        client = genai.Client(api_key=key)
        
        # Build facts for Gemini
        scene_desc = scene_top[0]["label"] if scene_top else "unknown"
        prompt = f"Scene: {scene_desc}. Objects: "
        for d in detections[:5]:
            prompt += f"{d['name']} at {d['distance_m']}m. "
        
        prompt += "\nDescribe this to a blind person in Algerian Darija (Arabic script). Be brief. Safety first."
        
        response = client.models.generate_content(
            model=config.GEMINI_TTS_MODEL,
            contents=prompt
        )
        return {
            "text": response.text,
            "darija": response.text,
            "error": None
        }
    except Exception as e:
        return {"text": None, "darija": None, "error": str(e)}
