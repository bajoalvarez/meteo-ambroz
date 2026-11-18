"""Mezcla ponderada de los 10 modelos, los conjuntos y la predicción oficial de AEMET.

Peso de cada modelo en cada hora:
    peso = base × refuerzo(hora) × acierto_reciente, suavizado con el horizonte
           y reducido en las últimas 18 h antes de que el modelo deje de tener datos.
La probabilidad de lluvia combina tres fuentes: el acuerdo entre modelos, los
143 miembros de los conjuntos y la probabilidad oficial de AEMET.
"""
import datetime as dt
import math
from zoneinfo import ZoneInfo

from . import config

TZ = ZoneInfo(config.TZ)
SYMBOL_LABEL = {
    "despejado": "Despejado", "poco-nuboso": "Poco nuboso", "intervalos": "Intervalos nubosos",
    "nuboso": "Nuboso", "cubierto": "Cubierto", "niebla": "Niebla", "lluvia-debil": "Lluvia débil",
    "lluvia": "Lluvia", "lluvia-fuerte": "Lluvia fuerte", "chubascos": "Chubascos", "tormenta": "Tormenta",
    "nieve": "Nieve", "aguanieve": "Aguanieve",
}
DIRS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
AEMET_DIR = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SO": 225, "O": 270, "NO": 315}
PARTS = [("madrugada", 0, 6), ("mañana", 6, 12), ("tarde", 12, 20), ("noche", 20, 24)]
WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def now_local():
    return dt.datetime.now(TZ)


def _r(x, nd=1):
    return None if x is None else round(x, nd)


def model_weight(m, lead, rem, skill):
    w = m["base"] * skill
    for limit, factor in m.get("boost", []):
        if lead <= limit:
            w *= factor
    g = 1.0 if lead <= 72 else max(0.5, 1.0 - 0.5 * (lead - 72) / 168.0)
    w = w ** g
    if rem < 18:
        w *= max(0.0, (rem + 1) / 19.0)
    return w


def _wmean(pairs):
    s = sw = 0.0
    for x, w in pairs:
        if x is not None and w > 0:
            s += x * w
            sw += w
    return s / sw if sw > 0 else None


def _wfrac(pairs, cond):
    s = sw = 0.0
    for x, w in pairs:
        if x is not None and w > 0:
            sw += w
            if cond(x):
                s += w
    return s / sw if sw > 0 else None


def _wstd(pairs, mu):
    s = sw = 0.0
    for x, w in pairs:
        if x is not None and w > 0 and mu is not None:
            s += w * (x - mu) ** 2
            sw += w
    return math.sqrt(s / sw) if sw > 0 else None


def dir_name(deg):
    if deg is None:
        return None
    return DIRS[int((deg % 360) / 45.0 + 0.5) % 8]


def apparent(t, rh, wind_kmh):
    """Temperatura aparente (Steadman), la misma fórmula que usa Open-Meteo."""
    if t is None or rh is None or wind_kmh is None:
        return None
    e = rh / 100.0 * 6.105 * math.exp(17.27 * t / (237.7 + t))
    return t + 0.33 * e - 0.70 * (wind_kmh / 3.6) - 4.0


def symbol(cloud, precip, pop, snow_frac, storm, fog, hourly=True):
    if storm is not None and storm >= 0.3 and (pop or 0) >= 0.3:
        return "tormenta"
    threshold = 0.1 if hourly else 1.0
    if (precip or 0) >= threshold and (pop or 0) >= (0.35 if hourly else 0.45):
        if (snow_frac or 0) >= 0.7:
            return "nieve"
        if (snow_frac or 0) >= 0.3:
            return "aguanieve"
        if cloud is not None and cloud < 65:
            return "chubascos"
        if hourly:
            return "lluvia-debil" if precip < 0.5 else "lluvia" if precip < 4 else "lluvia-fuerte"
        return "lluvia-debil" if precip < 4 else "lluvia" if precip < 20 else "lluvia-fuerte"
    if fog is not None and fog >= 0.4:
        return "niebla"
    c = cloud if cloud is not None else 50
    if c < 15:
        return "despejado"
    if c < 35:
        return "poco-nuboso"
    if c < 62:
        return "intervalos"
    if c < 85:
        return "nuboso"
    return "cubierto"


