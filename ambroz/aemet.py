"""AEMET: predicción oficial por municipio (XML abierto, sin clave) y estación de Hervás (con clave)."""
import json
import re
import xml.etree.ElementTree as ET

from . import config, net

DAILY_URL = "https://www.aemet.es/xml/municipios/localidad_{ine}.xml"
HOURLY_URL = "https://www.aemet.es/xml/municipios_h/localidad_h_{ine}.xml"
OBS_URL = "https://opendata.aemet.es/opendata/api/observacion/convencional/datos/estacion/{idema}"


def _parse(raw):
    text = raw.decode("iso-8859-15", "replace").strip()
    text = re.sub(r"^<\?xml[^>]*\?>", "", text)
    return ET.fromstring(text)


def _num(s):
    if s is None:
        return None
    s = s.strip()
    if not s:
        return None
    if s.lower() == "ip":  # inapreciable
        return 0.0
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def daily(ine):
    root = _parse(net.http_get(DAILY_URL.format(ine=ine)))
    out = {"elaborado": root.findtext("elaborado"), "dias": []}
    for dia in root.iter("dia"):
        d = {"fecha": dia.get("fecha"), "prob": {}, "cielo": {}, "viento": {}, "racha": {}, "cota_nieve": {}}
        for e in dia.findall("prob_precipitacion"):
            x = _num(e.text)
            if x is not None:
                d["prob"][e.get("periodo") or "00-24"] = x
        for e in dia.findall("cota_nieve_prov"):
            x = _num(e.text)
            if x is not None:
                d["cota_nieve"][e.get("periodo") or "00-24"] = x
        for e in dia.findall("estado_cielo"):
            code = (e.text or "").strip()
            if code:
                d["cielo"][e.get("periodo") or "00-24"] = {"code": code, "desc": e.get("descripcion") or ""}
        for e in dia.findall("viento"):
            vel = _num(e.findtext("velocidad"))
            if vel is not None:
                d["viento"][e.get("periodo") or "00-24"] = {"dir": (e.findtext("direccion") or "").strip(), "vel": vel}
        for e in dia.findall("racha_max"):
            x = _num(e.text)
            if x is not None:
                d["racha"][e.get("periodo") or "00-24"] = x
        t = dia.find("temperatura")
        d["tmax"] = _num(t.findtext("maxima")) if t is not None else None
        d["tmin"] = _num(t.findtext("minima")) if t is not None else None
        hr = dia.find("humedad_relativa")
        d["hr_max"] = _num(hr.findtext("maxima")) if hr is not None else None
        d["hr_min"] = _num(hr.findtext("minima")) if hr is not None else None
        d["uv"] = _num(dia.findtext("uv_max"))
        out["dias"].append(d)
    return out


def hourly(ine):
    root = _parse(net.http_get(HOURLY_URL.format(ine=ine)))
    out = {"elaborado": root.findtext("elaborado"), "horas": [], "probs": [], "dias": []}
    for dia in root.iter("dia"):
        fecha = dia.get("fecha")
        rows = {}

        def row(h):
            return rows.setdefault(h, {"time": "%sT%s:00" % (fecha, h)})

        for e in dia.findall("estado_cielo"):
            p, code = e.get("periodo"), (e.text or "").strip()
            if p and code:
                r = row(p)
                r["cielo"], r["desc"] = code, e.get("descripcion") or ""
        for tag, key in (("precipitacion", "precip"), ("nieve", "nieve"), ("temperatura", "temp"),
                         ("sens_termica", "sens"), ("humedad_relativa", "hr"), ("racha_max", "racha")):
            for e in dia.findall(tag):
                p = e.get("periodo")
                x = _num(e.text)
                if p and x is not None:
                    row(p)[key] = x
        for e in dia.findall("viento"):
            p = e.get("periodo")
            vel = _num(e.findtext("velocidad"))
            if p and vel is not None:
                r = row(p)
                r["vel"], r["dir"] = vel, (e.findtext("direccion") or "").strip()
        for tag in ("prob_precipitacion", "prob_tormenta", "prob_nieve"):
            for e in dia.findall(tag):
                p, x = e.get("periodo"), _num(e.text)
                if p and x is not None and len(p) == 4:
                    out["probs"].append({"fecha": fecha, "desde": p[:2], "hasta": p[2:], "tipo": tag[5:], "valor": x})
        out["dias"].append({"fecha": fecha, "orto": dia.get("orto"), "ocaso": dia.get("ocaso")})
        out["horas"].extend(sorted(rows.values(), key=lambda r: r["time"]))
    return out


def station_obs(idema):
    """Últimas 24 h de la estación oficial (necesita AEMET_API_KEY)."""
    if not config.AEMET_API_KEY:
        return None
    meta = net.http_json(OBS_URL.format(idema=idema), headers={"api_key": config.AEMET_API_KEY,
                                                               "Accept": "application/json"})
    if meta.get("estado") != 200 or not meta.get("datos"):
        raise net.FetchError("AEMET OpenData: %s" % meta.get("descripcion", "sin datos"))
    rows = json.loads(net.http_get(meta["datos"]).decode("iso-8859-15", "replace"))
    out = []
    for r in rows:
        def ms(key):
            x = r.get(key)
            return None if x is None else round(x * 3.6, 1)
        out.append({
            "time": r.get("fint"), "ta": r.get("ta"), "tamax": r.get("tamax"), "tamin": r.get("tamin"),
            "hr": r.get("hr"), "prec": r.get("prec"), "vv": ms("vv"), "vmax": ms("vmax"), "dv": r.get("dv"),
            "pres": r.get("pres_nmar") or r.get("pres"), "nieve": r.get("nieve"),
        })
    out.sort(key=lambda x: x["time"] or "")
    return out
