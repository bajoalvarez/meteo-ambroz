"""Estaciones de aficionados (Meteoclimatic), embalses (embalses.net) y avisos (MeteoAlarm)."""
import datetime as dt
import html
import math
import re

from . import config, net


def _km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _es_num(s):
    if s is None:
        return None
    s = s.strip().replace("−", "-").replace("+", "")
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


# --- Meteoclimatic -------------------------------------------------------

def meteoclimatic():
    lat0, lon0 = config.VALLEY_CENTER
    found = {}
    for feed in config.METEOCLIMATIC_FEEDS:
        raw = net.http_get("https://www.meteoclimatic.net/feed/rss/" + feed).decode("utf-8", "replace")
        for item in re.findall(r"<item>(.*?)</item>", raw, re.S):
            m = re.search(r"\[\[<([A-Z0-9]+);\(([^)]*)\);\(([^)]*)\);\(([^)]*)\);\(([^)]*)\);\(([^)]*)\);([^>]*)>\]\]", item)
            g = re.search(r"<georss:point>\s*([\d.\-]+)\s+([\d.\-]+)\s*</georss:point>", item)
            if not m or not g:
                continue
            lat, lon = float(g.group(1)), float(g.group(2))
            dist = _km(lat0, lon0, lat, lon)
            if dist > config.METEOCLIMATIC_RADIUS_KM:
                continue
            code = m.group(1)
            t = m.group(2).split(";")
            h = m.group(3).split(";")
            p = m.group(4).split(";")
            w = m.group(5).split(";")
            upd = re.search(r"Actualizado:\s*(\d\d)-(\d\d)-(\d{4}) (\d\d):(\d\d) UTC", item)
            updated = None
            if upd:
                d, mo, y, hh, mi = upd.groups()
                updated = "%s-%s-%sT%s:%s:00Z" % (y, mo, d, hh, mi)
            title = html.unescape(re.search(r"<title>(.*?)</title>", item, re.S).group(1)).strip()
            link = re.search(r"<link>(.*?)</link>", item, re.S).group(1).strip().replace("http://", "https://")
            found[code] = {
                "id": code, "name": title, "lat": lat, "lon": lon, "km": round(dist, 1), "url": link,
                "updated": updated, "network": "Meteoclimatic",
                "t": _es_num(t[0]), "tmax": _es_num(t[1]) if len(t) > 1 else None,
                "tmin": _es_num(t[2]) if len(t) > 2 else None,
                "rh": _es_num(h[0]), "pres": _es_num(p[0]),
                "wind": _es_num(w[0]), "gust": _es_num(w[1]) if len(w) > 1 else None,
                "wdir": _es_num(w[2]) if len(w) > 2 else None,
                "rain": _es_num(m.group(6)),
            }
    return sorted(found.values(), key=lambda s: s["km"])


# --- Embalses ------------------------------------------------------------

def _text(raw_html):
    txt = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw_html, flags=re.S)
    txt = html.unescape(re.sub(r"<[^>]+>", " ", txt))
    return re.sub(r"\s+", " ", txt)


def _table_after(raw, marker):
    """Filas (listas de celdas de texto) de la primera tabla que sigue a un título."""
    i = raw.find(marker)
    if i < 0:
        return []
    table = raw[i:].split("</table>", 1)[0]
    rows = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", c))).strip().rstrip("%").strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if cells:
            rows.append(cells)
    return rows


def _rt_time(s):
    m = re.match(r"(\d\d)-(\d\d)-(\d{4})\s+(\d\d:\d\d)", s or "")
    return "%s-%s-%sT%s" % (m.group(3), m.group(2), m.group(1), m.group(4)) if m else None


