#!/usr/bin/env python3
"""Meteo Ambroz: el tiempo del Valle del Ambroz con todos los modelos.

Servidor local escrito solo con la biblioteca estándar de Python (3.9 o superior).

Uso:
    python3 server.py --open           arranca y abre http://127.0.0.1:8790
    python3 server.py --host 0.0.0.0   accesible desde el móvil en la misma wifi
    python3 server.py --snapshot       genera public/api/*.json para publicar como web estática
    AEMET_API_KEY=... python3 server.py  añade la estación oficial de Hervás (clave gratuita)
"""
import argparse
import gzip
import json
import logging
import os
import re
import socket
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ambroz import api, config, history, net  # noqa: E402

log = logging.getLogger("ambroz")

ROUTES = [
    (re.compile(r"^/api/overview\.json$"), lambda m: api.overview()),
    (re.compile(r"^/api/village/([a-z-]+)\.json$"), lambda m: api.village(m.group(1))),
    (re.compile(r"^/api/history/([a-z-]+)\.json$"), lambda m: api.history_view(m.group(1))),
    (re.compile(r"^/api/embalses\.json$"), lambda m: api.reservoirs()),
    (re.compile(r"^/api/estaciones\.json$"), lambda m: api.observations()),
    (re.compile(r"^/api/fuentes\.json$"), lambda m: api.sources()),
]


class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{".js": "text/javascript", ".mjs": "text/javascript",
                                                                    ".json": "application/json", ".svg": "image/svg+xml"})

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=config.PUBLIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):  # noqa: N802 - nombre impuesto por http.server
        path = self.path.split("?", 1)[0]
        if not path.startswith("/api/"):
            return super().do_GET()
        for rx, fn in ROUTES:
            m = rx.match(path)
            if not m:
                continue
            if m.groups() and m.group(1) not in config.VILLAGE_BY_ID:
                return self._json(404, {"error": "Pueblo desconocido: %s" % m.group(1)})
            try:
                return self._json(200, fn(m))
            except net.FetchError as err:
                return self._json(503, {"error": str(err)})
            except Exception as err:  # noqa: BLE001
                log.exception("Error en %s", path)
                return self._json(500, {"error": "Error interno: %s" % err})
        return self._json(404, {"error": "Ruta desconocida"})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        zipped = "gzip" in (self.headers.get("Accept-Encoding") or "") and len(body) > 1400
        if zipped:
            body = gzip.compress(body, 5)
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if zipped:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def history_loop():
    """Completa la serie ERA5 al arrancar y añade los días nuevos cada 6 horas."""
    while True:
        try:
            history.update()
        except net.RateLimited as err:
            history.PROGRESS.update(state="en pausa", error="Cuota de Open-Meteo: " + err.scope)
            time.sleep(900)
            continue
        except Exception as err:  # noqa: BLE001
            history.PROGRESS.update(state="error", error=str(err)[:200])
            log.warning("Histórico sin actualizar: %s", err)
            time.sleep(1800)
            continue
        time.sleep(6 * 3600)


def warm_up():
    try:
        api.overview()
        api.reservoirs()
        api.observations()
        log.info("Datos iniciales listos.")
    except Exception as err:  # noqa: BLE001
        log.warning("Precarga incompleta: %s", err)


def snapshot(out_dir):
    """Escribe todas las respuestas como ficheros estáticos (para GitHub Pages, Netlify…).

    Si no hay datos de modelos termina con error, para que la web publicada conserve
    la versión anterior en lugar de mostrar una vacía.
    """
    try:
        history.update()
    except Exception as err:  # noqa: BLE001
        log.warning("Histórico sin actualizar: %s", err)
    overview = api.overview()
    missing = [v["village"]["name"] for v in overview["villages"] if "error" in v]
    if missing:
        raise SystemExit("Sin datos de modelos para: %s" % ", ".join(missing))
    jobs = [("overview.json", lambda: overview), ("embalses.json", api.reservoirs),
            ("estaciones.json", api.observations)]
    for v in config.VILLAGES:
        jobs.append(("village/%s.json" % v["id"], lambda vid=v["id"]: api.village(vid)))
        jobs.append(("history/%s.json" % v["id"], lambda vid=v["id"]: api.history_view(vid)))
    jobs.append(("fuentes.json", api.sources))  # al final, con el estado de todas las fuentes
    for name, fn in jobs:
        path = os.path.join(out_dir, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(fn(), fh, ensure_ascii=False, separators=(",", ":"))
        log.info("Escrito %s", path)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser(description="Meteo Ambroz: servidor local del tiempo del Valle del Ambroz")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8790")))
    ap.add_argument("--snapshot", nargs="?", const=os.path.join(config.PUBLIC_DIR, "api"),
                    help="genera los JSON estáticos y termina")
    ap.add_argument("--open", action="store_true", help="abre la página en el navegador al arrancar")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    os.makedirs(config.DATA_DIR, exist_ok=True)

    if args.snapshot:
        snapshot(args.snapshot)
        return

    threading.Thread(target=history_loop, name="historico", daemon=True).start()
    threading.Thread(target=warm_up, name="precarga", daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    log.info("Meteo Ambroz listo en http://%s:%d", "127.0.0.1" if args.host in ("0.0.0.0", "") else args.host, args.port)
    if args.open:
        threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:%d/" % args.port)).start()
    if args.host in ("0.0.0.0", ""):
        ip = lan_ip()
        if ip:
            log.info("Desde el móvil (misma wifi): http://%s:%d", ip, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Servidor detenido.")


if __name__ == "__main__":
    main()
