import json
import os
from pathlib import Path

def restore_v8():
    v10_p = Path("benchmark/yolov10.ipynb")
    v8_p = Path("benchmark/yolov8.ipynb")
    
    with open(v10_p, 'r', encoding='utf-8') as f:
        nb = json.load(f)
        
    for cell in nb['cells']:
        src = "".join(cell['source'])
        # Replace occurrences
        new_src = src.replace("yolov10", "yolov8").replace("YOLOV10", "YOLOV8")
        # Handle capitalization in some output/labels
        new_src = new_src.replace("v10", "v8")
        cell['source'] = [new_src]
        
    with open(v8_p, 'w', encoding='utf-8') as f:
        json.dump(nb, f, indent=1)
    
    # Also overwrite the one in benchmark_indoor
    v8_p_in = Path("benchmark_indoor/YOLOv8.ipynb")
    with open(v8_p_in, 'w', encoding='utf-8') as f:
        json.dump(nb, f, indent=1)

if __name__ == "__main__":
    restore_v8()
