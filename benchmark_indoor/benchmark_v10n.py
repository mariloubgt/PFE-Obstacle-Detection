import os
import time
import pandas as pd
import numpy as np
import torch
from ultralytics import YOLO
from pathlib import Path

# Configuration
WEIGHTS_PATH = r"runs/detect/yolov10n_indoor/weights/best.pt"
DATA_YAML = "data_indoor_balanced.yaml"
RESULTS_CSV = r"c:\Users\maria\OneDrive\Desktop\PFE PROJECT\PFE-Obstacle-Detection\benchmark_indoor\benchmark_yolov10_indoor.csv"
IMG_SIZE = 640

def main():
    print(f"Benchmarking YOLOv10n Indoor: {WEIGHTS_PATH}")
    
    if not os.path.exists(WEIGHTS_PATH):
        print(f"Error: Weights not found at {WEIGHTS_PATH}")
        return

    # Load model
    try:
        model = YOLO(WEIGHTS_PATH)
    except Exception as e:
        print(f"Error loading model: {e}")
        return
    
    # Measure model size and params
    size_mb = os.path.getsize(WEIGHTS_PATH) / (1024 * 1024)
    params_m = sum(p.numel() for p in model.model.parameters()) / 1e6
    
    # 1. Accuracy metrics
    print("Gathering accuracy metrics...")
    metrics = model.val(
        data=DATA_YAML,
        split='test',
        imgsz=IMG_SIZE,
        plots=False,  # Low-disk mode
        save=False,   # Low-disk mode
        device=0 if torch.cuda.is_available() else 'cpu'
    )
    
    map50 = metrics.box.map50
    map50_95 = metrics.box.map
    precision = metrics.box.mp
    recall = metrics.box.mr
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    
    # 2. Speed metrics
    print("Gathering speed metrics...")
    test_img_dir = Path("dataset_indoor_yolo_new/test/images")
    test_images = list(test_img_dir.glob("*.jpg"))[:100]
    
    latencies = []
    # Warmup
    for img in test_images[:5]:
        model.predict(img, imgsz=IMG_SIZE, verbose=False)
        
    for img in test_images:
        t0 = time.perf_counter()
        model.predict(img, imgsz=IMG_SIZE, verbose=False)
        latencies.append((time.perf_counter() - t0) * 1000)
    
    avg_speed = np.mean(latencies)
    
    # 3. Update CSV
    new_data = {
        "model": "yolov10n",
        "mAP@0.5": round(float(map50), 4),
        "mAP@0.5:0.95": round(float(map50_95), 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "F1": round(float(f1), 4),
        "speed_ms/img": round(float(avg_speed), 2),
        "size_MB": round(size_mb, 2),
        "params_M": round(params_m, 2)
    }
    
    df_final = pd.DataFrame([new_data])
    df_final.to_csv(RESULTS_CSV, index=False)
    print(f"Successfully updated {RESULTS_CSV}")
    print(df_final)

if __name__ == "__main__":
    main()
