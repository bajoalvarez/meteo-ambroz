// Meteo Ambroz · interfaz. Vistas: ahora, previsión, modelos, mapa, histórico, embalses y fuentes.
import {
  $, $$, esc, num, num1, num2, signed2, temp, temp1, mm, pct, kmh, signed, dayLabel, dateShort, dateLong, weekdayShort,
  hourLabel, ts, ago, agoIso, dirName, dirLong, skyFamily, tempColor, tempRGB, inkOn, anomColor, rainRGB,
  store, MONTHS, MONTHS_SHORT, cap, parseLocal,
} from './util.js';
import { wx, ui, windArrow, alertIcon } from './icons.js';
import { chart, hourTicks, dayTicks, yearTicks, nightBands, stripes, tank } from './charts.js';
import { createMap, fitValley, drawVillages, drawStations, drawReservoirs, addRadar, MAP_VARS } from './map.js';
import { loadRadar, modelFrameURL, gridBounds, legendStops } from './radar.js';

const VIEWS = {
  ahora: 'Ahora', prevision: 'Previsión', lluvia: 'Lluvia', modelos: 'Modelos', mapa: 'Mapa', historico: 'Histórico',
  embalses: 'Embalses', fuentes: 'Fuentes',
};
const VILLAGE_VIEWS = new Set(['ahora', 'prevision', 'lluvia', 'modelos', 'historico']);
const REFRESH_MS = 10 * 60 * 1000;

const state = {
  view: 'ahora', village: store('ma.village') || 'hervas', overview: null, data: {}, loadedAt: {},
  charts: [], maps: {}, range: store('ma.range') || '48h', histRange: 30, mapVar: 'now', day: 0,
};

// --- Datos -----------------------------------------------------------------
async function api(path, maxAge = REFRESH_MS) {
  const fresh = state.loadedAt[path] && Date.now() - state.loadedAt[path] < maxAge;
  if (fresh && state.data[path]) return state.data[path];
  const r = await fetch(`api/${path}`, { cache: 'no-store' });
  let body = null;
  try {
    body = await r.json();
  } catch (e) {
    body = null;
  }
  if (!r.ok || !body) throw new Error(body?.error || `No se pudo cargar ${path} (${r.status})`);
  state.data[path] = body;
  state.loadedAt[path] = Date.now();
  return body;
}

const villageItem = () => state.overview?.villages.find((x) => x.village.id === state.village) || state.overview?.villages[0];
const villages = () => state.overview?.villages.map((x) => x.village) || [];

// --- Esqueleto ---------------------------------------------------------------
function shell() {
  $('#tabs').innerHTML = Object.entries(VIEWS)
    .map(([id, label]) => `<a class="tab" href="#${id}" data-view="${id}" role="tab">${label}</a>`)
    .join('');
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store('ma.theme', next);
    $('#theme').innerHTML = ui(next === 'dark' ? 'sun' : 'moon', 18);
    render();
  });
  const theme = store('ma.theme');
  if (theme) document.documentElement.dataset.theme = theme;
  const isDark = (theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  $('#theme').innerHTML = ui(isDark ? 'sun' : 'moon', 18);
  $('#refresh').innerHTML = ui('refresh', 18);
  $('#refresh').addEventListener('click', async () => {
    state.loadedAt = {};
    await loadOverview(true);
    render();
  });
}

function renderChrome() {
  $$('#tabs .tab').forEach((t) => {
    const on = t.dataset.view === state.view;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', on);
    t.href = `#${t.dataset.view}${VILLAGE_VIEWS.has(t.dataset.view) ? `/${state.village}` : ''}`;
  });
  const chips = $('#villages');
  chips.hidden = !VILLAGE_VIEWS.has(state.view) || !state.overview;
  if (state.overview) {
    chips.innerHTML = state.overview.villages
      .map((it) => {
        const v = it.village;
        const n = it.now || {};
        return `<a class="vchip${v.id === state.village ? ' on' : ''}" href="#${state.view}/${v.id}" data-id="${v.id}">
          ${wx(n.sym, n.is_day, 22)}<span class="vchip-name">${esc(v.name)}</span><b>${temp(n.t)}</b></a>`;
      })
      .join('');
    const on = chips.querySelector('.on');
    if (on && !chips.hidden) {
      const cr = chips.getBoundingClientRect();
      const r = on.getBoundingClientRect();
      if (r.left < cr.left || r.right > cr.right) chips.scrollLeft += r.left - cr.left - 16;
    }
    const upd = villageItem()?.updated?.models;
    $('#updated').innerHTML = `${ui('refresh', 13)} Modelos ${ago(upd)}`;
  }
  renderAlerts();
}

function renderAlerts() {
  const box = $('#alerts');
  const items = state.overview?.warnings?.items || [];
  if (!items.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const fmt = (iso) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  };
  box.innerHTML = items
    .map((a) => `<div class="alert lvl-${a.level}" role="alert">
      <span class="alert-ic">${alertIcon(a.type, 18)}</span>
      <div class="alert-txt"><b>Aviso ${a.color} · ${esc(a.type_label)}</b> <span class="alert-when">${fmt(a.onset)} → ${fmt(a.expires)}</span>
      <span class="alert-desc">${esc(a.description || '')} <span class="alert-zone">Zona: Norte de Cáceres.</span></span></div>
      <a href="${esc(a.web)}" target="_blank" rel="noopener" aria-label="Ver el aviso en AEMET">AEMET ${ui('external', 13)}</a></div>`)
    .join('');
}

// --- Enrutado ---------------------------------------------------------------
function parseHash() {
  const [view, vid] = location.hash.replace('#', '').split('/');
  if (VIEWS[view]) state.view = view;
  else if (!location.hash) state.view = 'ahora';
  if (vid && villages().some((v) => v.id === vid)) state.village = vid;
  else if (vid && !state.overview) state.village = vid;
  store('ma.village', state.village);
}

function cleanup() {
  state.charts.forEach((c) => c.destroy && c.destroy());
  state.charts = [];
  Object.values(state.maps).forEach((m) => {
    m.radar?.stop?.();
    m.map.remove();
  });
  state.maps = {};
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  cleanup();
  renderChrome();
  const main = $('#view');
  main.dataset.view = state.view;
  document.title = `${VIEWS[state.view]} · Meteo Ambroz`;
  if (!state.overview) {
    main.innerHTML = loading('Reuniendo los modelos, AEMET y las estaciones…');
    return;
  }
  try {
    const fn = { ahora: viewNow, prevision: viewForecast, lluvia: viewRain, modelos: viewModels, mapa: viewMap, historico: viewHistory, embalses: viewWater, fuentes: viewSources }[state.view];
    await fn(main, () => token === renderToken);
  } catch (err) {
    if (token !== renderToken) return;
    main.innerHTML = errorBox(err);
  }
}

const loading = (msg) => `<div class="loading"><span class="spinner" aria-hidden="true"></span><p>${esc(msg)}</p></div>`;
const errorBox = (err) => `<div class="errorbox">${ui('alert', 22)}<div><b>No se pudieron cargar los datos.</b><p>${esc(err.message || err)}</p><p>Comprueba la conexión a internet. Si usas la versión local, comprueba también que el servidor sigue en marcha (<code>python3 server.py</code>).</p></div></div>`;

function keep(c) {
  state.charts.push(c);
  return c;
}

// --- Vista: Ahora -------------------------------------------------------------
async function viewNow(main, alive) {
  const it = villageItem();
  const v = it.village;
  const n = it.now;
  const d0 = it.days[0];
  const d1 = it.days[1];
  const sky = skyFamily(n.sym);
  const tend = n.pres_tendency ? `${n.pres_tendency.label} (${signed(n.pres_tendency.dp, 1)} en 3 h)` : '';
  const snowLine = d0.snow_level && (d0.prcp || 0) >= 1 ? `<div><dt>${ui('snow', 15)} Cota de nieve</dt><dd>${num(d0.snow_level, 0)} m</dd></div>` : '';
  main.innerHTML = `
  <div class="now-grid">
    <section class="hero sky-${sky} ${n.is_day ? 'day' : 'night'}" aria-label="Tiempo ahora en ${esc(v.name)}">
      <div class="hero-fx" aria-hidden="true"></div>
      <div class="hero-top">
        <div class="hero-place"><h1>${esc(v.name)}</h1><p>${num(v.elev, 0)} m · media de 10 modelos y AEMET · ${ago(it.updated?.models)}</p></div>
      </div>
      <div class="hero-now">
        <div class="hero-icon">${wx(n.sym, n.is_day, 132, 'anim')}</div>
        <div class="hero-temp">
          <span class="big">${temp(n.t)}</span>
          <span class="cond">${esc(n.label)}</span>
          <span class="feels">Sensación ${temp(n.feels)} · modelos entre ${temp(n.t_lo)} y ${temp(n.t_hi)}</span>
        </div>
      </div>
      <p class="hero-text">${esc(d0.text)}</p>
      <dl class="hero-stats">
        <div><dt>${ui('thermo', 15)} Hoy</dt><dd>${temp(d0.tmax)} <span class="sep">/</span> ${temp(d0.tmin)}</dd></div>
        <div><dt>${ui('wind', 15)} Viento</dt><dd>${windArrow(n.dir, 15)} ${num(n.wind, 0)} km/h ${n.dir_name || ''}<small>rachas de ${num(n.gust, 0)} km/h</small></dd></div>
        <div><dt>${ui('drop', 15)} Lluvia</dt><dd>${mm(d0.prcp)}<small>probabilidad ${pct(d0.pop)}</small></dd></div>
        <div><dt>${ui('humidity', 15)} Humedad</dt><dd>${num(n.rh, 0)} %</dd></div>
        <div><dt>${ui('gauge', 15)} Presión</dt><dd>${num(n.pres, 0)} hPa<small>${esc(tend)}</small></dd></div>
        <div><dt>${ui('sunrise', 15)} Sol</dt><dd>${d0.sunrise || '–'} <span class="sep">–</span> ${d0.sunset || '–'}</dd></div>
        ${snowLine}
      </dl>
    </section>

    <section class="card next24" aria-label="Próximas 24 horas">
      <header class="card-h"><h2>Próximas 24 horas</h2><a class="more" href="#prevision/${v.id}">Previsión completa →</a></header>
      <div class="hours" tabindex="0">${it.next24.map(hourCell).join('')}</div>
    </section>

    ${it.rain ? rainMiniHTML(it) : ''}

    <section class="card tomorrow">
      <header class="card-h"><h2>${dayLabel(d1.date, d1.k)}, ${dateShort(d1.date)}</h2><span class="conf conf-${d1.conf_label}">confianza ${d1.conf_label}</span></header>
      <div class="tomorrow-body">${wx(d1.sym, 1, 64)}<div><p class="tt">${temp(d1.tmax)} <span>/ ${temp(d1.tmin)}</span></p><p>${esc(d1.text)}</p></div></div>
      ${d1.aemet ? `<p class="aemet-line">${ui('info', 14)} AEMET: ${temp(d1.aemet.tmax)} / ${temp(d1.aemet.tmin)}, ${esc((d1.aemet.desc || '').toLowerCase())}, lluvia ${num(d1.aemet.prob, 0)} %</p>` : ''}
    </section>

    <section class="card valley">
      <header class="card-h"><h2>Los 8 pueblos</h2><span class="hint">Pulsa uno para verlo</span></header>
      <div class="valley-map" id="mini-map"></div>
      <ul class="vlist">${state.overview.villages.map(villageRow).join('')}</ul>
    </section>

    <section class="card stations" id="stations-card">
      <header class="card-h"><h2>Estaciones cercanas</h2><span class="hint">Observación real</span></header>
      <div id="stations-body">${loading('Leyendo estaciones…')}</div>
    </section>

    <section class="card efem" id="efem-card">
      <header class="card-h"><h2>Hoy en la historia</h2><a class="more" href="#historico/${v.id}">Histórico →</a></header>
      <div id="efem-body">${loading('Consultando 86 años de datos…')}</div>
    </section>
  </div>`;

  // Mapa compacto con la temperatura de cada pueblo
  const mm1 = createMap($('#mini-map'), { zoom: 10.5, onSelect: (id) => (location.hash = `#ahora/${id}`) });
  state.maps.mini = mm1;
  mm1.variable = 'now';
  drawVillages(mm1, state.overview, state.village);
  fitValley(mm1, villages().map((x) => [x.lat, x.lon]), 28);

  api('estaciones.json').then((obs) => {
    if (!alive()) return;
    $('#stations-body').innerHTML = stationsHTML(obs);
  }).catch((e) => alive() && ($('#stations-body').innerHTML = `<p class="muted">${esc(e.message)}</p>`));

  api(`history/${v.id}.json`, 30 * 60 * 1000).then((hist) => {
    if (!alive()) return;
    $('#efem-body').innerHTML = efemHTML(hist);
  }).catch((e) => alive() && ($('#efem-body').innerHTML = `<p class="muted">${esc(e.message)}</p>`));
}

