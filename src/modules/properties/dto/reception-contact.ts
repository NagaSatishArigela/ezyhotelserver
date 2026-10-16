export function normalizeReceptionNumber(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/[\s()-]/g, '') : value;
}

export function normalizeReceptionMobile(value: unknown): unknown {
  const number = normalizeReceptionNumber(value);
  if (typeof number !== 'string') return number;
  if (number.startsWith('+91') && number.length === 13) return number.slice(3);
  if (number.startsWith('91') && number.length === 12) return number.slice(2);
  return number;
}

export function normalizeReceptionLandline(value: unknown): unknown {
  const number = normalizeReceptionNumber(value);
  return number === '' ? null : number;
}
