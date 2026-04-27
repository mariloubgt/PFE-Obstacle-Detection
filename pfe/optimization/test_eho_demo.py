import os
import yaml
import numpy as np
from ultralytics import YOLO
from pfe.optimization.elk_herd_optimizer import ElkHerdOptimizer

# Configuration
DATA_PATH = "dataset/data.yaml"
MODEL_NAME = "yolov10n.pt"
EPOCHS = 10                       # User requested 10 epochs
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
    
    hyp_path = "temp_hyp_demo.yaml"
    with open(hyp_path, 'w') as f:
        yaml.dump(hyp, f)
        
    print(f"\n[EHO-DEMO] Testing Hyp: {hyp}")
    
    # Train for a few epochs to get a performance signal
    model = YOLO(MODEL_NAME)
    results = model.train(
        data=DATA_PATH,
        epochs=EPOCHS,
        imgsz=VAL_IMG_SIZE,
        cfg=hyp_path,
        device=0,
        verbose=False,
        exist_ok=True,
        workers=0,  # Fix for Windows
        project="eho_demo",
        name="demo_run"
    )
    
    # Get mAP50-95 from validation
    map_score = results.results_dict.get('metrics/mAP50-95(B)', 0.0)
    print(f"[EHO-DEMO] Resulting mAP: {map_score:.4f}")
    
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
    
    print("="*50)
    print("STARTING EHO DEMO (10 EPOCHS, 4 RUNS)")
    print("="*50)
    
    optimizer = ElkHerdOptimizer(
        obj_func=fitness_function,
        bounds=bounds,
        pop_size=2,    # Minimal population
        max_iter=1     # Minimal iterations
    )
    
    best_params, best_fitness = optimizer.optimize()
    
    print("\n" + "="*50)
    print("DEMO COMPLETE")
    print(f"Best mAP achieved: {1.0 - best_fitness:.4f}")
    print(f"Best Hyperparameters: {best_params}")
    print("="*50)
    
    # Save best params for user
    with open("demo_best_hyperparameters.yaml", "w") as f:
        param_names = ['lr0', 'lrf', 'momentum', 'weight_decay', 'box', 'cls']
        yaml.dump(dict(zip(param_names, best_params.tolist())), f)

if __name__ == "__main__":
    main()
