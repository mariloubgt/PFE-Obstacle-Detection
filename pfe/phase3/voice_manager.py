import time

class VoiceManager:
    def __init__(self):
        # On garde en mémoire le temps ET la distance de la dernière annonce
        self.last_announced_time = {}  # { class_name: timestamp }
        self.last_announced_dist = {}  # { class_name: distance }
        
        self.PRIORITY_MAP = {
            "person": 100, "dog": 100, "car": 90, "bus": 90, "truck": 90,
            "stairs": 80, "curb": 75, "warning_column": 70, "stop_sign": 60,
            "bench": 50, "tree": 20, "pole": 20
        }
        
        # TIMERS PLUS LONGS POUR LE CALME
        self.COOLDOWN_NORMAL = 12.0  # Annonce toutes les 12s si statique
        self.COOLDOWN_DANGER = 5.0   # Annonce toutes les 5s si danger (<1.8m)

    def get_priority_announcement(self, detections):
        if not detections:
            return None

        now = time.time()
        candidates = []

        for det in detections:
            name = det['name']
            dist = det['distance_m']
            if dist is None: continue

            # --- RÈGLE DE SILENCE INTELLIGENTE ---
            last_t = self.last_announced_time.get(name, 0)
            last_d = self.last_announced_dist.get(name, 99.0)
            
            required_gap = self.COOLDOWN_DANGER if dist < 1.8 else self.COOLDOWN_NORMAL
            
            # 1. Vérifie si le cooldown est passé
            time_passed = (now - last_t) > required_gap
            
            # 2. Vérifie si l'objet a bougé de façon significative (> 40cm)
            dist_changed = abs(last_d - dist) > 0.40
            
            # On ne parle que si le temps est passé ET que ça a bougé 
            # OU si c'est un nouvel objet très proche (< 1.5m)
            is_new_threat = (last_t == 0 and dist < 1.5)
            
            if not (is_new_threat or (time_passed and dist_changed)):
                continue

            priority_score = self.PRIORITY_MAP.get(name, 0) + (10 / max(0.5, dist))
            candidates.append({"name": name, "dist": dist, "score": priority_score})

        if not candidates:
            return None

        best = sorted(candidates, key=lambda x: x['score'], reverse=True)[0]
        
        # Mémorisation
        self.last_announced_time[best['name']] = now
        self.last_announced_dist[best['name']] = best['dist']
        
        # Français plus naturel
        name_clean = best['name'].replace("person", "une personne").replace("car", "une voiture")
        
        return f"{name_clean} à {round(best['dist'], 1)} mètres"
