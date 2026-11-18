"""Construye las respuestas JSON que consume la página."""
import datetime as dt
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from . import aemet, blend, config, history, net, openmeteo, stations

log = logging.getLogger("ambroz")
_build_lock = threading.Lock()
_blend_memo = {}

SOURCES = [
    {"id": "models", "name": "Modelos numéricos (10)", "via": "Open-Meteo", "url": "https://open-meteo.com/",
     "what": "ECMWF IFS y AIFS, UKMO, AROME/ARPEGE, ICON, GFS, AIGFS, GEM, GSM y GRAPES, hora a hora."},
    {"id": "ensemble", "name": "Conjuntos (ensembles)", "via": "Open-Meteo", "url": "https://open-meteo.com/en/docs/ensemble-api",
     "what": "143 escenarios de ECMWF, GEFS, ICON-EPS y GEM para estimar la probabilidad de lluvia."},
    {"id": "skill", "name": "Verificación de modelos", "via": "Open-Meteo Previous Runs + ERA5",
     "url": "https://open-meteo.com/en/docs/previous-runs-api",
     "what": "Error de cada modelo en los últimos 14 días; ajusta su peso."},
    {"id": "aemet", "name": "AEMET · predicción por municipios", "via": "AEMET (XML abierto)",
     "url": "https://www.aemet.es/es/eltiempo/prediccion/municipios",
     "what": "Predicción oficial diaria y horaria de los 8 municipios."},
    {"id": "aemet_obs", "name": "AEMET · estación de Hervás (3504X)", "via": "AEMET OpenData",
     "url": "https://www.aemet.es/es/eltiempo/observacion/ultimosdatos?k=ext&l=3504X&w=0&datos=det&x=h24",
     "what": "Observación oficial horaria. Requiere clave gratuita (AEMET_API_KEY)."},
    {"id": "meteoalarm", "name": "Avisos AEMET (Meteoalerta)", "via": "MeteoAlarm", "url": "https://meteoalarm.org/",
     "what": "Avisos amarillos, naranjas y rojos de la zona Norte de Cáceres."},
    {"id": "meteoclimatic", "name": "Estaciones de aficionados", "via": "Meteoclimatic",
     "url": "https://www.meteoclimatic.net/", "what": "Observaciones en tiempo real a menos de 45 km."},
    {"id": "embalses", "name": "Embalses", "via": "embalses.net (datos del MITECO y SAIH Tajo)",
     "url": "https://www.embalses.net/", "what": "Agua embalsada semanal y lecturas en tiempo real."},
    {"id": "recent", "name": "Últimos 92 días", "via": "Open-Meteo (análisis de modelos)",
     "url": "https://open-meteo.com/", "what": "Temperatura, lluvia, viento y presión día a día en cada pueblo."},
    {"id": "history", "name": "Serie histórica desde 1940", "via": "ERA5 (Copernicus) vía Open-Meteo",
     "url": "https://open-meteo.com/en/docs/historical-weather-api",
     "what": "Reanálisis diario: récords, normales 1991-2020 y tendencias."},
    {"id": "q15", "name": "Lluvia cada 15 minutos", "via": "Open-Meteo (AROME, Météo-France)",
     "url": "https://open-meteo.com/en/docs/meteofrance-api",
     "what": "Lluvia de las próximas 8 horas en cada pueblo, a 1,3 km de resolución."},
    {"id": "raingrid", "name": "Mapa de lluvia prevista", "via": "Open-Meteo (AROME / ARPEGE)",
     "url": "https://open-meteo.com/en/docs/meteofrance-api",
     "what": "Lluvia hora a hora en 120 puntos alrededor del valle para las próximas 36 horas."},
    {"id": "radar", "name": "Radar de precipitación", "via": "RainViewer", "url": "https://www.rainviewer.com/",
     "what": "Mosaico de radar de las últimas 2 horas y su extrapolación a una hora (se calcula en el navegador)."},
]


def _get(key, ttl, producer, source=None):
    try:
        return net.cached(key, ttl, producer, source=source or key)
    except Exception as err:  # noqa: BLE001
        log.warning("Sin datos de %s: %s", key, err)
        return None, {"updated": None, "stale": True, "error": str(err)[:240]}


def models():
    return _get("models", config.TTL["models"], openmeteo.fetch_models)


def extras():
    return _get("extras", config.TTL["extras"], openmeteo.fetch_extras, "models")


def ensemble():
    return _get("ensemble", config.TTL["ensemble"], openmeteo.fetch_ensemble)


def skill():
    return _get("skill", config.TTL["skill"], openmeteo.fetch_skill)


def recent():
    return _get("recent", config.TTL["recent"], openmeteo.fetch_recent)