def _realtime(raw, bulletin):
    vol = []
    for c in _table_after(raw, "(Tiempo Real)"):
        t = _rt_time(c[0]) if c else None
        if t and len(c) >= 3:
            vol.append({"time": t, "hm3": _es_num(c[1]), "pct": _es_num(c[2])})
    if not vol:
        return None
    vol.sort(key=lambda r: r["time"])
    last = vol[-1]
    t_last = dt.datetime.fromisoformat(last["time"])

    def change(hours, tol):
        best = None
        for r in vol[:-1]:
            gap = (t_last - dt.datetime.fromisoformat(r["time"])).total_seconds() / 3600
            if abs(gap - hours) <= tol and (best is None or abs(gap - hours) < abs(best[1] - hours)):
                best = (r, gap)
        if not best or best[0]["hm3"] is None or last["hm3"] is None:
            return None
        return {"hm3": round(last["hm3"] - best[0]["hm3"], 2), "hours": round(best[1], 1), "since": best[0]["time"]}

    outflow = []
    for c in _table_after(raw, "(Caudal desembalsado)"):
        t = _rt_time(c[0]) if c else None
        if t and len(c) >= 2:
            outflow.append({"time": t, "m3s": _es_num(c[1])})
    outflow.sort(key=lambda r: r["time"])
    gauges = []
    for c in _table_after(raw, "Pluviómetros cercanos")[1:]:
        if len(c) >= 6:
            gauges.append({"name": c[0], "prov": c[1], "h1": _es_num(c[2]), "h6": _es_num(c[3]),
                           "h12": _es_num(c[4]), "h24": _es_num(c[5])})
    since = None
    if bulletin.get("hm3") is not None and last["hm3"] is not None:
        since = round(last["hm3"] - bulletin["hm3"], 2)
    return {
        "time": last["time"], "hm3": last["hm3"], "pct": last["pct"],
        "chg_1h": change(1, 0.6), "chg_24h": change(24, 7), "since_bulletin": since,
        "series": vol, "outflow": outflow[-1] if outflow else None, "outflow_series": outflow,
        "gauges": gauges,
    }


def reservoir(r):
    raw = net.http_get("https://www.embalses.net/" + r["page"]).decode("utf-8", "replace")
    txt = _text(raw)
    num = r"([\-−+]?[\d.,]+)"
    out = {"id": r["id"], "name": r["name"], "where": r["where"], "lat": r["lat"], "lon": r["lon"],
           "url": "https://www.embalses.net/" + r["page"]}
    m = re.search(r"Agua embalsada \((\d\d)-(\d\d)-(\d{4})\):\s*" + num + r"\s*hm\s*3\s*" + num + r"\s*%", txt)
    if not m:
        raise net.FetchError("Formato inesperado en embalses.net (%s)" % r["name"])
    out["date"] = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    out["hm3"], out["pct"] = _es_num(m.group(4)), _es_num(m.group(5))
    m = re.search(r"Variación semana Anterior:\s*" + num + r"\s*hm\s*3\s*" + num + r"\s*%", txt)
    out["week_hm3"], out["week_pct"] = (_es_num(m.group(1)), _es_num(m.group(2))) if m else (None, None)
    m = re.search(r"Capacidad:\s*" + num + r"\s*hm\s*3", txt)
    out["capacity"] = _es_num(m.group(1)) if m else None
    m = re.search(r"Misma Semana \((\d{4})\):\s*" + num + r"\s*hm\s*3\s*" + num + r"\s*%", txt)
    out["last_year"] = {"year": int(m.group(1)), "hm3": _es_num(m.group(2)), "pct": _es_num(m.group(3))} if m else None
    m = re.search(r"Misma Semana \(Med\. 10 Años\):\s*" + num + r"\s*hm\s*3\s*" + num + r"\s*%", txt)
    out["avg10"] = {"hm3": _es_num(m.group(1)), "pct": _es_num(m.group(2))} if m else None

    # Tiempo real (SAIH Tajo): volumen, caudal desembalsado y pluviómetros cercanos.
    out["rt"] = _realtime(raw, out)

    # Variaciones semanales del último año → reconstrucción del volumen hacia atrás.
    weeks = re.findall(r"Semana (\d+) · (\d{4}) Variación:\s*" + num + r"\s*hm³(?: Variación media histórica:\s*"
                       + num + r"\s*hm³)?", txt)
    seen, series = set(), []
    for w, y, var, avg in weeks:
        key = (int(y), int(w))
        if key in seen:
            continue
        seen.add(key)
        series.append({"y": key[0], "w": key[1], "var": _es_num(var), "avg": _es_num(avg) if avg else None})
    series.sort(key=lambda s: (s["y"], s["w"]))
    vol = out["hm3"]
    for s in reversed(series):
        s["hm3"] = round(vol, 1) if vol is not None else None
        if vol is not None and s["var"] is not None:
            vol = vol - s["var"]
    cap = out["capacity"]
    for s in series:
        s["pct"] = round(100 * s["hm3"] / cap, 1) if (cap and s.get("hm3") is not None) else None
    out["weekly"] = series
    return out


