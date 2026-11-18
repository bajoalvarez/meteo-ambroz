// Mapas con Leaflet: relieve del valle, temperatura de cada pueblo, radar de lluvia
// (RainViewer), estaciones y embalses.
import { wx, ui } from './icons.js';
import { temp, mm, kmh, esc, tempRGB, inkOn, num, agoIso } from './util.js';

const VALLEY = [40.272, -5.9];

const BASES = {
  Relieve: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, subdomains: 'abc',
    attribution: 'Mapa © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · datos © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  Callejero: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  Satélite: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
  }),
  Oscuro: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'tiles-dark', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
};

export const MAP_VARS = {
  now: { label: 'Ahora', get: (v) => v.now?.t, fmt: temp, color: true },
  max: { label: 'Máx. hoy', get: (v) => v.days?.[0]?.tmax, fmt: temp, color: true },
  min: { label: 'Mín. hoy', get: (v) => v.days?.[0]?.tmin, fmt: temp, color: true },
  rain: { label: 'Lluvia hoy', get: (v) => v.days?.[0]?.prcp, fmt: (x) => (x == null ? '–' : `${num(x, x < 10 ? 1 : 0)}`), unit: 'mm' },
  gust: { label: 'Racha hoy', get: (v) => v.days?.[0]?.gust, fmt: (x) => (x == null ? '–' : `${Math.round(x)}`), unit: 'km/h' },
};

export function fitValley(ctl, points, pad = 24) {
  const b = L.latLngBounds(points);
  requestAnimationFrame(() => {
    ctl.map.invalidateSize();
    ctl.map.fitBounds(b, { padding: [pad, pad], maxZoom: 12 });
  });
}

export function createMap(el, { zoom = 11, onSelect, full = false, base = null } = {}) {
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: full, attributionControl: true, zoomSnap: 0.5 })
    .setView(VALLEY, zoom);
  const bases = {};
  for (const [name, mk] of Object.entries(BASES)) bases[name] = mk();
  const dark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  bases[base && bases[base] ? base : full ? 'Relieve' : dark ? 'Oscuro' : 'Relieve'].addTo(map);
  const villages = L.layerGroup().addTo(map);
  const stations = L.layerGroup();
  const reservoirs = L.layerGroup();
  const ctl = { map, bases, villages, stations, reservoirs, radar: null, onSelect, variable: 'now' };
  // Leaflet necesita recalcular su tamaño cuando cambia el del contenedor.
  const zoomClass = () => el.classList.toggle('z-hi', map.getZoom() >= 11.5);
  map.on('zoomend', zoomClass);
  zoomClass();
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(el);
  map.on('unload', () => ro.disconnect());
  if (full) {
    stations.addTo(map);
    reservoirs.addTo(map);
    L.control.layers(bases, { Pueblos: villages, Estaciones: stations, Embalses: reservoirs }, { collapsed: true, position: 'topright' }).addTo(map);
  }
  return ctl;
}

export function drawVillages(ctl, overview, selectedId) {
  const def = MAP_VARS[ctl.variable] || MAP_VARS.now;
  ctl.villages.clearLayers();
  for (const item of overview.villages) {
    const v = item.village;
    const val = def.get(item);
    const rgb = def.color ? tempRGB(val) : null;
    const style = rgb ? `--vm-bg:rgb(${rgb.join(',')});--vm-ink:${inkOn(rgb)}` : '';
    const sym = item.now?.sym;
    const html = `<button class="vmark${v.id === selectedId ? ' sel' : ''}" style="${style}" aria-label="${esc(v.name)}: ${esc(def.fmt(val))}">
        <span class="vmark-ic">${wx(sym, item.now?.is_day, 26)}</span>
        <span class="vmark-val${def.color ? '' : ' plain'}">${esc(def.fmt(val))}${def.unit ? `<small>${def.unit}</small>` : ''}</span>
        <span class="vmark-name">${esc(v.name)}</span></button>`;
    const icon = L.divIcon({ className: 'vmark-wrap', html, iconSize: null, iconAnchor: [0, 0] });
    const mk = L.marker([v.lat, v.lon], { icon, keyboard: false, riseOnHover: true, zIndexOffset: v.id === selectedId ? 500 : 0 });
    mk.on('click', () => ctl.onSelect && ctl.onSelect(v.id));
    mk.addTo(ctl.villages);
  }
}

