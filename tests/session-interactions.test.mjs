import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionKeyboardIntent } from '../src/features/sessions/shared/useCardNavigation.js';
import { practiceAnswerSpeech } from '../src/features/sessions/shared/useSessionAudio.js';
import { studyCardDoubleTapAction } from '../src/features/sessions/study/model.js';
import { wordSpeechText } from '../src/words/speech.js';

test('session keyboard intent keeps study and practice commands explicit', () => {
  assert.equal(sessionKeyboardIntent({ key: 'ArrowLeft' }, { left: 'previous' }), 'previous');
  assert.equal(sessionKeyboardIntent({ key: 'ArrowDown' }, { down: 'flip' }), 'flip');
  assert.equal(sessionKeyboardIntent({ key: ' ' }, { space: 'replay' }), 'replay');
  assert.equal(sessionKeyboardIntent({ key: 'Enter' }, { enter: 'next' }), 'next');
  assert.equal(sessionKeyboardIntent({ key: ' ', isComposing: true }, { space: 'replay' }), '');
  assert.equal(sessionKeyboardIntent({ key: ' ', repeat: true }, { space: 'reveal' }), '');
});

test('touch card regions resolve previous, flip, and next without page knowledge', () => {
  assert.equal(studyCardDoubleTapAction(110, 100, 300), 'previous');
  assert.equal(studyCardDoubleTapAction(250, 100, 300), 'flip');
  assert.equal(studyCardDoubleTapAction(390, 100, 300), 'next');
});

test('practice answer audio selects exactly one language', () => {
  const question = { ko: '안녕하세요', zh: '你好' };
  assert.deepEqual(practiceAnswerSpeech(question), { text: '안녕하세요', lang: 'ko-KR' });
  assert.deepEqual(practiceAnswerSpeech(question, true), { text: '你好', lang: 'zh-TW' });
});

test('word audio reads the base form and each distinct conjugation in one utterance', () => {
  const word = { ko: '쏟다', variants: ['쏟아요', '쏟는', '쏟아요', '쏟다'] };
  assert.equal(wordSpeechText(word), '쏟다. 쏟아요. 쏟는');
  assert.deepEqual(practiceAnswerSpeech({ kind: 'term', ko: word.ko, source: word }), {
    text: '쏟다. 쏟아요. 쏟는', lang: 'ko-KR',
  });
  assert.deepEqual(practiceAnswerSpeech({ kind: 'example', ko: '물을 쏟아요.', source: word }), {
    text: '물을 쏟아요.', lang: 'ko-KR',
  });
});