def reservoirs():
    out, errors = [], []
    for r in config.RESERVOIRS:
        try:
            out.append(reservoir(r))
        except Exception as err:  # noqa: BLE001
            errors.append("%s: %s" % (r["name"], err))
    if not out:
        raise net.FetchError("; ".join(errors) or "sin datos")
    return {"items": out, "errors": errors}


# --- Avisos MeteoAlarm / AEMET --------------------------------------------

ALERT_TYPES = {
    1: ("viento", "Viento"), 2: ("nieve", "Nieve y hielo"), 3: ("tormenta", "Tormentas"), 4: ("niebla", "Nieblas"),
    5: ("calor", "Temperaturas máximas"), 6: ("frio", "Temperaturas mínimas"), 7: ("costeros", "Fenómenos costeros"),
    8: ("incendios", "Riesgo de incendio"), 9: ("aludes", "Aludes"), 10: ("lluvia", "Lluvias"),
    12: ("inundacion", "Inundaciones"), 13: ("lluvia", "Lluvias e inundaciones"),
}
LEVELS = {2: "amarillo", 3: "naranja", 4: "rojo"}


def warnings():
    data = net.http_json("https://feeds.meteoalarm.org/api/v1/warnings/feeds-spain", timeout=90)
    now = dt.datetime.now(dt.timezone.utc)
    out, seen = [], set()
    for w in data.get("warnings", []):
        for info in w.get("alert", {}).get("info", []):
            if not str(info.get("language", "")).startswith("es"):
                continue
            hit = any(g.get("value") == config.METEOALARM_AREA
                      for a in info.get("area", []) for g in a.get("geocode", []))
            if not hit:
                continue
            params = {p.get("valueName"): p.get("value") for p in info.get("parameter", [])}
            try:
                level = int(str(params.get("awareness_level", "1")).split(";")[0])
                atype = int(str(params.get("awareness_type", "0")).split(";")[0])
                expires = dt.datetime.fromisoformat(info["expires"])
            except (ValueError, KeyError):
                continue
            if level < 2 or expires < now:
                continue
            key = (info.get("event"), info.get("onset"), info.get("expires"))
            if key in seen:
                continue
            seen.add(key)
            slug, label = ALERT_TYPES.get(atype, ("otro", "Aviso"))
            out.append({
                "level": level, "color": LEVELS.get(level, "amarillo"), "type": slug, "type_label": label,
                "event": info.get("event"), "headline": info.get("headline"),
                "description": info.get("description"), "instruction": info.get("instruction"),
                "onset": info.get("onset"), "expires": info.get("expires"),
                "web": info.get("web") or "https://www.aemet.es/es/eltiempo/prediccion/avisos",
            })
    out.sort(key=lambda a: (a["onset"] or "", -a["level"]))
    return {"area": "Norte de Cáceres", "code": config.METEOALARM_AREA, "items": out}
