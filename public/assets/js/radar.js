// Radar de precipitación: últimas 2 horas (RainViewer), extrapolación a 1 hora calculada aquí
// y mapas de lluvia prevista por el modelo AROME, todo con la misma escala de colores.
//
// Extrapolación: se compara el radar de hace 10 y 20 minutos con el actual para medir hacia
// dónde y a qué velocidad se mueve la lluvia (correlación cruzada), y se desplaza la imagen
// actual con ese movimiento para los próximos 60 minutos.

const API = 'https://api.rainviewer.com/public/weather-maps.json';
const Z = 7; // zoom máximo de la API gratuita de RainViewer
const TILE = 256;
const WORLD = TILE * 2 ** Z;
const KM_PX = 0.933; // tamaño de un píxel del zoom 7 a la latitud del valle

// Paleta "Universal Blue" de RainViewer para lluvia, de -10 a 74 dBZ (tabla oficial de colores).
const UB = ['63615914', '66635a19', '69665c1e', '6c685d24', '6f6b5f29', '726e612e', '75706234', '78736439', '7c75653e', '7f786744', '827b6949', '857d6a4e', '88806c54', '8b826d59', '8e856f5e', '92887164', '9e93756e', 'aa9e7978', 'b6a97e82', 'c2b4828c', 'cec08796', 'd2c48ba0', 'd6c88faa', 'dacc93b4', 'ded097be', '88ddeeff', '6cd1ebff', '51c5e8ff', '36bae5ff', '1baee2ff', '00a3e0ff', '009ad5ff', '0091caff', '0088bfff', '007fb4ff', '0077aaff', '0070a3ff', '00699cff', '006295ff', '005b8eff', '005588ff', '005180ff', '004e78ff', '004a70ff', '004768ff', 'ffee00ff', 'ffe000ff', 'ffd200ff', 'ffc500ff', 'ffb700ff', 'ffaa00ff', 'ff9f00ff', 'ff9500ff', 'ff8b00ff', 'ff8100ff', 'ff4400ff', 'f23600ff', 'e62800ff', 'd91b00ff', 'cd0d00ff', 'c10000ff', 'a80000ff', '8f0000ff', '760000ff', '5d0000ff', 'ffaaffff', 'ff9fffff', 'ff95ffff', 'ff8bffff', 'ff81ffff', 'ff77ffff', 'ff6cffff', 'ff62ffff', 'ff58ffff', 'ff4effff', 'ffffffff', 'ffffffff', 'ffffffff', 'ffffffff', 'ffffffff', 'ffffffff', 'ffffffff', 'ffffffff', 'ffffffff', 'ffffffff'].map((h) => [0, 2, 4, 6].map((k) => parseInt(h.slice(k, k + 2), 16)));

// La misma paleta para la nieve (la API marca así la precipitación sólida).
const UB_SNOW = ['cfffff00','ceffff0c','cdffff19','ccffff26','cbffff33','cbffff3f','caffff4c','c9ffff59','c8ffff66','c7ffff72','c7ffff7f','c6ffff8c','c5ffff99','c4ffffa5','c3ffffb2','c3ffffbf','c2ffffcc','c1ffffd8','c0ffffe5','bffffff2','bfffffff','b8f8ffff','b2f2ffff','abebffff','a5e5ffff','9fdfffff','98d8ffff','92d2ffff','8bcbffff','85c5ffff','7fbfffff','78b8ffff','72b2ffff','6babffff','65a5ffff','5f9fffff','5b9bffff','5898ffff','5595ffff','5292ffff','4f8fffff','4b8bffff','4888ffff','4585ffff','4282ffff','3f7fffff','3b7bffff','3878ffff','3575ffff','3272ffff','2f6fffff','2b6bffff','2868ffff','2565ffff','2262ffff','1f5fffff','1b5bffff','1858ffff','1555ffff','1252ffff','0f4fffff','0c4bffff','0948ffff','0645ffff','0242ffff','003fffff','003bffff','0038ffff','0035ffff','0032ffff','002fffff','002bffff','0028ffff','0025ffff','0022ffff','001fffff','001bffff','0018ffff','0015ffff','0012ffff','000fffff','000cffff','0009ffff','0006ffff','0002ffff'].map((h) => [0, 2, 4, 6].map((k) => parseInt(h.slice(k, k + 2), 16)));

