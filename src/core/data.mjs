// Pure shared helpers: never hold mutable source/account state at module scope.
export const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const records = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
export const string = value => typeof value === 'string' && value.trim() ? value.trim() : null;
export const normalizeText = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
export const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export function parseError(message) {
  return Object.assign(new Error(message), {code: 'parse_error', phase: 'parse'});
}
export function manga(value) {
  return {id: value.id, title: value.title, coverUrl: null, description: null,
    secondaryTitle: null, author: null, artist: null, status: null, type: null,
    ageRating: null, rating: null, releaseYear: null, pageCount: null,
    languageFlagUrl: null, tags: [], ...value};
}
export function chapter(value) {
  return {uploadedAt: null, access: {type: 'available', availableAt: null,
    priceLabel: null, message: null}, ...value};
}
export function filter(kind, key, label, options = [], defaultValues = []) {
  return {kind, key, label, caption: null,
    options: options.map(([value, optionLabel]) => ({value, label: optionLabel, caption: null})),
    defaultValues};
}
export function isoDate(value) {
  const text = string(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
