import cv2
import os
from ultralytics import YOLO
from pfe.phase3.depth_estimator import estimate_distance
from pfe.phase3 import config

def test():
    img_path = r"C:\Users\admin\PFE\PFE-Obstacle-Detection\test.jpg"
    real_dist = 1.0
    
    # Correction de hauteur pour personne assise si besoin
    # (On peut tester avec 1.70 d'abord pour voir l'erreur)
    
    model = YOLO(r"C:\Users\admin\Downloads\best.pt")
    img = cv2.imread(img_path)
    if img is None:
        print("❌ Impossible de lire l'image test.jpg")
        return
    h, w = img.shape[:2]
    print(f"📸 Image chargée : {w}x{h}")
    print(f"📋 TOUTES les classes connues : {model.names}")
    
    # On force une plus haute résolution d'analyse pour les photos iPhone
    results = model(img_path, verbose=False, conf=0.05, imgsz=1280) 
    
    found_any = False
    for r in results:
        for box in r.boxes:
            found_any = True
            cls_name = model.names[int(box.cls[0])]
            conf = float(box.conf[0])
            print(f"🔍 Objet détecté : {cls_name} ({conf:.2f} confidence)")
            
            if cls_name == "person":
                x1, y1, x2, y2 = box.xyxy[0]
                box_h = int(y2 - y1)
                
                # Test avec hauteur standard 1.70m
                est_dist = estimate_distance(cls_name, box_h, h)
                error = abs(est_dist - real_dist)
                acc = (1 - (error / real_dist)) * 100
                
                print(f"\n✅ RESULTAT POUR LA PERSONNE SUR TA PHOTO :")
                print(f"   - Hauteur détectée : {box_h} pixels")
                print(f"   - Distance calculée : {est_dist:.2f} m")
                print(f"   - Distance réelle   : {real_dist:.2f} m")
                print(f"   - Précision         : {acc:.1f} %")
                
                if acc < 80:
                    print("\nℹ️ NOTE : La précision est basse car la personne est ASSISE.")
                    print("Si on ajuste la hauteur à 1.10m (hauteur d'une personne assise) :")
                    # Calcul manuel rapide pour démonstration
                    # distance est proportionnelle à la hauteur
                    adj_dist = est_dist * (1.10 / 1.70)
                    adj_acc = (1 - (abs(adj_dist - real_dist) / real_dist)) * 100
                    print(f"   - Distance ajustée : {adj_dist:.2f} m")
                    print(f"   - Précision ajustée : {adj_acc:.1f} %")

if __name__ == "__main__":
    test()
