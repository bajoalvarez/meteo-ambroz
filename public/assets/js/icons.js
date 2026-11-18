// Iconos meteorológicos dibujados a mano en SVG (64×64). Los colores salen de
// variables CSS (--ic-*) para que funcionen en tema claro, oscuro y sobre el cielo.

const cloudShapes = (x, y, s = 1) => {
  const c = (cx, cy, r) => `<circle cx="${x + cx * s}" cy="${y + cy * s}" r="${r * s}"/>`;
  return `${c(10, 0, 8)}${c(22, -6, 11.5)}${c(33, 1, 8)}<rect x="${x + 2 * s}" y="${y}" width="${38 * s}" height="${9 * s}" rx="${4.5 * s}"/>`;
};

function cloud(x, y, s = 1, tone = 'light') {
  const fill = tone === 'dark' ? 'var(--ic-cloud-dark)' : 'var(--ic-cloud)';
  return `<g class="ic-cloud"><g fill="var(--ic-cloud-edge)" stroke="var(--ic-cloud-edge)" stroke-width="${3.2}">${cloudShapes(x, y, s)}</g><g fill="${fill}">${cloudShapes(x, y, s)}</g></g>`;
}

function sun(cx, cy, r = 10, rays = true) {
  let out = `<g class="ic-sun">`;
  if (rays) {
    out += `<g class="ic-rays" stroke="var(--ic-sun)" stroke-width="3" stroke-linecap="round">`;
    for (let k = 0; k < 8; k++) {
      const a = (Math.PI / 4) * k;
      const r1 = r + 4.5;
      const r2 = r + 9;
      out += `<line x1="${(cx + Math.cos(a) * r1).toFixed(1)}" y1="${(cy + Math.sin(a) * r1).toFixed(1)}" x2="${(cx + Math.cos(a) * r2).toFixed(1)}" y2="${(cy + Math.sin(a) * r2).toFixed(1)}"/>`;
    }
    out += `</g>`;
  }
  return `${out}<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--ic-sun)"/></g>`;
}

function moon(cx, cy, r = 11) {
  // Creciente: círculo menos otro círculo desplazado arriba a la derecha.
  const ox = cx + 0.5 * r;
  const oy = cy - 0.38 * r;
  const r2 = 0.82 * r;
  const dx = ox - cx;
  const dy = oy - cy;
  const d = Math.hypot(dx, dy);
  const a = (r * r - r2 * r2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, r * r - a * a));
  const xm = cx + (a * dx) / d;
  const ym = cy + (a * dy) / d;
  const p1 = `${(xm + (hh * dy) / d).toFixed(2)} ${(ym - (hh * dx) / d).toFixed(2)}`;
  const p2 = `${(xm - (hh * dy) / d).toFixed(2)} ${(ym + (hh * dx) / d).toFixed(2)}`;
  return `<path class="ic-moon" fill="var(--ic-moon)" d="M${p1} A${r} ${r} 0 1 0 ${p2} A${r2} ${r2} 0 0 1 ${p1}Z"/>`;
}

function drops(xs, y0, len = 7) {
  return `<g class="ic-drops" stroke="var(--ic-rain)" stroke-width="3" stroke-linecap="round">${xs
    .map(([x, dy = 0], k) => `<line class="ic-drop d${k % 3}" x1="${x}" y1="${y0 + dy}" x2="${x - 2.5}" y2="${y0 + dy + len}"/>`)
    .join('')}</g>`;
}

function flakes(pts) {
  return `<g class="ic-flakes" stroke="var(--ic-snow)" stroke-width="2.2" stroke-linecap="round">${pts
    .map(([x, y]) => `<g transform="translate(${x} ${y})"><line x1="-4" y1="0" x2="4" y2="0"/><line x1="-2" y1="-3.5" x2="2" y2="3.5"/><line x1="-2" y1="3.5" x2="2" y2="-3.5"/></g>`)
    .join('')}</g>`;
}

const bolt = () => `<path class="ic-bolt" fill="var(--ic-bolt)" d="M33 38 L25 51 L31 51 L27 61 L40 46 L33 46 L37 38Z"/>`;
const fogLines = (y) => `<g stroke="var(--ic-fog)" stroke-width="3" stroke-linecap="round"><line x1="12" y1="${y}" x2="46" y2="${y}"/><line x1="18" y1="${y + 7}" x2="52" y2="${y + 7}"/><line x1="10" y1="${y + 14}" x2="40" y2="${y + 14}"/></g>`;