export function dbzRGBA(dbz) {
  if (dbz == null || dbz < -10) return null;
  return UB[Math.min(UB.length - 1, Math.round(dbz) + 10)];
}
// Relación Z-R de Marshall-Palmer (Z = 200·R^1,6).
export const mmhToDbz = (r) => 10 * Math.log10(200 * r ** 1.6);
export const dbzToMmh = (d) => ((10 ** (d / 10)) / 200) ** (1 / 1.6);
export const RAIN_DBZ = 18; // ≈ 0,5 mm/h: por debajo suele ser llovizna, ruido o ecos no meteorológicos

export function dbzLabel(d) {
  if (d == null || d < RAIN_DBZ) return null;
  return intensityLabel(dbzToMmh(d));
}
export function intensityLabel(mmh) {
  if (mmh == null || mmh < 0.1) return 'sin lluvia';
  if (mmh <= 2) return 'débil';
  if (mmh <= 15) return 'moderada';
  if (mmh <= 30) return 'fuerte';
  if (mmh <= 60) return 'muy fuerte';
  return 'torrencial';
}

const lonToPx = (lon) => ((lon + 180) / 360) * WORLD;
const latToPx = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
};
const pxToLon = (x) => (x / WORLD) * 360 - 180;
const pxToLat = (y) => {
  const n = Math.PI - (2 * Math.PI * y) / WORLD;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    im.src = url;
  });
}

// Bloque de 3×3 teselas (unos 750 km de lado) centrado en el valle.
function makeBlock(lat, lon, size = 3) {
  const cx = Math.floor(lonToPx(lon) / TILE);
  const cy = Math.floor(latToPx(lat) / TILE);
  const tx0 = cx - Math.floor(size / 2);
  const ty0 = cy - Math.floor(size / 2);
  const px0 = tx0 * TILE;
  const py0 = ty0 * TILE;
  const N = size * TILE;
  return { tx0, ty0, size, px0, py0, N, bounds: [[pxToLat(py0 + N), pxToLon(px0)], [pxToLat(py0), pxToLon(px0 + N)]] };
}

async function composite(host, path, blk, options) {
  const c = document.createElement('canvas');
  c.width = blk.N;
  c.height = blk.N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let ok = 0;
  const jobs = [];
  for (let j = 0; j < blk.size; j++) {
    for (let i = 0; i < blk.size; i++) {
      const url = `${host}${path}/256/${Z}/${blk.tx0 + i}/${blk.ty0 + j}/2/${options}.png`;
      jobs.push(loadImg(url).then((im) => {
        ctx.drawImage(im, i * TILE, j * TILE);
        ok++;
      }).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  if (!ok) throw new Error('El radar no responde');
  return c;
}

// La API gratuita solo sirve la paleta "Universal Blue": cada color se traduce a dBZ buscando
// el más parecido de la tabla oficial (lluvia y nieve). Se usan teselas sin suavizar.
const LOOKUP = [];
UB.forEach((c, i) => { if (c[3] >= 10) LOOKUP.push([c[0], c[1], c[2], c[3], i - 10]); });
UB_SNOW.forEach((c, i) => { if (c[3] >= 10) LOOKUP.push([c[0], c[1], c[2], c[3], i - 10]); });
const memo = new Map();
function colorToDbz(r, g, b, a) {
  const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  let v = memo.get(key);
  if (v !== undefined) return v;
  let best = Infinity;
  v = -99;
  for (const [pr, pg, pb, pa, d] of LOOKUP) {
    const dist = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2 + 0.5 * (pa - a) ** 2;
    if (dist < best) {
      best = dist;
      v = d;
    }
  }
  memo.set(key, v);
  return v;
}

function dbzField(canvas) {
  const N = canvas.width;
  const px = canvas.getContext('2d').getImageData(0, 0, N, N).data;
  const out = new Float32Array(N * N);
  for (let k = 0, p = 0; k < out.length; k++, p += 4) {
    out[k] = px[p + 3] < 10 ? -99 : colorToDbz(px[p], px[p + 1], px[p + 2], px[p + 3]);
  }
  return out;
}

function coarse(field, N, f) {
  const M = N / f;
  const out = new Float32Array(M * M);
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) {
      let mx = -99;
      for (let j = 0; j < f; j++) {
        const row = (y * f + j) * N + x * f;
        for (let i = 0; i < f; i++) if (field[row + i] > mx) mx = field[row + i];
      }
      out[y * M + x] = Math.max(0, mx - 12);
    }
  }
  return out;
}

// Desplazamiento (en celdas) que mejor superpone A sobre B: correlación cruzada normalizada.
function motion(A, B, M, R) {
  const score = (dx, dy) => {
    let s = 0;
    let sa = 0;
    let sb = 0;
    const y0 = Math.max(0, -dy);
    const y1 = Math.min(M, M - dy);
    const x0 = Math.max(0, -dx);
    const x1 = Math.min(M, M - dx);
    for (let y = y0; y < y1; y++) {
      const ra = y * M;
      const rb = (y + dy) * M + dx;
      for (let x = x0; x < x1; x++) {
        const a = A[ra + x];
        const b = B[rb + x];
        if (!a && !b) continue;
        s += a * b;
        sa += a * a;
        sb += b * b;
      }
    }
    return sa && sb ? s / Math.sqrt(sa * sb) : 0;
  };
  let best = -1;
  let bx = 0;
  let by = 0;
  const grid = {};
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const v = score(dx, dy);
      grid[`${dx},${dy}`] = v;
      if (v > best) {
        best = v;
        bx = dx;
        by = dy;
      }
    }
  }
  const sub = (m, c, p) => {
    const den = m - 2 * c + p;
    return den ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den))) : 0;
  };
  const g = (dx, dy) => grid[`${dx},${dy}`] ?? best;
  return {
    dx: bx + sub(g(bx - 1, by), best, g(bx + 1, by)),
    dy: by + sub(g(bx, by - 1), best, g(bx, by + 1)),
    score: best,
  };
}

