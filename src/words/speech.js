export function wordSpeechText(word) {
  const forms = [word?.ko, ...(Array.isArray(word?.variants) ? word.variants : [])]
    .map((form) => String(form || '').trim())
    .filter(Boolean);
  return [...new Set(forms)].join('. ');
}
