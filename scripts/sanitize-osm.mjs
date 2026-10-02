import fs from 'node:fs';
export const privacyPolicy = JSON.parse(fs.readFileSync(new URL('../data/privacy-policy.json', import.meta.url), 'utf8'));
export function sanitizeElement(element) {
  const copy = {...element};
  for (const key of privacyPolicy.elementFields) delete copy[key];
  if (copy.tags) {
    copy.tags = {...copy.tags};
    for (const key of privacyPolicy.tagFields) delete copy.tags[key];
  }
  return copy;
}
export function sanitizeOSM(value) {
  if (value?.raw) return {...value, raw: sanitizeOSM(value.raw)};
  if (!Array.isArray(value?.elements)) throw Error('OSM elements array required');
  return {...value, elements: value.elements.map(sanitizeElement)};
}
export function assertCleanOSM(value) {
  const raw = value?.raw || value;
  if (!Array.isArray(raw?.elements)) throw Error('OSM elements array required');
  for (const e of raw.elements) {
    if (privacyPolicy.elementFields.some(k => Object.hasOwn(e, k)) || privacyPolicy.tagFields.some(k => Object.hasOwn(e.tags || {}, k))) throw Error('Unnecessary OSM metadata/contact tags found');
  }
}