// Fracción de píxeles con lluvia en un círculo (vecindario que crece con el plazo)
// y reflectividad media (promediada en Z, no en dBZ).
function sampleDisk(field, N, cx, cy, r) {
  let hit = 0;
  let tot = 0;
  let mx = -99;
  let zsum = 0;
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const v = field[y * N + x];
      tot++;
      if (v >= RAIN_DBZ) hit++;
      if (v > mx) mx = v;
      if (v > -99) zsum += 10 ** (v / 10);
    }
  }
  return { frac: tot ? hit / tot : 0, max: mx, mean: zsum > 0 ? 10 * Math.log10(zsum / tot) : -99 };
}

export async function loadRadar(center, villages) {
  const meta = await fetch(API).then((r) => {
    if (!r.ok) throw new Error('Radar no disponible');
    return r.json();
  });
  const past = (meta.radar?.past || []).map((f) => ({ time: f.time * 1000, path: f.path }));
  if (past.length < 2) throw new Error('Radar sin imágenes');
  const blk = makeBlock(center[0], center[1]);
  const n = past.length;
  const last = past[n - 1];
  const p10 = past[Math.max(0, n - 2)];
  const p20 = past[Math.max(0, n - 3)];
  const [cLast, c10, c20, cDisp] = await Promise.all([
    composite(meta.host, last.path, blk, '0_1'),
    composite(meta.host, p10.path, blk, '0_1'),
    composite(meta.host, p20.path, blk, '0_1'),
    composite(meta.host, last.path, blk, '1_1'),
  ]);
  const N = blk.N;
  const fLast = dbzField(cLast);

  // Movimiento de la lluvia medido a 10 y 20 minutos y promediado según la calidad del ajuste.
  // Se ignoran los ecos que no se mueven nada (suelen ser ruido del relieve).
  const f = 4;
  const M = N / f;
  const B = coarse(fLast, N, f);
  const A1 = coarse(dbzField(c10), N, f);
  const A2 = coarse(dbzField(c20), N, f);
  const wet = B.reduce((acc, v) => acc + (v > 6 ? 1 : 0), 0);
  for (let k = 0; k < B.length; k++) {
    if (B[k] && A1[k] && A2[k] && Math.abs(A1[k] - B[k]) < 2 && Math.abs(A2[k] - B[k]) < 2) {
      A1[k] = 0;
      A2[k] = 0;
      B[k] = 0;
    }
  }
  let vx = 0;
  let vy = 0;
  let quality = 'sin ecos';
  if (wet >= 25) {
    const est = [];
    for (const [A, prev, R] of [[A1, p10, 8], [A2, p20, 14]]) {
      const dt = (last.time - prev.time) / 1000;
      if (dt <= 0) continue;
      const mv = motion(A, B, M, R);
      est.push({ vx: (mv.dx * f) / dt, vy: (mv.dy * f) / dt, w: Math.max(0.01, mv.score) * dt, score: mv.score });
    }
    const wsum = est.reduce((a, e) => a + e.w, 0);
    vx = est.reduce((a, e) => a + e.vx * e.w, 0) / wsum;
    vy = est.reduce((a, e) => a + e.vy * e.w, 0) / wsum;
    const spread = est.length > 1 ? Math.hypot(est[0].vx - est[1].vx, est[0].vy - est[1].vy) * 3600 * KM_PX : 0;
    const kmh = Math.hypot(vx, vy) * 3600 * KM_PX;
    quality = Math.min(...est.map((e) => e.score)) > 0.45 && spread < 35 ? 'buena' : 'baja';
    if (kmh >= 160) {
      vx = 0;
      vy = 0;
      quality = 'baja';
    }
  }
  const speedKmh = Math.hypot(vx, vy) * 3600 * KM_PX;
  const heading = (Math.atan2(vx, -vy) * 180) / Math.PI; // hacia dónde se mueve (0 = norte)

  // Imágenes de la próxima hora: la actual desplazada con el movimiento medido.
  const nowcast = [];
  for (let k = 1; k <= 6; k++) {
    const sec = k * 600;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const ctx = c.getContext('2d');
    ctx.globalAlpha = 1 - 0.05 * k;
    ctx.drawImage(cDisp, vx * sec, vy * sec);
    nowcast.push({ time: last.time + sec * 1000, url: c.toDataURL('image/png') });
  }

  // Lluvia en cada pueblo: ahora y en la próxima hora (advección hacia atrás).
  const at = {};
  for (const v of villages) {
    const X = lonToPx(v.lon) - blk.px0;
    const Y = latToPx(v.lat) - blk.py0;
    const now = sampleDisk(fLast, N, X, Y, 1.5);
    const raining = now.mean >= RAIN_DBZ || now.frac >= 0.5;
    let p = raining ? 1 : now.frac;
    let eta = raining ? 0 : null;
    let peak = now.mean;
    for (let k = 1; k <= 6; k++) {
      const sec = k * 600;
      const s = sampleDisk(fLast, N, X - vx * sec, Y - vy * sec, 1.5 + 1.5 * k);
      if (s.frac > p) p = s.frac;
      if (s.mean > peak) peak = s.mean;
      if (eta == null && s.frac >= 0.3) eta = k * 10;
    }
    at[v.id] = {
      nowDbz: now.mean, raining, nowLabel: raining ? dbzLabel(Math.max(now.mean, RAIN_DBZ)) : null,
      p1h: p, peakLabel: dbzLabel(peak), eta,
    };
  }
  return {
    past: past.map((fr) => ({ ...fr, url: `${meta.host}${fr.path}/256/{z}/{x}/{y}/2/1_1.png` })),
    nowcast, bounds: blk.bounds, lastTime: last.time, speedKmh, heading, quality, at,
  };
}

