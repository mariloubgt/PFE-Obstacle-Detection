import os
import yaml
import numpy as np
import time
import torch
from ultralytics import YOLO

# --- ELK HERD OPTIMIZER CLASS (Self-Contained) ---
class ElkHerdOptimizer:
    """
    Elk Herd Optimizer (EHO) meta-heuristic algorithm.
    Based on simulated social behavior of elk herds.
    """
    def __init__(self, obj_func, bounds, pop_size=30, max_iter=50, bull_rate=0.2):
        self.obj_func = obj_func
        self.bounds = np.array(bounds)
        self.dim = len(bounds)
        self.pop_size = pop_size
        self.max_iter = max_iter
        self.bull_rate = bull_rate
        
        # Initialize population
        print(f"[EHO] Initializing population of {pop_size} individuals...")
        self.pop = np.random.uniform(self.bounds[:, 0], self.bounds[:, 1], (self.pop_size, self.dim))
        self.fitness = np.array([self.obj_func(x) for x in self.pop])
        
        self.best_idx = np.argmin(self.fitness)
        self.best_sol = self.pop[self.best_idx].copy()
        self.best_fit = self.fitness[self.best_idx]
        self.history = [self.best_fit]

    def _clamp(self, pop):
        for i in range(self.dim):
            pop[:, i] = np.clip(pop[:, i], self.bounds[i, 0], self.bounds[i, 1])
        return pop

    def optimize(self):
        print(f"Starting EHO Optimization (pop={self.pop_size}, iterations={self.max_iter})")
        
        for iteration in range(self.max_iter):
            t_start = time.time()
            
            # Sort population
            indices = np.argsort(self.fitness)
            self.pop = self.pop[indices]
            self.fitness = self.fitness[indices]
            
            num_bulls = max(1, int(self.pop_size * self.bull_rate))
            bulls = self.pop[:num_bulls]
            
            # 1. Rutting Season
            new_pop = self.pop.copy()
            for i in range(num_bulls, self.pop_size):
                bull = bulls[np.random.randint(0, num_bulls)]
                step = np.random.uniform(0, 1)
                new_pop[i] = self.pop[i] + step * (bull - self.pop[i])
            
            # 2. Calving Season
            calves = []
            for i in range(num_bulls):
                for _ in range(max(1, int(self.pop_size / num_bulls))):
                    sigma = 0.1 * (self.bounds[:, 1] - self.bounds[:, 0])
                    calf = bulls[i] + np.random.normal(0, sigma, self.dim)
                    calves.append(calf)
            
            calves = np.array(calves)
            calves = self._clamp(calves)
            calf_fitness = np.array([self.obj_func(x) for x in calves])
            
            # 3. Selection Season
            combined_pop = np.vstack((new_pop, calves))
            combined_fit = np.concatenate((self.fitness, calf_fitness))
            
            final_indices = np.argsort(combined_fit)[:self.pop_size]
            self.pop = combined_pop[final_indices]
            self.fitness = combined_fit[final_indices]
            
            if self.fitness[0] < self.best_fit:
                self.best_fit = self.fitness[0]
                self.best_sol = self.pop[0].copy()
                
            self.history.append(self.best_fit)
            duration = time.time() - t_start
            print(f"  Iter {iteration+1:02d} | Best Fit: {self.best_fit:.4f} | Time: {duration:.1f}s")
            
        return self.best_sol, self.best_fit

# --- YOLO TUNING LOGIC ---

# CONFIGURATION (Adjust paths as needed for Kaggle)
DATA_PATH = "/kaggle/input/your-dataset/data.yaml"  # UPDATE THIS PATH
MODEL_NAME = "yolov10n.pt"
EPOCHS = 10
BATCH_SIZE = 8   # Explicitly set to avoid OOM
IMG_SIZE = 640   # Kaggle GPUs (P100/T4) should handle 640, use 320 if it crashes

def fitness_function(params):
    """
    Evaluates YOLO performance. params: [lr0, lrf, momentum, weight_decay, box, cls]
    """
    lr0, lrf, momentum, wd, box, cls = params
    
    hyp = {
        'lr0': float(lr0), 'lrf': float(lrf), 'momentum': float(momentum),
        'weight_decay': float(wd), 'box': float(box), 'cls': float(cls),
        'warmup_epochs': 3.0, 'plots': False
    }
    
    hyp_path = "temp_hyp.yaml"
    with open(hyp_path, 'w') as f:
        yaml.dump(hyp, f)
        
    print(f"\n[EHO] Testing Hyp: {hyp}")
    
    # Force clean GPU cache before training
    torch.cuda.empty_cache()
    
    model = YOLO(MODEL_NAME)
    results = model.train(
        data=DATA_PATH,
        epochs=EPOCHS,
        imgsz=IMG_SIZE,
        batch=BATCH_SIZE,
        cfg=hyp_path,
        device=0,
        verbose=False,
        exist_ok=True,
        project="eho_kaggle_tuning",
        name="tune_run"
    )
    
    map_score = results.results_dict.get('metrics/mAP50-95(B)', 0.0)
    print(f"[EHO] Evaluation Result: mAP={map_score:.4f}")
    
    # Cleanup memory
    del model
    torch.cuda.empty_cache()
    
    return 1.0 - map_score

def run_optimization():
    # Bounds for: [lr0, lrf, momentum, weight_decay, box, cls]
    bounds = [
        (1e-5, 1e-1), (0.01, 1.0), (0.6, 0.98),
        (0.0, 0.001), (0.02, 0.2), (0.2, 4.0),
    ]
    
    optimizer = ElkHerdOptimizer(
        obj_func=fitness_function,
        bounds=bounds,
        pop_size=5,     # Adjust based on how much time you have
        max_iter=3
    )
    
    best_params, best_fitness = optimizer.optimize()
    
    print("\n" + "="*50)
    print("OPTIMIZATION COMPLETE")
    print(f"Best mAP: {1.0 - best_fitness:.4f}")
    print(f"Best Params: {dict(zip(['lr0', 'lrf', 'momentum', 'weight_decay', 'box', 'cls'], best_params.tolist()))}")
    print("="*50)

if __name__ == "__main__":
    # Ensure dependencies are installed (uncomment if needed in Kaggle)
    # !pip install ultralytics
    run_optimization()
