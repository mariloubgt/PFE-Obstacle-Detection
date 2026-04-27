import math

def calculate_debug_fov(real_distance_m, estimated_distance_m, current_fov_deg):
    """
    Si on attendait 2.0m mais qu'on a eu 1.32m, cela permet de calculer
    le FOV correct.
    D est proportionnel à 1/tan(FOV/2).
    """
    ratio = estimated_distance_m / real_distance_m
    # On cherche le nouveau FOV tel que tan(new/2) = tan(old/2) * ratio
    old_fov_rad = math.radians(current_fov_deg)
    new_tan = math.tan(old_fov_rad / 2.0) * ratio
    new_fov_deg = math.degrees(math.atan(new_tan)) * 2.0
    return new_fov_deg

# Cas de l'utilisateur :
dist_reelle = 2.0
dist_app = 1.32
fov_actuel = 71.0 # Celui que j'ai mis dans config.py

print("--- DEBUG DEPTH VISIONAID ---")
print(f"Distance Réelle : {dist_reelle}m")
print(f"Distance App : {dist_app}m")
print(f"FOV Configuré : {fov_actuel}°")

correct_fov = calculate_debug_fov(dist_reelle, dist_app, fov_actuel)

print("-" * 30)
print(f"🎯 POUR AVOIR 2.0m, TU DOIS RÉGLER LE FOV SUR : {correct_fov:.2f}°")
print("-" * 30)
print("\nInstructions :")
print(f"1. Ouvre pfe/phase3/config.py")
print(f"2. Change CAMERA_VFOV pour {correct_fov:.2f}")
print(f"3. Relance le serveur et teste !")
