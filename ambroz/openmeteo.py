"""Open-Meteo: modelos deterministas, conjuntos (ensembles), verificación reciente y días pasados."""
import datetime as dt
import statistics

from . import config, net

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
PREVIOUS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def _coords(villages):
    return (",".join(str(v["lat"]) for v in villages), ",".join(str(v["lon"]) for v in villages),
            ",".join(str(v["elev"]) for v in villages))


def _as_list(data):
    return data if isinstance(data, list) else [data]


def fetch_models():
    """Previsión horaria de los 10 modelos para los 8 pueblos (3 peticiones agrupadas)."""
    lats, lons, elevs = _coords(config.VILLAGES)
    groups = {}
    for m in config.MODELS:
        groups.setdefault(m["group"], []).append(m["id"])
    out = {v["id"]: {"time": None, "models": {}} for v in config.VILLAGES}
    for group, ids in groups.items():
        days = config.MODEL_GROUP_DAYS[group]
        params = {
            "latitude": lats, "longitude": lons, "elevation": elevs,
            "hourly": ",".join(config.HOURLY_VARS), "models": ",".join(ids),
            "forecast_days": days, "timezone": config.TZ, "wind_speed_unit": "kmh",
        }
        weight = net.om_weight(len(config.VILLAGES), len(ids), len(config.HOURLY_VARS), days)
        data = _as_list(net.openmeteo_json(FORECAST_URL, params, weight=weight))
        for v, loc in zip(config.VILLAGES, data):
            hourly = loc["hourly"]
            times = hourly["time"]
            slot = out[v["id"]]
            if slot["time"] is None or len(times) > len(slot["time"]):
                slot["time"] = times
            for mid in ids:
                series = {}
                for var in config.HOURLY_VARS:
                    arr = hourly.get("%s_%s" % (var, mid))
                    if arr is None and len(ids) == 1:
                        arr = hourly.get(var)
                    series[var] = arr
                slot["models"][mid] = series
    # Igualar longitudes (los grupos piden distinto número de días).
    for slot in out.values():
        n = len(slot["time"])
        for series in slot["models"].values():
            for var, arr in series.items():
                arr = list(arr or [])
                series[var] = arr + [None] * (n - len(arr))
    return out


def fetch_extras():
    """Datos complementarios del mejor modelo disponible: UV, isocero y salida/puesta de sol."""
    lats, lons, elevs = _coords(config.VILLAGES)
    params = {
        "latitude": lats, "longitude": lons, "elevation": elevs,
        "hourly": "freezing_level_height,is_day,visibility,cape",
        "daily": "sunrise,sunset,daylight_duration,uv_index_max",
        "forecast_days": 16, "timezone": config.TZ,
    }
    data = _as_list(net.openmeteo_json(FORECAST_URL, params, weight=net.om_weight(len(config.VILLAGES), 1, 8, 16)))
    out = {}
    for v, loc in zip(config.VILLAGES, data):
        out[v["id"]] = {"hourly": loc["hourly"], "daily": loc["daily"]}
    return out


def fetch_ensemble():
    """Conjuntos ECMWF-ENS, GEFS, ICON-EPS y GEM (143 miembros) en el centro del valle."""
    p = config.VILLAGE_BY_ID[config.ENSEMBLE_POINT]
    params = {
        "latitude": p["lat"], "longitude": p["lon"], "elevation": p["elev"],
        "hourly": "temperature_2m,precipitation", "models": ",".join(config.ENSEMBLE_MODELS),
        "forecast_days": 15, "timezone": config.TZ,
    }
    data = net.openmeteo_json(ENSEMBLE_URL, params, weight=net.om_weight(1, 30, 2, 15))
    hourly = data["hourly"]
    times = hourly["time"]
    temps, precs = [], []
    for key, arr in hourly.items():
        if key.startswith("temperature_2m"):
            temps.append(arr)
        elif key.startswith("precipitation"):
            precs.append(arr)
    n = len(times)

    def pct(vals, q):
        vals = sorted(vals)
        if not vals:
            return None
        k = (len(vals) - 1) * q
        f = int(k)
        c = min(f + 1, len(vals) - 1)
        return vals[f] + (vals[c] - vals[f]) * (k - f)

    t_p10, t_p25, t_p50, t_p75, t_p90, p_prob, p_mean, members = [], [], [], [], [], [], [], []
    for i in range(n):
        tv = [a[i] for a in temps if a[i] is not None]
        pv = [a[i] for a in precs if a[i] is not None]
        members.append(len(tv))
        t_p10.append(_r(pct(tv, 0.10)))
        t_p25.append(_r(pct(tv, 0.25)))
        t_p50.append(_r(pct(tv, 0.50)))
        t_p75.append(_r(pct(tv, 0.75)))
        t_p90.append(_r(pct(tv, 0.90)))
        p_prob.append(_r(sum(1 for x in pv if x >= 0.1) / len(pv), 3) if pv else None)
        p_mean.append(_r(sum(pv) / len(pv), 2) if pv else None)
    # Estadística diaria por miembro.
    days = sorted({t[:10] for t in times})
    daily = []
    for d in days:
        idx = [i for i, t in enumerate(times) if t.startswith(d)]
        if len(idx) < 20:
            continue
        sums, maxs, mins = [], [], []
        for a in precs:
            vals = [a[i] for i in idx if a[i] is not None]
            if len(vals) >= 20:
                sums.append(sum(vals))
        for a in temps:
            vals = [a[i] for i in idx if a[i] is not None]
            if len(vals) >= 20:
                maxs.append(max(vals))
                mins.append(min(vals))
        if not sums:
            continue
        daily.append({
            "date": d, "members": len(sums),
            "pop1": _r(sum(1 for x in sums if x >= 1) / len(sums), 3),
            "pop10": _r(sum(1 for x in sums if x >= 10) / len(sums), 3),
            "p50": _r(pct(sums, 0.5)), "p90": _r(pct(sums, 0.9)),
            "tmax_p10": _r(pct(maxs, 0.1)), "tmax_p50": _r(pct(maxs, 0.5)), "tmax_p90": _r(pct(maxs, 0.9)),
            "tmin_p10": _r(pct(mins, 0.1)), "tmin_p50": _r(pct(mins, 0.5)), "tmin_p90": _r(pct(mins, 0.9)),
        })
    return {
        "point": config.ENSEMBLE_POINT, "elev": p["elev"], "models": config.ENSEMBLE_MODELS,
        "members": max(members) if members else 0, "time": times,
        "t_p10": t_p10, "t_p25": t_p25, "t_p50": t_p50, "t_p75": t_p75, "t_p90": t_p90,
        "p_prob": p_prob, "p_mean": p_mean, "daily": daily,
    }


