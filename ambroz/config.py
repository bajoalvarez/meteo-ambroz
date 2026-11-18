"""Configuración: pueblos, modelos, embalses, estaciones y tiempos de caché."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
PUBLIC_DIR = os.path.join(ROOT, "public")
TZ = "Europe/Madrid"
USER_AGENT = "MeteoAmbroz/1.0 (pagina local del tiempo del Valle del Ambroz)"

# Los 8 pueblos del valle. Coordenadas y altitud: GeoNames (Open-Meteo geocoding).
# ine: código de municipio que usa AEMET. geonames: id para enlazar a webs externas.
VILLAGES = [
    {"id": "hervas", "name": "Hervás", "lat": 40.2708, "lon": -5.8672, "elev": 664, "ine": "10096", "geonames": 3120776, "slug": "hervas"},
    {"id": "banos", "name": "Baños de Montemayor", "lat": 40.3167, "lon": -5.8601, "elev": 696, "ine": "10024", "geonames": 3128874, "slug": "banos-de-montemayor"},
    {"id": "la-garganta", "name": "La Garganta", "lat": 40.3289, "lon": -5.8232, "elev": 1132, "ine": "10078", "geonames": 3119696, "slug": "la-garganta"},
    {"id": "gargantilla", "name": "Gargantilla", "lat": 40.2484, "lon": -5.9207, "elev": 638, "ine": "10080", "geonames": 3121582, "slug": "gargantilla"},
    {"id": "aldeanueva", "name": "Aldeanueva del Camino", "lat": 40.2598, "lon": -5.9289, "elev": 521, "ine": "10015", "geonames": 3130491, "slug": "aldeanueva-del-camino"},
    {"id": "segura", "name": "Segura de Toro", "lat": 40.2243, "lon": -5.9484, "elev": 639, "ine": "10174", "geonames": 3109239, "slug": "segura-de-toro"},
    {"id": "casas", "name": "Casas del Monte", "lat": 40.2032, "lon": -5.9615, "elev": 584, "ine": "10055", "geonames": 3126066, "slug": "casas-del-monte"},
    {"id": "abadia", "name": "Abadía", "lat": 40.2592, "lon": -5.9783, "elev": 453, "ine": "10001", "geonames": 3131138, "slug": "abadia"},
]
VILLAGE_BY_ID = {v["id"]: v for v in VILLAGES}

# Modelos numéricos (vía Open-Meteo). "base" es el peso a priori: refleja la
# verificación global publicada (WMO/ECMWF) y la resolución sobre terreno
# complejo. "boost" multiplica el peso hasta cierta hora de previsión
# (modelos de área limitada de alta resolución). "group" fija cuántos días
# se piden. El peso final se corrige con el error real de los últimos días.
MODELS = [
    {"id": "ecmwf_ifs", "name": "ECMWF IFS", "org": "Centro Europeo ECMWF", "res": "9 km", "base": 1.00, "group": "long",
     "note": "Modelo global de referencia en Europa."},
    {"id": "ukmo_seamless", "name": "UKMO", "org": "Met Office (Reino Unido)", "res": "10 km", "base": 0.90, "group": "mid",
     "note": "Segundo global mejor verificado de forma habitual."},
    {"id": "meteofrance_seamless", "name": "AROME · ARPEGE", "org": "Météo-France", "res": "1,3–10 km", "base": 0.85, "group": "short",
     "boost": [[48, 1.40]], "note": "AROME resuelve el relieve del valle en las primeras 48 h."},
    {"id": "icon_seamless", "name": "ICON", "org": "DWD (Alemania)", "res": "7–13 km", "base": 0.85, "group": "mid",
     "boost": [[120, 1.15]], "note": "ICON-EU a 7 km los primeros 5 días."},
    {"id": "ecmwf_aifs025_single", "name": "ECMWF AIFS", "org": "ECMWF · inteligencia artificial", "res": "28 km", "base": 0.85, "group": "long",
     "note": "Modelo de IA del ECMWF, muy bueno en la circulación general."},
    {"id": "gfs_seamless", "name": "GFS", "org": "NOAA (EE. UU.)", "res": "13 km", "base": 0.70, "group": "long",
     "note": "Global estadounidense, llega a 16 días."},
    {"id": "ncep_aigfs025", "name": "AIGFS", "org": "NOAA · inteligencia artificial", "res": "25 km", "base": 0.60, "group": "long",
     "note": "Versión de IA del GFS."},
    {"id": "gem_seamless", "name": "GEM", "org": "ECCC (Canadá)", "res": "15 km", "base": 0.60, "group": "mid",
     "note": "Global canadiense."},
    {"id": "jma_seamless", "name": "GSM", "org": "JMA (Japón)", "res": "55 km", "base": 0.45, "group": "mid",
     "note": "Resolución gruesa: poco peso en un valle de montaña."},
    {"id": "cma_grapes_global", "name": "GRAPES", "org": "CMA (China)", "res": "15 km", "base": 0.40, "group": "short",
     "note": "Global chino, horizonte corto en Open-Meteo."},
]
MODEL_BY_ID = {m["id"]: m for m in MODELS}
MODEL_GROUP_DAYS = {"long": 16, "mid": 11, "short": 6}
HOURLY_VARS = ["temperature_2m", "relative_humidity_2m", "precipitation", "snowfall", "weather_code",
               "cloud_cover", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "pressure_msl"]

# Peso relativo de la predicción oficial de AEMET dentro de la mezcla diaria
# (fracción del total) según el día de previsión (0 = hoy).
AEMET_SHARE = [0.25, 0.25, 0.22, 0.18, 0.16, 0.14, 0.12]
# Fracción de la probabilidad de lluvia que aporta cada fuente.
POP_MIX = {"models": 0.45, "ensemble": 0.35, "aemet": 0.20}

ENSEMBLE_MODELS = ["ecmwf_ifs025", "gfs025", "icon_seamless", "gem_global"]
ENSEMBLE_POINT = "hervas"

# Embalses de la zona (cuenca del Alagón). Datos semanales del MITECO vía embalses.net.
RESERVOIRS = [
    {"id": "banos", "name": "Baños", "page": "pantano-912-banos.html", "lat": 40.2956, "lon": -5.8857,
     "where": "Baños de Montemayor, en el propio valle"},
    {"id": "gabriel-y-galan", "name": "Gabriel y Galán", "page": "pantano-977-gabriel-y-galan.html", "lat": 40.3110, "lon": -6.1238,
     "where": "Río Alagón, al oeste del valle"},
    {"id": "guijo-de-granadilla", "name": "Guijo de Granadilla", "page": "pantano-990-guijo-de-granadilla.html", "lat": 40.2007, "lon": -6.1329,
     "where": "Río Alagón, aguas abajo de Gabriel y Galán"},
    {"id": "valdeobispo", "name": "Valdeobispo", "page": "pantano-1209-valdeobispo.html", "lat": 40.1395, "lon": -6.2064,
     "where": "Río Alagón, cerca de Montehermoso"},
]

# Estación oficial de AEMET en el valle. Sus datos horarios requieren una
# clave gratuita de AEMET OpenData (variable de entorno AEMET_API_KEY).
AEMET_STATIONS = [{"id": "3504X", "name": "Hervás (AEMET)", "lat": 40.2650, "lon": -5.8611, "elev": 724}]
AEMET_API_KEY = os.environ.get("AEMET_API_KEY", "").strip()

# Estaciones de aficionados de Meteoclimatic: provincias de Cáceres y Salamanca.
METEOCLIMATIC_FEEDS = ["ESEXT10", "ESCYL37"]
METEOCLIMATIC_RADIUS_KM = 45
VALLEY_CENTER = (40.27, -5.90)

# Zona de avisos de AEMET/MeteoAlarm que cubre el valle.
METEOALARM_AREA = "ES198"  # Norte de Cáceres

# Serie histórica: los 8 pueblos caen en la misma celda de ERA5 (40,25 N 5,75 O),
# así que se guarda una sola serie a la altitud de Hervás y se ajusta por altitud.
HISTORY_POINT = {"id": "valle", "lat": 40.2708, "lon": -5.8672, "elev": 664, "start": "1940-01-01"}
LAPSE_RATE = 0.0065  # °C por metro, el mismo gradiente que aplica Open-Meteo
HISTORY_DAILY_VARS = ["temperature_2m_max", "temperature_2m_min", "temperature_2m_mean", "precipitation_sum",
                      "snowfall_sum", "wind_speed_10m_max", "wind_gusts_10m_max", "pressure_msl_mean",
                      "pressure_msl_min", "pressure_msl_max"]
RECENT_DAILY_VARS = ["temperature_2m_max", "temperature_2m_min", "temperature_2m_mean", "precipitation_sum",
                     "snowfall_sum", "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
                     "pressure_msl_mean", "relative_humidity_2m_mean"]

# ¿Lloverá? Ventanas de las próximas horas y umbral de lluvia apreciable (mm).
RAIN_WINDOWS = [[1, 0.1], [6, 0.2], [12, 0.3], [24, 0.5]]
# Modelo de alta resolución para la lluvia cada 15 minutos y el mapa de lluvia prevista.
RAIN_MODEL = "meteofrance_seamless"
RAIN_MODEL_NAME = "AROME / ARPEGE (Météo-France)"
# Rejilla del mapa de lluvia prevista: 15 × 8 puntos cada ~10 km alrededor del valle.
RAIN_GRID = {"lat0": 39.92, "lon0": -6.75, "dlat": 0.1, "dlon": 0.1214, "ny": 8, "nx": 15, "hours": 36}

# Tiempo de vida de cada caché, en segundos.
TTL = {
    "models": 60 * 60,
    "extras": 3 * 60 * 60,
    "ensemble": 4 * 60 * 60,
    "skill": 12 * 60 * 60,
    "recent": 3 * 60 * 60,
    "aemet": 60 * 60,
    "meteoalarm": 30 * 60,
    "meteoclimatic": 10 * 60,
    "aemet_obs": 30 * 60,
    "embalses": 6 * 60 * 60,
    "q15": 30 * 60,
    "raingrid": 2 * 60 * 60,
}
