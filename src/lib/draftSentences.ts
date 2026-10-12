/**
 * The finished sentences of streamed text, by paragraph, for showing an answer while it is written:
 * a sentence appears whole once its end arrives (never letter by letter), citation markers hidden, and
 * the model's NO_RECORD marker never shown.
 */
export function draftSentences(raw: string): string[][] {
  const text = raw.replace(/\bNO_RECORD\b/g, '').replace(/\s*(?:\[\d+(?:\s*,\s*\d+)*\])+/g, '');
  return text
    .split(/\n{2,}/)
    .map((p) => (p.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? []).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 3))
    .filter((p) => p.length > 0);
}
