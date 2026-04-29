import json
import os

ultimate_nb_path = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\VISIONAID_ULTIMATE_BENCHMARK.ipynb"
target_dir = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle"

with open(ultimate_nb_path, 'r', encoding='utf-8') as f:
    ult_data = json.load(f)

modelsToGenerate = [8, 10, 11, 12, 26]

for v in modelsToGenerate:
    # Deep copy the ultimate data
    new_data = json.loads(json.dumps(ult_data))
    
    # 1. Update Markdown Title
    md_source = "".join(new_data['cells'][0]['source'])
    md_source = md_source.replace(
        "# 🏆 VisionAid Ultimate Benchmark - 22 Classes Original Order", 
        f"# 🏆 VisionAid Ultimate Benchmark - YOLOv{v} (22 Classes Original Order)"
    )
    new_data['cells'][0]['source'] = [md_source]
    
    # 2. Update Training Cell (Cell 3, index 2 or 3 depending on markdown)
    # Let's search for the training cell dynamically
    for cell in new_data['cells']:
        src = "".join(cell.get('source', []))
        
        if "3. TRAINING MASTER" in src:
            src = src.replace("YOLO('yolov8s.pt')", f"YOLO('yolov{v}s.pt')")
            src = src.replace("name='VisionAid_ULTIMATE'", f"name='VisionAid_ULTIMATE_yolov{v}'")
            cell['source'] = [src]
            
        if "4. BENCHMARKING & SAHI" in src:
            src = src.replace("runs/detect/VisionAid_ULTIMATE/weights/best.pt", 
                              f"runs/detect/VisionAid_ULTIMATE_yolov{v}/weights/best.pt")
            cell['source'] = [src]

    target_file = os.path.join(target_dir, f"benchmark_yolov{v}.ipynb")
    
    with open(target_file, 'w', encoding='utf-8') as f:
        json.dump(new_data, f, indent=1)
        
    print(f"Generated Ultimate Benchmark for YOLOv{v} at {target_file}")
    
