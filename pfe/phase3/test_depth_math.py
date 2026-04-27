import math
import sys
from pathlib import Path

# Fix path to allow importing pfe
sys.path.append(str(Path(__file__).parents[2]))
from pfe.phase3 import config
from pfe.phase3.depth_estimator import estimate_distance

def test_interactive():
    print("="*50)
    print("   OUtil DE TEST DE PRÉCISION DE DISTANCE (PFE)")
    print("="*50)
    print(f"Caméra configurée : iPhone 14 Pro (VFOV: {config.CAMERA_VFOV})")
    print(f"Classes disponibles : {list(config.OBJECT_REAL_HEIGHTS.keys())}")
    
    while True:
        try:
            print("\n" + "-"*30)
            cls = input("Entrez la classe (ex: car, bench) ou 'q' pour quitter : ").strip()
            if cls.lower() == 'q': break
            if cls not in config.OBJECT_REAL_HEIGHTS:
                print(f"❌ Erreur: La classe '{cls}' n'existe pas dans config.py")
                continue
            
            px_h = float(input("Entrez la hauteur de la boîte en PIXELS (ex: 200) : "))
            img_h = float(input("Entrez la hauteur totale de l'image (ex: 720 ou 1080) : "))
            
            dist = estimate_distance(cls, int(px_h), int(img_h))
            
            real = config.OBJECT_REAL_HEIGHTS[cls]
            print(f"\n✅ RÉSULTAT :")
            print(f"   Objet : {cls} (Taille réelle supposée : {real}cm)")
            print(f"   Occupation écran : {(px_h/img_h)*100:.1f}%")
            print(f"   👉 DISTANCE CALCULÉE : {dist} mètres")
            
        except ValueError:
            print("❌ Veuillez entrer des chiffres valides.")
        except KeyboardInterrupt:
            break

if __name__ == "__main__":
    test_interactive()
