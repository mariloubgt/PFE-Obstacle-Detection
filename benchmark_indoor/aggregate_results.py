import csv
import os
from pathlib import Path

runs_dir = Path("../runs/detect")
results_csv_out = "benchmark_yolov11_indoor.csv"

models_info = [
    ("yolo11n_indoor", "yolo11n"),
    ("yolo11s_indoor", "yolo11s"),
    ("yolo11m_indoor", "yolo11m"),
]

weights_dir = Path(".")
rows = []

for run_name, model_label in models_info:
    results_path = runs_dir / run_name / "results.csv"
    if not results_path.exists():
        print(f"Skipping {run_name}: results.csv not found")
        continue
    
    with open(results_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        # Find row with max metrics/mAP50(B)
        best_row = None
        max_map50 = -1.0
        
        for row in reader:
            # strip keys because sometimes they have whitespace
            row = {k.strip(): v.strip() for k, v in row.items()}
            map50 = float(row.get('metrics/mAP50(B)', 0))
            if map50 > max_map50:
                max_map50 = map50
                best_row = row
        
        if best_row:
            p = float(best_row.get('metrics/precision(B)', 0))
            r = float(best_row.get('metrics/recall(B)', 0))
            map50 = float(best_row.get('metrics/mAP50(B)', 0))
            map50_95 = float(best_row.get('metrics/mAP50-95(B)', 0))
            f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0
            
            # Size
            pt_path = weights_dir / f"{model_label}.pt"
            size_mb = pt_path.stat().st_size / (1024 * 1024) if pt_path.exists() else 0
            
            # params
            params = {"yolo11n": 2.6, "yolo11s": 9.4, "yolo11m": 20.1}.get(model_label, 0)
            
            rows.append({
                "model": model_label,
                "mAP@0.5": round(map50, 4),
                "mAP@0.5:0.95": round(map50_95, 4),
                "precision": round(p, 4),
                "recall": round(r, 4),
                "F1": round(f1, 4),
                "speed_ms/img": 0.0, 
                "size_MB": round(size_mb, 1),
                "params_M": params
            })

if rows:
    keys = rows[0].keys()
    with open(results_csv_out, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Updated {results_csv_out} with {len(rows)} models.")
else:
    print("No rows found to update.")
