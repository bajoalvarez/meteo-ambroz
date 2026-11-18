// Motor de gráficos SVG: paneles apilados que comparten el eje X (meteogramas,
// series históricas, barras). Cada panel tiene su propia escala Y (nunca dos ejes
// en el mismo panel). Incluye cruceta y ficha emergente al pasar el ratón o el dedo.
import { wxBody } from './icons.js';

const fmtTick = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export function niceTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function pathFrom(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

function nearest(xs, v) {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - v) <= Math.abs(xs[hi] - v) ? lo : hi;
}

export function chart(el, cfg) {
  const state = { cfg, width: 0 };
  el.classList.add('chart');
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;

  function render() {
    const c = state.cfg;
    const W = Math.max(280, el.clientWidth || 600);
    state.width = W;
    const narrow = W < 520;
    const m = { l: c.marginLeft ?? (narrow ? 34 : 42), r: c.marginRight ?? 12, t: c.icons ? (narrow ? 30 : 36) : 10, b: c.noXAxis ? 6 : 24 };
    const gap = c.gap ?? 14;
    const panels = c.panels;
    const H = m.t + panels.reduce((s, p) => s + p.h, 0) + gap * (panels.length - 1) + m.b;
    const X = c.x;
    const n = X.length;
    if (!n) {
      el.innerHTML = '<p class="empty">Sin datos para este gráfico.</p>';
      return;
    }
    const hasBars = panels.some((p) => p.series.some((s) => s.type === 'bars'));
    const step = n > 1 ? (X[n - 1] - X[0]) / (n - 1) : 1;
    let x0 = c.xMin ?? X[0];
    let x1 = c.xMax ?? X[n - 1];
    if (hasBars && c.xMin == null) {
      x0 -= step / 2;
      x1 += step / 2;
    }
    if (x1 === x0) x1 = x0 + 1;
    const iw = W - m.l - m.r;
    const sx = (v) => m.l + ((v - x0) / (x1 - x0)) * iw;
    const barW = Math.max(1, (iw / ((x1 - x0) / step)) * (c.barFrac ?? 0.72));

    let svg = `<svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${c.label || 'Gráfico'}">`;
    const top = m.t;
    const bottom = H - m.b;

    // Franjas de fondo (noches, fines de semana…)
    for (const b of c.bands || []) {
      const a = Math.max(m.l, sx(b.x0));
      const z = Math.min(W - m.r, sx(b.x1));
      if (z > a) svg += `<rect class="${b.cls || 'band-bg'}" x="${a}" y="${top}" width="${z - a}" height="${bottom - top}"/>`;
    }
    // Rejilla vertical y etiquetas del eje X
    const xt = c.xTicks ? c.xTicks(x0, x1, iw) : [];
    for (const t of xt) {
      const px = sx(t.x);
      if (px < m.l - 1 || px > W - m.r + 1) continue;
      svg += `<line class="${t.major ? 'vgrid major' : 'vgrid'}" x1="${px}" x2="${px}" y1="${top}" y2="${bottom}"/>`;
      if (t.label && !c.noXAxis) svg += `<text class="xtick${t.major ? ' major' : ''}" x="${px + (t.offset || 0)}" y="${H - 7}" text-anchor="${t.anchor || 'middle'}">${t.label}</text>`;
    }

    const scales = [];
    let y = top;
    panels.forEach((p, pi) => {
      const vals = [];
      for (const s of p.series) {
        for (const k of ['y', 'lo', 'hi']) if (s[k]) for (const v of s[k]) if (v != null && Number.isFinite(v)) vals.push(v);
        if (s.type === 'hline' && s.value != null) vals.push(s.value);
      }
      let lo = p.min ?? (vals.length ? Math.min(...vals) : 0);
      let hi = p.max ?? (vals.length ? Math.max(...vals) : 1);
      if (p.minSpan && hi - lo < p.minSpan) {
        const mid = (hi + lo) / 2;
        lo = p.min ?? mid - p.minSpan / 2;
        hi = p.max != null ? p.max : lo + p.minSpan;
      }
      if (p.floor != null) lo = Math.min(lo, p.floor);
      const ticks = niceTicks(lo, hi, p.ticks ?? (p.h < 90 ? 2 : 4));
      if (p.min == null) lo = ticks[0];
      if (p.max == null) hi = ticks[ticks.length - 1];
      if (hi === lo) hi = lo + 1;
      const sy = (v) => y + p.h - ((v - lo) / (hi - lo)) * p.h;
      scales.push({ sy, y, h: p.h, lo, hi });

      for (const t of ticks) {
        if (t < lo - 1e-9 || t > hi + 1e-9) continue;
        const py = sy(t);
        svg += `<line class="grid${t === 0 && p.zero ? ' zero' : ''}" x1="${m.l}" x2="${W - m.r}" y1="${py}" y2="${py}"/>`;
        svg += `<text class="ytick" x="${m.l - 6}" y="${py + 3.5}" text-anchor="end">${p.fmt ? p.fmt(t) : fmtTick.format(t)}</text>`;
      }
      for (const s of p.series) {
        const cls = s.cls || '';
        if (s.type === 'band') {
          const up = [];
          const dn = [];
          const flush = () => {
            if (up.length > 1) svg += `<path class="band ${cls}" d="M${up.join('L')}L${dn.reverse().join('L')}Z"/>`;
            up.length = 0;
            dn.length = 0;
          };
          for (let i = 0; i < n; i++) {
            if (s.lo[i] == null || s.hi[i] == null) {
              flush();
              continue;
            }
            up.push(`${sx(X[i]).toFixed(1)} ${sy(s.hi[i]).toFixed(1)}`);
            dn.push(`${sx(X[i]).toFixed(1)} ${sy(s.lo[i]).toFixed(1)}`);
          }
          flush();
        } else if (s.type === 'area') {
          const base = sy(Math.max(lo, s.base ?? 0));
          let seg = [];
          const flush = () => {
            if (seg.length > 1) svg += `<path class="area ${cls}" d="M${seg[0][0]} ${base}L${seg.map((q) => q.join(' ')).join('L')}L${seg[seg.length - 1][0]} ${base}Z"/>`;
            seg = [];
          };
          for (let i = 0; i < n; i++) {
            if (s.y[i] == null) {
              flush();
              continue;
            }
            seg.push([sx(X[i]).toFixed(1), sy(s.y[i]).toFixed(1)]);
          }
          flush();
        } else if (s.type === 'line') {
          const pts = X.map((xv, i) => (s.y[i] == null ? null : [sx(xv), sy(s.y[i])]));
          const style = s.color ? ` style="stroke:${s.color}"` : '';
          svg += `<path class="line ${cls}" d="${pathFrom(pts)}"${style}${s.id ? ` data-id="${s.id}"` : ''}/>`;
          if (s.endDot) {
            let last = n - 1;
            while (last >= 0 && s.y[last] == null) last--;
            if (last >= 0) svg += `<circle class="enddot ${cls}" cx="${sx(X[last])}" cy="${sy(s.y[last])}" r="4"/>`;
          }
        } else if (s.type === 'bars') {
          const base = sy(Math.max(lo, Math.min(hi, s.base ?? 0)));
          for (let i = 0; i < n; i++) {
            const v = s.y[i];
            if (v == null || (v === 0 && !s.showZero)) continue;
            const py = sy(Math.max(lo, Math.min(hi, v)));
            const yTop = Math.min(py, base);
            const hgt = Math.max(v === 0 ? 0 : 1, Math.abs(base - py));
            const fill = s.colorFn ? ` style="fill:${s.colorFn(v, i)}"` : '';
            const r = Math.min(3, barW / 3);
            svg += `<rect class="bar ${cls}${s.clsFn ? ' ' + s.clsFn(v, i) : ''}" x="${(sx(X[i]) - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${hgt.toFixed(1)}" rx="${r.toFixed(1)}"${fill}/>`;
          }
        } else if (s.type === 'dots') {
          for (let i = 0; i < n; i++) {
            if (s.y[i] == null) continue;
            svg += `<circle class="dot ${cls}" cx="${sx(X[i]).toFixed(1)}" cy="${sy(s.y[i]).toFixed(1)}" r="${s.r || 3}"/>`;
          }
        } else if (s.type === 'arrows') {
          const every = s.every || 1;
          const ay = y + p.h - 9;
          for (let i = 0; i < n; i += every) {
            const d = s.dir[i];
            if (d == null) continue;
            const px = sx(X[i]);
            svg += `<g class="warrow" transform="translate(${px.toFixed(1)} ${ay}) rotate(${(d + 180) % 360})"><path d="M0 -6 L4 5 L0 2.6 L-4 5Z"/></g>`;
          }
        } else if (s.type === 'hline') {
          const py = sy(s.value);
          svg += `<line class="hline ${cls}" x1="${m.l}" x2="${W - m.r}" y1="${py}" y2="${py}"/>`;
          if (s.label) svg += `<text class="hlabel" x="${W - m.r - 4}" y="${py - 4}" text-anchor="end">${s.label}</text>`;
        }
      }
      if (p.label) svg += `<text class="plabel" x="${m.l + 4}" y="${y + 11}">${p.label}</text>`;
      y += p.h + gap;
    });

    // Iconos del tiempo sobre el primer panel
    if (c.icons) {
      const size = narrow ? 24 : 28;
      for (const k of c.icons.idx) {
        const px = sx(X[k]);
        if (px < m.l + size / 3 || px > W - m.r - size / 3) continue;
        const sc = size / 64;
        svg += `<g transform="translate(${(px - size / 2).toFixed(1)} 2) scale(${sc})">${wxBody(c.icons.sym[k], c.icons.day ? c.icons.day[k] : 1)}</g>`;
      }
    }
    // Marcas verticales (ahora, inicio de datos provisionales…)
    for (const mk of c.marks || []) {
      const px = sx(mk.x);
      if (px < m.l || px > W - m.r) continue;
      svg += `<line class="mark ${mk.cls || ''}" x1="${px}" x2="${px}" y1="${top}" y2="${bottom}"/>`;
      if (mk.label) svg += `<text class="mlabel" x="${px + 4}" y="${bottom - 5}">${mk.label}</text>`;
    }
    svg += `<g class="hover" visibility="hidden"><line class="xhair" y1="${top}" y2="${bottom}"/></g>`;
    svg += `<rect class="overlay" x="${m.l}" y="${top}" width="${iw}" height="${bottom - top}" fill="transparent"/>`;
    svg += '</svg>';
    el.innerHTML = svg;
    el.appendChild(tip);
    tip.hidden = true;

    if (!c.hover) return;
    const svgEl = el.firstElementChild;
    const hov = svgEl.querySelector('.hover');
    const xh = hov.querySelector('.xhair');
    const overlay = svgEl.querySelector('.overlay');
    const dotsFor = [];
    panels.forEach((p, pi) => {
      p.series.forEach((s) => {
        if (s.type === 'line' && !s.noHover) dotsFor.push({ s, sc: scales[pi] });
      });
    });
    const move = (ev) => {
      const r = svgEl.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const v = x0 + ((px - m.l) / iw) * (x1 - x0);
      const i = nearest(X, v);
      const html = c.hover(i);
      if (html == null) return;
      const cx = sx(X[i]);
      xh.setAttribute('x1', cx);
      xh.setAttribute('x2', cx);
      hov.querySelectorAll('circle').forEach((d) => d.remove());
      for (const { s, sc } of dotsFor) {
        if (s.y[i] == null) continue;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('class', `hdot ${s.cls || ''}`);
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', sc.sy(s.y[i]));
        dot.setAttribute('r', 4);
        if (s.color) dot.style.stroke = s.color;
        hov.appendChild(dot);
      }
      hov.setAttribute('visibility', 'visible');
      tip.innerHTML = html;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = cx + 14 + tw > W ? cx - 14 - tw : cx + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, top + 4)}px`;
    };
    const leave = () => {
      hov.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerdown', move);
    overlay.addEventListener('pointerleave', leave);
  }

  const ro = new ResizeObserver(() => {
    if (Math.abs((el.clientWidth || 0) - state.width) > 4) render();
  });
  ro.observe(el);
  render();
  return {
    update(next) {
      state.cfg = { ...state.cfg, ...next };
      render();
    },
    destroy() {
      ro.disconnect();
    },
  };
}

// Ejes de tiempo habituales -------------------------------------------------
const WD = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const HOUR = 3600e3;
const DAY = 24 * HOUR;

export function hourTicks(x0, x1, width) {
  const span = (x1 - x0) / HOUR;
  const out = [];
  const start = new Date(x0);
  start.setMinutes(0, 0, 0);
  const pxPerHour = width / span;
  const every = pxPerHour > 22 ? 3 : pxPerHour > 9 ? 6 : pxPerHour > 4 ? 12 : 24;
  for (let t = start.getTime(); t <= x1; t += HOUR) {
    const d = new Date(t);
    const hh = d.getHours();
    if (hh === 0) {
      const lbl = pxPerHour > 2.2 ? `${WD[d.getDay()]} ${d.getDate()}` : `${d.getDate()}`;
      out.push({ x: t, major: true, label: lbl, anchor: 'start', offset: 4 });
    } else if (every < 24 && hh % every === 0) {
      out.push({ x: t, label: pxPerHour > 9 ? `${hh}` : '' });
    }
  }
  return out;
}

export function dayTicks(x0, x1, width) {
  const out = [];
  const span = (x1 - x0) / DAY;
  const every = width / span > 46 ? 1 : width / span > 22 ? 2 : 7;
  const start = new Date(x0);
  start.setHours(0, 0, 0, 0);
  let k = 0;
  for (let t = start.getTime(); t <= x1 + 1; t += DAY) {
    const d = new Date(t);
    if (t >= x0 && k % every === 0) out.push({ x: t, label: `${d.getDate()} ${MS[d.getMonth()]}`, major: d.getDate() === 1 });
    k++;
  }
  return out;
}

export function yearTicks(x0, x1, width) {
  const out = [];
  const span = x1 - x0;
  const every = width / span > 14 ? 5 : width / span > 6 ? 10 : 20;
  for (let y = Math.ceil(x0); y <= x1; y++) if (y % every === 0) out.push({ x: y, label: String(y), major: y % (every * 2) === 0 });
  return out;
}

// Franjas de noche para un eje horario, a partir de is_day.
export function nightBands(X, isDay) {
  const bands = [];
  let start = null;
  for (let i = 0; i < X.length; i++) {
    if (!isDay[i] && start == null) start = X[i] - HOUR / 2;
    if (isDay[i] && start != null) {
      bands.push({ x0: start, x1: X[i] - HOUR / 2, cls: 'night' });
      start = null;
    }
  }
  if (start != null) bands.push({ x0: start, x1: X[X.length - 1] + HOUR / 2, cls: 'night' });
  return bands;
}

// Franjas de calentamiento (warming stripes) --------------------------------
export function stripes(el, items, colorFn, tipFn) {
  el.classList.add('chart');
  const draw = () => {
    const W = Math.max(280, el.clientWidth || 600);
    const H = el.dataset.height ? Number(el.dataset.height) : 64;
    const w = W / items.length;
    let svg = `<svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Franjas de temperatura anual">`;
    items.forEach((it, i) => {
      svg += `<rect x="${(i * w).toFixed(2)}" y="0" width="${(w + 0.6).toFixed(2)}" height="${H}" style="fill:${colorFn(it)}" data-i="${i}"/>`;
    });
    svg += '</svg>';
    el.innerHTML = svg;
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    el.appendChild(tip);
    const s = el.firstElementChild;
    s.addEventListener('pointermove', (ev) => {
      const r = s.getBoundingClientRect();
      const i = Math.max(0, Math.min(items.length - 1, Math.floor(((ev.clientX - r.left) / r.width) * items.length)));
      tip.innerHTML = tipFn(items[i]);
      tip.hidden = false;
      const px = (i + 0.5) * w;
      tip.style.left = `${px + 12 + tip.offsetWidth > W ? px - 12 - tip.offsetWidth : px + 12}px`;
      tip.style.top = '4px';
    });
    s.addEventListener('pointerleave', () => {
      tip.hidden = true;
    });
  };
  const ro = new ResizeObserver(draw);
  ro.observe(el);
  draw();
}