def q15():
    return _get("q15", config.TTL["q15"], openmeteo.fetch_q15)


def rain_grid():
    return _get("raingrid", config.TTL["raingrid"], openmeteo.fetch_rain_grid)


def aemet_daily(v):
    return _get("aemet_d_" + v["ine"], config.TTL["aemet"], lambda: aemet.daily(v["ine"]), "aemet")


def aemet_hourly(v):
    return _get("aemet_h_" + v["ine"], config.TTL["aemet"], lambda: aemet.hourly(v["ine"]), "aemet")


def warnings():
    data, meta = _get("meteoalarm", config.TTL["meteoalarm"], stations.warnings)
    if data:
        now = dt.datetime.now(dt.timezone.utc)
        items = [a for a in data["items"] if dt.datetime.fromisoformat(a["expires"]) >= now]
        data = dict(data, items=items)
    return data, meta


def _normals(v):
    try:
        s = history.summary(v)
        return s["normals"]["daily"] if s else None
    except Exception as err:  # noqa: BLE001
        log.warning("Normales no disponibles: %s", err)
        return None


def village_blend(v):
    raw, m_meta = models()
    if not raw:
        raise net.FetchError("No hay datos de modelos todavía. Revisa la conexión a internet.")
    ext, _ = extras()
    ens, _ = ensemble()
    sk, _ = skill()
    ad, _ = aemet_daily(v)
    ah, _ = aemet_hourly(v)
    key = (v["id"], m_meta.get("updated"), blend.now_local().strftime("%Y-%m-%dT%H"), bool(ens), bool(sk), bool(ad))
    if key in _blend_memo:
        return _blend_memo[key]
    res = blend.blend(v, raw[v["id"]], sk, (ext or {}).get(v["id"]), ens, ad, ah, _normals(v))
    res["updated"] = {"models": m_meta.get("updated"), "stale": m_meta.get("stale", False)}
    res["aemet"] = {"daily": ad, "hourly_elaborado": (ah or {}).get("elaborado")}
    res["skill"] = sk
    res["ensemble_info"] = ({"members": ens["members"], "models": ens["models"], "point": ens["point"]} if ens else None)
    if len(_blend_memo) > 32:
        _blend_memo.clear()
    _blend_memo[key] = res
    return res


def _warm():
    """Descarga en paralelo lo que necesita la portada."""
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = [pool.submit(models), pool.submit(extras), pool.submit(ensemble), pool.submit(skill),
                pool.submit(warnings)]
        for v in config.VILLAGES:
            jobs.append(pool.submit(aemet_daily, v))
            jobs.append(pool.submit(aemet_hourly, v))
        for j in jobs:
            j.result()


def overview():
    with _build_lock:
        _warm()
    out = []
    for v in config.VILLAGES:
        try:
            b = village_blend(v)
        except Exception as err:  # noqa: BLE001
            out.append({"village": v, "error": str(err)})
            continue
        i = b["i_now"]
        h = b["hourly"]
        next24 = []
        for k in range(i, min(i + 25, len(h["time"]))):
            next24.append({"time": h["time"][k], "t": h["t"][k], "sym": h["sym"][k], "pop": h["pop"][k],
                           "precip": h["precip"][k], "is_day": h["is_day"][k], "wind": h["wind"][k],
                           "gust": h["gust"][k], "dir": h["dir"][k]})
        days = [{k: d[k] for k in ("date", "k", "tmax", "tmin", "sym", "label", "pop", "prcp", "gust", "dir_name",
                                   "conf_label", "text", "normal_tmax", "normal_tmin", "snow_level", "sunrise",
                                   "sunset", "uv", "aemet")} for d in b["daily"][:8]]
        rain = {"windows": [{k: w[k] for k in ("hours", "pop", "mm", "intensity")} for w in b["rain"]["windows"]],
                "timing": b["rain"]["timing"]}
        out.append({"village": v, "now": b["now"], "next24": next24, "days": days, "rain": rain,
                    "updated": b["updated"]})
    al, _ = warnings()
    return {"generated": blend.now_local().isoformat(timespec="seconds"), "villages": out,
            "warnings": al, "status": status()}


def village(vid):
    v = config.VILLAGE_BY_ID[vid]
    b = village_blend(v)
    return {"generated": blend.now_local().isoformat(timespec="seconds"), "village": v,
            "now": b["now"], "i_now": b["i_now"], "hourly": b["hourly"], "daily": b["daily"],
            "models": b["models"], "weights": b["weights"], "skill": b["skill"],
            "ensemble": b["ensemble_info"], "aemet": b["aemet"], "updated": b["updated"],
            "model_meta": [{k: m.get(k) for k in ("id", "name", "org", "res", "note")} for m in config.MODELS]}


