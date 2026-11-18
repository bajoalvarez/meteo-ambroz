"""Descargas HTTP con reintentos, caché en disco y control de los límites de Open-Meteo."""
import collections
import gzip
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

log = logging.getLogger("ambroz")
CACHE_DIR = os.path.join(config.DATA_DIR, "cache")


class FetchError(Exception):
    pass


class RateLimited(FetchError):
    """Open-Meteo ha rechazado la petición por superar su cuota gratuita."""

    def __init__(self, scope, message):
        super().__init__(message)
        self.scope = scope  # "minute", "hour" o "day"


_polite_lock = threading.Lock()
_last_hit = {}


def _polite(host, gap=0.35):
    """Deja un pequeño hueco entre peticiones seguidas al mismo servidor."""
    with _polite_lock:
        wait = _last_hit.get(host, 0) + gap - time.time()
        _last_hit[host] = time.time() + max(0.0, wait)
    if wait > 0:
        time.sleep(wait)


def http_get(url, params=None, timeout=45, headers=None, retries=2):
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params, safe=",:")
    hdrs = {"User-Agent": config.USER_AGENT, "Accept-Encoding": "gzip"}
    if headers:
        hdrs.update(headers)
    host = urllib.parse.urlsplit(url).netloc
    for attempt in range(retries + 1):
        _polite(host)
        req = urllib.request.Request(url, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return body
        except urllib.error.HTTPError as err:
            body = err.read() or b""
            if err.headers.get("Content-Encoding") == "gzip":
                try:
                    body = gzip.decompress(body)
                except OSError:
                    pass
            text = body.decode("utf-8", "replace")
            if err.code == 429 or "limit exceeded" in text.lower():
                low = text.lower()
                scope = "day" if "daily" in low else "hour" if "hourly" in low else "minute"
                raise RateLimited(scope, text[:200])
            if err.code >= 500 and attempt < retries:
                time.sleep(2 * (attempt + 1))
                continue
            raise FetchError("HTTP %s en %s: %s" % (err.code, host, text[:200]))
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
                continue
            raise FetchError("Sin conexión con %s: %s" % (host, err))
    raise FetchError("Sin respuesta de %s" % host)


def http_json(url, params=None, **kw):
    return json.loads(http_get(url, params, **kw).decode("utf-8"))


# --- Cuota de Open-Meteo -------------------------------------------------
# La API gratuita admite 600 llamadas/minuto, 5.000/hora y 10.000/día. Una
# petición "pesa" más de una llamada si pide más de 10 variables, más de 2
# semanas de datos o varios puntos. Llevamos la cuenta para no pasarnos.

_om_lock = threading.Lock()
_om_window = collections.deque()  # (instante, peso)
_om_blocked_until = 0.0
OM_MINUTE_BUDGET = 480


def om_weight(locations=1, models=1, variables=10, days=14):
    return locations * models * max(1.0, variables / 10.0) * max(1.0, days / 14.0)


def openmeteo_json(url, params, weight=1.0):
    global _om_blocked_until
    if time.time() < _om_blocked_until:
        raise RateLimited("hour", "Cuota de Open-Meteo agotada; se reintentará más tarde")
    for attempt in range(2):
        with _om_lock:
            now = time.time()
            while _om_window and now - _om_window[0][0] > 60:
                _om_window.popleft()
            used = sum(w for _, w in _om_window)
            if _om_window and used + weight > OM_MINUTE_BUDGET:
                wait = 61 - (now - _om_window[0][0])
            else:
                wait = 0
        if wait > 0:
            time.sleep(min(wait, 61))
        with _om_lock:
            _om_window.append((time.time(), weight))
        try:
            return http_json(url, params, timeout=90)
        except RateLimited as err:
            if err.scope == "minute" and attempt == 0:
                time.sleep(65)
                continue
            if err.scope in ("hour", "day"):
                with _om_lock:
                    _om_blocked_until = time.time() + (15 * 60 if err.scope == "hour" else 3 * 3600)
            raise
    raise RateLimited("minute", "Límite por minuto de Open-Meteo")


# --- Caché en disco con estado por fuente --------------------------------

_mem = {}
_locks = collections.defaultdict(threading.Lock)
STATUS = {}


def _path(key):
    return os.path.join(CACHE_DIR, key.replace("/", "_") + ".json")


def cache_read(key):
    if key in _mem:
        return _mem[key]
    try:
        with open(_path(key), "r", encoding="utf-8") as fh:
            entry = json.load(fh)
        _mem[key] = (entry["t"], entry["data"])
        return _mem[key]
    except (OSError, ValueError, KeyError):
        return (0, None)


def cache_write(key, data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    now = time.time()
    tmp = _path(key) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"t": now, "data": data}, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, _path(key))
    _mem[key] = (now, data)
    return now


def cached(key, ttl, producer, source=None):
    """Devuelve (datos, meta). Si la descarga falla, sirve la copia antigua."""
    source = source or key
    with _locks[key]:
        ts, data = cache_read(key)
        if data is not None and time.time() - ts < ttl:
            STATUS.setdefault(source, {"ok": True, "updated": ts, "error": None})
            return data, {"updated": ts, "stale": False}
        try:
            fresh = producer()
            ts = cache_write(key, fresh)
            STATUS[source] = {"ok": True, "updated": ts, "error": None}
            return fresh, {"updated": ts, "stale": False}
        except Exception as err:  # noqa: BLE001 - cualquier fallo de red o de formato
            log.warning("Fuente %s sin actualizar: %s", source, err)
            STATUS[source] = {"ok": False, "updated": ts or None, "error": str(err)[:240]}
            if data is not None:
                return data, {"updated": ts, "stale": True, "error": str(err)[:240]}
            raise
