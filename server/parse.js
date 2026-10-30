// Pull a JSON object out of a model reply: plain JSON, a fenced block, or the
// first "{" to the last "}".
export function extractJsonCandidate(text) {
  try { return JSON.parse(text); } catch { /* next */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* next */ }
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { /* next */ }
  }
  throw new Error('Unable to parse JSON from model output');
}
