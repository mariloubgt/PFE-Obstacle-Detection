import json
import os
import glob

def clean_and_update_notebook(nb_path, ultimate_cell):
    with open(nb_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Hack to fix the git conflict in some files
    if '>>>>>>>' in content:
        lines = content.split('\n')
        lines = [l for l in lines if not l.startswith('>>>>>>>')]
        content = '\n'.join(lines)
        
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"Skipping {nb_path} due to parsing error: {e}")
        return

    # Delete cells that we added previously
    keep_cells = []
    for cell in data.get('cells', []):
        if cell.get('cell_type') != 'code':
            keep_cells.append(cell)
            continue
            
        src = "".join(cell.get('source', []))
        
        # Conditions to delete
        if 'CELL 6: Results Table' in src: continue
        if 'CELL 7: Per-Class Heatmap' in src: continue
        if 'CELL 8: Charts' in src: continue
        if 'CELL 9: Download Weights' in src: continue
        if 'import pandas as pd\nRESULTS_CSV' in src: continue
        if 'import pandas as pd\n\nRESULTS_CSV' in src: continue
        
        keep_cells.append(cell)
        
    # Append the ultimate benchmark cell
    keep_cells.append(ultimate_cell)
    
    data['cells'] = keep_cells
    
    with open(nb_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)
    
    print(f"Updated {nb_path}")

if __name__ == "__main__":
    ultimate_nb = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\VISIONAID_ULTIMATE_BENCHMARK.ipynb"
    with open(ultimate_nb, 'r', encoding='utf-8') as f:
        ult_data = json.load(f)
    
    # Extract the benchmarking cell
    benchmark_cell = None
    for cell in ult_data['cells']:
        src = "".join(cell.get('source', []))
        if '4. BENCHMARKING & SAHI' in src:
            benchmark_cell = cell
            break
            
    if not benchmark_cell:
        print("Could not find the benchmarking cell in ultimate notebook.")
        exit(1)
        
    # Find target notebooks
    target_pattern1 = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\benchmark_yolo*.ipynb"
    target_pattern2 = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\benchmark\yolo*.ipynb"
    
    targets = glob.glob(target_pattern1) + glob.glob(target_pattern2)
    
    for t in targets:
        clean_and_update_notebook(t, benchmark_cell)