def fetch_skill():
    """Error reciente de cada modelo en Hervás: previsiones a 1 y 3 días frente a ERA5.

    Se usan las previsiones que cada modelo hizo hace 1 y 3 días (Previous Runs API) y se
    comparan con el reanálisis ERA5 en los 14 últimos días con dato. De ahí sale un factor
    de corrección del peso: el modelo que más acierta pesa más.
    """
    p = config.VILLAGE_BY_ID["hervas"]
    end = dt.date.today() - dt.timedelta(days=6)
    start = end - dt.timedelta(days=13)
    ref = net.openmeteo_json(ARCHIVE_URL, {
        "latitude": p["lat"], "longitude": p["lon"], "elevation": p["elev"],
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "hourly": "temperature_2m", "models": "era5", "timezone": config.TZ,
    }, weight=1)
    ref_map = {t: x for t, x in zip(ref["hourly"]["time"], ref["hourly"]["temperature_2m"]) if x is not None}
    ids = [m["id"] for m in config.MODELS]
    prev = net.openmeteo_json(PREVIOUS_URL, {
        "latitude": p["lat"], "longitude": p["lon"], "elevation": p["elev"],
        "past_days": 21, "forecast_days": 1,
        "hourly": "temperature_2m_previous_day1,temperature_2m_previous_day3",
        "models": ",".join(ids), "timezone": config.TZ,
    }, weight=net.om_weight(1, len(ids), 2, 22))
    times = prev["hourly"]["time"]
    mae = {}
    for mid in ids:
        res = {}
        for lead in ("day1", "day3"):
            arr = prev["hourly"].get("temperature_2m_previous_%s_%s" % (lead, mid)) or []
            errs = [abs(arr[i] - ref_map[t]) for i, t in enumerate(times)
                    if i < len(arr) and arr[i] is not None and t in ref_map]
            res[lead] = round(sum(errs) / len(errs), 2) if len(errs) >= 48 else None
        mae[mid] = res
    combo = {mid: _mean([r["day1"], r["day3"]]) for mid, r in mae.items()}
    valid = [x for x in combo.values() if x]
    med = statistics.median(valid) if valid else None
    factor = {}
    for mid, x in combo.items():
        factor[mid] = round(min(1.5, max(0.6, (med / x) ** 0.8)), 3) if (x and med) else 1.0
    return {"window": [start.isoformat(), end.isoformat()], "reference": "ERA5 (horaria) en Hervás",
            "mae": mae, "factor": factor}


def fetch_recent():
    """Últimos 92 días (análisis de los modelos de alta resolución) para los 8 pueblos."""
    lats, lons, elevs = _coords(config.VILLAGES)
    params = {
        "latitude": lats, "longitude": lons, "elevation": elevs,
        "daily": ",".join(config.RECENT_DAILY_VARS), "past_days": 92, "forecast_days": 1,
        "timezone": config.TZ, "wind_speed_unit": "kmh",
    }
    data = _as_list(net.openmeteo_json(FORECAST_URL, params,
                                       weight=net.om_weight(len(config.VILLAGES), 1, len(config.RECENT_DAILY_VARS), 93)))
    out = {}
    names = {"temperature_2m_max": "tmax", "temperature_2m_min": "tmin", "temperature_2m_mean": "tmean",
             "precipitation_sum": "prcp", "snowfall_sum": "snow", "wind_speed_10m_max": "wind",
             "wind_gusts_10m_max": "gust", "wind_direction_10m_dominant": "wdir", "pressure_msl_mean": "pres",
             "relative_humidity_2m_mean": "rh"}
    for v, loc in zip(config.VILLAGES, data):
        d = loc["daily"]
        rec = {"time": d["time"]}
        for var, short in names.items():
            rec[short] = d.get(var)
        out[v["id"]] = rec
    return out


def _r(x, nd=1):
    return None if x is None else round(x, nd)


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None
