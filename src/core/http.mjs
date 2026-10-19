import {parseError} from './data.mjs';

export function urlWithQuery(path, base, query = {}) {
  const url = new URL(path, base);
  for (const [key, raw] of Object.entries(query)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value !== null && value !== undefined) url.searchParams.append(key, String(value));
    }
  }
  return url.href;
}

export function requireRecord(value, field = 'response') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw parseError(`Invalid ${field} object.`);
  return value;
}

export function requireArray(value, field = 'data') {
  if (!Array.isArray(value)) throw parseError(`Invalid ${field} list.`);
  return value;
}

export function requireText(value, field = 'value') {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!text) throw parseError(`Missing ${field}.`);
  return text;
}

export function finiteNumber(value, fallback = 0) {
  const result = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(result) ? result : fallback;
}
