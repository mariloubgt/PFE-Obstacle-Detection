import numpy as np
import time

class ElkHerdOptimizer:
    """
    Elk Herd Optimizer (EHO) meta-heuristic algorithm.
    Simulates the social and reproductive behavior of elk herds.
    Based on the paper: Al-Betar et al. (2024).
    """

    def __init__(self, obj_func, bounds, pop_size=30, max_iter=50, bull_rate=0.2):
        """
        Args:
            obj_func: The objective function to minimize (fitness).
            bounds: List of tuples (min, max) for each dimension.
            pop_size: Number of elk (candidate solutions).
            max_iter: Maximum number of generations.
            bull_rate: Proportion of top-ranked elk considered 'bulls'.
        """
        self.obj_func = obj_func
        self.bounds = np.array(bounds)
        self.dim = len(bounds)
        self.pop_size = pop_size
        self.max_iter = max_iter
        self.bull_rate = bull_rate
        
        # Initialize population
        self.pop = np.random.uniform(self.bounds[:, 0], self.bounds[:, 1], (self.pop_size, self.dim))
        self.fitness = np.array([self.obj_func(x) for x in self.pop])
        
        # Track history
        self.best_idx = np.argmin(self.fitness)
        self.best_sol = self.pop[self.best_idx].copy()
        self.best_fit = self.fitness[self.best_idx]
        self.history = [self.best_fit]

    def _clamp(self, pop):
        """Ensure population stays within bounds."""
        for i in range(self.dim):
            pop[:, i] = np.clip(pop[:, i], self.bounds[i, 0], self.bounds[i, 1])
        return pop

    def optimize(self):
        """Execute the EHO algorithm."""
        print(f"Starting EHO Optimization (pop={self.pop_size}, iterations={self.max_iter})")
        
        for iteration in range(self.max_iter):
            t_start = time.time()
            
            # Sort population by fitness
            indices = np.argsort(self.fitness)
            self.pop = self.pop[indices]
            self.fitness = self.fitness[indices]
            
            num_bulls = max(1, int(self.pop_size * self.bull_rate))
            bulls = self.pop[:num_bulls]
            
            # 1. Rutting Season (Movement towards dominant bulls)
            new_pop = self.pop.copy()
            for i in range(num_bulls, self.pop_size):
                # Select a random bull for this harem member
                bull = bulls[np.random.randint(0, num_bulls)]
                # Move towards bull with step size
                step = np.random.uniform(0, 1)
                new_pop[i] = self.pop[i] + step * (bull - self.pop[i])
            
            # 2. Calving Season (Reproduction / New Solutions)
            calves = []
            for i in range(num_bulls):
                # Bulls produce calves around their position
                for _ in range(int(self.pop_size / num_bulls)):
                    sigma = 0.1 * (self.bounds[:, 1] - self.bounds[:, 0])
                    calf = bulls[i] + np.random.normal(0, sigma, self.dim)
                    calves.append(calf)
            
            calves = np.array(calves)
            calves = self._clamp(calves)
            
            # Evaluate calves
            calf_fitness = np.array([self.obj_func(x) for x in calves])
            
            # 3. Selection Season (Survival of the fittest)
            combined_pop = np.vstack((new_pop, calves))
            combined_fit = np.concatenate((self.fitness, calf_fitness))
            
            final_indices = np.argsort(combined_fit)[:self.pop_size]
            self.pop = combined_pop[final_indices]
            self.fitness = combined_fit[final_indices]
            
            # Update best
            if self.fitness[0] < self.best_fit:
                self.best_fit = self.fitness[0]
                self.best_sol = self.pop[0].copy()
                
            self.history.append(self.best_fit)
            duration = time.time() - t_start
            print(f"  Iter {iteration+1:02d} | Best Fit: {self.best_fit:.4f} | Time: {duration:.1f}s")
            
        return self.best_sol, self.best_fit

if __name__ == "__main__":
    # Smoke test with Sphere function
    def sphere(x): return np.sum(x**2)
    bnds = [(-10, 10)] * 5
    optimizer = ElkHerdOptimizer(sphere, bnds, pop_size=20, max_iter=30)
    best_x, best_f = optimizer.optimize()
    print(f"\nOptimization Finished:\nBest Solution: {best_x}\nBest Fitness: {best_f}")