function body(sym, day) {
  const orb = (x, y, r) => (day ? sun(x, y, r) : moon(x, y, r + 1));
  switch (sym) {
    case 'despejado':
      return day ? sun(32, 32, 12) : moon(30, 32, 15);
    case 'poco-nuboso':
      return orb(24, 24, 10) + cloud(22, 44, 0.78);
    case 'intervalos':
      return orb(22, 22, 10) + cloud(14, 42, 0.98);
    case 'nuboso':
      return cloud(20, 30, 0.75, 'light') + cloud(10, 44, 1.02);
    case 'cubierto':
      return cloud(20, 28, 0.78, 'dark') + cloud(10, 42, 1.02, 'dark');
    case 'niebla':
      return (day ? sun(32, 20, 8, false) : moon(32, 20, 8)) + fogLines(36);
    case 'lluvia-debil':
      return cloud(11, 32, 1.02) + drops([[24], [38, 2]], 46);
    case 'lluvia':
      return cloud(11, 30, 1.02, 'dark') + drops([[20], [31, 2], [42]], 44);
    case 'lluvia-fuerte':
      return cloud(11, 28, 1.02, 'dark') + drops([[17], [26, 3], [35], [44, 3]], 42, 9);
    case 'chubascos':
      return orb(22, 20, 9) + cloud(14, 38, 0.98) + drops([[26], [38, 2]], 52, 6);
    case 'tormenta':
      return cloud(11, 28, 1.02, 'dark') + bolt() + drops([[18], [46, 2]], 44);
    case 'nieve':
      return cloud(11, 30, 1.02) + flakes([[20, 49], [32, 54], [44, 49]]);
    case 'aguanieve':
      return cloud(11, 30, 1.02) + drops([[22]], 45) + flakes([[38, 51]]);
    default:
      return cloud(11, 38, 1.02);
  }
}

// Contenido del icono sin la etiqueta <svg>, para incrustarlo dentro de un gráfico.
export function wxBody(sym, isDay = 1) {
  return body(sym, isDay === undefined || isDay === null ? true : Boolean(isDay));
}

export function wx(sym, isDay = 1, size = 40, cls = '') {
  const day = isDay === undefined || isDay === null ? true : Boolean(isDay);
  return `<svg class="wx ${cls}" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${sym || ''}">${body(sym, day)}</svg>`;
}

// Iconos de interfaz (trazo, 24×24).
const UI = {
  drop: '<path d="M12 3.5c3.2 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.8-6.6 6-10.8z"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 15h15a3 3 0 1 1-3 3"/><path d="M3 12h7"/>',
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l4-4"/><circle cx="12" cy="13" r="1.2"/>',
  humidity: '<path d="M12 3.5c3.2 4.2 6 7.6 6 10.8a6 6 0 0 1-12 0c0-3.2 2.8-6.6 6-10.8z"/><path d="M9.5 15.5l5-5"/><circle cx="9.7" cy="11" r=".6"/><circle cx="14.3" cy="15.4" r=".6"/>',
  thermo: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  sunrise: '<path d="M4 18h16"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 4v5"/><path d="M9.5 6.5L12 4l2.5 2.5"/>',
  sunset: '<path d="M4 18h16"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 9V4"/><path d="M9.5 6.5L12 9l2.5-2.5"/>',
  alert: '<path d="M12 3.8l9 15.7H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".7"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  station: '<path d="M12 21V9"/><path d="M8 21h8"/><path d="M12 9l-5-4h10z"/><circle cx="12" cy="9" r="1"/>',
  dam: '<path d="M3 20h18"/><path d="M5 20V9l4-3v14"/><path d="M13 20v-6c2 0 2 1.2 4 1.2s2-1.2 4-1.2"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  uv: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21"/>',
  mountain: '<path d="M2.5 19.5l6-10 4 6 2.5-3.5 6.5 7.5z"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 15l4-5 3 3 5-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".7"/>',
};

export function ui(name, size = 18, cls = '') {
  return `<svg class="ui-ic ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name] || ''}</svg>`;
}

// Flecha de viento: apunta hacia donde sopla el viento (dirección + 180°).
export function windArrow(deg, size = 16, cls = '') {
  if (deg == null) return '';
  return `<svg class="wind-arrow ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" style="transform:rotate(${(deg + 180) % 360}deg)"><path d="M12 3l5.5 15-5.5-3.6L6.5 18z" fill="currentColor"/></svg>`;
}

// Iconos de tipo de aviso.
export function alertIcon(type, size = 20) {
  const map = { lluvia: 'drop', viento: 'wind', nieve: 'snow', tormenta: 'alert', niebla: 'humidity', calor: 'thermo', frio: 'thermo' };
  return ui(map[type] || 'alert', size);
}

export const LOGO = `<svg class="logo" viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
  <circle cx="27" cy="13" r="6" fill="var(--logo-sun)"/>
  <path d="M2 33 L13 16 L19 24 L24 18 L38 33 Z" fill="var(--logo-hill)"/>
  <path d="M2 33 C10 30 16 34 22 31 S32 30 38 33 L38 38 L2 38Z" fill="var(--logo-river)"/>
</svg>`;
