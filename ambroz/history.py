"""Serie diaria ERA5 del valle desde 1940: descarga incremental, normales, agregados y récords.

Los 8 pueblos caen en la misma celda de ERA5, así que se guarda una única serie a
la altitud de Hervás. Para cada pueblo las temperaturas se corrigen con el
gradiente estándar (0,65 °C por cada 100 m), igual que hace Open-Meteo.
La lluvia, el viento y la presión son los de la celda, comunes a todo el valle.
"""
import datetime as dt
import json
import logging
import os
import threading
import time

from . import config, net

log = logging.getLogger("ambroz")
P = config.HISTORY_POINT
PATH = os.path.join(config.DATA_DIR, "history", "valle-era5.json")
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
KEYS = {
    "tmax": "temperature_2m_max", "tmin": "temperature_2m_min", "tmean": "temperature_2m_mean",
    "prcp": "precipitation_sum", "snow": "snowfall_sum", "wind": "wind_speed_10m_max",
    "gust": "wind_gusts_10m_max", "pres": "pressure_msl_mean", "pmin": "pressure_msl_min",
    "pmax": "pressure_msl_max",
}
NORMAL_YEARS = (1991, 2020)
STRIPES_BASE = (1961, 1990)
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
          "septiembre", "octubre", "noviembre", "diciembre"]

_lock = threading.Lock()
_file = {"mtime": None, "data": None}
_memo = {}
PROGRESS = {"state": "sin iniciar", "until": None, "error": None}


def _r(x, nd=1):
    return None if x is None else round(x, nd)


def load():
    try:
        mtime = os.path.getmtime(PATH)
    except OSError:
        return None
    if _file["mtime"] != mtime:
        with open(PATH, "r", encoding="utf-8") as fh:
            _file["data"] = json.load(fh)
        _file["mtime"] = mtime
    return _file["data"]


def _save(h):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(h, fh, separators=(",", ":"))
    os.replace(tmp, PATH)


def _add_years(d, n):
    try:
        return d.replace(year=d.year + n)
    except ValueError:
        return d.replace(year=d.year + n, day=28)


def _fetch(start, end):
    days = (end - start).days + 1
    params = {
        "latitude": P["lat"], "longitude": P["lon"], "elevation": P["elev"],
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "daily": ",".join(KEYS.values()), "models": "era5", "timezone": config.TZ,
    }
    data = net.openmeteo_json(ARCHIVE_URL, params, weight=net.om_weight(1, 1, len(KEYS), days))
    return data["daily"]


def update(chunk_years=8, pause=25.0):
    """Completa la serie hasta el último día publicado (ERA5 va unos 6 días por detrás)."""
    with _lock:
        h = load() or {
            "source": "ERA5 (Copernicus / ECMWF) vía Open-Meteo",
            "lat": P["lat"], "lon": P["lon"], "elev": P["elev"], "start": P["start"],
            "time": [], "v": {k: [] for k in KEYS},
        }
        if h["time"]:
            start = dt.date.fromisoformat(h["time"][-1]) + dt.timedelta(days=1)
        else:
            start = dt.date.fromisoformat(P["start"])
        target = dt.date.today() - dt.timedelta(days=4)
        while start <= target:
            end = min(_add_years(start, chunk_years) - dt.timedelta(days=1), target)
            PROGRESS.update(state="descargando", until=h["time"][-1] if h["time"] else None, error=None)
            log.info("Histórico ERA5: %s → %s", start, end)
            daily = _fetch(start, end)
            times = daily["time"]
            n = len(times)
            while n and daily[KEYS["tmax"]][n - 1] is None:
                n -= 1
            for i in range(n):
                h["time"].append(times[i])
                for k, var in KEYS.items():
                    h["v"][k].append(_r(daily[var][i]))
            _save(h)
            if n < len(times):
                break
            start = end + dt.timedelta(days=1)
            if start <= target and pause:
                time.sleep(pause)
        PROGRESS.update(state="al día", until=h["time"][-1] if h["time"] else None, error=None)
        return h


def is_ready():
    h = load()
    return bool(h and h["time"] and h["time"][0] <= "1941-01-01" and h["time"][-1] >= "2025-12-31")


# --- Cálculos -----------------------------------------------------------

def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _doy(m, d):
    """Índice de día del año en un calendario bisiesto (0-365)."""
    return (dt.date(2020, m, d) - dt.date(2020, 1, 1)).days


