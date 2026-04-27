from . import config

_history = {}

def estimate_distance(class_name, x1, y1, x2, y2, img_w, img_h):
    bbox_h = y2 - y1
    bbox_w = x2 - x1
    
    real_h = config.OBJECT_REAL_HEIGHTS.get(class_name)
    real_w = config.OBJECT_REAL_WIDTHS.get(class_name)

    if not real_h or bbox_h <= 0:
        return None

    # Focale calibrée
    focal = 0.85 * img_h 

    # 1. CALCULS BRUTS
    dist_h = (real_h * focal) / (bbox_h * 100.0)
    dist_w = (real_w * focal) / (bbox_w * 100.0) if (real_w and bbox_w > 0) else dist_h

    # 2. LOGIQUE DE SÉLECTION (Clipping)
    margin = img_h * 0.04
    is_height_clipped = (y1 < margin) or (y2 > (img_h - margin))
    
    dist_m = dist_w if is_height_clipped else dist_h

    # 3. LISSAGE
    if class_name not in _history:
        _history[class_name] = dist_m
    else:
        # On lisse, puis on arrondit TOUTE DE SUITE
        new_val = (_history[class_name] * 0.4) + (dist_m * 0.6)
        _history[class_name] = round(float(new_val), 3)

    return round(_history[class_name], 2)
