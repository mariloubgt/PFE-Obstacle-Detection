import cv2
import PIL.Image
import threading
import time

from google import genai

from . import config
from .gemini_scene_caption import gemini_caption_image


class SceneAnalyzer:
    """Async scene descriptions for the desktop pipeline (Gemini Vision)."""

    def __init__(self, interval=15.0):
        self.interval = interval
        self.last_analysis_time = 0
        self.is_processing = False
        self.current_description = ""

        self.client = genai.Client(api_key=config.GEMINI_API_KEY) if config.GEMINI_API_KEY else None
        if self.client:
            print("[Scene] Gemini Vision prêt pour les légendes de scène.")
        else:
            print("[Scene] Pas de GEMINI_API_KEY — analyse de scène désactivée.")

    def analyze_scene_async(self, frame):
        if self.is_processing:
            return
        if not self.client:
            return
        now = time.time()
        if now - self.last_analysis_time < self.interval:
            return

        self.is_processing = True
        self.last_analysis_time = now
        threading.Thread(target=self._run_gemini_scene_analysis, args=(frame.copy(),), daemon=True).start()

    def _run_gemini_scene_analysis(self, frame):
        try:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_img = PIL.Image.fromarray(rgb_frame)

            caption = gemini_caption_image(
                pil_img,
                self.client,
                timeout_s=config.GEMINI_TIMEOUT_S,
            )
            if caption:
                print(f"[Scene] Gemini (EN): {caption}")
                self.current_description = caption
        except Exception as e:
            print(f"Error in Scene Analysis: {e}")
        finally:
            self.is_processing = False

    def get_description(self):
        return self.current_description