def _smooth(arr, half):
    n = len(arr)
    out = []
    for i in range(n):
        vals = [arr[(i + k) % n] for k in range(-half, half + 1) if arr[(i + k) % n] is not None]
        out.append(sum(vals) / len(vals) if vals else None)
    return out


def _series(village, recent):
    """Serie del pueblo: ERA5 corregida por altitud + días recientes provisionales."""
    h = load()
    off = -(village["elev"] - P["elev"]) * config.LAPSE_RATE
    v = h["v"]

    def adj(arr):
        return [None if x is None else x + off for x in arr]

    s = {"time": list(h["time"]), "tmax": adj(v["tmax"]), "tmin": adj(v["tmin"]), "tmean": adj(v["tmean"]),
         "prcp": list(v["prcp"]), "snow": list(v["snow"]), "wind": list(v["wind"]), "gust": list(v["gust"]),
         "pres": list(v["pres"]), "pmin": list(v["pmin"]), "pmax": list(v["pmax"])}
    era5_end = s["time"][-1]
    n_era5 = len(s["time"])
    if recent:
        for i, t in enumerate(recent["time"]):
            if t <= era5_end or recent["tmax"][i] is None:
                continue
            s["time"].append(t)
            for k in ("tmax", "tmin", "tmean", "prcp", "snow", "wind", "gust", "pres"):
                s[k].append(recent[k][i])
            s["pmin"].append(None)
            s["pmax"].append(None)
    return s, off, n_era5


