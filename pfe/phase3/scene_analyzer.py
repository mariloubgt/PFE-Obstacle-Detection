import torch
from transformers import BlipProcessor, BlipForConditionalGeneration
import cv2
import PIL.Image
import threading
import time
from . import config
from google import genai

class SceneAnalyzer:
    def __init__(self, interval=15.0):
        self.interval = interval
        self.last_analysis_time = 0
        self.is_processing = False
        self.current_description = ""
        
        self.client = genai.Client(api_key=config.GEMINI_API_KEY) if config.GEMINI_API_KEY else None
        
        # Passage en version BASE pour plus de rapidité (Moins de lag au démarrage)
        print("[Scene] Chargement de BLIP-Base (Vitesse optimisée)...")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        self.processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
        self.model = BlipForConditionalGeneration.from_pretrained(
            "Salesforce/blip-image-captioning-base"
        ).to(self.device)
        print(f"[Scene] BLIP Prêt sur {self.device}")

    def analyze_scene_async(self, frame):
        if self.is_processing: return
        now = time.time()
        if now - self.last_analysis_time < self.interval: return

        self.is_processing = True
        self.last_analysis_time = now
        threading.Thread(target=self._run_blip_analysis, args=(frame.copy(),), daemon=True).start()

    def _run_blip_analysis(self, frame):
        try:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_img = PIL.Image.fromarray(rgb_frame)
            
            inputs = self.processor(pil_img, return_tensors="pt").to(self.device)
            out = self.model.generate(**inputs, max_new_tokens=50)
            english_caption = self.processor.decode(out[0], skip_special_tokens=True)
            
            print(f"[Scene] BLIP (EN): {english_caption}")
            self.current_description = english_caption
            
            # Note: La traduction Gemini est gérée par le vision_pipeline dans ton nouveau script PC
        except Exception as e:
            print(f"Error in Scene Analysis: {e}")
        finally:
            self.is_processing = False

    def get_description(self):
        return self.current_description
