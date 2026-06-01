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

// Convert hex -> HSL ([h 0-360, s 0-1, l 0-1]) for general-colour naming.
export function hsl(hex) {
  const c = rgb(hex);
  if (!c) return null;
  const r = c[0] / 255; const g = c[1] / 255; const b = c[2] / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

// Map a hex to a general colour name (red, orange, blue, purple, black, white,
// gray, …). Used so "blue" matches any bluish exotic, not one exact hex.
export function colorName(hex) {
  const v = hsl(hex);
  if (!v) return null;
  const [h, s, l] = v;
  if (l <= 0.08) return 'black';
  if (l >= 0.93 && s <= 0.15) return 'white';
  if (s <= 0.12) return 'gray';
  // Hue buckets (degrees). Browns are dark/low-sat oranges.
  if ((h < 15 || h >= 345)) return 'red';
  if (h < 45) return (l < 0.4 ? 'brown' : 'orange');
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 200) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

// Some friendly aliases a user might type.
const COLOR_ALIASES = {
  grey: 'gray', magenta: 'pink', violet: 'purple', lime: 'green',
  aqua: 'cyan', teal: 'cyan', gold: 'yellow', maroon: 'red',
};
export function normColorName(input) {
  const s = String(input || '').trim().toLowerCase();
  return COLOR_ALIASES[s] || s;
}