// Mapa de lluvia prevista por el modelo: interpolación bilineal de la rejilla y misma paleta.
export function modelFrameURL(grid, k, scale = 14) {
  const { nx, ny } = grid;
  const vals = grid.frames[k];
  const W = (nx - 1) * scale + 1;
  const H = (ny - 1) * scale + 1;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const v = (i, j) => vals[j * nx + i] || 0;
  for (let y = 0; y < H; y++) {
    const gy = (ny - 1) - y / scale; // la fila 0 de la rejilla es la más al sur
    const j0 = Math.min(ny - 2, Math.floor(gy));
    const fy = gy - j0;
    for (let x = 0; x < W; x++) {
      const gx = x / scale;
      const i0 = Math.min(nx - 2, Math.floor(gx));
      const fx = gx - i0;
      const r = (1 - fx) * (1 - fy) * v(i0, j0) + fx * (1 - fy) * v(i0 + 1, j0) + (1 - fx) * fy * v(i0, j0 + 1) + fx * fy * v(i0 + 1, j0 + 1);
      if (r < 0.1) continue;
      const col = dbzRGBA(mmhToDbz(r));
      if (!col) continue;
      const p = (y * W + x) * 4;
      img.data[p] = col[0];
      img.data[p + 1] = col[1];
      img.data[p + 2] = col[2];
      img.data[p + 3] = col[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function gridBounds(grid) {
  return [[grid.lat0, grid.lon0], [grid.lat0 + (grid.ny - 1) * grid.dlat, grid.lon0 + (grid.nx - 1) * grid.dlon]];
}

// Leyenda: colores para varias intensidades en mm/h.
export function legendStops() {
  return [0.2, 0.5, 1, 2, 5, 10, 20, 50].map((mmh) => {
    const c = dbzRGBA(mmhToDbz(mmh));
    return { mmh, css: c ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})` : 'transparent' };
  });
}
