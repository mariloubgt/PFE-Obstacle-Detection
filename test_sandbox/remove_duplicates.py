import json
import glob

def remove_duplicate_cells(nb_path):
    with open(nb_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    new_cells = []
    seen_ultimate = False
    
    for cell in data.get('cells', []):
        src = "".join(cell.get('source', []))
        
        # Check if this is the ultimate benchmark cell
        if '4. BENCHMARKING & SAHI' in src and 'from sahi import AutoDetectionModel' in src:
            if not seen_ultimate:
                seen_ultimate = True
                new_cells.append(cell)
            else:
                # Duplicate! Skip it.
                pass
        else:
            new_cells.append(cell)
            
    data['cells'] = new_cells
    
    with open(nb_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)
    
    print(f"Cleaned duplicates in {nb_path}")

target_pattern1 = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\benchmark_yolo*.ipynb"
target_pattern2 = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\benchmark\yolo*.ipynb"
targets = glob.glob(target_pattern1) + glob.glob(target_pattern2)

for t in targets:
    remove_duplicate_cells(t)
