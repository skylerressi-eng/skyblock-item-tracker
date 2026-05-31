// Colour helpers. Leather armour stores colour as an integer (R<<16 | G<<8 | B)
// in NBT at tag.display.color; everywhere else we work with 6-char lowercase hex.

export function hexFromInt(n) {
  const v = (Number(n) >>> 0) & 0xffffff;
  return v.toString(16).padStart(6, '0');
}

export function normHex(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{3}$/.test(s)) return s.split('').map((c) => c + c).join('');
  if (/^\d+$/.test(s)) return hexFromInt(Number(s));
  return null;
}

export function intFromHex(hex) {
  const h = normHex(hex);
  return h == null ? null : parseInt(h, 16);
}

export function rgb(hex) {
  const h = normHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Euclidean distance in RGB space (0 = identical, ~441 = max).
export function dist(a, b) {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return Infinity;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}
