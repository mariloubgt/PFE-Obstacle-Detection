import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// --- CONFIGURATION RADAR (SIMPLE & BASIQUE) ---
const COOLDOWN_MS = 5000;      // Temps minimum avant de répéter le même objet
const DIST_CHANGE_M = 0.40;    // Ne répète pas si ça bouge de moins de 40cm

const FR_NAMES = {
  person: 'une personne', car: 'une voiture', dog: 'un chien', bench: 'un banc',
  chair: 'une chaise', stairs: 'des escaliers', curb: 'un trottoir', tree: 'un arbre',
  bus: 'un bus', motorcycle: 'une moto', bicycle: 'un vélo'
};

export default function MainNavigationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [aiTestEnabled, setAiTestEnabled] = useState(false);
  const [detections, setDetections] = useState([]);
  const cameraRef = useRef(null);
  
  const lastSpokenTime = useRef({});
  const lastSpokenDist = useRef({});
  const lastGlobalTime = useRef(0);

  // --- LOGIQUE VOCALE BASIQUE ---
  const handleVoiceFeedback = (current) => {
    if (current.length === 0) return;
    const now = Date.now();

    // Empêche les phrases de se chevaucher (1.5s entre chaque phrase)
    if (now - lastGlobalTime.current < 1500) return;

    // On prend l'objet le plus proche
    const sorted = [...current].sort((a,b) => a.distance_m - b.distance_m);
    const top = sorted[0];
    const cls = top.name;

    const lastT = lastSpokenTime.current[cls] || 0;
    const lastD = lastSpokenDist.current[cls] || 99;

    const expired = (now - lastT) > COOLDOWN_MS;
    const moved = Math.abs(lastD - top.distance_m) > DIST_CHANGE_M;

    // On ne parle que si l'objet est nouveau, s'il a bougé ou si le temps est écoulé
    if (expired || moved) {
        lastSpokenTime.current[cls] = now;
        lastSpokenDist.current[cls] = top.distance_m;
        lastGlobalTime.current = now;
        
        const frName = FR_NAMES[cls] || cls;
        const msg = `${frName} à ${top.distance_m.toFixed(1)} mètres`;
        
        Speech.stop();
        Speech.speak(msg, { language: 'fr-FR', rate: 0.9 });
    }
  };

  // --- CAPTURE ET ENVOI AU SERVEUR ---
  const runFrame = async () => {
    if (!aiTestEnabled || !cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.15, skipProcessing: true });
      const formData = new FormData();
      formData.append('file', { uri: photo.uri, name: 'image.jpg', type: 'image/jpeg' });
      
      const response = await fetch('http://192.168.100.5:8787/predict', {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      const data = await response.json();
      // On ne garde que ce qui est utile pour la navigation (< 5m)
      const valid = (data.detections || []).filter(d => d.distance_m < 5.0);
      setDetections(valid);
      handleVoiceFeedback(valid);
    } catch (e) {
      console.log("Inference Error:", e.message);
    }
  };

  useEffect(() => {
    let timer = null;
    if (aiTestEnabled) {
      // Analyse toutes les 800ms pour une bonne réactivité
      timer = setInterval(runFrame, 800);
    } else {
      Speech.stop();
      setDetections([]);
      lastSpokenTime.current = {};
    }
    return () => { if (timer) clearInterval(timer); };
  }, [aiTestEnabled]);

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={styles.root}>
        <Text style={styles.whiteText}>Camera access is required.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      
      <View style={styles.overlay}>
        <TouchableOpacity 
          style={[styles.btn, aiTestEnabled && styles.btnOn]} 
          onPress={() => setAiTestEnabled(!aiTestEnabled)}
        >
            <MaterialCommunityIcons name="brain" size={30} color="white" />
            <Text style={styles.btnText}>{aiTestEnabled ? "RADAR ACTIVÉ" : "LANCER RADAR IA"}</Text>
        </TouchableOpacity>
        
        <View style={styles.statsContainer}>
           {detections.length > 0 ? (
             detections.map((d, i) => (
               <Text key={i} style={styles.detText}>{d.name}: {d.distance_m.toFixed(1)}m</Text>
             ))
           ) : (
             aiTestEnabled && <Text style={styles.detText}>Recherche d'obstacles...</Text>
           )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  overlay: { 
    position: 'absolute', 
    top: 60, 
    left: 0, 
    right: 0, 
    bottom: 40, 
    alignItems: 'center', 
    justifyContent: 'space-between' 
  },
  btn: { 
    backgroundColor: 'rgba(255,255,255,0.2)', 
    paddingVertical: 15, 
    paddingHorizontal: 30, 
    borderRadius: 50, 
    flexDirection: 'row', 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'white'
  },
  btnOn: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 18, marginLeft: 10 },
  statsContainer: { 
    backgroundColor: 'rgba(0,0,0,0.6)', 
    padding: 15, 
    borderRadius: 15, 
    width: '80%',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1
  },
  detText: { color: '#00FF00', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 },
  whiteText: { color: 'white', textAlign: 'center', marginBottom: 20 }
});
