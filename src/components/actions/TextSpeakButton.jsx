import { Volume2 } from 'lucide-react';
import { speakText } from '../../audio/speech.js';

export function TextSpeakButton({ text, lang, label }) {
  if (!text) return null;
  return (
    <button
      type="button"
      className="speak-icon-button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        speakText(text, lang);
      }}
      aria-label={label}
      title={label}
    >
      <Volume2 size={15} />
    </button>
  );
}
