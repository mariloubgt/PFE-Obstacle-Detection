"""
Configuration pour la Phase 3 - VisionAid
"""
import math
import os
from pathlib import Path

# --- GEMINI (RÉACTIVÉ ET PRIORITAIRE) ---
ENABLE_GEMINI = os.getenv("ENABLE_GEMINI", "1").strip().lower() in ("1", "true", "yes", "on")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# --- YOLO CONFIG ---
YOLO_WEIGHTS = str(Path(__file__).parents[2] / "models" / "best.pt")
YOLO_CONF    = 0.40
YOLO_IOU     = 0.45
IMG_SIZE     = 832 

# --- CAMERA CALIBRATION ---
FOCAL_CONSTANT = 1150  # legacy constant (depth now uses FOV below)

# Horizontal FOV (degrees) — main rear camera, full frame. Tune per device or set
# CAMERA_HORIZONTAL_FOV_DEG in the environment (inference_server already reads it).
CAMERA_HORIZONTAL_FOV_DEG = float(os.getenv("CAMERA_HORIZONTAL_FOV_DEG", "56.0"))

# Portrait width/height when only img_h is known (legacy tests). ~iPhone 14 portrait.
DEFAULT_IMAGE_WH_RATIO = float(os.getenv("DEFAULT_IMAGE_WH_RATIO", "0.462"))

_h_test = 1080
_w_test = max(int(round(_h_test * DEFAULT_IMAGE_WH_RATIO)), 1)
_hfov_r = math.radians(CAMERA_HORIZONTAL_FOV_DEG)
CAMERA_VFOV = math.degrees(
    2.0 * math.atan(math.tan(_hfov_r / 2.0) * (_h_test / float(_w_test)))
)

# --- HAUTEURS ET LARGEURS RÉELLES (cm) ---
# Custom classes + typical COCO sizes (underscore keys; depth_estimator normalizes names).
_OBJECT_REAL_HEIGHTS_BASE = {
    "person": 175, "car": 150, "bus": 320, "truck": 350, "tree": 350,
    "pole": 300, "street_light": 600, "traffic_light": 250, "stop_sign": 200,
    "bench": 80, "dog": 50, "motorcycle": 110, "bicycle": 100, "stairs": 150,
    "curb": 15, "fire_hydrant": 60, "waste_container": 100, "bus_stop": 250,
    "spherical_roadblock": 50, "warning_column": 100, "crutch": 120, "train": 400,
}

_COCO_EXTRA_HEIGHTS_CM = {
    "airplane": 240, "bird": 25, "cat": 30, "horse": 160, "sheep": 90, "cow": 150,
    "elephant": 280, "bear": 140, "zebra": 150, "giraffe": 320,
    "backpack": 45, "umbrella": 100, "handbag": 35, "tie": 80, "suitcase": 55,
    "frisbee": 3, "skis": 120, "snowboard": 140, "sports_ball": 22, "kite": 80,
    "baseball_bat": 85, "baseball_glove": 25, "skateboard": 15, "surfboard": 170,
    "tennis_racket": 70, "bottle": 25, "wine_glass": 20, "cup": 10, "fork": 20,
    "knife": 20, "spoon": 18, "bowl": 8, "banana": 20, "apple": 8, "sandwich": 8,
    "orange": 8, "broccoli": 15, "carrot": 20, "hot_dog": 12, "pizza": 4, "donut": 4,
    "cake": 15, "chair": 95, "couch": 85, "potted_plant": 80, "bed": 100,
    "dining_table": 75, "toilet": 80, "tv": 55, "laptop": 25, "mouse": 5,
    "remote": 5, "keyboard": 3, "cell_phone": 14, "microwave": 30, "oven": 60,
    "toaster": 20, "sink": 25, "refrigerator": 170, "book": 25, "clock": 25,
    "vase": 25, "scissors": 15, "teddy_bear": 30, "hair_drier": 22, "toothbrush": 18,
    "boat": 180, "parking_meter": 120,
}

OBJECT_REAL_HEIGHTS = {**_COCO_EXTRA_HEIGHTS_CM, **_OBJECT_REAL_HEIGHTS_BASE}

OBJECT_REAL_WIDTHS = {
    "person": 50, "car": 180, "bus": 250, "truck": 250, "motorcycle": 80,
    "bicycle": 60, "dog": 30, "bench": 120, "chair": 55, "tree": 80,
    "traffic_light": 40, "stop_sign": 75, "fire_hydrant": 40, "potted_plant": 40,
}

# --- ALERTE ---
DANGER_CLOSE_M = 1.8
WARNING_M      = 4.0
MAX_DISTANCE_M = 15.0

# --- GEMINI TTS ---
GEMINI_TTS_MODEL = "gemini-1.5-flash"
GEMINI_TIMEOUT_S = 6
