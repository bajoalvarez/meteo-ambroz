// Utilidades de formato, fechas, colores y DOM.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const nf1f = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const num = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : d === 0 ? nf0.format(x) : nf1.format(x));
export const num1 = (x) => (x == null ? '–' : nf1f.format(x));
const nf2f = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const num2 = (x) => (x == null ? '–' : nf2f.format(x));
export const signed2 = (x) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${nf2f.format(Math.abs(x))}`);
export const temp = (x) => (x == null ? '–' : `${nf0.format(Math.round(x))}°`);
export const temp1 = (x) => (x == null ? '–' : `${nf1f.format(x)}°`);
export const mm = (x) => (x == null ? '–' : x < 0.05 ? '0 mm' : x < 10 ? `${nf1.format(x)} mm` : `${nf0.format(x)} mm`);
export const pct = (x) => (x == null ? '–' : `${nf0.format(Math.round(x * 100))} %`);
export const kmh = (x) => (x == null ? '–' : `${nf0.format(Math.round(x))} km/h`);
export const signed = (x, d = 0) => (x == null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${num(Math.abs(x), d)}`);

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WD_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Las horas llegan en hora local de Madrid ("2026-11-18T07:00"); se tratan como hora local.
export function parseLocal(s) {
  const [d, t = '00:00'] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh, mi || 0);
}
export const ts = (s) => parseLocal(s).getTime();

export function dayLabel(dateStr, k) {
  if (k === 0) return 'Hoy';
  if (k === 1) return 'Mañana';
  const d = parseLocal(dateStr);
  return cap(WEEKDAYS[d.getDay()]);
}
export const weekdayShort = (dateStr) => WD_SHORT[parseLocal(dateStr).getDay()];
export const weekday = (dateStr) => WEEKDAYS[parseLocal(dateStr).getDay()];
export function dateShort(dateStr) {
  const d = parseLocal(dateStr);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
export function dateLong(dateStr) {
  if (!dateStr) return '–';
  if (/^\d{4}$/.test(dateStr)) return dateStr;
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [y, m] = dateStr.split('-').map(Number);
    return `${MONTHS[m - 1]} de ${y}`;
  }
  const d = parseLocal(dateStr);
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}
export const hourLabel = (s) => s.slice(11, 13) + ' h';
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function ago(epochSec) {
  if (!epochSec) return 'sin datos';
  const m = Math.round((Date.now() / 1000 - epochSec) / 60);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const hh = Math.round(m / 60);
  if (hh < 24) return `hace ${hh} h`;
  return `hace ${Math.round(hh / 24)} días`;
}
export function agoIso(iso) {
  if (!iso) return 'sin datos';
  return ago(new Date(iso).getTime() / 1000);
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const DIR_LONG = { N: 'norte', NE: 'nordeste', E: 'este', SE: 'sudeste', S: 'sur', SO: 'suroeste', O: 'oeste', NO: 'noroeste' };
export const dirName = (deg) => (deg == null ? '–' : DIRS[Math.round((deg % 360) / 45) % 8]);
export const dirLong = (deg) => DIR_LONG[dirName(deg)] || '';

export const SYMBOL_LABEL = {
  despejado: 'Despejado', 'poco-nuboso': 'Poco nuboso', intervalos: 'Intervalos nubosos', nuboso: 'Nuboso',
  cubierto: 'Cubierto', niebla: 'Niebla', 'lluvia-debil': 'Lluvia débil', lluvia: 'Lluvia', 'lluvia-fuerte': 'Lluvia fuerte',
  chubascos: 'Chubascos', tormenta: 'Tormenta', nieve: 'Nieve', aguanieve: 'Aguanieve',
};

// Familia de cielo para el fondo adaptativo.
export function skyFamily(sym) {
  if (!sym) return 'nubes';
  if (sym === 'despejado' || sym === 'poco-nuboso') return 'despejado';
  if (sym === 'intervalos') return 'nubes';
  if (sym === 'nuboso' || sym === 'cubierto') return 'cubierto';
  if (sym === 'niebla') return 'niebla';
  if (sym === 'tormenta') return 'tormenta';
  if (sym === 'nieve' || sym === 'aguanieve') return 'nieve';
  return 'lluvia';
}

// Escala divergente de temperatura: azul (frío) ↔ gris neutro ↔ rojo (calor).
const T_STOPS = [
  [-8, [16, 66, 129]], [0, [42, 120, 214]], [6, [109, 167, 236]], [11, [183, 211, 246]],
  [16, [228, 228, 224]], [21, [247, 196, 160]], [27, [235, 104, 52]], [33, [208, 59, 59]], [40, [128, 26, 26]],
];
export function tempRGB(t) {
  if (t == null) return [200, 200, 200];
  if (t <= T_STOPS[0][0]) return T_STOPS[0][1];
  for (let i = 1; i < T_STOPS.length; i++) {
    const [t1, c1] = T_STOPS[i];
    const [t0, c0] = T_STOPS[i - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return T_STOPS[T_STOPS.length - 1][1];
}
export const tempColor = (t) => `rgb(${tempRGB(t).join(',')})`;
export function inkOn(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? '#15211c' : '#ffffff';
}
// Anomalía (divergente) para franjas y meses.
export function anomRGB(a, span = 2.5) {
  const f = Math.max(-1, Math.min(1, a / span));
  const neutral = [228, 228, 224];
  const cold = [29, 92, 171];
  const hot = [196, 47, 47];
  const target = f < 0 ? cold : hot;
  return neutral.map((c, k) => Math.round(c + (target[k] - c) * Math.abs(f)));
}
export const anomColor = (a, span) => `rgb(${anomRGB(a, span).join(',')})`;

// Lluvia: escala secuencial de un solo tono (azul).
const R_STOPS = [[0, [205, 226, 251]], [2, [134, 182, 239]], [8, [57, 135, 229]], [20, [37, 106, 191]], [45, [16, 66, 129]]];
export function rainRGB(p) {
  if (p == null || p < 0.1) return null;
  for (let i = 1; i < R_STOPS.length; i++) {
    const [p1, c1] = R_STOPS[i];
    const [p0, c0] = R_STOPS[i - 1];
    if (p <= p1) {
      const f = (p - p0) / (p1 - p0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return R_STOPS[R_STOPS.length - 1][1];
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    return null;
  }
  return value;
}

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
