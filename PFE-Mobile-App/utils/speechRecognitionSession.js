/** Single mic owner — prevents Main + Scene hooks from fighting the iOS audio session. */
let activeOwner = null;

export function claimSpeechRecognition(ownerId) {
  activeOwner = ownerId;
}

export function releaseSpeechRecognition(ownerId) {
  if (activeOwner === ownerId) activeOwner = null;
}

export function isSpeechRecognitionOwner(ownerId) {
  return activeOwner === ownerId;
}

export function abortSpeechRecognition(module, ownerId) {
  if (ownerId != null && activeOwner != null && activeOwner !== ownerId) return;
  if (ownerId != null) releaseSpeechRecognition(ownerId);
  if (!module) return;
  try {
    module.abort();
  } catch {
    try {
      module.stop();
    } catch {
      /* ignore */
    }
  }
}

/** Stop any in-flight recognition before another screen takes the mic. */
export function takeSpeechRecognition(module, ownerId) {
  if (activeOwner && activeOwner !== ownerId && module) {
    abortSpeechRecognition(module, activeOwner);
  }
  activeOwner = ownerId;
}