def aemet_symbol(code):
    if not code:
        return None, True
    night = code.endswith("n")
    c = int(code.rstrip("n") or 0)
    table = {11: "despejado", 12: "poco-nuboso", 13: "intervalos", 14: "nuboso", 15: "nuboso", 16: "cubierto",
             17: "poco-nuboso", 23: "chubascos", 24: "lluvia", 25: "lluvia", 26: "lluvia", 43: "chubascos",
             44: "lluvia-debil", 45: "lluvia-debil", 46: "lluvia-debil", 81: "niebla", 82: "niebla", 83: "niebla"}
    if c in table:
        return table[c], not night
    if 33 <= c <= 36 or 71 <= c <= 74:
        return "nieve", not night
    if 51 <= c <= 64:
        return "tormenta", not night
    return "nuboso", not night


def _snow_frac(precip, snow_cm):
    if not precip or precip <= 0 or snow_cm is None:
        return 0.0
    return min(1.0, (snow_cm * 10.0 / 7.0) / precip)


def _aemet_prob(probs, date, hour):
    """Probabilidad AEMET (por tramos) que cubre una hora concreta."""
    prev = (dt.date.fromisoformat(date) - dt.timedelta(days=1)).isoformat()
    for p in probs:
        if p["tipo"] != "precipitacion":
            continue
        a, b = int(p["desde"]), int(p["hasta"])
        if a < b and p["fecha"] == date and a <= hour < b:
            return p["valor"]
        if a > b and ((p["fecha"] == date and hour >= a) or (p["fecha"] == prev and hour < b)):
            return p["valor"]
    return None


