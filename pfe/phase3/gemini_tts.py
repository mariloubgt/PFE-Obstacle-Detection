"""
Gemini TTS wrapper — generates Darija voice alerts.
Caches audio files to avoid repeated API calls.
Fallback to local pyttsx3 if quota is exceeded.
"""
import hashlib
import time
import wave
from pathlib import Path
import pyttsx3
import threading
import winsound
from . import config

# Initialize local TTS engine
local_engine = pyttsx3.init()
local_engine.setProperty('rate', 150) # Speed of speech

# Tracking alert times
_last_alert: dict[str, float] = {}
_last_global_alert: float = 0
_is_playing: bool = False

def _get_darija_phrase(class_name: str, distance_m: float, danger: str) -> str:
    darija_names = {
        "person": "شخص", "car": "طوموبيل", "bus": "طوبيس", "truck": "كاميو",
        "bicycle": "بشكليطة", "motorcycle": "موطور", "dog": "كلب", "bench": "بنك",
        "tree": "شجرة", "pole": "عمود", "stairs": "الدروج", "curb": "الرصيف",
        "fire_hydrant": "بوش ديال الما", "stop_sign": "لافيتة ديال الوقوف",
        "traffic_light": "ضو حمر", "bus_stop": "محطة ديال الطوبيس", "crutch": "عكاز",
        "train": "تران", "spherical_roadblock": "حاجز", "warning_column": "عمود تحذيري",
        "waste_container": "صبّالة",
    }
    name = darija_names.get(class_name, class_name)
    dist_txt = f"{distance_m:.0f}"
    if danger == "DANGER": return f"انتباه! {name} قريب بزاف"
    elif danger == "WARNING": return f"كاين {name} على بعد {dist_txt} متر"
    else: return f"{name} بعيد شوية"

def _cache_path(text: str) -> Path:
    h = hashlib.md5(text.encode()).hexdigest()[:12]
    return config.CACHE_DIR / f"{h}.wav"

def speak_local(text: str):
    """Fallback: Speak using local Windows voice."""
    global _is_playing
    def _run():
        global _is_playing
        _is_playing = True
        print(f"[Local TTS] Speaking: {text}")
        local_engine.say(text)
        local_engine.runAndWait()
        _is_playing = False
    threading.Thread(target=_run, daemon=True).start()

def generate_custom_text_alert(text: str) -> Path | None:
    global _last_global_alert
    now = time.time()
    if now - _last_global_alert < 2.5 or _is_playing: return None
        
    cached = _cache_path(text)
    if cached.exists(): return cached

    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        response = client.models.generate_content(
            model=config.GEMINI_TTS_MODEL,
            contents=text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.GEMINI_VOICE)
                    )
                )
            )
        )
        audio_data = response.candidates[0].content.parts[0].inline_data.data
        with wave.open(str(cached), "wb") as wf:
            wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(24000)
            wf.writeframes(audio_data)
        _last_global_alert = now
        print(f"[TTS SCENE] Generated with Gemini: {text}")
        return cached
    except Exception as e:
        print(f"[TTS SCENE] Gemini failed (possibly quota), using local voice: {e}")
        speak_local(text)
        return None

def generate_alert(class_name: str, distance_m: float, danger: str) -> Path | None:
    global _last_global_alert, _is_playing
    now = time.time()
    if now - _last_global_alert < config.GLOBAL_COOLDOWN_S or _is_playing: return None
    
    # Per-class cooldown
    last = _last_alert.get(class_name, 0)
    if now - last < config.TTS_COOLDOWN_S: return None
    _last_alert[class_name] = now

    phrase = _get_darija_phrase(class_name, distance_m, danger)
    cached = _cache_path(phrase)
    if cached.exists(): return cached

    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        response = client.models.generate_content(
            model=config.GEMINI_TTS_MODEL,
            contents=phrase,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.GEMINI_VOICE)
                    )
                )
            )
        )
        audio_data = response.candidates[0].content.parts[0].inline_data.data
        with wave.open(str(cached), "wb") as wf:
            wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(24000)
            wf.writeframes(audio_data)
        _last_global_alert = now
        return cached
    except Exception as e:
        # For obstacles, we can just use the local voice as well
        print(f"[TTS ALERT] Gemini failed, using local voice: {e}")
        speak_local(phrase)
        return None

def play_audio(wav_path: Path) -> None:
    if not wav_path or not wav_path.exists(): return
    def _play():
        global _is_playing
        try:
            _is_playing = True
            print(f"[Audio] Playing: {wav_path.name}")
            winsound.PlaySound(str(wav_path), winsound.SND_FILENAME)
            _is_playing = False
        except Exception as e:
            print(f"[Audio Error] Cannot play sound: {e}")
            _is_playing = False
    threading.Thread(target=_play, daemon=True).start()