def summary(village, recent=None):
    h = load()
    if not h or not h["time"]:
        return None
    memo_key = (village["id"], _file["mtime"], recent["time"][-1] if recent else None, dt.date.today())
    if memo_key in _memo:
        return _memo[memo_key]
    s, off, n_era5 = _series(village, recent)
    T = s["time"]
    Y = [int(t[:4]) for t in T]
    M = [int(t[5:7]) for t in T]
    D = [int(t[8:10]) for t in T]
    n = len(T)
    today = dt.date.today()

    # Mensual -----------------------------------------------------------
    months = {}
    for i in range(n):
        key = (Y[i], M[i])
        acc = months.get(key)
        if acc is None:
            acc = months[key] = {"tmean": [], "tmax": [], "tmin": [], "prcp": 0.0, "rdays": 0, "n": 0, "prov": False}
        acc["tmean"].append(s["tmean"][i])
        acc["tmax"].append(s["tmax"][i])
        acc["tmin"].append(s["tmin"][i])
        p = s["prcp"][i] or 0.0
        acc["prcp"] += p
        acc["rdays"] += 1 if p >= 1 else 0
        acc["n"] += 1
        if i >= n_era5:
            acc["prov"] = True
    mlist = []
    for (y, m), acc in sorted(months.items()):
        mlist.append({"y": y, "m": m, "tmean": _r(_mean(acc["tmean"])), "tmax": _r(_mean(acc["tmax"])),
                      "tmin": _r(_mean(acc["tmin"])), "prcp": _r(acc["prcp"]), "rdays": acc["rdays"],
                      "n": acc["n"], "prov": acc["prov"]})

    # Normales 1991-2020 ------------------------------------------------
    y0, y1 = NORMAL_YEARS
    mnorm = []
    for m in range(1, 13):
        sel = [r for r in mlist if r["m"] == m and y0 <= r["y"] <= y1]
        mnorm.append({"m": m, "tmean": _r(_mean([r["tmean"] for r in sel])), "tmax": _r(_mean([r["tmax"] for r in sel])),
                      "tmin": _r(_mean([r["tmin"] for r in sel])), "prcp": _r(_mean([r["prcp"] for r in sel])),
                      "rdays": _r(_mean([r["rdays"] for r in sel]))})
    dsum = {k: [0.0] * 366 for k in ("tmax", "tmin", "prcp")}
    dcnt = [0] * 366
    for i in range(min(n, n_era5)):
        if y0 <= Y[i] <= y1 and s["tmax"][i] is not None:
            j = _doy(M[i], D[i])
            dsum["tmax"][j] += s["tmax"][i]
            dsum["tmin"][j] += s["tmin"][i]
            dsum["prcp"][j] += s["prcp"][i] or 0.0
            dcnt[j] += 1
    dnorm = {}
    for k, half in (("tmax", 7), ("tmin", 7), ("prcp", 15)):
        raw = [dsum[k][j] / dcnt[j] if dcnt[j] else None for j in range(366)]
        dnorm[k] = [_r(x) for x in _smooth(raw, half)]

    # Anual -------------------------------------------------------------
    years = {}
    for i in range(n):
        acc = years.setdefault(Y[i], {"t": [], "p": 0.0, "frost": 0, "hot": 0, "snowd": 0, "gust": None, "n": 0,
                                       "tmax": None, "tmin": None})
        acc["t"].append(s["tmean"][i])
        acc["p"] += s["prcp"][i] or 0.0
        if s["tmin"][i] is not None and s["tmin"][i] < 0:
            acc["frost"] += 1
        if s["tmax"][i] is not None and s["tmax"][i] >= 30:
            acc["hot"] += 1
        if (s["snow"][i] or 0) >= 0.5:
            acc["snowd"] += 1
        g = s["gust"][i]
        if g is not None and (acc["gust"] is None or g > acc["gust"]):
            acc["gust"] = g
        acc["n"] += 1
    alist = []
    for y, acc in sorted(years.items()):
        alist.append({"y": y, "tmean": _r(_mean(acc["t"]), 2), "prcp": _r(acc["p"], 0), "frost": acc["frost"],
                      "hot": acc["hot"], "snowd": acc["snowd"], "gust": _r(acc["gust"], 0),
                      "partial": acc["n"] < 365})
    full = [a for a in alist if not a["partial"]]
    b0, b1 = STRIPES_BASE
    base = _mean([a["tmean"] for a in full if b0 <= a["y"] <= b1])
    stripes = [{"y": a["y"], "anom": _r(a["tmean"] - base, 2)} for a in full if a["tmean"] is not None]
    ann_norm = {"tmean": _r(_mean([a["tmean"] for a in full if y0 <= a["y"] <= y1]), 2),
                "prcp": _r(_mean([a["prcp"] for a in full if y0 <= a["y"] <= y1]), 0),
                "frost": _r(_mean([a["frost"] for a in full if y0 <= a["y"] <= y1]), 0)}

    # Récords (solo ERA5, sin días provisionales) ----------------------
    def extreme(key, pick_max=True, label="", unit="", nd=1):
        best, bi = None, None
        for i in range(n_era5):
            x = s[key][i]
            if x is None:
                continue
            if best is None or (x > best if pick_max else x < best):
                best, bi = x, i
        return {"key": key + ("_max" if pick_max else "_min"), "label": label, "value": _r(best, nd), "unit": unit,
                "date": T[bi] if bi is not None else None}

    era5_months = [r for r in mlist if not r["prov"] and r["n"] >= 28]
    wet_m = max(era5_months, key=lambda r: r["prcp"])
    hot_m = max(era5_months, key=lambda r: r["tmean"] if r["tmean"] is not None else -99)
    cold_m = min(era5_months, key=lambda r: r["tmean"] if r["tmean"] is not None else 99)
    wet_y = max(full, key=lambda a: a["prcp"])
    dry_y = min(full, key=lambda a: a["prcp"])
    hot_y = max(full, key=lambda a: a["tmean"])
    cold_y = min(full, key=lambda a: a["tmean"])
    frost_y = max(full, key=lambda a: a["frost"])

    def spell(cond):
        best_len, best_end, cur = 0, None, 0
        for i in range(n_era5):
            if cond(i):
                cur += 1
                if cur > best_len:
                    best_len, best_end = cur, i
            else:
                cur = 0
        if best_end is None:
            return {"days": 0, "from": None, "to": None}
        return {"days": best_len, "from": T[best_end - best_len + 1], "to": T[best_end]}

    dry = spell(lambda i: (s["prcp"][i] or 0) < 1)
    wet = spell(lambda i: (s["prcp"][i] or 0) >= 1)
    frost = spell(lambda i: s["tmin"][i] is not None and s["tmin"][i] < 0)
    records = [
        extreme("tmax", True, "Temperatura más alta", "°C"),
        extreme("tmin", False, "Temperatura más baja", "°C"),
        extreme("tmin", True, "Noche más cálida", "°C"),
        extreme("tmax", False, "Día más frío (máxima)", "°C"),
        extreme("prcp", True, "Más lluvia en un día", "mm"),
        extreme("snow", True, "Más nieve en un día", "cm"),
        extreme("gust", True, "Racha de viento más fuerte", "km/h", 0),
        extreme("pmax", True, "Presión más alta", "hPa"),
        extreme("pmin", False, "Presión más baja", "hPa"),
        {"key": "wet_month", "label": "Mes más lluvioso", "value": wet_m["prcp"], "unit": "mm",
         "date": "%04d-%02d" % (wet_m["y"], wet_m["m"])},
        {"key": "hot_month", "label": "Mes más cálido", "value": hot_m["tmean"], "unit": "°C",
         "date": "%04d-%02d" % (hot_m["y"], hot_m["m"])},
        {"key": "cold_month", "label": "Mes más frío", "value": cold_m["tmean"], "unit": "°C",
         "date": "%04d-%02d" % (cold_m["y"], cold_m["m"])},
        {"key": "wet_year", "label": "Año más lluvioso", "value": wet_y["prcp"], "unit": "mm", "date": str(wet_y["y"])},
        {"key": "dry_year", "label": "Año más seco", "value": dry_y["prcp"], "unit": "mm", "date": str(dry_y["y"])},
        {"key": "hot_year", "label": "Año más cálido", "value": hot_y["tmean"], "unit": "°C", "date": str(hot_y["y"])},
        {"key": "cold_year", "label": "Año más frío", "value": cold_y["tmean"], "unit": "°C", "date": str(cold_y["y"])},
        {"key": "frost_year", "label": "Más días de helada en un año", "value": frost_y["frost"], "unit": "días",
         "date": str(frost_y["y"])},
        {"key": "dry_spell", "label": "Racha más larga sin lluvia", "value": dry["days"], "unit": "días",
         "date": dry["from"], "to": dry["to"]},
        {"key": "wet_spell", "label": "Racha más larga lloviendo", "value": wet["days"], "unit": "días",
         "date": wet["from"], "to": wet["to"]},
        {"key": "frost_spell", "label": "Racha más larga de heladas", "value": frost["days"], "unit": "días",
         "date": frost["from"], "to": frost["to"]},
    ]

    # Récords del mes en curso y efemérides de hoy -----------------------
    cm = today.month
    idx_m = [i for i in range(n_era5) if M[i] == cm]

    def pick(idx, key, pick_max=True):
        vals = [(s[key][i], i) for i in idx if s[key][i] is not None]
        if not vals:
            return None
        x, i = max(vals) if pick_max else min(vals)
        return {"value": _r(x), "date": T[i]}

    sel_months = [r for r in era5_months if r["m"] == cm]
    month_records = {
        "month": cm, "name": MONTHS[cm - 1],
        "tmax": pick(idx_m, "tmax", True), "tmin": pick(idx_m, "tmin", False),
        "prcp": pick(idx_m, "prcp", True), "gust": pick(idx_m, "gust", True),
        "wettest": ({"value": max(sel_months, key=lambda r: r["prcp"])["prcp"],
                     "year": max(sel_months, key=lambda r: r["prcp"])["y"]} if sel_months else None),
        "driest": ({"value": min(sel_months, key=lambda r: r["prcp"])["prcp"],
                    "year": min(sel_months, key=lambda r: r["prcp"])["y"]} if sel_months else None),
    }
    idx_d = [i for i in idx_m if D[i] == today.day]
    j = _doy(today.month, today.day)
    last_year = today.year - 1
    ly = [i for i in idx_d if Y[i] == last_year]
    efem = {
        "date": today.isoformat(),
        "tmax": pick(idx_d, "tmax", True), "tmin": pick(idx_d, "tmin", False),
        "prcp": pick(idx_d, "prcp", True),
        "normal": {"tmax": dnorm["tmax"][j], "tmin": dnorm["tmin"][j]},
        "last_year": ({"tmax": _r(s["tmax"][ly[0]]), "tmin": _r(s["tmin"][ly[0]]), "prcp": s["prcp"][ly[0]]}
                      if ly else None),
        "years": len(idx_d),
    }

    # Año hidrológico (1 de octubre) -----------------------------------
    hy_start = dt.date(today.year if today.month >= 10 else today.year - 1, 10, 1)
    pos = {t: i for i, t in enumerate(T)}

    def hydro(year):
        start = dt.date(year, 10, 1)
        out, acc = [], 0.0
        d = start
        while d < dt.date(year + 1, 10, 1):
            i = pos.get(d.isoformat())
            if i is None:
                break
            acc += s["prcp"][i] or 0.0
            out.append(round(acc, 1))
            d += dt.timedelta(days=1)
        return out

    hy_cur = hydro(hy_start.year)
    hy_prev = hydro(hy_start.year - 1)
    norm_sets = [hydro(y) for y in range(y0, y1 + 1)]
    norm_sets = [c for c in norm_sets if len(c) >= 365]
    hy_norm = []
    for k in range(366):
        vals = [c[min(k, len(c) - 1)] for c in norm_sets]
        hy_norm.append(_r(sum(vals) / len(vals)) if vals else None)
    totals = []
    for y in range(Y[0], hy_start.year):
        c = hydro(y)
        if len(c) >= 365 and dt.date(y, 10, 1).isoformat() >= T[0]:
            totals.append((c[-1], y))
    pct = None
    if hy_cur and hy_norm[len(hy_cur) - 1]:
        pct = round(100 * hy_cur[-1] / hy_norm[len(hy_cur) - 1])
    hydro_out = {
        "start": hy_start.isoformat(), "current": hy_cur, "previous": hy_prev, "normal": hy_norm,
        "pct_of_normal": pct, "normal_total": hy_norm[364],
        "wettest": ({"value": max(totals)[0], "year": "%d-%02d" % (max(totals)[1], (max(totals)[1] + 1) % 100)}
                    if totals else None),
        "driest": ({"value": min(totals)[0], "year": "%d-%02d" % (min(totals)[1], (min(totals)[1] + 1) % 100)}
                   if totals else None),
    }

    # Año en curso hasta la fecha, frente a la media 1991-2020 del mismo periodo.
    span = {}
    for i in range(n):
        a, b = span.get(Y[i], (i, i))
        span[Y[i]] = (min(a, i), max(b, i))
    last_md = T[-1][5:]
    cur_y = Y[-1]

    def ytd(year):
        a, b = span.get(year, (0, -1))
        idx = [i for i in range(a, b + 1) if T[i][5:] <= last_md]
        return _mean([s["tmean"][i] for i in idx]), sum(s["prcp"][i] or 0 for i in idx), len(idx)

    cur_t, cur_p, cur_n = ytd(cur_y)
    norm_vals = [ytd(y) for y in range(y0, y1 + 1)]
    ytd_out = {
        "year": cur_y, "to": T[-1], "days": cur_n, "tmean": _r(cur_t, 2), "prcp": _r(cur_p, 0),
        "tmean_normal": _r(_mean([x[0] for x in norm_vals]), 2), "prcp_normal": _r(_mean([x[1] for x in norm_vals]), 0),
    }

    out = {
        "village": village["id"], "elev": village["elev"], "offset": round(off, 2), "ytd": ytd_out,
        "source": h.get("source"), "cell": {"lat": 40.25, "lon": -5.75, "elev_ref": P["elev"]},
        "coverage": {"from": T[0], "to": T[n_era5 - 1], "provisional_to": T[-1] if n > n_era5 else None},
        "normals": {"period": "%d-%d" % NORMAL_YEARS, "monthly": mnorm, "daily": dnorm, "annual": ann_norm},
        "monthly": mlist[-38:], "annual": alist, "stripes": stripes, "stripes_base": "%d-%d" % STRIPES_BASE,
        "records": records, "month_records": month_records, "today": efem, "hydro": hydro_out,
        "top": {
            "wet_years": [{"y": a["y"], "prcp": a["prcp"]} for a in sorted(full, key=lambda a: -a["prcp"])[:5]],
            "dry_years": [{"y": a["y"], "prcp": a["prcp"]} for a in sorted(full, key=lambda a: a["prcp"])[:5]],
            "hot_years": [{"y": a["y"], "tmean": a["tmean"]} for a in sorted(full, key=lambda a: -a["tmean"])[:5]],
            "cold_years": [{"y": a["y"], "tmean": a["tmean"]} for a in sorted(full, key=lambda a: a["tmean"])[:5]],
        },
    }
    if len(_memo) > 24:
        _memo.clear()
    _memo[memo_key] = out
    return out


def daily_normals_for(village):
    """Normales diarias (máx./mín.) para comparar la previsión con lo habitual."""
    s = summary(village)
    return s["normals"]["daily"] if s else None