def blend(v, raw, skill, extras, ens, aemet_d, aemet_h, normals):
    times = raw["time"]
    n = len(times)
    now = now_local()
    cur = now.strftime("%Y-%m-%dT%H:00")
    i_now = times.index(cur) if cur in times else (0 if cur < times[0] else n - 1)
    models = [m for m in config.MODELS if m["id"] in raw["models"]]
    S = {m["id"]: raw["models"][m["id"]] for m in models}
    ends = {}
    for mid, s in S.items():
        ends[mid] = max((i for i, x in enumerate(s["temperature_2m"]) if x is not None), default=-1)
    factor = (skill or {}).get("factor", {})

    W = {mid: [0.0] * n for mid in S}
    for i in range(n):
        lead = max(0, i - i_now)
        for m in models:
            mid = m["id"]
            if S[mid]["temperature_2m"][i] is None:
                continue
            W[mid][i] = model_weight(m, lead, ends[mid] - i, factor.get(mid, 1.0))

    a_rows = {r["time"]: r for r in (aemet_h or {}).get("horas", [])}
    a_probs = (aemet_h or {}).get("probs", [])
    e_idx = {t: k for k, t in enumerate(ens["time"])} if ens else {}
    e_shift = -(v["elev"] - ens["elev"]) * config.LAPSE_RATE if ens else 0.0
    x_hourly = (extras or {}).get("hourly", {})
    x_idx = {t: k for k, t in enumerate(x_hourly.get("time", []))}

    H = {k: [] for k in ("t", "t_lo", "t_hi", "feels", "rh", "precip", "precip_hi", "pop", "snow", "cloud", "wind",
                         "gust", "dir", "pres", "storm", "fog", "sym", "is_day", "ens_lo", "ens_hi", "freezing")}
    for i in range(n):
        def pairs(var):
            return [(S[mid][var][i], W[mid][i]) for mid in S]

        t = _wmean(pairs("temperature_2m"))
        temps = [x for x, w in pairs("temperature_2m") if x is not None and w > 0]
        precip = _wmean(pairs("precipitation"))
        precs = [x for x, w in pairs("precipitation") if x is not None and w > 0]
        pop_det = _wfrac(pairs("precipitation"), lambda x: x >= 0.1)
        snow = _wmean(pairs("snowfall"))
        cloud = _wmean(pairs("cloud_cover"))
        wind = _wmean(pairs("wind_speed_10m"))
        gust = _wmean(pairs("wind_gusts_10m"))
        rh = _wmean(pairs("relative_humidity_2m"))
        pres = _wmean(pairs("pressure_msl"))
        storm = _wfrac(pairs("weather_code"), lambda c: c >= 95)
        fog = _wfrac(pairs("weather_code"), lambda c: c in (45, 48))
        u = vv = 0.0
        for mid in S:
            d, ws, w = S[mid]["wind_direction_10m"][i], S[mid]["wind_speed_10m"][i], W[mid][i]
            if d is not None and ws is not None and w > 0:
                u += w * ws * math.sin(math.radians(d))
                vv += w * ws * math.cos(math.radians(d))
        wdir = (math.degrees(math.atan2(u, vv)) + 360) % 360 if (u or vv) else None

        # Predicción horaria oficial de AEMET (2-3 días): 20 % del peso.
        ar = a_rows.get(times[i])
        if ar and t is not None and ar.get("temp") is not None:
            t = 0.8 * t + 0.2 * ar["temp"]
        if ar and precip is not None and ar.get("precip") is not None:
            precip = 0.8 * precip + 0.2 * ar["precip"]
        pop = pop_det
        k = e_idx.get(times[i])
        ens_lo = ens_hi = None
        if k is not None:
            if ens["p_prob"][k] is not None and pop is not None:
                pop = 0.6 * pop + 0.4 * ens["p_prob"][k]
            if ens["t_p10"][k] is not None:
                ens_lo, ens_hi = ens["t_p10"][k] + e_shift, ens["t_p90"][k] + e_shift
        ap = _aemet_prob(a_probs, times[i][:10], int(times[i][11:13])) if a_probs else None
        if ap is not None and pop is not None:
            pop = 0.8 * pop + 0.2 * ap / 100.0
        xk = x_idx.get(times[i])
        is_day = x_hourly.get("is_day", [None])[xk] if xk is not None else None
        if is_day is None:
            hh = int(times[i][11:13])
            is_day = 1 if 8 <= hh < 19 else 0
        freezing = x_hourly.get("freezing_level_height", [None])[xk] if xk is not None else None

        H["t"].append(_r(t))
        H["t_lo"].append(_r(min(temps)) if temps else None)
        H["t_hi"].append(_r(max(temps)) if temps else None)
        H["feels"].append(_r(apparent(t, rh, wind)))
        H["rh"].append(_r(rh, 0))
        H["precip"].append(_r(precip, 2))
        H["precip_hi"].append(_r(max(precs), 2) if precs else None)
        H["pop"].append(_r(pop, 2))
        H["snow"].append(_r(snow, 2))
        H["cloud"].append(_r(cloud, 0))
        H["wind"].append(_r(wind, 0))
        H["gust"].append(_r(gust, 0))
        H["dir"].append(_r(wdir, 0))
        H["pres"].append(_r(pres, 1))
        H["storm"].append(_r(storm, 2))
        H["fog"].append(_r(fog, 2))
        H["sym"].append(symbol(cloud, precip, pop, _snow_frac(precip, snow), storm, fog, True) if t is not None else None)
        H["is_day"].append(is_day)
        H["ens_lo"].append(_r(ens_lo))
        H["ens_hi"].append(_r(ens_hi))
        H["freezing"].append(freezing)

    last = max((i for i in range(n) if H["t"][i] is not None), default=n - 1)
    for key in H:
        H[key] = H[key][: last + 1]
    times = times[: last + 1]
    n = len(times)

    daily, model_daily = _daily(v, times, S, W, H, ends, factor, i_now, models, extras, ens, aemet_d, normals)

    def at(arr, i):
        return arr[i] if 0 <= i < len(arr) else None

    def interp(arr):
        a, b = at(arr, i_now), at(arr, i_now + 1)
        if a is None:
            return b
        if b is None:
            return a
        return a + (b - a) * now.minute / 60.0

    p_now, p_3h = at(H["pres"], i_now), at(H["pres"], i_now - 3)
    tendency = None
    if p_now is not None and p_3h is not None:
        dp = p_now - p_3h
        tendency = {"dp": round(dp, 1), "label": "subiendo" if dp > 0.8 else "bajando" if dp < -0.8 else "estable"}
    t_now = interp(H["t"])
    nowinfo = {
        "time": now.strftime("%Y-%m-%dT%H:%M"), "t": _r(t_now), "feels": _r(interp(H["feels"])),
        "rh": _r(interp(H["rh"]), 0), "wind": _r(interp(H["wind"]), 0), "gust": _r(interp(H["gust"]), 0),
        "dir": at(H["dir"], i_now), "dir_name": dir_name(at(H["dir"], i_now)), "pres": _r(interp(H["pres"]), 1),
        "pres_tendency": tendency, "cloud": at(H["cloud"], i_now), "precip": at(H["precip"], i_now),
        "pop": at(H["pop"], i_now), "sym": at(H["sym"], i_now), "is_day": at(H["is_day"], i_now),
        "t_lo": at(H["t_lo"], i_now), "t_hi": at(H["t_hi"], i_now),
        "rain_next3": _r(sum(x or 0 for x in H["precip"][i_now:i_now + 3]), 1),
        "rain_next24": _r(sum(x or 0 for x in H["precip"][i_now:i_now + 24]), 1),
        "label": SYMBOL_LABEL.get(at(H["sym"], i_now) or "", ""),
    }

    weights = []
    for m in models:
        mid = m["id"]
        row = {"id": mid, "name": m["name"], "org": m["org"], "res": m["res"], "base": m["base"],
               "boost": m.get("boost", []), "note": m.get("note", ""), "skill": factor.get(mid, 1.0),
               "mae": (skill or {}).get("mae", {}).get(mid), "horizon": times[min(ends[mid], n - 1)] if ends[mid] >= 0 else None}
        for label, lead in (("w_now", 3), ("w_d3", 72), ("w_d7", 168), ("w_d12", 288)):
            i = min(n - 1, i_now + lead)
            tot = sum(W[x][i] for x in W)
            row[label] = round(W[mid][i] / tot, 3) if tot else 0
        weights.append(row)

    model_series = {}
    horizon = min(n, i_now + 24 * 10 + 1)
    start = max(0, i_now - 6)
    for mid, s in S.items():
        model_series[mid] = {
            "t": [_r(x) for x in s["temperature_2m"][start:horizon]],
            "precip": [_r(x, 2) for x in s["precipitation"][start:horizon]],
            "gust": [_r(x, 0) for x in s["wind_gusts_10m"][start:horizon]],
            "cloud": [_r(x, 0) for x in s["cloud_cover"][start:horizon]],
        }

    rain = rain_outlook(times, S, W, H, i_now, ens, aemet_h, now)
    nowinfo["rain_next3"] = rain["next3"]
    nowinfo["rain_next24"] = next((w["mm"] for w in rain["windows"] if w["hours"] == 24), nowinfo["rain_next24"])

    return {
        "now": nowinfo, "i_now": i_now, "rain": rain,
        "hourly": dict(time=times, **H),
        "daily": daily,
        "models": {"start": start, "time": times[start:horizon], "series": model_series, "daily": model_daily},
        "weights": weights,
    }