def lluvia():
    """¿Lloverá? Ventanas de 1 a 24 h por pueblo, lluvia cada 15 min y mapa de lluvia prevista."""
    with _build_lock:
        _warm()
    q, q_meta = q15()
    grid, g_meta = rain_grid()
    now = blend.now_local()
    now_s = now.strftime("%Y-%m-%dT%H:%M")
    out = []
    for v in config.VILLAGES:
        try:
            b = village_blend(v)
        except Exception as err:  # noqa: BLE001
            out.append({"village": v, "error": str(err)})
            continue
        h = b["hourly"]
        i = b["i_now"]
        qv = (q or {}).get(v["id"]) or {"time": [], "mm": []}
        keep = [k for k, t in enumerate(qv["time"]) if t > now_s][:24]
        out.append({
            "village": v, "now": {k: b["now"][k] for k in ("t", "sym", "is_day", "precip", "pop", "label")},
            "rain": b["rain"],
            "next24": {"time": h["time"][i + 1:i + 25], "precip": h["precip"][i + 1:i + 25],
                       "pop": h["pop"][i + 1:i + 25], "hi": h["precip_hi"][i + 1:i + 25],
                       "sym": h["sym"][i + 1:i + 25], "is_day": h["is_day"][i + 1:i + 25]},
            "q15": {"time": [qv["time"][k] for k in keep], "mm": [qv["mm"][k] for k in keep]},
        })
    return {"generated": now.isoformat(timespec="seconds"), "now": now_s, "villages": out,
            "grid": grid, "grid_updated": g_meta.get("updated"), "q15_updated": q_meta.get("updated"),
            "windows": config.RAIN_WINDOWS, "pop_mix": config.POP_MIX, "model": config.RAIN_MODEL_NAME}


def history_view(vid):
    v = config.VILLAGE_BY_ID[vid]
    rec, meta = recent()
    rv = (rec or {}).get(vid)
    summary = None
    if history.load():
        try:
            summary = history.summary(v, rv)
        except Exception as err:  # noqa: BLE001
            log.exception("Error calculando el histórico: %s", err)
    all_recent = {}
    if rec:
        for other in config.VILLAGES:
            r = rec.get(other["id"])
            if r:
                all_recent[other["id"]] = {"time": r["time"][-31:], "tmax": r["tmax"][-31:], "tmin": r["tmin"][-31:],
                                           "prcp": r["prcp"][-31:]}
    return {"generated": blend.now_local().isoformat(timespec="seconds"), "village": v,
            "recent": rv, "recent_updated": meta.get("updated"), "all_recent": all_recent,
            "summary": summary, "progress": dict(history.PROGRESS), "ready": history.is_ready()}


def reservoirs():
    data, meta = _get("embalses", config.TTL["embalses"], stations.reservoirs)
    return {"generated": blend.now_local().isoformat(timespec="seconds"), "data": data, "meta": meta}


def observations():
    mc, mc_meta = _get("meteoclimatic", config.TTL["meteoclimatic"], stations.meteoclimatic)
    obs = None
    obs_meta = {"updated": None, "error": None}
    if config.AEMET_API_KEY:
        st = config.AEMET_STATIONS[0]
        obs, obs_meta = _get("aemet_obs", config.TTL["aemet_obs"], lambda: aemet.station_obs(st["id"]))
    else:
        net.STATUS["aemet_obs"] = {"ok": False, "optional": True, "updated": None,
                                   "error": "Opcional: añade una clave gratuita de AEMET OpenData (AEMET_API_KEY)."}
    return {"generated": blend.now_local().isoformat(timespec="seconds"),
            "aemet": {"station": config.AEMET_STATIONS[0], "rows": obs, "meta": obs_meta,
                      "has_key": bool(config.AEMET_API_KEY)},
            "meteoclimatic": {"items": mc or [], "meta": mc_meta}}


def status():
    out = []
    for s in SOURCES:
        st = net.STATUS.get(s["id"])
        if s["id"] == "history":
            h = history.load()
            st = {"ok": bool(h and h["time"]), "updated": None,
                  "error": None if (h and h["time"]) else "Descargando la serie histórica…",
                  "coverage": [h["time"][0], h["time"][-1]] if h and h["time"] else None}
        if s["id"] == "radar":
            st = {"ok": True, "updated": None, "error": None, "client": True}
        out.append(dict(s, status=st))
    return out


def sources():
    return {"generated": blend.now_local().isoformat(timespec="seconds"), "sources": status(),
            "models": config.MODELS, "aemet_share": config.AEMET_SHARE, "pop_mix": config.POP_MIX,
            "villages": config.VILLAGES, "history_progress": dict(history.PROGRESS)}
