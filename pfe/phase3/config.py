"""
Configuration pour la Phase 3 - VisionAid
"""
import os
from pathlib import Path

# --- GEMINI (RÉACTIVÉ ET PRIORITAIRE) ---
ENABLE_GEMINI = False 
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# --- YOLO CONFIG ---
YOLO_WEIGHTS = str(Path(__file__).parents[2] / "models" / "best.pt")
YOLO_CONF    = 0.40
YOLO_IOU     = 0.45
IMG_SIZE     = 832 

# --- CAMERA CALIBRATION ---
FOCAL_CONSTANT = 1150 

# --- HAUTEURS ET LARGEURS RÉELLES (cm) ---
OBJECT_REAL_HEIGHTS = {
    "person": 175, "car": 150, "bus": 320, "truck": 350, "tree": 350,
    "pole": 300, "street_light": 600, "traffic_light": 250, "stop_sign": 200,
    "bench": 80, "dog": 50, "motorcycle": 110, "bicycle": 100, "stairs": 150,
    "curb": 15, "fire_hydrant": 60, "waste_container": 100, "bus_stop": 250,
    "spherical_roadblock": 50, "warning_column": 100, "crutch": 120, "train": 400
}

OBJECT_REAL_WIDTHS = {
    "person": 50, "car": 180, "bus": 250, "truck": 250, "motorcycle": 80,
    "bicycle": 60, "dog": 30
}

# --- ALERTE ---
DANGER_CLOSE_M = 1.8
WARNING_M      = 4.0
MAX_DISTANCE_M = 15.0

# --- GEMINI TTS ---
GEMINI_TTS_MODEL = "gemini-1.5-flash"
GEMINI_TIMEOUT_S = 6