def _daily(v, times, S, W, H, ends, factor, i_now, models, extras, ens, aemet_d, normals):
    dates = []
    for t in times:
        if t[:10] not in dates:
            dates.append(t[:10])
    by_date = {}
    for i, t in enumerate(times):
        by_date.setdefault(t[:10], []).append(i)
    a_days = {d["fecha"]: d for d in (aemet_d or {}).get("dias", [])}
    e_days = {d["date"]: d for d in (ens or {}).get("daily", [])}
    e_shift = -(v["elev"] - ens["elev"]) * config.LAPSE_RATE if ens else 0.0
    xd = (extras or {}).get("daily", {})
    x_pos = {d: k for k, d in enumerate(xd.get("time", []))}
    today = now_local().date()
    out, per_model = [], {m["id"]: [] for m in models}

    for di, d in enumerate(dates):
        idx = by_date[d]
        if len(idx) < 20:
            continue
        noon = next((i for i in idx if times[i].endswith("T12:00")), idx[len(idx) // 2])
        lead = max(0, noon - i_now)
        stats = {}
        for m in models:
            mid = m["id"]
            s = S[mid]
            T = [s["temperature_2m"][i] for i in idx if s["temperature_2m"][i] is not None]
            if len(T) < 20:
                per_model[mid].append({"date": d})
                continue
            P = [s["precipitation"][i] or 0 for i in idx]
            G = [s["wind_gusts_10m"][i] for i in idx if s["wind_gusts_10m"][i] is not None]
            WS = [s["wind_speed_10m"][i] for i in idx if s["wind_speed_10m"][i] is not None]
            SN = [s["snowfall"][i] or 0 for i in idx]
            C = [s["cloud_cover"][i] for i in idx if s["cloud_cover"][i] is not None and 8 <= int(times[i][11:13]) < 20]
            codes = [s["weather_code"][i] for i in idx if s["weather_code"][i] is not None]
            morning = [s["weather_code"][i] for i in idx if s["weather_code"][i] is not None and 5 <= int(times[i][11:13]) < 11]
            st = {
                "tmax": max(T), "tmin": min(T), "prcp": sum(P), "snow": sum(SN),
                "gust": max(G) if G else None, "wind": max(WS) if WS else None,
                "cloud": sum(C) / len(C) if C else None,
                "storm": 1.0 if any(c >= 95 for c in codes) else 0.0,
                "fog": 1.0 if any(c in (45, 48) for c in morning) else 0.0,
                "w": model_weight(m, lead, 99, factor.get(mid, 1.0)),
            }
            stats[mid] = st
            per_model[mid].append({"date": d, "tmax": _r(st["tmax"]), "tmin": _r(st["tmin"]),
                                   "prcp": _r(st["prcp"]), "gust": _r(st["gust"], 0)})
        if not stats:
            continue

        def pairs(key):
            return [(st[key], st["w"]) for st in stats.values()]

        tmax = _wmean(pairs("tmax"))
        tmin = _wmean(pairs("tmin"))
        prcp = _wmean(pairs("prcp"))
        snow = _wmean(pairs("snow"))
        gust = _wmean(pairs("gust"))
        wind = _wmean(pairs("wind"))
        cloud = _wmean(pairs("cloud"))
        storm = _wmean(pairs("storm"))
        fog = _wmean(pairs("fog"))
        pop_models = _wfrac(pairs("prcp"), lambda x: x >= 1.0)
        sd = _wstd(pairs("tmax"), tmax)

        k_day = (dt.date.fromisoformat(d) - today).days
        ad = a_days.get(d)
        aemet = None
        if ad:
            share = config.AEMET_SHARE[k_day] if 0 <= k_day < len(config.AEMET_SHARE) else 0.1
            if ad.get("tmax") is not None and tmax is not None:
                tmax = (1 - share) * tmax + share * ad["tmax"]
            if ad.get("tmin") is not None and tmin is not None:
                tmin = (1 - share) * tmin + share * ad["tmin"]
            prob = ad["prob"].get("00-24")
            if prob is None and ad["prob"]:
                prob = max(ad["prob"].values())
            sky = ad["cielo"].get("00-24") or ad["cielo"].get("12-24") or ad["cielo"].get("06-12") or \
                next(iter(ad["cielo"].values()), None)
            racha = max(ad["racha"].values()) if ad["racha"] else None
            cota = min(ad["cota_nieve"].values()) if ad["cota_nieve"] else None
            wind_a = ad["viento"].get("00-24") or ad["viento"].get("12-24") or next(iter(ad["viento"].values()), None)
            sym, _ = aemet_symbol(sky["code"]) if sky else (None, True)
            aemet = {"tmax": ad.get("tmax"), "tmin": ad.get("tmin"), "prob": prob, "sym": sym,
                     "desc": sky["desc"] if sky else None, "racha": racha, "cota": cota, "uv": ad.get("uv"),
                     "wind": wind_a}

        ed = e_days.get(d)
        parts_pop = {"models": pop_models, "ensemble": ed["pop1"] if ed else None,
                     "aemet": (aemet["prob"] / 100.0) if aemet and aemet.get("prob") is not None else None}
        tot = sum(config.POP_MIX[k] for k, x in parts_pop.items() if x is not None)
        pop = sum(config.POP_MIX[k] * x for k, x in parts_pop.items() if x is not None) / tot if tot else None

        hours_pop = [H["pop"][i] for i in idx if H["pop"][i] is not None]
        sym = symbol(cloud, prcp, pop, _snow_frac(prcp, snow), storm, fog, False)
        agree = abs((pop_models or 0) - 0.5) * 2
        conf = 0.5 * max(0.0, min(1.0, 1 - (sd or 0) / 3.0)) + 0.5 * agree
        if lead > 24 * 9:
            conf *= 0.8

        # Cota de nieve: AEMET si la da; si no, isocero - 300 m en las horas con precipitación.
        fz = [H["freezing"][i] for i in idx if H["freezing"][i] is not None and (H["precip"][i] or 0) >= 0.1]
        if not fz:
            fz = [H["freezing"][i] for i in idx if H["freezing"][i] is not None]
        snow_level = (aemet or {}).get("cota") or (round((min(fz) - 300) / 100) * 100 if fz else None)
        if snow_level is not None and snow_level < 0:
            snow_level = 0

        u = vv = 0.0
        for i in idx:
            if H["dir"][i] is not None and H["wind"][i]:
                u += H["wind"][i] * math.sin(math.radians(H["dir"][i]))
                vv += H["wind"][i] * math.cos(math.radians(H["dir"][i]))
        wdir = (math.degrees(math.atan2(u, vv)) + 360) % 360 if (u or vv) else None

        parts = []
        for name, h0, h1 in PARTS:
            pidx = [i for i in idx if h0 <= int(times[i][11:13]) < h1]
            if not pidx:
                continue
            syms = [H["sym"][i] for i in pidx if H["sym"][i]]
            parts.append({"name": name, "prcp": _r(sum(H["precip"][i] or 0 for i in pidx), 1),
                          "pop": _r(max((H["pop"][i] or 0) for i in pidx), 2),
                          "sym": max(set(syms), key=syms.count) if syms else None,
                          "t": _r(_mean_list([H["t"][i] for i in pidx]))})

        k = x_pos.get(d)
        nt = nn = None
        if normals:
            j = (dt.date(2020, int(d[5:7]), int(d[8:10])) - dt.date(2020, 1, 1)).days
            nt, nn = normals["tmax"][j], normals["tmin"][j]
        day = {
            "date": d, "k": k_day, "tmax": _r(tmax), "tmin": _r(tmin),
            "tmax_lo": _r(min(x for x, _ in pairs("tmax"))), "tmax_hi": _r(max(x for x, _ in pairs("tmax"))),
            "tmin_lo": _r(min(x for x, _ in pairs("tmin"))), "tmin_hi": _r(max(x for x, _ in pairs("tmin"))),
            "prcp": _r(prcp), "prcp_lo": _r(min(x for x, _ in pairs("prcp"))),
            "prcp_hi": _r(max(x for x, _ in pairs("prcp"))), "snow": _r(snow),
            "pop": _r(pop, 2), "pop_parts": {key: _r(x, 2) for key, x in parts_pop.items()},
            "pop_hour_max": _r(max(hours_pop), 2) if hours_pop else None,
            "wind": _r(wind, 0), "gust": _r(gust, 0), "dir": _r(wdir, 0), "dir_name": dir_name(wdir),
            "cloud": _r(cloud, 0), "storm": _r(storm, 2), "fog": _r(fog, 2), "sym": sym,
            "label": SYMBOL_LABEL.get(sym, ""), "conf": _r(conf, 2),
            "conf_label": "alta" if conf >= 0.7 else "media" if conf >= 0.45 else "baja",
            "n_models": len(stats), "snow_level": snow_level,
            "sunrise": xd.get("sunrise", [None] * 99)[k][11:16] if k is not None and xd.get("sunrise") and xd["sunrise"][k] else None,
            "sunset": xd.get("sunset", [None] * 99)[k][11:16] if k is not None and xd.get("sunset") and xd["sunset"][k] else None,
            "uv": _r((aemet or {}).get("uv") or (xd.get("uv_index_max") or [None] * 99)[k] if k is not None else None, 0),
            "normal_tmax": nt, "normal_tmin": nn, "aemet": aemet,
            "ens": ({"p50": ed["p50"], "p90": ed["p90"], "pop1": ed["pop1"], "pop10": ed["pop10"],
                     "tmax_p10": _r(ed["tmax_p10"] + e_shift), "tmax_p90": _r(ed["tmax_p90"] + e_shift),
                     "tmin_p10": _r(ed["tmin_p10"] + e_shift), "tmin_p90": _r(ed["tmin_p90"] + e_shift),
                     "members": ed["members"]} if ed else None),
            "parts": parts,
        }
        day["text"] = day_text(day)
        out.append(day)
    return out, per_model


def _ri(x):
    """Redondeo "de toda la vida" (0,5 hacia arriba), igual que Math.round en la página."""
    return int(math.floor(x + 0.5))


def _epoch(t):
    return dt.datetime.fromisoformat(t).replace(tzinfo=TZ).timestamp()


def _window_sum(arr, ends, t0, t1, i0, i1):
    """Suma la lluvia horaria (cada valor acumula la hora anterior) que cae entre t0 y t1."""
    total, seen = 0.0, False
    for i in range(max(0, i0), min(i1, len(arr), len(ends))):
        x = arr[i]
        if x is None:
            continue
        overlap = min(ends[i], t1) - max(ends[i] - 3600, t0)
        if overlap > 0:
            total += x * overlap / 3600.0
            seen = True
    return total if seen else None


def _pct(vals, q):
    vals = sorted(vals)
    if not vals:
        return None
    k = (len(vals) - 1) * q
    f = int(k)
    c = min(f + 1, len(vals) - 1)
    return vals[f] + (vals[c] - vals[f]) * (k - f)


def intensity(mm_h):
    """Escala de AEMET para la intensidad de la lluvia (mm en una hora)."""
    if mm_h is None or mm_h < 0.1:
        return "sin lluvia"
    if mm_h <= 2:
        return "débil"
    if mm_h <= 15:
        return "moderada"
    if mm_h <= 30:
        return "fuerte"
    if mm_h <= 60:
        return "muy fuerte"
    return "torrencial"


def rain_outlook(times, S, W, H, i_now, ens, aemet_h, now):
    """Probabilidad y cantidad de lluvia en la próxima hora y en las próximas 6, 12 y 24 horas."""
    n = len(times)
    lo, hi = max(0, i_now - 1), min(n, i_now + 52)
    ends = [0.0] * n
    for i in range(lo, hi):
        ends[i] = _epoch(times[i])
    t0 = now.timestamp()
    a_int = []
    for p in (aemet_h or {}).get("probs", []):
        if p["tipo"] != "precipitacion":
            continue
        day = dt.datetime.fromisoformat(p["fecha"]).replace(tzinfo=TZ)
        a, b = int(p["desde"]), int(p["hasta"])
        start = day + dt.timedelta(hours=a)
        end = day + dt.timedelta(hours=b + (24 if b <= a else 0))
        a_int.append((start.timestamp(), end.timestamp(), p["valor"] / 100.0))
    members = (ens or {}).get("members_p")
    e_ends = [_epoch(t) for t in ens["members_time"]] if members else None

    windows = []
    for hours, thr in config.RAIN_WINDOWS:
        t1 = t0 + hours * 3600
        i0, i1 = i_now, min(n, i_now + hours + 2)
        mid = min(n - 1, i_now + max(1, hours // 2))
        sums = {}
        for mid_id, s in S.items():
            v = _window_sum(s["precipitation"], ends, t0, t1, i0, i1)
            if v is not None and W[mid_id][mid] > 0:
                sums[mid_id] = v
        p_models = _wfrac([(sums[m], W[m][mid]) for m in sums], lambda x: x >= thr)
        p_ens = e50 = e90 = None
        if members:
            vals = [_window_sum(mp, e_ends, t0, t1, 0, len(e_ends)) for mp in members]
            vals = [x for x in vals if x is not None]
            if vals:
                p_ens = sum(1 for x in vals if x >= thr) / len(vals)
                e50, e90 = _pct(vals, 0.5), _pct(vals, 0.9)
        cands = [p for a, b, p in a_int if min(b, t1) - max(a, t0) > 0]
        p_aemet = max(cands) if cands else None
        parts = {"models": p_models, "ensemble": p_ens, "aemet": p_aemet}
        tot = sum(config.POP_MIX[k] for k, x in parts.items() if x is not None)
        pop = sum(config.POP_MIX[k] * x for k, x in parts.items() if x is not None) / tot if tot else None
        amount = _window_sum(H["precip"], ends, t0, t1, i0, i1)
        peak = max([(H["precip"][i] or 0) for i in range(i_now + 1, min(n, i_now + hours + 1))] or [0])
        windows.append({
            "hours": hours, "threshold": thr, "pop": _r(pop, 2), "parts": {k: _r(x, 2) for k, x in parts.items()},
            "mm": _r(amount, 1), "mm_lo": _r(min(sums.values()), 1) if sums else None,
            "mm_hi": _r(max(sums.values()), 1) if sums else None, "ens_p50": _r(e50, 1), "ens_p90": _r(e90, 1),
            "peak": _r(peak, 1), "intensity": intensity(peak),
        })

    def wet(i):
        return (H["precip"][i] or 0) >= 0.2 and (H["pop"][i] or 0) >= 0.5

    timing = {"state": "seco", "from": None, "until": None, "peak": None}
    j = i_now + 1
    if j < n and wet(j):
        k = j
        while k < n and k < i_now + 48 and wet(k):
            k += 1
        timing.update(state="lloviendo", until=times[k - 1] if k < n else None)
    else:
        for k in range(j, min(n, i_now + 48)):
            if wet(k):
                timing["from"] = times[k - 1]
                break
    rng = range(i_now + 1, min(n, i_now + 25))
    if rng:
        ip = max(rng, key=lambda i: H["precip"][i] or 0)
        if (H["precip"][ip] or 0) >= 0.1:
            timing["peak"] = {"time": times[ip], "mm": _r(H["precip"][ip], 1), "intensity": intensity(H["precip"][ip])}
    next3 = _window_sum(H["precip"], ends, t0, t0 + 3 * 3600, i_now, min(n, i_now + 5))
    return {"windows": windows, "timing": timing, "next3": _r(next3, 1)}


def _mean_list(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _join(items):
    items = [x for x in items if x]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " y " + items[-1]


def _when(parts):
    """["mañana", "tarde"] → "por la mañana y la tarde"; incluye "de madrugada"."""
    out = []
    rest = [p for p in parts if p != "madrugada"]
    if "madrugada" in parts:
        out.append("de madrugada")
    if rest:
        out.append("por la " + _join(["la " + p if i else p for i, p in enumerate(rest)]))
    return _join(out)


def day_name(date_str, k):
    if k == 0:
        return "Hoy"
    if k == 1:
        return "Mañana"
    d = dt.date.fromisoformat(date_str)
    return WEEKDAYS[d.weekday()].capitalize()


def day_text(day):
    """Resumen en una frase, al estilo de un parte hablado."""
    s = []
    p, pop = day["prcp"] or 0, day["pop"] or 0
    wet_parts = [pt["name"] for pt in day["parts"] if (pt["prcp"] or 0) >= 0.5 and (pt["pop"] or 0) >= 0.4]
    snowy = day["sym"] in ("nieve", "aguanieve")
    if day["sym"] == "tormenta":
        s.append("Tormentas" + (" por la " + _join(wet_parts) if wet_parts else ""))
    elif p >= 1 and pop >= 0.45:
        kind = "Nieve" if snowy else "Lluvia"
        inten = "débil" if p < 4 else "moderada" if p < 15 else "abundante" if p < 40 else "muy abundante"
        if snowy:
            inten = "débil" if p < 4 else "moderada" if p < 15 else "intensa"
        when = (" " + _when(wet_parts)) if wet_parts and len(wet_parts) < 4 else ""
        s.append("%s %s%s (%s mm)" % (kind, inten, when, ("%.0f" % p) if p >= 1.5 else "%.1f" % p))
    elif pop >= 0.3:
        s.append("Nubes y claros con algún chubasco posible")
    else:
        sky = {"despejado": "Cielo despejado", "poco-nuboso": "Poco nuboso", "intervalos": "Intervalos nubosos",
               "nuboso": "Nuboso", "cubierto": "Cielo cubierto", "niebla": "Nieblas"}.get(day["sym"], day["label"])
        s.append(sky)
        if (day.get("fog") or 0) >= 0.4 and day["sym"] != "niebla":
            s.append("nieblas matinales")
    g = day.get("gust") or 0
    if g >= 70:
        s.append("rachas muy fuertes del %s (hasta %d km/h)" % (day["dir_name"] or "?", _ri(g)))
    elif g >= 50:
        s.append("rachas fuertes del %s (%d km/h)" % (day["dir_name"] or "?", _ri(g)))
    elif (day.get("wind") or 0) >= 25:
        s.append("viento moderado del %s" % (day["dir_name"] or "?"))
    if day.get("tmin") is not None and day["tmin"] <= -3:
        s.append("heladas fuertes")
    elif day.get("tmin") is not None and day["tmin"] <= 0.5:
        s.append("heladas")
    text = s[0]
    if len(s) > 1:
        text += ", " + _join(s[1:])
    text += ". Máxima de %d° y mínima de %d°" % (_ri(day["tmax"]), _ri(day["tmin"]))
    if day.get("normal_tmax") is not None:
        an = day["tmax"] - day["normal_tmax"]
        if an >= 3:
            text += ", %d° más de lo normal" % _ri(an)
        elif an <= -3:
            text += ", %d° menos de lo normal" % _ri(-an)
    if day.get("snow_level") and day["snow_level"] < 1800 and p >= 1:
        text += ". Cota de nieve en torno a %d m" % day["snow_level"]
    return text + "."