export function drawStations(ctl, obs) {
  ctl.stations.clearLayers();
  const st = obs?.aemet?.station;
  if (st) {
    const last = obs.aemet.rows?.[obs.aemet.rows.length - 1];
    const icon = L.divIcon({ className: 'smark-wrap', html: `<span class="smark official">${ui('station', 14)}${last ? `<b>${temp(last.ta)}</b>` : ''}</span>`, iconSize: null });
    L.marker([st.lat, st.lon], { icon }).bindPopup(`<b>${esc(st.name)}</b><br>Estación oficial AEMET · ${st.elev} m<br>${last ? `${temp(last.ta)} · ${num(last.hr, 0)} % · ${kmh(last.vv)}` : 'Datos con clave AEMET OpenData'}<br><a href="https://www.aemet.es/es/eltiempo/observacion/ultimosdatos?k=ext&l=3504X&w=0&datos=det&x=h24" target="_blank" rel="noopener">Ver en AEMET</a>`).addTo(ctl.stations);
  }
  for (const s of obs?.meteoclimatic?.items || []) {
    const icon = L.divIcon({ className: 'smark-wrap', html: `<span class="smark">${ui('station', 13)}<b>${temp(s.t)}</b></span>`, iconSize: null });
    L.marker([s.lat, s.lon], { icon }).bindPopup(`<b>${esc(s.name)}</b><br>Meteoclimatic · a ${num(s.km)} km<br>${temp(s.t)} · ${num(s.rh, 0)} % · lluvia hoy ${mm(s.rain)}<br>Viento ${kmh(s.wind)}, racha ${kmh(s.gust)}<br><small>${agoIso(s.updated)}</small><br><a href="${esc(s.url)}" target="_blank" rel="noopener">Ficha de la estación</a>`).addTo(ctl.stations);
  }
}

export function drawReservoirs(ctl, data) {
  ctl.reservoirs.clearLayers();
  for (const r of data?.items || []) {
    const icon = L.divIcon({ className: 'rmark-wrap', html: `<span class="rmark">${ui('drop', 13)}<b>${Math.round(r.pct)} %</b></span>`, iconSize: null });
    L.marker([r.lat, r.lon], { icon }).bindPopup(`<b>Embalse de ${esc(r.name)}</b><br>${num(r.hm3, 0)} de ${num(r.capacity, 0)} hm³ (${num(r.pct)} %)<br><small>${esc(r.where)}</small>`).addTo(ctl.reservoirs);
  }
}

// Radar RainViewer --------------------------------------------------------
export async function addRadar(ctl, ui) {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!res.ok) throw new Error('Radar no disponible');
  const meta = await res.json();
  const frames = [...(meta.radar?.past || []), ...(meta.radar?.nowcast || [])];
  if (!frames.length) throw new Error('Radar sin imágenes');
  const layers = frames.map((f) => L.tileLayer(`${meta.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
    opacity: 0, zIndex: 400, maxNativeZoom: 7, maxZoom: 18,
    attribution: 'Radar © <a href="https://www.rainviewer.com/">RainViewer</a>',
  }));
  const nPast = meta.radar?.past?.length || 0;
  const radar = { frames, layers, i: nPast - 1, timer: null, on: false };
  ctl.radar = radar;
  const show = (i) => {
    radar.layers.forEach((l, k) => l.setOpacity(k === i ? 0.72 : 0));
    radar.i = i;
    const d = new Date(frames[i].time * 1000);
    if (ui?.label) ui.label.textContent = `${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${i >= nPast ? ' · previsión' : ''}`;
    if (ui?.slider) ui.slider.value = i;
  };
  radar.show = show;
  radar.enable = () => {
    layers.forEach((l) => l.addTo(ctl.map));
    radar.on = true;
    show(radar.i);
  };
  radar.disable = () => {
    radar.stop();
    layers.forEach((l) => ctl.map.removeLayer(l));
    radar.on = false;
  };
  radar.play = () => {
    radar.stop();
    radar.timer = setInterval(() => show((radar.i + 1) % frames.length), 700);
  };
  radar.stop = () => {
    clearInterval(radar.timer);
    radar.timer = null;
  };
  if (ui?.slider) {
    ui.slider.max = frames.length - 1;
    ui.slider.value = radar.i;
  }
  return radar;
}