// Depósito para embalses: el agua sube hasta el % actual; marcas de hace un año y media.
export function tank(pct, lastYear, avg10, size = 120) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const H = size;
  const W = size * 0.82;
  const inner = H - 12;
  const yOf = (v) => 6 + inner - (inner * Math.max(0, Math.min(100, v))) / 100;
  const wy = yOf(p);
  // "hace 1 año" se rotula a la derecha y "media 10 años" a la izquierda para que no se pisen.
  const tick = (v, cls, label, left) =>
    v == null ? '' : `<line class="${cls}" x1="6" x2="${W - 6}" y1="${yOf(v)}" y2="${yOf(v)}"/><text class="tank-lbl" x="${left ? 9 : W - 9}" y="${yOf(v) + (left ? 10 : -3)}" text-anchor="${left ? 'start' : 'end'}">${label}</text>`;
  return `<svg class="tank" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Embalse al ${Math.round(p)} %">
    <rect class="tank-body" x="4" y="4" width="${W - 8}" height="${H - 8}" rx="10"/>
    <clipPath id="clip-${Math.round(p * 10)}-${size}"><rect x="6" y="6" width="${W - 12}" height="${inner}" rx="8"/></clipPath>
    <g clip-path="url(#clip-${Math.round(p * 10)}-${size})">
      <path class="tank-water" d="M6 ${wy} q ${(W - 12) / 4} -4 ${(W - 12) / 2} 0 t ${(W - 12) / 2} 0 V ${H} H 6 Z"/>
    </g>
    ${tick(lastYear, 'tank-ly', 'hace 1 año', false)}${tick(avg10, 'tank-avg', 'media 10 años', true)}
  </svg>`;
}
