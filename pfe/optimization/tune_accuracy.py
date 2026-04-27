import os
import yaml
import numpy as np
from ultralytics import YOLO
from pfe.optimization.elk_herd_optimizer import ElkHerdOptimizer

# Configuration
DATA_PATH = "dataset/data.yaml"  # Updated to point to existing dataset config
MODEL_NAME = "yolov10n.pt"        # Base model to tune
EPOCHS = 10                       # Low epochs for fast evaluation
VAL_IMG_SIZE = 640

def fitness_function(params):
    """
    Evaluates YOLO performance with the given hyperparameters.
    params: [lr0, lrf, momentum, weight_decay, box, cls]
    Returns: 1 - mAP50-95 (to minimize)
    """
    lr0, lrf, momentum, wd, box, cls = params
    
    # Generate temporary hyperparameter file
    hyp = {
        'lr0': float(lr0),
        'lrf': float(lrf),
        'momentum': float(momentum),
        'weight_decay': float(wd),
        'box': float(box),
        'cls': float(cls),
        'warmup_epochs': 3.0,
        'plots': False
    }
    
    hyp_path = "temp_hyp.yaml"
    with open(hyp_path, 'w') as f:
        yaml.dump(hyp, f)
        
    print(f"\n[EHO] Testing Hyp: {hyp}")
    
    # Train for a few epochs to get a performance signal
    model = YOLO(MODEL_NAME)
    results = model.train(
        data=DATA_PATH,
        epochs=EPOCHS,
        imgsz=VAL_IMG_SIZE,
        cfg=hyp_path,
        device=0,  # Ensure GPU
        verbose=False,
        exist_ok=True,
        workers=0,  # Fix for "paging file too small" error on Windows
        project="eho_tuning",
        name="tune_run"
    )

    
    # Get mAP50-95 from validation
    # Ultralytics results.results_dict contains 'metrics/mAP50-95(B)'
    map_score = results.results_dict.get('metrics/mAP50-95(B)', 0.0)
    
    # Clean up
    if os.path.exists(hyp_path):
        os.remove(hyp_path)
        
    return 1.0 - map_score

def main():
    # Bounds for hyperparameters [min, max]
    bounds = [
        (1e-5, 1e-1),   # lr0
        (0.01, 1.0),    # lrf
        (0.6, 0.98),    # momentum
        (0.0, 0.001),   # weight_decay
        (0.02, 0.2),    # box loss gain
        (0.2, 4.0),     # cls loss gain
    ]
    
    optimizer = ElkHerdOptimizer(
        obj_func=fitness_function,
        bounds=bounds,
        pop_size=5,    # Keep small for demonstration
        max_iter=3
    )
    
    best_params, best_fitness = optimizer.optimize()
    
    print("\n" + "="*50)
    print("OPTIMIZATION COMPLETE")
    print(f"Best mAP: {1.0 - best_fitness:.4f}")
    print(f"Best Params: {best_params}")
    print("="*50)
    
    # Save best params
    with open("best_hyperparameters.yaml", "w") as f:
        yaml.dump(dict(zip(['lr0', 'lrf', 'momentum', 'weight_decay', 'box', 'cls'], best_params.tolist())), f)

if __name__ == "__main__":
    main()
