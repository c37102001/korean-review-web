import { wordExamples } from '../../../words/records.js';
import { wordSpeechText } from '../../../words/speech.js';

export function shouldShowStudyChinese(hideChineseInitially, cardChineseRevealed) {
  return !hideChineseInitially || cardChineseRevealed;
}

export function studyCardDoubleTapAction(clientX, left, width) {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return '';
  const position = (clientX - left) / width;
  if (position < 1 / 3) return 'previous';
  if (position > 2 / 3) return 'next';
  return 'flip';
}

export function buildStudyAutoPlaySpeechSequence(item, {
  frontSide = 'ko',
  hideChineseInitially = true,
  playExampleVoice = true,
  voiceRepeatCount = 1,
} = {}) {
  if (!item) return [];
  const repeatCount = Math.min(3, Math.max(1, Number(voiceRepeatCount) || 1));
  const includeChinese = !hideChineseInitially;
  const cycle = [{
    text: wordSpeechText(item),
    lang: 'ko-KR',
    face: frontSide === 'ko' || hideChineseInitially ? 'front' : 'back',
  }];
  if (includeChinese && item.zh) {
    cycle.push({ text: item.zh, lang: 'zh-TW', face: frontSide === 'zh' ? 'front' : 'back' });
  }
  if (playExampleVoice) {
    wordExamples(item).forEach((example) => {
      if (example.ko) cycle.push({ text: example.ko, lang: 'ko-KR', face: 'back' });
      if (includeChinese && example.zh) cycle.push({ text: example.zh, lang: 'zh-TW', face: 'back' });
    });
  }
  return Array.from({ length: repeatCount }, () => cycle).flat();
}
