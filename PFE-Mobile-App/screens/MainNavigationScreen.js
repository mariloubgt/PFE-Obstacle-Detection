import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- CONFIG RADAR ---
const DANGER_DIST_M = 1.8;
const COOLDOWN_MS = 5000;
const MIN_CHANGE_M = 0.40;

const FR_MAP = {
  person: 'une personne', car: 'une voiture', dog: 'un chien', bench: 'un banc',
  chair: 'une chaise', stairs: 'des escaliers', curb: 'un trottoir'
};

export default function MainNavigationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [aiTestEnabled, setAiTestEnabled] = useState(false);
  const [detections, setDetections] = useState([]);
  const cameraRef = useRef(null);
  
  const lastSpokenTime = useRef({});
  const lastSpokenDist = useRef({});
  const lastGlobalSpeak = useRef(0);

  const handleVoiceFeedback = (current) => {
    if (current.length === 0) return;
    const now = Date.now();
    if (now - lastGlobalSpeak.current < 1500) return;

    const top = [...current].sort((a,b) => a.distance_m - b.distance_m)[0];
    const cls = top.name;
    const lastT = lastSpokenTime.current[cls] || 0;
    const lastD = lastSpokenDist.current[cls] || 99;

    const timePassed = (now - lastT) > COOLDOWN_MS;
    const moved = Math.abs(lastD - top.distance_m) > MIN_CHANGE_M;

    if (timePassed || moved) {
        lastSpokenTime.current[cls] = now;
        lastSpokenDist.current[cls] = top.distance_m;
        lastGlobalSpeak.current = now;
        
        const frName = FR_MAP[cls] || cls;
        const msg = `${frName} à ${top.distance_m.toFixed(1)} mètres`;
        
        Speech.stop();
        Speech.speak(msg, { language: 'fr-FR', rate: 0.9 });
    }
  };

  const runFrame = async () => {
    if (!aiTestEnabled || !cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.2, skipProcessing: true });
      const formData = new FormData();
      formData.append('file', { uri: photo.uri, name: 'image.jpg', type: 'image/jpeg' });
      
      const response = await fetch('http://192.168.100.5:8787/predict', {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      const data = await response.json();
      const dets = (data.detections || []).filter(d => d.distance_m < 5.0);
      setDetections(dets);
      handleVoiceFeedback(dets);
    } catch (e) { console.log("Error:", e); }
  };

  useEffect(() => {
    let interval = null;
    if (aiTestEnabled) {
      interval = setInterval(runFrame, 800);
    } else {
      Speech.stop();
      setDetections([]);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [aiTestEnabled]);

  if (!permission) return <View />;
  if (!permission.granted) return <View style={styles.root}><Text>No camera permission</Text></View>;

  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      
      <View style={styles.overlay}>
        <TouchableOpacity style={[styles.btn, aiTestEnabled && styles.btnOn]} onPress={() => setAiTestEnabled(!aiTestEnabled)}>
            <MaterialCommunityIcons name="brain" size={30} color="white" />
            <Text style={styles.btnText}>{aiTestEnabled ? "RADAR ON" : "START AI"}</Text>
        </TouchableOpacity>
        
        <View style={styles.stats}>
           {detections.map((d, i) => (
             <Text key={i} style={styles.detText}>{d.name}: {d.distance_m.toFixed(1)}m</Text>
           ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  overlay: { position: 'absolute', top: 50, left: 0, right: 0, bottom: 20, alignItems: 'center', justifyContent: 'space-between' },
  btn: { backgroundColor: '#444', padding: 20, borderRadius: 50, flexDirection: 'row', alignItems: 'center' },
  btnOn: { backgroundColor: '#007AFF' },
  btnText: { color: 'white', fontWeight: 'bold', marginLeft: 10 },
  stats: { backgroundColor: 'rgba(0,0,0,0.5)', padding: 10, borderRadius: 10 },
  detText: { color: 'white', fontSize: 18 }
});