function hourCell(hh) {
  const p = hh.pop ?? 0;
  return `<div class="hour">
    <span class="h-t">${hh.time.slice(11, 13)} h</span>
    ${wx(hh.sym, hh.is_day, 34)}
    <b>${temp(hh.t)}</b>
    <span class="h-p${p >= 0.5 ? ' wet' : ''}">${p >= 0.1 ? pct(p) : '&nbsp;'}</span>
    <span class="h-mm">${(hh.precip || 0) >= 0.1 ? num(hh.precip, 1) : '&nbsp;'}</span>
    <span class="h-w">${windArrow(hh.dir, 12)}${num(hh.wind, 0)}</span>
  </div>`;
}

function villageRow(it) {
  const v = it.village;
  const n = it.now || {};
  const d = it.days?.[0] || {};
  return `<li><a href="#ahora/${v.id}" class="${v.id === state.village ? 'on' : ''}">
    <span class="vl-name">${esc(v.name)}<small>${num(v.elev, 0)} m</small></span>
    ${wx(n.sym, n.is_day, 30)}
    <b class="vl-t">${temp(n.t)}</b>
    <span class="vl-mm">${temp(d.tmax)} / ${temp(d.tmin)}</span>
    <span class="vl-rain">${(d.prcp || 0) >= 0.5 ? mm(d.prcp) : ''}</span></a></li>`;
}

