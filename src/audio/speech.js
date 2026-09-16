export const SPEECH_VOICE_STORAGE_KEY = 'korean-review-speech-voices-v1';

export function normalizeSpeechLanguage(lang) {
  return String(lang || '').replaceAll('_', '-').toLowerCase();
}

export function speechLanguageKey(lang) {
  return normalizeSpeechLanguage(lang).startsWith('zh') ? 'zh' : 'ko';
}

export function findPreferredSpeechVoice(voices, preference, lang) {
  if (!preference || !Array.isArray(voices)) return null;
  const languageKey = speechLanguageKey(lang);
  const candidates = voices.filter((voice) => normalizeSpeechLanguage(voice?.lang).startsWith(languageKey));
  return candidates.find((voice) => preference.voiceURI && voice.voiceURI === preference.voiceURI)
    || candidates.find((voice) => (
      voice.name === preference.name
      && normalizeSpeechLanguage(voice.lang) === normalizeSpeechLanguage(preference.lang)
    ))
    || null;
}

export function readSpeechVoicePreferences() {
  if (typeof window === 'undefined') return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(SPEECH_VOICE_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

export function configureSpeechUtterance(utterance, lang, voiceOverride = undefined) {
  utterance.lang = lang;
  utterance.rate = normalizeSpeechLanguage(lang).startsWith('ko') ? 0.9 : 1;
  const selectedVoice = voiceOverride === undefined
    ? findPreferredSpeechVoice(
      window.speechSynthesis.getVoices(),
      readSpeechVoicePreferences()[speechLanguageKey(lang)],
      lang,
    )
    : voiceOverride;
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang || lang;
  }
  return utterance;
}

export function speakText(text, lang, voiceOverride = undefined) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = configureSpeechUtterance(new SpeechSynthesisUtterance(text), lang, voiceOverride);
  window.speechSynthesis.speak(utterance);
}

export function speakTextAndWait(text, lang) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = configureSpeechUtterance(new SpeechSynthesisUtterance(text), lang);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      resolve();
    };
    const fallbackTimer = window.setTimeout(finish, Math.max(3500, [...text].length * 320));
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}
