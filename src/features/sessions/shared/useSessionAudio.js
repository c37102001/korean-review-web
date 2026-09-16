import {
  configureSpeechUtterance,
  findPreferredSpeechVoice,
  normalizeSpeechLanguage,
  readSpeechVoicePreferences,
  speechLanguageKey,
  speakText,
} from '../../../audio/speech.js';

export function waitFor(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function practiceAnswerSpeech(question, useChinese = false) {
  return useChinese
    ? { text: question?.zh || '', lang: 'zh-TW' }
    : { text: question?.ko || '', lang: 'ko-KR' };
}

export function speakAnswer(question) {
  speakText(question?.ko, 'ko-KR');
}

export function speakPracticeAnswer(question, useChinese = false, onError = () => {}) {
  const speech = practiceAnswerSpeech(question, useChinese);
  if (!speech.text.trim()) {
    onError('這題沒有可朗讀的答案文字。');
    return;
  }
  if (!window.speechSynthesis) {
    onError('此瀏覽器不支援語音播放。');
    return;
  }
  const synth = window.speechSynthesis;
  const voices = synth.getVoices();
  const preferred = findPreferredSpeechVoice(
    voices,
    readSpeechVoicePreferences()[speechLanguageKey(speech.lang)],
    speech.lang,
  );
  const voice = preferred
    || voices.find((candidate) => normalizeSpeechLanguage(candidate.lang) === normalizeSpeechLanguage(speech.lang))
    || voices.find((candidate) => normalizeSpeechLanguage(candidate.lang).startsWith(useChinese ? 'zh' : 'ko'));
  const utterance = configureSpeechUtterance(new SpeechSynthesisUtterance(speech.text), speech.lang, voice);
  utterance.onerror = (event) => {
    if (['canceled', 'interrupted'].includes(event.error)) return;
    onError(`${useChinese ? '中文' : '韓文'}語音播放失敗（${event.error || 'unknown'}）。請在首頁「語音設定」試聽並選擇可用聲音。`);
  };
  synth.cancel();
  synth.resume();
  synth.speak(utterance);
}

export function playResultSound(correct) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const now = context.currentTime;
  const notes = correct
    ? [
        { frequency: 660, start: 0, duration: 0.12 },
        { frequency: 880, start: 0.13, duration: 0.16 },
      ]
    : [
        { frequency: 220, start: 0, duration: 0.16 },
        { frequency: 165, start: 0.14, duration: 0.18 },
      ];
  notes.forEach(({ frequency, start, duration }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = correct ? 'sine' : 'sawtooth';
    oscillator.frequency.setValueAtTime(frequency, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(correct ? 0.12 : 0.08, now + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + duration + 0.02);
  });
  window.setTimeout(() => context.close(), 520);
}