function stationsHTML(obs) {
  const a = obs.aemet;
  let out = '';
  if (a.has_key && a.rows?.length) {
    const last = a.rows[a.rows.length - 1];
    out += `<div class="official"><span class="badge">Oficial</span><b>${esc(a.station.name)}</b> · ${a.station.elev} m
      <div class="obs-row"><span>${temp1(last.ta)}</span><span>${num(last.hr, 0)} %</span><span>${num(last.pres, 0)} hPa</span><span>${kmh(last.vv)} (${kmh(last.vmax)})</span><span>lluvia ${mm(last.prec)}</span></div>
      <small>${new Date(last.time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</small></div>`;
  } else {
    out += `<div class="official muted"><span class="badge">Oficial</span><b>Hervás (AEMET 3504X)</b>, a 724 m.
      ${a.has_key ? 'Sin datos recientes.' : 'Para ver aquí sus datos horarios, arranca el servidor con una clave gratuita de AEMET OpenData.'}
      <a href="https://www.aemet.es/es/eltiempo/observacion/ultimosdatos?k=ext&l=3504X&w=0&datos=det&x=h24" target="_blank" rel="noopener">Ver en AEMET ${ui('external', 12)}</a></div>`;
  }
  const items = obs.meteoclimatic.items || [];
  if (!items.length) return `${out}<p class="muted">Ninguna estación de aficionados responde ahora mismo.</p>`;
  out += `<div class="table-wrap"><table class="obs"><thead><tr><th>Estación</th><th>km</th><th>Temp.</th><th>Hum.</th><th>Viento</th><th>Lluvia hoy</th></tr></thead><tbody>${items
    .map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name.replace(/ \((Cáceres|Salamanca)\)/, ''))}</a><small>${agoIso(s.updated)}</small></td>
      <td class="num">${num(s.km, 0)}</td><td class="num">${temp1(s.t)}</td><td class="num">${num(s.rh, 0)} %</td>
      <td class="num">${windArrow(s.wdir, 11)}${num(s.wind, 0)}<small>${s.gust != null ? ` · ${num(s.gust, 0)}` : ''}</small></td><td class="num">${mm(s.rain)}</td></tr>`)
    .join('')}</tbody></table></div><p class="foot">Red Meteoclimatic. No hay estaciones de aficionados dentro del valle; estas son las más próximas (La Vera, Tiétar, Hurdes y Sierra de Francia).</p>`;
  return out;
}

function efemHTML(hist) {
  const s = hist.summary;
  if (!s) return `<p class="muted">La serie histórica se está descargando. ${esc(hist.progress?.state || '')}</p>`;
  const t = s.today;
  const ly = t.last_year;
  const d = parseLocal(t.date);
  return `<p class="efem-date">${d.getDate()} de ${MONTHS[d.getMonth()]} · ${t.years} años de registros (1940–${s.coverage.to.slice(0, 4)})</p>
  <div class="efem-grid">
    <div><span>Lo normal</span><b>${temp(t.normal.tmax)} / ${temp(t.normal.tmin)}</b></div>
    <div><span>Récord de calor</span><b>${temp1(t.tmax?.value)}</b><small>${t.tmax?.date.slice(0, 4)}</small></div>
    <div><span>Récord de frío</span><b>${temp1(t.tmin?.value)}</b><small>${t.tmin?.date.slice(0, 4)}</small></div>
    <div><span>Más lluvia</span><b>${mm(t.prcp?.value)}</b><small>${t.prcp?.date.slice(0, 4)}</small></div>
    ${ly ? `<div><span>Hace un año</span><b>${temp(ly.tmax)} / ${temp(ly.tmin)}</b><small>${mm(ly.prcp)}</small></div>` : ''}
  </div>
  <p class="foot">Reanálisis ERA5 ajustado a la altitud de ${esc(hist.village.name)}.</p>`;
}

// --- Vista: Previsión -----------------------------------------------------------
async function viewForecast(main, alive) {
  main.innerHTML = loading('Calculando la media ponderada…');
  const vd = await api(`village/${state.village}.json`);
  if (!alive()) return;
  const days = vd.daily;
  if (state.day >= days.length) state.day = 0;
  main.innerHTML = `
    <section class="section-head">
      <h1>Previsión para ${esc(vd.village.name)} <small>${num(vd.village.elev, 0)} m</small></h1>
      <p>Media ponderada de ${vd.weights.length} modelos, 143 escenarios de conjuntos y la predicción oficial de AEMET. Pulsa un día para ver el detalle.</p>
    </section>
    <div class="days" role="list">${days.map(dayCard).join('')}</div>
    <section class="card" id="day-detail"></section>
    <section class="card">
      <header class="card-h"><h2>Meteograma</h2>
        <div class="seg" role="tablist" id="range">
          ${[['48h', '48 horas'], ['7d', '7 días'], ['16d', '16 días']].map(([k, l]) => `<button role="tab" data-r="${k}" class="${state.range === k ? 'on' : ''}">${l}</button>`).join('')}
        </div></header>
      <div class="legend">
        <span><i class="lg line-temp"></i>Temperatura (media)</span><span><i class="lg band-model"></i>Rango entre modelos</span>
        <span><i class="lg line-feels"></i>Sensación</span><span><i class="lg bar-rain"></i>Lluvia (mm/h)</span>
        <span><i class="lg line-wind"></i>Viento</span><span><i class="lg line-gust"></i>Rachas</span>
      </div>
      <div id="meteogram"></div>
    </section>`;
  $$('.daycard', main).forEach((el) => el.addEventListener('click', () => {
    state.day = Number(el.dataset.k);
    $$('.daycard', main).forEach((x) => x.classList.toggle('on', x === el));
    renderDayDetail(vd);
  }));
  $$('#range button').forEach((b) => b.addEventListener('click', () => {
    state.range = b.dataset.r;
    store('ma.range', state.range);
    $$('#range button').forEach((x) => x.classList.toggle('on', x === b));
    drawMeteogram(vd);
  }));
  renderDayDetail(vd);
  drawMeteogram(vd);
}

function dayCard(d, i) {
  const an = d.normal_tmax != null ? d.tmax - d.normal_tmax : null;
  const anTxt = an != null && Math.abs(an) >= 2 ? `<span class="anom ${an > 0 ? 'warm' : 'cold'}" title="Respecto a la máxima normal">${signed(an)}°</span>` : '';
  const rainW = Math.round((d.pop || 0) * 100);
  return `<button class="daycard${i === state.day ? ' on' : ''}${i > 9 ? ' far' : ''}" data-k="${i}" role="listitem">
    <span class="dc-day">${dayLabel(d.date, d.k)}</span><span class="dc-date">${dateShort(d.date)}</span>
    ${wx(d.sym, 1, 46)}
    <span class="dc-t"><b>${temp(d.tmax)}</b> <span>${temp(d.tmin)}</span> ${anTxt}</span>
    <span class="dc-rain"><span class="pbar"><i style="width:${rainW}%"></i></span>${pct(d.pop)}<small>${(d.prcp || 0) >= 0.5 ? mm(d.prcp) : ''}</small></span>
    <span class="dc-wind">${ui('wind', 12)} ${num(d.gust, 0)}</span>
    <span class="dc-conf conf-${d.conf_label}" title="Confianza ${d.conf_label}"></span>
  </button>`;
}

function renderDayDetail(vd) {
  const d = vd.daily[state.day];
  const box = $('#day-detail');
  const pp = d.pop_parts || {};
  const a = d.aemet;
  const e = d.ens;
  box.innerHTML = `
    <header class="card-h"><h2>${dayLabel(d.date, d.k)} ${dateLong(d.date).replace(/ de \d{4}$/, '')}</h2><span class="conf conf-${d.conf_label}">confianza ${d.conf_label}</span></header>
    <div class="detail">
      <div class="detail-main">
        ${wx(d.sym, 1, 84)}
        <div><p class="tt">${temp(d.tmax)} <span>/ ${temp(d.tmin)}</span></p><p class="lbl">${esc(d.label)}</p>
        <p>${esc(d.text)}</p></div>
      </div>
      <div class="parts">${(d.parts || []).map((p) => `<div class="part"><span>${cap(p.name)}</span>${wx(p.sym, p.name === 'noche' || p.name === 'madrugada' ? 0 : 1, 38)}<b>${temp(p.t)}</b><small>${(p.prcp || 0) >= 0.1 ? mm(p.prcp) : 'seco'}</small></div>`).join('')}</div>
      <dl class="facts">
        <div><dt>Máxima entre modelos</dt><dd>${temp(d.tmax_lo)} a ${temp(d.tmax_hi)}</dd></div>
        <div><dt>Mínima entre modelos</dt><dd>${temp(d.tmin_lo)} a ${temp(d.tmin_hi)}</dd></div>
        <div><dt>Lo normal (1991-2020)</dt><dd>${temp(d.normal_tmax)} / ${temp(d.normal_tmin)}</dd></div>
        <div><dt>Lluvia</dt><dd>${mm(d.prcp)} <small>(modelos: ${mm(d.prcp_lo)} a ${mm(d.prcp_hi)})</small></dd></div>
        <div><dt>Probabilidad de lluvia</dt><dd>${pct(d.pop)} <small>modelos ${pct(pp.models)} · conjuntos ${pct(pp.ensemble)} · AEMET ${pct(pp.aemet)}</small></dd></div>
        ${e ? `<div><dt>Conjuntos (${e.members} escenarios)</dt><dd>${mm(e.p50)} probable, hasta ${mm(e.p90)} <small>≥10 mm: ${pct(e.pop10)}</small></dd></div>` : ''}
        <div><dt>Viento</dt><dd>${num(d.wind, 0)} km/h del ${dirLong(d.dir)}, rachas ${num(d.gust, 0)} km/h</dd></div>
        ${d.snow_level ? `<div><dt>Cota de nieve</dt><dd>${num(d.snow_level, 0)} m</dd></div>` : ''}
        <div><dt>Sol</dt><dd>${d.sunrise || '–'} – ${d.sunset || '–'}${d.uv != null ? ` · UV ${num(d.uv, 0)}` : ''}</dd></div>
        <div><dt>Modelos con datos</dt><dd>${d.n_models} de ${vd.weights.length}</dd></div>
      </dl>
      ${a ? `<div class="aemet-box"><span class="badge">AEMET</span>${wx(a.sym, 1, 34)}<div><b>${temp(a.tmax)} / ${temp(a.tmin)}</b> · ${esc(a.desc || '')}<br><small>Lluvia ${num(a.prob, 0)} %${a.racha ? ` · rachas ${num(a.racha, 0)} km/h` : ''}${a.cota ? ` · cota de nieve ${num(a.cota, 0)} m` : ''}</small></div></div>` : '<p class="muted small">AEMET publica 7 días; más allá solo hay modelos.</p>'}
    </div>`;
}

function rangeSlice(vd) {
  const Hh = vd.hourly;
  const n = Hh.time.length;
  let a = 0;
  let b = n - 1;
  if (state.range === '48h') {
    a = Math.max(0, vd.i_now - 2);
    b = Math.min(n - 1, vd.i_now + 48);
  } else if (state.range === '7d') {
    a = 0;
    b = Math.min(n - 1, 24 * 7 - 1);
  }
  return [a, b];
}

function drawMeteogram(vd) {
  const Hh = vd.hourly;
  const [a, b] = rangeSlice(vd);
  const sl = (arr) => arr.slice(a, b + 1);
  const X = sl(Hh.time).map(ts);
  const want = state.range === '48h' ? (hh) => hh % 3 === 0 : state.range === '7d' ? (hh) => hh % 6 === 3 : (hh) => hh === 13;
  const idx = [];
  for (let i = 0; i < X.length; i++) if (want(Number(Hh.time[a + i].slice(11, 13)))) idx.push(i);
  const icons = { idx, sym: sl(Hh.sym), day: sl(Hh.is_day) };
  const rainFill = (v) => {
    const c = rainRGB(v);
    return c ? `rgb(${c.join(',')})` : 'transparent';
  };
  const el = $('#meteogram');
  const old = state.charts.find((x) => x.el === el);
  if (old) {
    old.destroy();
    state.charts = state.charts.filter((x) => x !== old);
  }
  const c = chart(el, {
    label: 'Meteograma',
    x: X, icons, bands: nightBands(X, sl(Hh.is_day)), xTicks: hourTicks,
    marks: [{ x: ts(Hh.time[vd.i_now]), label: 'ahora', cls: 'now' }],
    panels: [
      { h: 150, label: 'Temperatura °C', fmt: (v) => `${v}°`, series: [
        { type: 'band', lo: sl(Hh.t_lo), hi: sl(Hh.t_hi), cls: 'band-model' },
        { type: 'line', y: sl(Hh.feels), cls: 'line-feels', noHover: true },
        { type: 'line', y: sl(Hh.t), cls: 'line-temp' },
      ] },
      { h: 80, label: 'Lluvia mm/h', min: 0, minSpan: 1, series: [{ type: 'bars', y: sl(Hh.precip), cls: 'bar-rain', colorFn: rainFill }] },
      { h: 46, label: 'Prob. %', min: 0, max: 100, ticks: 1, series: [{ type: 'area', y: sl(Hh.pop).map((p) => (p == null ? null : p * 100)), cls: 'area-pop' }] },
      { h: 92, label: 'Viento km/h', min: 0, series: [
        { type: 'line', y: sl(Hh.gust), cls: 'line-gust' },
        { type: 'line', y: sl(Hh.wind), cls: 'line-wind' },
        { type: 'arrows', dir: sl(Hh.dir), every: state.range === '48h' ? 3 : state.range === '7d' ? 6 : 12 },
      ] },
      { h: 64, label: 'Presión hPa', ticks: 2, series: [{ type: 'line', y: sl(Hh.pres), cls: 'line-pres' }] },
    ],
    hover: (i) => {
      const k = a + i;
      const t = Hh.time[k];
      const d = parseLocal(t);
      return `<div class="tip-h">${wx(Hh.sym[k], Hh.is_day[k], 26)}<b>${cap(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }))}, ${t.slice(11, 16)}</b></div>
        <div class="tip-g"><span>Temperatura</span><b>${temp1(Hh.t[k])}</b>
        <span>Entre modelos</span><b>${temp(Hh.t_lo[k])} a ${temp(Hh.t_hi[k])}</b>
        <span>Sensación</span><b>${temp(Hh.feels[k])}</b>
        <span>Lluvia</span><b>${num(Hh.precip[k], 1)} mm · ${pct(Hh.pop[k])}</b>
        <span>Viento</span><b>${num(Hh.wind[k], 0)} km/h ${dirName(Hh.dir[k])}</b>
        <span>Rachas</span><b>${num(Hh.gust[k], 0)} km/h</b>
        <span>Nubes · humedad</span><b>${num(Hh.cloud[k], 0)} % · ${num(Hh.rh[k], 0)} %</b>
        <span>Presión</span><b>${num(Hh.pres[k], 0)} hPa</b></div>`;
    },
  });
  c.el = el;
  keep(c);
}

// --- Vista: ¿Lloverá? ------------------------------------------------------------
const MAD = 'Europe/Madrid';
const WIN_LABEL = { 1: 'Próxima hora', 6: 'Próximas 6 horas', 12: 'Próximas 12 horas', 24: 'Próximas 24 horas' };
const WIN_SHORT = { 1: '1 hora', 6: '6 horas', 12: '12 horas', 24: '24 horas' };
const popWord = (p) => (p == null ? '–' : p >= 0.85 ? 'Casi segura' : p >= 0.6 ? 'Probable' : p >= 0.35 ? 'Posible' : p >= 0.15 ? 'Poco probable' : 'No se espera');
const hhmm = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: MAD });
const madridMs = (s, off) => {
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, dd, hh, mi || 0) - off * 1000;
};

function nextDay(dateStr) {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "2026-11-19T03:00" → "mañana a las 03:00"
function whenText(s, today) {
  if (!s) return '';
  const day = s.slice(0, 10);
  const hour = s.slice(11, 16);
  if (day === today) return `las ${hour}`;
  if (day === nextDay(today)) return `mañana a las ${hour}`;
  return `el ${weekday(day)} a las ${hour}`;
}

function timingText(tm, today) {
  if (!tm) return '';
  const out = [];
  if (tm.state === 'lloviendo') out.push(tm.until ? `Los modelos dan lluvia hasta ${whenText(tm.until, today)}` : 'Los modelos dan lluvia durante las próximas 48 horas');
  else if (tm.from) out.push(`Los modelos prevén lluvia a partir de ${whenText(tm.from, today)}`);
  else out.push('Los modelos no prevén lluvia en las próximas 48 horas');
  if (tm.peak) out.push(`lo más intenso, hacia ${whenText(tm.peak.time, today)} (${mm(tm.peak.mm)} en una hora, ${tm.peak.intensity})`);
  return `${out.join('; ')}.`;
}

function rainMiniHTML(it) {
  const today = it.next24?.[0]?.time?.slice(0, 10) || '';
  return `<section class="card rain-mini">
    <header class="card-h"><h2>¿Lloverá?</h2><a class="more" href="#lluvia/${it.village.id}">Radar y detalle →</a></header>
    <div class="rmini">${it.rain.windows.map((w) => `<div class="rmw${(w.pop || 0) >= 0.55 ? ' hi' : ''}" style="--p:${Math.round((w.pop || 0) * 100)}">
      <span>${WIN_SHORT[w.hours]}</span><b>${pct(w.pop)}</b><small>${(w.mm || 0) >= 0.1 ? mm(w.mm) : 'seco'}</small></div>`).join('')}</div>
    <p class="rmini-txt">${esc(timingText(it.rain.timing, today))}</p>
  </section>`;
}

function combined1h(w, rv) {
  if (!rv || w.hours !== 1) return w.pop;
  const p = 0.6 * rv.p1h + 0.4 * (w.pop || 0);
  return rv.raining ? Math.max(0.95, p) : p; // si ya llueve, lloverá en la próxima hora
}

function winTile(w, rv) {
  const p = combined1h(w, rv);
  const parts = [`modelos ${pct(w.parts.models)}`, `conjuntos ${pct(w.parts.ensemble)}`, `AEMET ${pct(w.parts.aemet)}`];
  if (w.hours === 1 && rv) parts.unshift(`radar ${pct(rv.p1h)}`);
  const range = w.mm_hi != null && w.mm_hi >= 0.5 ? `<small class="rw-range">entre modelos: ${mm(w.mm_lo)} a ${mm(w.mm_hi)}</small>` : '';
  return `<div class="rwin${(p || 0) >= 0.55 ? ' hi' : ''}" style="--p:${Math.round((p || 0) * 100)}">
    <span class="rw-label">${WIN_LABEL[w.hours]}</span>
    <b class="rw-p">${pct(p)}</b>
    <span class="rw-word">${popWord(p)}</span>
    <span class="rw-mm">${(w.mm || 0) >= 0.05 ? mm(w.mm) : 'Sin lluvia'}${(w.peak || 0) >= 0.1 ? ` · ${w.intensity}` : ''}</span>
    ${range}
    <small class="rw-parts">${parts.join(' · ')}</small>
  </div>`;
}

function rainStatusHTML(it, R, today) {
  const rv = R?.at?.[it.village.id];
  let icon = wx(it.now.sym, it.now.is_day, 64);
  let head;
  const sub = [];
  if (rv) {
    if (rv.raining) {
      head = `Está lloviendo en ${esc(it.village.name)}${rv.nowLabel ? ` (${rv.nowLabel})` : ''}`;
      icon = wx(rv.nowLabel === 'débil' ? 'lluvia-debil' : rv.nowLabel === 'moderada' ? 'lluvia' : 'lluvia-fuerte', it.now.is_day, 64);
    } else if (rv.eta != null) {
      head = `Ahora no llueve. Según el radar, la lluvia llegará en unos ${rv.eta} minutos`;
    } else {
      head = `Ahora no llueve en ${esc(it.village.name)}`;
    }
    sub.push(`Radar de las ${hhmm(R.lastTime)}${R.quality !== 'sin ecos' && R.speedKmh >= 3 ? `; la lluvia se mueve hacia el ${dirLong(R.heading)} a unos ${Math.round(R.speedKmh)} km/h` : ''}.`);
  } else {
    head = it.rain.timing.state === 'lloviendo' ? `Los modelos dan lluvia ahora en ${esc(it.village.name)}` : `Los modelos no dan lluvia ahora en ${esc(it.village.name)}`;
  }
  sub.push(timingText(it.rain.timing, today));
  return `${icon}<div><p class="rs-head">${head}</p>${sub.map((t) => `<p class="rs-sub">${esc(t)}</p>`).join('')}</div>`;
}

function rainTableHTML(data, R) {
  const rows = data.villages.filter((x) => !x.error).map((x) => {
    const rv = R?.at?.[x.village.id];
    const radar = R ? (rv?.raining ? `<span class="rchip on">${esc(rv.nowLabel || 'lluvia')}</span>` : rv?.eta != null ? `<span class="rchip near">en ${rv.eta} min</span>` : '<span class="rchip">no</span>') : '<span class="muted">…</span>';
    const cells = x.rain.windows.map((w) => {
      const p = combined1h(w, rv);
      return `<td class="pc${(p || 0) >= 0.55 ? ' hi' : ''}" style="--p:${Math.round((p || 0) * 100)}">${pct(p)}<small>${(w.mm || 0) >= 0.1 ? mm(w.mm) : ''}</small></td>`;
    }).join('');
    return `<tr class="${x.village.id === state.village ? 'on' : ''}"><td><a href="#lluvia/${x.village.id}">${esc(x.village.name)}</a><small>${num(x.village.elev, 0)} m</small></td><td>${radar}</td>${cells}</tr>`;
  }).join('');
  return `<thead><tr><th>Pueblo</th><th>Radar ahora</th><th>1 hora</th><th>6 horas</th><th>12 horas</th><th>24 horas</th></tr></thead><tbody>${rows}</tbody>`;
}

async function viewRain(main, alive) {
  main.innerHTML = loading('Mirando el radar y los modelos…');
  const data = await api('lluvia.json', 5 * 60 * 1000);
  if (!alive()) return;
  const it = data.villages.find((x) => x.village.id === state.village && !x.error) || data.villages.find((x) => !x.error);
  const v = it.village;
  const today = data.now.slice(0, 10);
  const grid = data.grid;
  main.innerHTML = `
    <section class="section-head"><h1>¿Va a llover en ${esc(v.name)}?</h1>
      <p>El radar de las dos últimas horas, su extrapolación para la próxima hora y la lluvia que prevén los modelos hasta dentro de 24 horas.</p></section>
    <section class="card rain-top">
      <div class="rain-status" id="rain-status">${rainStatusHTML(it, null, today)}</div>
      <div class="rain-wins" id="rain-wins">${it.rain.windows.map((w) => winTile(w, null)).join('')}</div>
      <p class="foot">Cuenta como lluvia: al menos 0,1 mm en una hora, 0,2 mm en 6 horas, 0,3 mm en 12 horas o 0,5 mm en 24 horas.
      La probabilidad combina los 10 modelos, los 143 escenarios de los conjuntos y AEMET; en la próxima hora pesa además el radar (60 %).</p>
    </section>
    <section class="card">
      <header class="card-h"><h2>Radar y lluvia prevista</h2><span class="hint" id="rmove">Cargando el radar…</span></header>
      <div class="rain-tools">
        <button class="icon-btn" id="rplay" type="button" aria-label="Reproducir la animación" disabled>${ui('play', 16)}</button>
        <div class="rtrack">
          <input type="range" id="rslider" min="0" max="0" value="0" aria-label="Momento del mapa" disabled>
          <div class="segbar" id="segbar"></div>
        </div>
        <span class="rtime" id="rtime">–</span>
      </div>
      <div id="rain-map" class="rain-map"></div>
      <div class="rain-legend"><span class="muted">Intensidad</span>${legendStops().map((st) => `<span><i style="background:${st.css}"></i>${num(st.mmh)}</span>`).join('')}<span class="muted">mm/h</span></div>
      <p class="foot">Pasado y presente: mosaico de radares de RainViewer (imágenes cada 10 minutos). Próxima hora: la imagen actual desplazada según el movimiento medido en los últimos 20 minutos; no prevé lluvia que se forme o se deshaga. Desde la segunda hora: lluvia prevista por ${esc(data.model)} en una rejilla de 10 km (recuadro discontinuo).</p>
    </section>
    <section class="card">
      <header class="card-h"><h2>Cuánto y cuándo en ${esc(v.name)}</h2><span class="hint">Pasa el dedo o el ratón por las barras</span></header>
      <h3 class="sub tight">Próximas horas, cada 15 minutos (AROME)</h3>
      <div id="q15-chart"></div>
      <h3 class="sub tight">Próximas 24 horas (media de los modelos)</h3>
      <div id="h24-chart"></div>
    </section>
    <section class="card">
      <header class="card-h"><h2>Los 8 pueblos</h2><span class="hint">Probabilidad de lluvia y cantidad prevista</span></header>
      <div class="table-wrap"><table class="rain-table" id="rain-table">${rainTableHTML(data, null)}</table></div>
    </section>`;

  // Gráficos de cantidad
  const q = it.q15;
  if (q.time.length) {
    keep(chart($('#q15-chart'), {
      x: q.time.map(ts), xTicks: hourTicks,
      panels: [{ h: 110, label: 'mm en 15 min', min: 0, minSpan: 0.5, series: [{ type: 'bars', y: q.mm, cls: 'bar-rain' }] }],
      hover: (i) => `<div class="tip-h"><b>${q.time[i].slice(11, 16)}</b></div><div class="tip-g"><span>Lluvia en 15 min</span><b>${mm(q.mm[i])}</b><span>Ritmo</span><b>${num((q.mm[i] || 0) * 4, 1)} mm/h</b></div>`,
    }));
  } else {
    $('#q15-chart').innerHTML = '<p class="muted">Sin datos cada 15 minutos ahora mismo.</p>';
  }
  const n24 = it.next24;
  keep(chart($('#h24-chart'), {
    x: n24.time.map(ts), xTicks: hourTicks,
    icons: { idx: n24.time.map((_, i) => i).filter((i) => i % 3 === 0), sym: n24.sym, day: n24.is_day },
    panels: [
      { h: 110, label: 'Lluvia mm/h', min: 0, minSpan: 1, series: [{ type: 'bars', y: n24.precip, cls: 'bar-rain' }, { type: 'dots', y: n24.hi, cls: 'dot-normal', r: 2.5 }] },
      { h: 60, label: 'Probabilidad %', min: 0, max: 100, ticks: 2, series: [{ type: 'area', y: n24.pop.map((p) => (p == null ? null : p * 100)), cls: 'area-pop' }] },
    ],
    hover: (i) => `<div class="tip-h">${wx(n24.sym[i], n24.is_day[i], 24)}<b>${n24.time[i].slice(11, 16)}</b></div><div class="tip-g"><span>Lluvia (media)</span><b>${mm(n24.precip[i])}</b><span>Máximo entre modelos</span><b>${mm(n24.hi[i])}</b><span>Probabilidad</span><b>${pct(n24.pop[i])}</b></div>`,
  }));

  // Mapa con la línea de tiempo
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const ctl = createMap($('#rain-map'), { zoom: 9, base: dark ? 'Oscuro' : 'Callejero' });
  state.maps.rain = ctl;
  for (const x of villages()) {
    const icon = L.divIcon({ className: 'rlabel-wrap', html: `<span class="rlabel${x.id === state.village ? ' sel' : ''}"><i></i>${esc(x.name)}</span>`, iconSize: null });
    L.marker([x.lat, x.lon], { icon, keyboard: false, interactive: false, zIndexOffset: x.id === state.village ? 600 : 500 }).addTo(ctl.map);
  }
  const gb = gridBounds(grid);
  requestAnimationFrame(() => {
    ctl.map.invalidateSize();
    ctl.map.fitBounds(gb, { padding: [8, 8] });
  });
  const area = L.rectangle(gb, { color: 'currentColor', weight: 1.2, dashArray: '5 5', fill: false, interactive: false, className: 'grid-box' });

  let R = null;
  try {
    R = await loadRadar([40.272, -5.9], villages());
  } catch (err) {
    if (!alive()) return;
    $('#rmove').textContent = 'Radar no disponible ahora mismo; se muestran solo los modelos.';
  }
  if (!alive()) return;
  if (R) {
    $('#rain-status').innerHTML = rainStatusHTML(it, R, today);
    $('#rain-wins').innerHTML = it.rain.windows.map((w) => winTile(w, R.at[it.village.id])).join('');
    $('#rain-table').innerHTML = rainTableHTML(data, R);
    $('#rmove').textContent = R.quality === 'sin ecos' ? 'El radar no ve lluvia en la zona.' : `Lluvia moviéndose hacia el ${dirLong(R.heading)} a ${Math.round(R.speedKmh)} km/h`;
  }

  const frames = [];
  if (R) {
    R.past.forEach((f) => frames.push({ kind: 'radar', time: f.time, make: () => L.tileLayer(f.url, { opacity: 0, zIndex: 400, maxNativeZoom: 7, maxZoom: 18, attribution: 'Radar © <a href="https://www.rainviewer.com/">RainViewer</a>' }) }));
    R.nowcast.forEach((f) => frames.push({ kind: 'nowcast', time: f.time, make: () => L.imageOverlay(f.url, R.bounds, { opacity: 0, zIndex: 400 }) }));
  }
  const nowMs = R ? R.lastTime : Date.now();
  grid.time.forEach((t, k) => {
    const end = madridMs(t, grid.utc_offset || 0);
    const mid = end - 30 * 60e3;
    if (mid > nowMs + 60 * 60e3 && mid <= nowMs + 25 * 3600e3) {
      frames.push({ kind: 'model', time: mid, end, make: () => L.imageOverlay(modelFrameURL(grid, k), gb, { opacity: 0, zIndex: 400, attribution: 'Previsión AROME vía Open-Meteo' }) });
    }
  });
  if (!frames.length) return;
  const OPAC = { radar: 0.78, nowcast: 0.72, model: 0.75 };
  const KIND = { radar: 'Radar', nowcast: 'Extrapolación del radar', model: 'Previsión del modelo' };
  frames.forEach((f) => {
    f.layer = f.make();
    f.layer.addTo(ctl.map);
  });
  const nRadar = frames.filter((f) => f.kind === 'radar').length;
  const slider = $('#rslider');
  const play = $('#rplay');
  slider.max = frames.length - 1;
  slider.disabled = false;
  play.disabled = false;
  const counts = { radar: nRadar, nowcast: frames.filter((f) => f.kind === 'nowcast').length, model: frames.filter((f) => f.kind === 'model').length };
  $('#segbar').innerHTML = [['radar', 'Radar · 2 h'], ['nowcast', 'Próxima hora'], ['model', 'Modelo · hasta 24 h']]
    .filter(([k]) => counts[k]).map(([k, l]) => `<span class="seg-${k}" style="flex:${counts[k]}">${l}</span>`).join('');
  let cur = -1;
  const show = (i) => {
    if (cur >= 0) frames[cur].layer.setOpacity(0);
    cur = i;
    const f = frames[i];
    f.layer.setOpacity(OPAC[f.kind]);
    slider.value = i;
    if (f.kind === 'model') area.addTo(ctl.map);
    else area.remove();
    let label;
    if (f.kind === 'radar') label = i === nRadar - 1 ? `Ahora · radar de las ${hhmm(f.time)}` : `${hhmm(f.time)} · hace ${Math.round((nowMs - f.time) / 60e3)} min`;
    else if (f.kind === 'nowcast') label = `${hhmm(f.time)} · dentro de ${Math.round((f.time - nowMs) / 60e3)} min`;
    else label = `${new Date(f.end - 3600e3).toLocaleDateString('es-ES', { weekday: 'short', timeZone: MAD })} ${hhmm(f.end - 3600e3)}–${hhmm(f.end)}`;
    $('#rtime').innerHTML = `<b>${label}</b><span class="kind kind-${f.kind}">${KIND[f.kind]}</span>`;
  };
  show(R ? nRadar - 1 : 0);
  slider.addEventListener('input', () => {
    stopPlay();
    show(Number(slider.value));
  });
  let timer = null;
  const stopPlay = () => {
    clearInterval(timer);
    timer = null;
    play.innerHTML = ui('play', 16);
    play.setAttribute('aria-label', 'Reproducir la animación');
  };
  play.addEventListener('click', () => {
    if (timer) return stopPlay();
    play.innerHTML = ui('pause', 16);
    play.setAttribute('aria-label', 'Pausar la animación');
    if (cur >= frames.length - 1) show(0);
    timer = setInterval(() => {
      if (!alive()) return stopPlay();
      show(cur >= frames.length - 1 ? 0 : cur + 1);
    }, 650);
  });
  keep({ destroy: stopPlay });
}

// --- Vista: Modelos -------------------------------------------------------------
async function viewModels(main, alive) {
  main.innerHTML = loading('Comparando modelos…');
  const vd = await api(`village/${state.village}.json`);
  if (!alive()) return;
  const W = vd.weights;
  const sk = vd.skill;
  const maxW = Math.max(...W.map((w) => w.w_now), 0.01);
  const pctW = (x) => (x ? `${Math.round(x * 100)} %` : '—');
  const days = vd.daily.slice(0, 10);
  const md = vd.models.daily;
  main.innerHTML = `
    <section class="section-head">
      <h1>Los modelos, uno a uno</h1>
      <p>Cada modelo pesa según su calidad conocida, su resolución sobre el relieve del valle y lo que ha acertado en Hervás estos últimos 14 días.
      Si un modelo falla más de lo normal, pierde peso; si acierta, gana. Los pesos cambian con el horizonte: AROME manda en las primeras 48 horas y el ECMWF a medio plazo.</p>
    </section>
    <section class="card">
      <header class="card-h"><h2>Pesos de la media ponderada</h2><span class="hint">${sk ? `Error medido del ${dateShort(sk.window[0])} al ${dateShort(sk.window[1])} frente a ERA5` : 'Sin verificación reciente: pesos a priori'}</span></header>
      <div class="table-wrap"><table class="weights">
        <thead><tr><th>Modelo</th><th>Resolución</th><th title="Error medio absoluto de la temperatura prevista a 1 y 3 días">Error reciente</th><th>Ajuste</th><th class="wcol">Peso ahora</th><th>a 3 días</th><th>a 7 días</th><th>a 12 días</th><th>Llega hasta</th></tr></thead>
        <tbody>${W.map((w) => `<tr>
          <td><b>${esc(w.name)}</b><small>${esc(w.org)}</small></td>
          <td>${esc(w.res)}</td>
          <td class="num">${w.mae ? `${num1(w.mae.day1)}° · ${num1(w.mae.day3)}°` : '–'}</td>
          <td class="num ${w.skill > 1.05 ? 'up' : w.skill < 0.95 ? 'down' : ''}">×${num(w.skill, 2)}</td>
          <td class="wcol"><span class="wbar"><i style="width:${(w.w_now / maxW) * 100}%"></i></span>${pctW(w.w_now)}</td>
          <td class="num">${pctW(w.w_d3)}</td><td class="num">${pctW(w.w_d7)}</td><td class="num">${pctW(w.w_d12)}</td>
          <td class="num">${w.horizon ? dateShort(w.horizon.slice(0, 10)) : '–'}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="foot">Error reciente: diferencia media entre lo que el modelo previó con 1 y 3 días de antelación y la temperatura real (reanálisis ERA5) en Hervás. AEMET entra además con un ${Math.round(0.25 * 100)} % del peso en los primeros días.</p>
    </section>
    <section class="card">
      <header class="card-h"><h2>Temperatura según cada modelo</h2><span class="hint">Pasa el ratón por la leyenda para resaltar uno</span></header>
      <div class="legend models-legend" id="mlegend">
        <span><i class="lg line-temp"></i>Media ponderada</span><span><i class="lg band-ens"></i>Conjuntos (10-90 %)</span>
        ${W.map((w) => `<button class="mleg" data-id="${w.id}"><i class="lg line-model"></i>${esc(w.name)}</button>`).join('')}
      </div>
      <div id="spaghetti"></div>
    </section>
    <section class="card">
      <header class="card-h"><h2>Lluvia acumulada según cada modelo</h2><span class="hint">Desde ahora, 10 días</span></header>
      <div id="cumrain"></div>
    </section>
    <section class="card">
      <header class="card-h"><h2>Día a día: máximas, mínimas y lluvia</h2></header>
      <div class="table-wrap"><table class="mtable">
        <thead><tr><th>Modelo</th>${days.map((d) => `<th>${weekdayShort(d.date)} ${parseLocal(d.date).getDate()}</th>`).join('')}</tr></thead>
        <tbody>
          <tr class="blend-row"><td><b>Media ponderada</b></td>${days.map((d) => mcell(d.tmax, d.tmin, d.prcp)).join('')}</tr>
          <tr><td><b>AEMET</b><small>oficial</small></td>${days.map((d) => (d.aemet ? mcell(d.aemet.tmax, d.aemet.tmin, null, d.aemet.prob) : '<td class="na">–</td>')).join('')}</tr>
          ${W.map((w) => `<tr><td>${esc(w.name)}</td>${days.map((d) => {
            const r = (md[w.id] || []).find((x) => x.date === d.date);
            return r && r.tmax != null ? mcell(r.tmax, r.tmin, r.prcp) : '<td class="na">–</td>';
          }).join('')}</tr>`).join('')}
        </tbody></table></div>
      <p class="foot">Color de fondo según la máxima. Debajo, la lluvia del día (o la probabilidad, en el caso de AEMET).</p>
    </section>
    <section class="card">
      <header class="card-h"><h2>Conjuntos: probabilidad de lluvia</h2><span class="hint">${vd.ensemble ? `${vd.ensemble.members} escenarios de ECMWF, GEFS, ICON y GEM` : 'Sin datos de conjuntos'}</span></header>
      <div id="enschart"></div>
    </section>`;

  // Espagueti de temperatura
  const M = vd.models;
  const X = M.time.map(ts);
  const off = M.start;
  const len = M.time.length;
  const Hh = vd.hourly;
  const seg = (arr) => arr.slice(off, off + len);
  const mseries = W.map((w) => ({ type: 'line', y: M.series[w.id].t, cls: 'line-model', id: w.id, noHover: true }));
  const sp = chart($('#spaghetti'), {
    x: X, xTicks: hourTicks, bands: nightBands(X, seg(Hh.is_day)), marks: [{ x: ts(Hh.time[vd.i_now]), label: 'ahora', cls: 'now' }],
    panels: [{ h: 240, label: 'Temperatura °C', fmt: (v) => `${v}°`, series: [
      { type: 'band', lo: seg(Hh.ens_lo), hi: seg(Hh.ens_hi), cls: 'band-ens' }, ...mseries,
      { type: 'line', y: seg(Hh.t), cls: 'line-temp' }] }],
    hover: (i) => {
      const rows = W.map((w) => [w.name, M.series[w.id].t[i]]).filter((r) => r[1] != null).sort((p, q) => q[1] - p[1]);
      return `<div class="tip-h"><b>${cap(parseLocal(M.time[i]).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }))}, ${M.time[i].slice(11, 16)}</b></div>
        <div class="tip-g"><span>Media ponderada</span><b>${temp1(seg(Hh.t)[i])}</b>${rows.map(([nm, v]) => `<span>${esc(nm)}</span><b>${temp1(v)}</b>`).join('')}</div>`;
    },
  });
  keep(sp);
  $$('#mlegend .mleg').forEach((b) => {
    const on = () => {
      $('#spaghetti').classList.add('dim');
      $$(`#spaghetti path[data-id="${b.dataset.id}"]`).forEach((p) => p.classList.add('hl'));
    };
    const off2 = () => {
      $('#spaghetti').classList.remove('dim');
      $$('#spaghetti path.hl').forEach((p) => p.classList.remove('hl'));
    };
    b.addEventListener('mouseenter', on);
    b.addEventListener('focus', on);
    b.addEventListener('mouseleave', off2);
    b.addEventListener('blur', off2);
  });

  // Lluvia acumulada desde ahora
  const i0 = vd.i_now - off;
  const cum = (arr) => {
    let s = 0;
    return arr.map((v, i) => (i < i0 ? null : v == null ? null : (s += v)));
  };
  const blendCum = cum(seg(Hh.precip));
  const cr = chart($('#cumrain'), {
    x: X, xTicks: hourTicks,
    panels: [{ h: 200, label: 'Lluvia acumulada mm', min: 0, series: [
      ...W.map((w) => ({ type: 'line', y: cum(M.series[w.id].precip), cls: 'line-model', id: w.id, noHover: true })),
      { type: 'line', y: blendCum, cls: 'line-rain', endDot: true }] }],
    hover: (i) => {
      if (i < i0) return null;
      const rows = W.map((w) => [w.name, cum(M.series[w.id].precip)[i]]).filter((r) => r[1] != null).sort((p, q) => q[1] - p[1]);
      return `<div class="tip-h"><b>Hasta el ${parseLocal(M.time[i]).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })}, ${M.time[i].slice(11, 16)}</b></div>
        <div class="tip-g"><span>Media ponderada</span><b>${mm(blendCum[i])}</b>${rows.map(([nm, v]) => `<span>${esc(nm)}</span><b>${mm(v)}</b>`).join('')}</div>`;
    },
  });
  keep(cr);

  // Conjuntos: probabilidad diaria
  const ed = vd.daily.filter((d) => d.ens);
  if (ed.length) {
    const XD = ed.map((d) => ts(d.date));
    keep(chart($('#enschart'), {
      x: XD, xTicks: dayTicks,
      panels: [
        { h: 110, label: 'Lluvia ≥ 1 mm (%)', min: 0, max: 100, series: [{ type: 'bars', y: ed.map((d) => Math.round(d.ens.pop1 * 100)), cls: 'bar-pop' }] },
        { h: 80, label: 'Lluvia ≥ 10 mm (%)', min: 0, max: 100, ticks: 2, series: [{ type: 'bars', y: ed.map((d) => Math.round(d.ens.pop10 * 100)), cls: 'bar-pop strong' }] },
        { h: 100, label: 'Cantidad mm (mediana y 90 %)', min: 0, series: [
          { type: 'band', lo: ed.map((d) => d.ens.p50), hi: ed.map((d) => d.ens.p90), cls: 'band-rain' },
          { type: 'line', y: ed.map((d) => d.ens.p50), cls: 'line-rain' }] },
      ],
      hover: (i) => {
        const d = ed[i];
        return `<div class="tip-h"><b>${dayLabel(d.date, d.k)} ${dateShort(d.date)}</b></div><div class="tip-g">
          <span>≥ 1 mm</span><b>${pct(d.ens.pop1)}</b><span>≥ 10 mm</span><b>${pct(d.ens.pop10)}</b>
          <span>Lo más probable</span><b>${mm(d.ens.p50)}</b><span>Escenario húmedo (90 %)</span><b>${mm(d.ens.p90)}</b>
          <span>Máxima 10-90 %</span><b>${temp(d.ens.tmax_p10)} a ${temp(d.ens.tmax_p90)}</b></div>`;
      },
    }));
  } else {
    $('#enschart').innerHTML = '<p class="muted">Los conjuntos no están disponibles ahora mismo.</p>';
  }
}

function mcell(tmax, tmin, prcp, prob) {
  const rgb = tempRGB(tmax);
  const sub = prob != null ? `${num(prob, 0)} %` : prcp != null && prcp >= 0.5 ? `${num(prcp, prcp < 10 ? 1 : 0)}` : '';
  return `<td class="mc" style="--mc-bg:rgb(${rgb.join(',')});--mc-ink:${inkOn(rgb)}"><b>${temp(tmax)}</b><span>${temp(tmin)}</span><small>${sub}</small></td>`;
}

// --- Vista: Mapa --------------------------------------------------------------
async function viewMap(main, alive) {
  main.innerHTML = `
    <section class="section-head"><h1>Mapa del valle</h1>
      <p>Temperatura y lluvia en cada pueblo, radar de precipitación de las dos últimas horas, estaciones y embalses. Cambia el fondo (relieve, satélite…) con el botón de capas.</p></section>
    <section class="card map-card">
      <div class="map-tools">
        <div class="seg" id="mapvar">${Object.entries(MAP_VARS).map(([k, d]) => `<button data-v="${k}" class="${state.mapVar === k ? 'on' : ''}">${d.label}</button>`).join('')}</div>
        <div class="radar-ctl" id="radar-ctl">
          <label class="switch"><input type="checkbox" id="radar-on"> Radar</label>
          <button class="icon-btn" id="radar-play" aria-label="Reproducir radar" disabled>${ui('play', 16)}</button>
          <input type="range" id="radar-slider" min="0" max="12" value="12" disabled aria-label="Momento del radar">
          <span id="radar-time" class="muted">–</span>
        </div>
      </div>
      <div id="big-map" class="big-map"></div>
      <div class="map-legend">
        <span>${ui('pin', 14)} Pueblos</span><span class="smark official">${ui('station', 12)}</span> AEMET
        <span class="smark">${ui('station', 12)}</span> Meteoclimatic <span class="rmark">${ui('drop', 12)}</span> Embalses
        <span class="radar-scale"><i></i>radar: débil → fuerte</span>
      </div>
    </section>
    <section class="card">
      <header class="card-h"><h2>Más mapas en directo</h2></header>
      <ul class="links">
        <li><a href="https://www.aemet.es/es/eltiempo/observacion/radar?w=0&p=r8cc" target="_blank" rel="noopener">Radar de AEMET (Cáceres) ${ui('external', 13)}</a><small>El radar oficial más cercano al valle.</small></li>
        <li><a href="https://www.aemet.es/es/eltiempo/observacion/satelite" target="_blank" rel="noopener">Satélite de AEMET ${ui('external', 13)}</a><small>Imágenes visibles e infrarrojas de Meteosat.</small></li>
        <li><a href="https://www.aemet.es/es/eltiempo/observacion/rayos" target="_blank" rel="noopener">Rayos en tiempo real (AEMET) ${ui('external', 13)}</a><small>Descargas eléctricas de la última hora.</small></li>
        <li><a href="https://meteologix.com/es/model-charts/euro/spain/precipitation-total.html" target="_blank" rel="noopener">Mapas de modelos en Meteologix ${ui('external', 13)}</a><small>Lluvia, viento y temperatura de cada modelo sobre España.</small></li>
        <li><a href="https://www.windy.com/40.272/-5.900?40.15,-5.90,10" target="_blank" rel="noopener">Windy ${ui('external', 13)}</a><small>Viento, rachas y nubes animados sobre el valle.</small></li>
        <li><a href="https://www.meteoblue.com/es/tiempo/mapas/hervás_españa_3120776" target="_blank" rel="noopener">meteoblue ${ui('external', 13)}</a><small>Mapas de nubes, precipitación y temperatura.</small></li>
      </ul>
    </section>`;
  const ctl = createMap($('#big-map'), { zoom: 11, full: true, onSelect: (id) => (location.hash = `#prevision/${id}`) });
  state.maps.big = ctl;
  ctl.variable = state.mapVar;
  drawVillages(ctl, state.overview, state.village);
  fitValley(ctl, villages().map((x) => [x.lat, x.lon]), 60);
  $$('#mapvar button').forEach((b) => b.addEventListener('click', () => {
    state.mapVar = b.dataset.v;
    ctl.variable = state.mapVar;
    $$('#mapvar button').forEach((x) => x.classList.toggle('on', x === b));
    drawVillages(ctl, state.overview, state.village);
  }));
  api('estaciones.json').then((obs) => alive() && drawStations(ctl, obs)).catch(() => {});
  api('embalses.json', 60 * 60 * 1000).then((r) => alive() && drawReservoirs(ctl, r.data)).catch(() => {});

  const chk = $('#radar-on');
  const play = $('#radar-play');
  const slider = $('#radar-slider');
  const label = $('#radar-time');
  let radar = null;
  chk.addEventListener('change', async () => {
    try {
      if (chk.checked) {
        if (!radar) radar = await addRadar(ctl, { slider, label });
        radar.enable();
        play.disabled = false;
        slider.disabled = false;
        ctl.map.setView([40.27, -5.9], Math.min(ctl.map.getZoom(), 9));
      } else if (radar) {
        radar.disable();
        play.disabled = true;
        slider.disabled = true;
        play.innerHTML = ui('play', 16);
      }
    } catch (e) {
      label.textContent = 'Radar no disponible';
      chk.checked = false;
    }
  });
  play.addEventListener('click', () => {
    if (!radar) return;
    if (radar.timer) {
      radar.stop();
      play.innerHTML = ui('play', 16);
    } else {
      radar.play();
      play.innerHTML = ui('pause', 16);
    }
  });
  slider.addEventListener('input', () => {
    if (!radar) return;
    radar.stop();
    play.innerHTML = ui('play', 16);
    radar.show(Number(slider.value));
  });
}

// --- Vista: Histórico -------------------------------------------------------------
async function viewHistory(main, alive) {
  main.innerHTML = loading('Abriendo el archivo desde 1940…');
  const hd = await api(`history/${state.village}.json`, 30 * 60 * 1000);
  if (!alive()) return;
  const v = hd.village;
  const s = hd.summary;
  const r = hd.recent;
  main.innerHTML = `
    <section class="section-head"><h1>Histórico de ${esc(v.name)}</h1>
      <p>Lo que ha pasado de verdad: últimos días, meses y años, con los récords desde 1940. ${s ? `Serie ERA5 del ${dateLong(s.coverage.from)} al ${dateLong(s.coverage.to)}` : ''}${s?.coverage.provisional_to ? `, completada hasta el ${dateLong(s.coverage.provisional_to)} con los análisis de los modelos` : ''}.</p>
      <nav class="subnav">
        <a href="#h-dias">Últimos días</a><a href="#h-hidro">Año hidrológico</a><a href="#h-meses">Meses</a><a href="#h-anios">Años</a><a href="#h-records">Récords</a></nav>
    </section>

    <section class="card" id="h-dias">
      <header class="card-h"><h2>Últimos días</h2>
        <div class="seg" id="hrange">${[7, 30, 92].map((k) => `<button data-k="${k}" class="${state.histRange === k ? 'on' : ''}">${k === 92 ? '3 meses' : `${k} días`}</button>`).join('')}</div></header>
      <div class="stat-row" id="recent-stats"></div>
      <div class="legend"><span><i class="lg band-range"></i>Máxima y mínima</span><span><i class="lg line-normal"></i>Lo normal</span><span><i class="lg bar-rain"></i>Lluvia diaria</span><span><i class="lg line-gust"></i>Racha máxima</span></div>
      <div id="recent-chart"></div>
    </section>

    <section class="card">
      <header class="card-h"><h2>Los 8 pueblos en los últimos 30 días</h2></header>
      <div class="table-wrap">${compareTable(hd.all_recent)}</div>
      <p class="foot">Análisis de los modelos de alta resolución (Open-Meteo). La lluvia varía mucho de un pueblo a otro con el relieve.</p>
    </section>

    ${s ? historyLong(s, v) : `<section class="card"><p class="muted">La serie histórica desde 1940 se está descargando (${esc(hd.progress?.state || '')}). Vuelve en unos minutos.</p></section>`}`;

  const drawRecent = () => {
    const k = state.histRange;
    const T = r.time.slice(-k);
    const sl = (a) => (a || []).slice(-k);
    const X = T.map(ts);
    const normals = s?.normals.daily;
    const nIdx = (d) => {
      const dd = parseLocal(d);
      return Math.round((new Date(2020, dd.getMonth(), dd.getDate()) - new Date(2020, 0, 1)) / 864e5);
    };
    const nmax = normals ? T.map((d) => normals.tmax[nIdx(d)]) : [];
    const nmin = normals ? T.map((d) => normals.tmin[nIdx(d)]) : [];
    const prc = sl(r.prcp);
    const tmx = sl(r.tmax);
    const tmn = sl(r.tmin);
    const total = prc.reduce((p, q) => p + (q || 0), 0);
    const wet = prc.filter((p) => (p || 0) >= 1).length;
    const iMax = tmx.indexOf(Math.max(...tmx.filter((x) => x != null)));
    const iMin = tmn.indexOf(Math.min(...tmn.filter((x) => x != null)));
    const normalRain = normals ? T.reduce((acc, d) => acc + (normals.prcp[nIdx(d)] || 0), 0) : null;
    $('#recent-stats').innerHTML = `
      <div class="stat"><span>Lluvia</span><b>${mm(total)}</b><small>${normalRain ? `${Math.round((100 * total) / normalRain)} % de lo normal` : ''}</small></div>
      <div class="stat"><span>Días de lluvia</span><b>${wet}</b><small>de ${k}</small></div>
      <div class="stat"><span>Máxima</span><b>${temp1(tmx[iMax])}</b><small>${dateShort(T[iMax])}</small></div>
      <div class="stat"><span>Mínima</span><b>${temp1(tmn[iMin])}</b><small>${dateShort(T[iMin])}</small></div>
      <div class="stat"><span>Racha más fuerte</span><b>${kmh(Math.max(...sl(r.gust).filter((x) => x != null)))}</b></div>`;
    const el = $('#recent-chart');
    state.charts.filter((c) => c.el === el).forEach((c) => c.destroy());
    state.charts = state.charts.filter((c) => c.el !== el);
    const c = chart(el, {
      x: X, xTicks: dayTicks,
      panels: [
        { h: 150, label: 'Temperatura °C', fmt: (x) => `${x}°`, series: [
          { type: 'band', lo: tmn, hi: tmx, cls: 'band-range' },
          ...(normals ? [{ type: 'line', y: nmax, cls: 'line-normal', noHover: true }, { type: 'line', y: nmin, cls: 'line-normal', noHover: true }] : []),
          { type: 'line', y: tmx, cls: 'line-tmax' }, { type: 'line', y: tmn, cls: 'line-tmin' }] },
        { h: 90, label: 'Lluvia mm', min: 0, series: [{ type: 'bars', y: prc, cls: 'bar-rain' }] },
        { h: 70, label: 'Racha km/h', min: 0, ticks: 2, series: [{ type: 'line', y: sl(r.gust), cls: 'line-gust' }] },
        { h: 64, label: 'Presión hPa', ticks: 2, series: [{ type: 'line', y: sl(r.pres), cls: 'line-pres' }] },
      ],
      hover: (i) => `<div class="tip-h"><b>${cap(parseLocal(T[i]).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</b></div>
        <div class="tip-g"><span>Máxima</span><b>${temp1(tmx[i])}</b><span>Mínima</span><b>${temp1(tmn[i])}</b>
        ${normals ? `<span>Normal</span><b>${temp(nmax[i])} / ${temp(nmin[i])}</b>` : ''}
        <span>Lluvia</span><b>${mm(prc[i])}</b><span>Racha</span><b>${kmh(sl(r.gust)[i])} ${dirName(sl(r.wdir)[i])}</b>
        <span>Presión media</span><b>${num(sl(r.pres)[i], 0)} hPa</b><span>Humedad</span><b>${num(sl(r.rh)[i], 0)} %</b></div>`,
    });
    c.el = el;
    keep(c);
  };
  if (r) drawRecent();
  else $('#recent-chart').innerHTML = '<p class="muted">Sin datos recientes.</p>';
  $$('#hrange button').forEach((b) => b.addEventListener('click', () => {
    state.histRange = Number(b.dataset.k);
    $$('#hrange button').forEach((x) => x.classList.toggle('on', x === b));
    drawRecent();
  }));
  if (s) drawHistoryCharts(s);
}

function compareTable(all) {
  const rows = villages().map((v) => {
    const r = all[v.id];
    if (!r) return '';
    const p = r.prcp.reduce((a, b) => a + (b || 0), 0);
    const mx = Math.max(...r.tmax.filter((x) => x != null));
    const mn = Math.min(...r.tmin.filter((x) => x != null));
    return { v, p, mx, mn, wet: r.prcp.filter((x) => (x || 0) >= 1).length };
  }).filter(Boolean);
  const maxP = Math.max(...rows.map((x) => x.p), 1);
  return `<table class="compare"><thead><tr><th>Pueblo</th><th>Altitud</th><th>Lluvia</th><th></th><th>Días de lluvia</th><th>Máxima</th><th>Mínima</th></tr></thead><tbody>${rows
    .map((x) => `<tr class="${x.v.id === state.village ? 'on' : ''}"><td><a href="#historico/${x.v.id}">${esc(x.v.name)}</a></td><td class="num">${num(x.v.elev, 0)} m</td>
      <td class="num"><b>${mm(x.p)}</b></td><td class="barcell"><span class="hbar"><i style="width:${(100 * x.p) / maxP}%"></i></span></td>
      <td class="num">${x.wet}</td><td class="num">${temp1(x.mx)}</td><td class="num">${temp1(x.mn)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function historyLong(s, v) {
  const hy = s.hydro;
  const yt = s.ytd;
  const mr = s.month_records;
  const rec = s.records;
  const fmtRec = (x) => {
    const val = x.unit === 'días' ? `${num(x.value, 0)} días` : x.unit === '°C' ? temp1(x.value) : x.unit === 'km/h' ? kmh(x.value) : `${num(x.value, x.unit === 'mm' && x.value >= 100 ? 0 : 1)} ${x.unit}`;
    const when = x.to ? `${dateShort(x.date)} ${x.date.slice(0, 4)} → ${dateShort(x.to)} ${x.to.slice(0, 4)}` : dateLong(x.date);
    return `<div class="rec rec-${x.key}"><span>${esc(x.label)}</span><b>${val}</b><small>${when}</small></div>`;
  };
  const hyY = Number(hy.start.slice(0, 4));
  return `
    <section class="card" id="h-hidro">
      <header class="card-h"><h2>Año hidrológico ${hyY}-${String(hyY + 1).slice(2)}</h2><span class="hint">Lluvia acumulada desde el 1 de octubre</span></header>
      <div class="stat-row">
        <div class="stat"><span>Llevamos</span><b>${mm(hy.current[hy.current.length - 1])}</b><small>${hy.pct_of_normal != null ? `${hy.pct_of_normal} % de lo normal a estas alturas` : ''}</small></div>
        <div class="stat"><span>Un año normal</span><b>${mm(hy.normal_total)}</b><small>media 1991-2020</small></div>
        <div class="stat"><span>Año anterior</span><b>${mm(hy.previous[hy.previous.length - 1])}</b></div>
        <div class="stat"><span>El más lluvioso</span><b>${mm(hy.wettest?.value)}</b><small>${hy.wettest?.year}</small></div>
        <div class="stat"><span>El más seco</span><b>${mm(hy.driest?.value)}</b><small>${hy.driest?.year}</small></div>
      </div>
      <div class="legend"><span><i class="lg line-rain"></i>Este año</span><span><i class="lg line-prev"></i>Año anterior</span><span><i class="lg line-normal"></i>Normal</span></div>
      <div id="hydro-chart"></div>
    </section>

    <section class="card" id="h-meses">
      <header class="card-h"><h2>Últimos 24 meses</h2><span class="hint">Frente a la media 1991-2020</span></header>
      <div class="stat-row">
        <div class="stat"><span>${yt.year} hasta el ${dateShort(yt.to)}</span><b>${temp1(yt.tmean)}</b><small>${signed(yt.tmean - yt.tmean_normal, 1)}° sobre lo normal</small></div>
        <div class="stat"><span>Lluvia en ${yt.year}</span><b>${mm(yt.prcp)}</b><small>${Math.round((100 * yt.prcp) / yt.prcp_normal)} % de lo normal</small></div>
      </div>
      <div class="legend"><span><i class="lg bar-rain"></i>Lluvia del mes</span><span><i class="lg dot-normal"></i>Normal del mes</span><span><i class="lg bar-warm"></i>Más cálido</span><span><i class="lg bar-cold"></i>Más frío</span></div>
      <div id="months-chart"></div>
    </section>

    <section class="card" id="h-anios">
      <header class="card-h"><h2>Desde 1940</h2><span class="hint">Cada franja es un año: azul más frío, rojo más cálido que 1961-1990</span></header>
      <div id="stripes" class="stripes" data-height="70"></div>
      <div id="years-chart"></div>
      <div class="tops">
        ${topList('Años más lluviosos', s.top.wet_years, (x) => mm(x.prcp))}
        ${topList('Años más secos', s.top.dry_years, (x) => mm(x.prcp))}
        ${topList('Años más cálidos', s.top.hot_years, (x) => temp1(x.tmean))}
        ${topList('Años más fríos', s.top.cold_years, (x) => temp1(x.tmean))}
      </div>
    </section>

    <section class="card" id="h-records">
      <header class="card-h"><h2>Récords desde 1940</h2><span class="hint">${esc(v.name)}, ${num(v.elev, 0)} m</span></header>
      <div class="records">${rec.map(fmtRec).join('')}</div>
      <h3 class="sub">Récords de ${mr.name}</h3>
      <div class="records small">
        <div class="rec"><span>Máxima más alta</span><b>${temp1(mr.tmax?.value)}</b><small>${dateLong(mr.tmax?.date)}</small></div>
        <div class="rec"><span>Mínima más baja</span><b>${temp1(mr.tmin?.value)}</b><small>${dateLong(mr.tmin?.date)}</small></div>
        <div class="rec"><span>Más lluvia en un día</span><b>${mm(mr.prcp?.value)}</b><small>${dateLong(mr.prcp?.date)}</small></div>
        <div class="rec"><span>${cap(mr.name)} más lluvioso</span><b>${mm(mr.wettest?.value)}</b><small>${mr.wettest?.year}</small></div>
        <div class="rec"><span>${cap(mr.name)} más seco</span><b>${mm(mr.driest?.value)}</b><small>${mr.driest?.year}</small></div>
        <div class="rec"><span>Racha más fuerte</span><b>${kmh(mr.gust?.value)}</b><small>${dateLong(mr.gust?.date)}</small></div>
      </div>
      <h3 class="sub">Clima normal (1991-2020)</h3>
      <div id="climate-chart"></div>
      <p class="foot">Fuente: reanálisis ERA5 de Copernicus/ECMWF (celda de unos 30 km que cubre todo el valle), con la temperatura corregida a ${num(v.elev, 0)} m (${signed(s.offset, 1)}° respecto a Hervás). Las rachas de viento del reanálisis son orientativas. No son los récords oficiales de una estación: para eso, consulta la ficha de Hervás (3504X) en AEMET.</p>
    </section>`;
}

function topList(title, items, fmt) {
  return `<div class="top"><h4>${title}</h4><ol>${items.map((x) => `<li><span>${x.y}</span><b>${fmt(x)}</b></li>`).join('')}</ol></div>`;
}

function drawHistoryCharts(s) {
  // Año hidrológico
  const hy = s.hydro;
  const n = 366;
  const X = Array.from({ length: n }, (_, i) => i);
  const start = parseLocal(hy.start);
  const monthTicks = () => {
    const out = [];
    for (let k = 0; k < 12; k++) {
      const d = new Date(start.getFullYear(), start.getMonth() + k, 1);
      out.push({ x: Math.round((d - start) / 864e5), label: MONTHS_SHORT[d.getMonth()], anchor: 'start', offset: 3, major: true });
    }
    return out;
  };
  const pad = (arr) => [...arr, ...Array(Math.max(0, n - arr.length)).fill(null)].slice(0, n);
  keep(chart(document.getElementById('hydro-chart'), {
    x: X, xTicks: monthTicks,
    marks: [{ x: hy.current.length - 1, label: 'hoy', cls: 'now' }],
    panels: [{ h: 200, label: 'Lluvia acumulada mm', min: 0, series: [
      { type: 'line', y: pad(hy.normal), cls: 'line-normal' },
      { type: 'line', y: pad(hy.previous), cls: 'line-prev' },
      { type: 'line', y: pad(hy.current), cls: 'line-rain', endDot: true }] }],
    hover: (i) => {
      const d = new Date(start.getTime() + i * 864e5);
      return `<div class="tip-h"><b>Hasta el ${d.getDate()} de ${MONTHS[d.getMonth()]}</b></div><div class="tip-g">
        <span>Este año</span><b>${mm(hy.current[i])}</b><span>Año anterior</span><b>${mm(hy.previous[i])}</b><span>Normal</span><b>${mm(hy.normal[i])}</b></div>`;
    },
  }));

  // Últimos 24 meses
  const months = s.monthly.slice(-24);
  const norm = s.normals.monthly;
  const MX = months.map((_, i) => i);
  const anoms = months.map((m) => (m.tmean == null ? null : Math.round((m.tmean - norm[m.m - 1].tmean) * 10) / 10));
  keep(chart(document.getElementById('months-chart'), {
    x: MX,
    xTicks: () => months.map((m, i) => ({ x: i, label: m.m === 1 || i === 0 ? `${MONTHS_SHORT[m.m - 1]} ${String(m.y).slice(2)}` : (MX.length > 14 && i % 2 ? '' : MONTHS_SHORT[m.m - 1]), major: m.m === 1 })),
    panels: [
      { h: 140, label: 'Lluvia mm', min: 0, series: [
        { type: 'bars', y: months.map((m) => m.prcp), cls: 'bar-rain' },
        { type: 'dots', y: months.map((m) => norm[m.m - 1].prcp), cls: 'dot-normal', r: 3.5 }] },
      { h: 110, label: 'Temperatura respecto a lo normal °C', zero: true, series: [
        { type: 'bars', y: anoms, clsFn: (val) => (val >= 0 ? 'bar-warm' : 'bar-cold') }] },
    ],
    hover: (i) => {
      const m = months[i];
      const nm = norm[m.m - 1];
      return `<div class="tip-h"><b>${cap(MONTHS[m.m - 1])} de ${m.y}${m.prov ? ' (provisional)' : ''}</b></div><div class="tip-g">
        <span>Lluvia</span><b>${mm(m.prcp)}</b><span>Normal</span><b>${mm(nm.prcp)}</b>
        <span>Temperatura media</span><b>${temp1(m.tmean)}</b><span>Diferencia</span><b>${signed(anoms[i], 1)}°</b>
        <span>Máx. / mín. medias</span><b>${temp1(m.tmax)} / ${temp1(m.tmin)}</b><span>Días de lluvia</span><b>${m.rdays}</b></div>`;
    },
  }));

  // Franjas y años
  stripes(document.getElementById('stripes'), s.stripes, (it) => anomColor(it.anom, 1.8),
    (it) => `<b>${it.y}</b><br>${signed(it.anom, 1)}° respecto a 1961-1990`);
  const years = s.annual.filter((a) => !a.partial);
  const YX = years.map((a) => a.y);
  const ma = years.map((_, i) => {
    const w = years.slice(Math.max(0, i - 5), i + 6).map((a) => a.tmean);
    return Math.round((w.reduce((p, q) => p + q, 0) / w.length) * 100) / 100;
  });
  keep(chart(document.getElementById('years-chart'), {
    x: YX, xTicks: yearTicks,
    panels: [
      { h: 150, label: 'Lluvia anual mm', min: 0, series: [
        { type: 'bars', y: years.map((a) => a.prcp), cls: 'bar-rain' },
        { type: 'hline', value: s.normals.annual.prcp, cls: 'hl-normal', label: `normal ${num(s.normals.annual.prcp, 0)} mm` }] },
      { h: 130, label: 'Temperatura media anual °C', fmt: (x) => `${x}°`, series: [
        { type: 'line', y: years.map((a) => a.tmean), cls: 'line-year' },
        { type: 'line', y: ma, cls: 'line-trend', noHover: true }] },
      { h: 90, label: 'Días de helada', min: 0, ticks: 2, series: [{ type: 'bars', y: years.map((a) => a.frost), cls: 'bar-frost' }] },
    ],
    hover: (i) => {
      const a = years[i];
      return `<div class="tip-h"><b>${a.y}</b></div><div class="tip-g"><span>Lluvia</span><b>${mm(a.prcp)}</b>
        <span>Temperatura media</span><b>${temp1(a.tmean)}</b><span>Días de helada</span><b>${a.frost}</b>
        <span>Días de 30° o más</span><b>${a.hot}</b><span>Racha máxima</span><b>${kmh(a.gust)}</b></div>`;
    },
  }));

  // Climograma (dos paneles, misma X)
  const N = s.normals.monthly;
  keep(chart(document.getElementById('climate-chart'), {
    x: N.map((_, i) => i),
    xTicks: () => N.map((m, i) => ({ x: i, label: MONTHS_SHORT[i] })),
    panels: [
      { h: 140, label: 'Temperatura °C', fmt: (x) => `${x}°`, series: [
        { type: 'band', lo: N.map((m) => m.tmin), hi: N.map((m) => m.tmax), cls: 'band-range' },
        { type: 'line', y: N.map((m) => m.tmax), cls: 'line-tmax' }, { type: 'line', y: N.map((m) => m.tmean), cls: 'line-temp' },
        { type: 'line', y: N.map((m) => m.tmin), cls: 'line-tmin' }] },
      { h: 110, label: 'Lluvia mm', min: 0, series: [{ type: 'bars', y: N.map((m) => m.prcp), cls: 'bar-rain' }] },
    ],
    hover: (i) => {
      const m = N[i];
      return `<div class="tip-h"><b>${cap(MONTHS[i])}</b></div><div class="tip-g"><span>Máxima media</span><b>${temp1(m.tmax)}</b>
        <span>Media</span><b>${temp1(m.tmean)}</b><span>Mínima media</span><b>${temp1(m.tmin)}</b><span>Lluvia</span><b>${mm(m.prcp)}</b>
        <span>Días de lluvia</span><b>${num(m.rdays, 0)}</b></div>`;
    },
  }));
}

// --- Vista: Embalses ---------------------------------------------------------------
// Protagonista: la última lectura automática del SAIH Tajo. El boletín semanal queda como nota.
function minutesAgo(localIso) {
  return Math.max(0, Math.round((Date.now() - parseLocal(localIso).getTime()) / 60000));
}
function agoShort(min) {
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}
function whenShort(localIso) {
  const d = parseLocal(localIso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? localIso.slice(11, 16) : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${localIso.slice(11, 16)}`;
}

// Desde cuándo se mantiene el caudal actual (±25 %) y cuál era el anterior.
function outflowSince(series) {
  if (!series?.length) return null;
  const last = series[series.length - 1];
  const near = (v) => v != null && Math.abs(v - last.m3s) <= Math.max(0.25 * last.m3s, 0.1);
  let k = series.length - 1;
  while (k > 0 && near(series[k - 1].m3s)) k--;
  return { since: series[k].time, before: k > 0 ? series[k - 1].m3s : null, changed: k > 0 };
}

async function viewWater(main, alive) {
  main.innerHTML = loading('Leyendo los embalses en tiempo real…');
  const res = await api('embalses.json', 15 * 60 * 1000);
  if (!alive()) return;
  const items = res.data?.items || [];
  const newest = items.map((r) => r.rt?.time).filter(Boolean).sort().pop();
  main.innerHTML = `
    <section class="section-head"><h1>Embalses en tiempo real</h1>
      <p>Lecturas automáticas del SAIH Tajo (Confederación Hidrográfica del Tajo), que se publican cada hora: agua embalsada, caudal que se suelta y lluvia en los pluviómetros cercanos.
      ${newest ? `Última lectura: <b>${whenShort(newest)}</b> (${agoShort(minutesAgo(newest))}).` : ''}</p></section>
    <div class="water-grid">${items.map(waterCard).join('')}</div>
    <p class="foot">Datos provisionales del SAIH, sin validar, recogidos por embalses.net. El boletín semanal del Ministerio (MITECO) se incluye solo como referencia.
    ${res.data?.errors?.length ? esc(res.data.errors.join(' · ')) : ''}</p>`;

  items.forEach((r) => {
    const rt = r.rt;
    const el = document.getElementById(`rt-${r.id}`);
    if (rt?.series?.length > 1 && el) {
      const ser = rt.series;
      keep(chart(el, {
        x: ser.map((p) => ts(p.time)), xTicks: hourTicks, marginLeft: 44,
        panels: [{ h: 112, label: 'Volumen hm³ (tiempo real)', minSpan: Math.max(0.2, (r.capacity || 10) * 0.01), series: [
          { type: 'line', y: ser.map((p) => p.hm3), cls: 'line-water' },
          { type: 'dots', y: ser.map((p) => p.hm3), cls: 'dot-water', r: 3 }] }],
        hover: (i) => `<div class="tip-h"><b>${whenShort(ser[i].time)}</b></div><div class="tip-g"><span>Volumen</span><b>${num2(ser[i].hm3)} hm³</b><span>Lleno</span><b>${num2(ser[i].pct)} %</b></div>`,
      }));
    }
    const wk = (r.weekly || []).filter((w) => w.pct != null);
    const wel = document.getElementById(`wk-${r.id}`);
    if (wk.length && wel) {
      keep(chart(wel, {
        x: wk.map((_, i) => i), marginLeft: 36,
        xTicks: () => wk.map((w, i) => (i % 13 === 0 || i === wk.length - 1 ? { x: i, label: `sem ${w.w}` } : null)).filter(Boolean),
        panels: [{ h: 90, label: '% lleno (boletín semanal)', min: 0, max: 100, ticks: 2, series: [{ type: 'area', y: wk.map((w) => w.pct), cls: 'area-water' }, { type: 'line', y: wk.map((w) => w.pct), cls: 'line-water' }] }],
        hover: (i) => `<b>Semana ${wk[i].w} de ${wk[i].y}</b><br>${num(wk[i].hm3, 0)} hm³ · ${num(wk[i].pct)} %<br><small>Cambio semanal ${signed(wk[i].var, 1)} hm³</small>`,
      }));
    }
  });
}

function waterCard(r) {
  const rt = r.rt;
  const pctNow = rt?.pct ?? r.pct;
  const hm3Now = rt?.hm3 ?? r.hm3;
  const age = rt ? minutesAgo(rt.time) : null;
  const live = rt
    ? `<span class="live${age > 180 ? ' stale' : ''}" title="Lectura automática del SAIH Tajo"><i></i>${age > 180 ? 'Última lectura' : 'En directo'} · ${whenShort(rt.time)}<small>${agoShort(age)}</small></span>`
    : '<span class="live stale"><i></i>Sin lectura en tiempo real</span>';
  const trend = (c, label) => (c ? `<span class="${c.hm3 > 0 ? 'up' : c.hm3 < 0 ? 'down' : ''}">${c.hm3 > 0 ? '▲' : c.hm3 < 0 ? '▼' : '='} ${signed2(c.hm3)} hm³ ${label}</span>` : '');
  const t24 = trend(rt?.chg_24h, rt?.chg_24h ? `en ${Math.round(rt.chg_24h.hours)} h` : '');
  const t1 = trend(rt?.chg_1h, 'en la última hora');
  const out = rt?.outflow;
  const os = outflowSince(rt?.outflow_series);
  const outTxt = out ? `<p class="wout">${ui('dam', 16)} <span>Soltando <b>${out.m3s < 10 ? num2(out.m3s) : num(out.m3s, 0)} m³/s</b>${os?.changed ? ` desde las ${os.since.slice(11, 16)}${parseLocal(os.since).toDateString() !== new Date().toDateString() ? ` del ${dateShort(os.since.slice(0, 10))}` : ''} <small>(antes ${os.before < 10 ? num2(os.before) : num(os.before, 0)} m³/s)</small>` : ''}</span></p>` : '';
  const ch = (ref, label) => {
    if (ref == null || pctNow == null) return '';
    const d = pctNow - ref;
    return `<div class="wchip ${d >= 0 ? 'up' : 'down'}"><span>${label}</span><b>${signed(d, 1)} pts</b><small>entonces ${num(ref, 1)} %</small></div>`;
  };
  const gauges = (rt?.gauges || []).slice(0, 5);
  const gaugesHTML = gauges.length ? `<div class="gauges"><h3>Lluvia en pluviómetros cercanos <small>(l/m²)</small></h3>
    <table><thead><tr><th>Pluviómetro</th><th>1 h</th><th>6 h</th><th>24 h</th></tr></thead><tbody>${gauges.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${num(g.h1, 1)}</td><td class="num">${num(g.h6, 1)}</td><td class="num"><b>${num(g.h24, 1)}</b></td></tr>`).join('')}</tbody></table></div>` : '';
  return `<article class="card water">
    <header class="card-h"><h2>${esc(r.name)}</h2>${live}</header>
    <p class="muted small where">${esc(r.where)}</p>
    <div class="water-main">${tank(pctNow, r.last_year?.pct, r.avg10?.pct, 132)}
      <div class="wnow">
        <p class="wpct">${num1(pctNow)} %</p>
        <p class="whm3"><b>${rt ? num2(hm3Now) : num(hm3Now, 0)} hm³</b> de ${num(r.capacity, 0)}</p>
        <p class="wtrend">${t24}${t1 ? ` ${t1}` : ''}</p>
        ${outTxt}
      </div></div>
    <div id="rt-${r.id}" class="rt-chart"></div>
    ${gaugesHTML}
    <div class="wchips">${ch(r.avg10?.pct, 'Frente a la media de 10 años')}${ch(r.last_year?.pct, `Frente a ${r.last_year?.year ?? 'hace un año'}`)}</div>
    <details class="bulletin"><summary>Boletín semanal del MITECO · ${dateShort(r.date)}: ${num(r.hm3, 0)} hm³ (${num(r.pct, 1)} %), ${signed(r.week_hm3, 0)} hm³ en la semana</summary>
      <p class="small muted">Misma semana de ${r.last_year?.year ?? 'el año pasado'}: ${num(r.last_year?.pct, 1)} %. Media de 10 años: ${num(r.avg10?.pct, 1)} %. <a href="${esc(r.url)}" target="_blank" rel="noopener">Ficha en embalses.net ${ui('external', 12)}</a></p>
      <div id="wk-${r.id}" class="wk-chart"></div></details>
  </article>`;
}

// --- Vista: Fuentes -------------------------------------------------------------
async function viewSources(main, alive) {
  main.innerHTML = loading('Comprobando fuentes…');
  const f = await api('fuentes.json', 60 * 1000);
  if (!alive()) return;
  const v = villages().find((x) => x.id === state.village) || f.villages[0];
  const stat = (s) => {
    const st = s.status;
    if (!st) return '<span class="st st-wait">pendiente</span>';
    if (st.client) return '<span class="st st-ok">en el navegador</span>';
    if (st.ok) return `<span class="st st-ok">${ui('check', 12)} ${st.updated ? ago(st.updated) : st.coverage ? `${st.coverage[0].slice(0, 4)}–${dateShort(st.coverage[1])}` : 'ok'}</span>`;
    if (st.optional) return `<span class="st st-wait">${esc(st.error)}</span>`;
    return `<span class="st st-err" title="${esc(st.error || '')}">${ui('x', 12)} ${esc((st.error || 'sin datos').slice(0, 90))}</span>`;
  };
  main.innerHTML = `
    <section class="section-head"><h1>Fuentes y método</h1>
      <p>De dónde sale cada dato y cómo se combinan. Los datos se reúnen y se calculan cada hora; esta página solo los muestra y no envía nada a ningún sitio.</p></section>
    <section class="card"><header class="card-h"><h2>Estado de las fuentes</h2></header>
      <div class="table-wrap"><table class="sources"><thead><tr><th>Fuente</th><th>Qué aporta</th><th>Estado</th></tr></thead><tbody>
      ${f.sources.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><small>${esc(s.via)}</small></td><td>${esc(s.what)}</td><td>${stat(s)}</td></tr>`).join('')}
      </tbody></table></div></section>
    <section class="card method"><header class="card-h"><h2>Cómo se calcula la media ponderada</h2></header>
      <ol>
        <li><b>Diez modelos.</b> Para cada pueblo se descarga la previsión hora a hora de ${f.models.length} modelos (${f.models.map((m) => esc(m.name)).join(', ')}), a la altitud exacta del pueblo.</li>
        <li><b>Peso de partida.</b> Cada modelo tiene un peso según su calidad en las verificaciones internacionales y su resolución sobre el relieve: del 1,00 del ECMWF IFS al 0,40 del GRAPES.</li>
        <li><b>Horizonte.</b> AROME (1,3-2,5 km) recibe ×1,4 en las primeras 48 h e ICON-EU ×1,15 hasta 5 días. A partir del tercer día las diferencias entre modelos se suavizan, y cada modelo pierde peso gradualmente en sus últimas 18 horas para que no haya saltos.</li>
        <li><b>Acierto reciente.</b> Se compara lo que cada modelo previó con 1 y 3 días de antelación con la temperatura real de los últimos 14 días. El que acierta más gana hasta ×1,5; el que falla, baja hasta ×0,6.</li>
        <li><b>AEMET.</b> La predicción oficial entra con el ${Math.round(f.aemet_share[0] * 100)} % del peso los dos primeros días y va bajando hasta el ${Math.round(f.aemet_share[6] * 100)} % el séptimo. En las horas en que AEMET da dato horario, aporta un 20 %.</li>
        <li><b>Probabilidad de lluvia.</b> Combina el acuerdo entre modelos (${Math.round(f.pop_mix.models * 100)} %), los 143 escenarios de los conjuntos (${Math.round(f.pop_mix.ensemble * 100)} %) y la probabilidad de AEMET (${Math.round(f.pop_mix.aemet * 100)} %).</li>
        <li><b>Confianza.</b> Alta cuando los modelos coinciden en temperatura y en si lloverá o no; baja cuando discrepan.</li>
      </ol></section>
    <section class="card"><header class="card-h"><h2>${esc(v.name)} en otras webs</h2></header>
      <ul class="links">
        <li><a href="https://www.aemet.es/es/eltiempo/prediccion/municipios/${v.slug}-id${v.ine}" target="_blank" rel="noopener">AEMET · predicción oficial ${ui('external', 13)}</a></li>
        <li><a href="https://meteologix.com/es/forecast/${v.geonames}-${v.slug}" target="_blank" rel="noopener">Meteologix ${ui('external', 13)}</a><small>Sin datos abiertos: se enlaza, no se descarga.</small></li>
        <li><a href="https://www.meteoblue.com/es/tiempo/pronostico/multimodel/${encodeURIComponent(v.name.toLowerCase())}_españa_${v.geonames}" target="_blank" rel="noopener">meteoblue · multimodelo ${ui('external', 13)}</a></li>
        <li><a href="https://www.windy.com/${v.lat}/${v.lon}?${v.lat},${v.lon},12" target="_blank" rel="noopener">Windy ${ui('external', 13)}</a></li>
        <li><a href="https://www.wunderground.com/weather/es/${encodeURIComponent(v.name.toLowerCase())}" target="_blank" rel="noopener">Weather Underground · estaciones personales ${ui('external', 13)}</a></li>
        <li><a href="https://www.embalses.net/provincia-4-caceres.html" target="_blank" rel="noopener">Embalses de Cáceres ${ui('external', 13)}</a></li>
      </ul></section>
    <section class="card"><header class="card-h"><h2>Licencias</h2></header>
      <p class="small">Datos meteorológicos de <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0), que redistribuye ECMWF, DWD, Météo-France, NOAA, Met Office, ECCC, JMA y CMA. Predicción y avisos © AEMET. Reanálisis ERA5 de Copernicus Climate Change Service. Estaciones de Meteoclimatic. Embalses: embalses.net con datos del MITECO. Radar: RainViewer. Mapas © OpenStreetMap, OpenTopoMap, Esri y CARTO.</p></section>`;
}

// --- Arranque ------------------------------------------------------------------
async function loadOverview(force = false) {
  try {
    state.overview = await api('overview.json', force ? 0 : REFRESH_MS);
    if (!state.overview.villages.some((x) => x.village.id === state.village)) state.village = 'hervas';
  } catch (err) {
    if (!state.overview) $('#view').innerHTML = errorBox(err);
    throw err;
  }
}

async function boot() {
  shell();
  parseHash();
  render();
  try {
    await loadOverview();
  } catch (e) {
    return;
  }
  parseHash();
  render();
  window.addEventListener('hashchange', () => {
    const prevView = state.view;
    const prevVillage = state.village;
    parseHash();
    if (prevView !== state.view || prevVillage !== state.village) {
      if (prevVillage !== state.village) state.day = 0;
      render();
      window.scrollTo(0, 0);
    }
  });
  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      await loadOverview(true);
      if (state.view === 'ahora') render();
      else renderChrome();
    } catch (e) {
      /* se reintenta en el siguiente ciclo */
    }
  }, REFRESH_MS);
}

boot();
