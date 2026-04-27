import cv2
import os
from ultralytics import YOLO
from .depth_estimator import estimate_distance
from . import config

def run_real_test():
    print("\n" + "="*60)
    print("      🧪 TEST DE VALIDATION EN CONDITIONS RÉELLES")
    print("="*60)
    
    # 1. Inputs
    img_path = input("\n📁 Entrez le chemin de votre image (ex: photo1.jpg) : ").strip('"')
    if not os.path.exists(img_path):
        print("❌ Fichier introuvable !")
        return
    
    real_dist = float(input("📏 Quelle est la distance réelle mesurée (en mètres) ? : "))
    
    # 2. Load Model
    print("\n⏳ Analyse en cours...")
    model = YOLO(os.path.join("C:\\Users\\admin\\Downloads", "best.pt"))
    results = model(img_path, verbose=False)
    
    # 3. Process
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    
    found = False
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = model.names[cls_id]
            conf = float(box.conf[0])
            
            # Get box height
            x1, y1, x2, y2 = box.xyxy[0]
            box_h = int(y2 - y1)
            
            # Calculate distance using OUR algorithm
            est_dist = estimate_distance(cls_name, box_h, h)
            
            # Accuracy calculation
            error = abs(est_dist - real_dist)
            accuracy = (1 - (error / real_dist)) * 100
            
            print(f"\n✅ DÉTECTION : {cls_name.upper()} (Confiance: {conf:.2f})")
            print(f"   - Hauteur de la boîte : {box_h} pixels")
            print(f"   - Distance ESTIMÉE    : {est_dist:.2f} m")
            print(f"   - Distance RÉELLE     : {real_dist:.2f} m")
            print(f"   - PRÉCISION           : {accuracy:.1f} %")
            print(f"   - ERREUR              : {error:.2f} m")
            found = True
            
    if not found:
        print("\n❌ Aucun objet connu n'a été détecté sur cette image.")

if __name__ == "__main__":
    run_real_test()
