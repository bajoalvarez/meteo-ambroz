# Meteo Ambroz

El tiempo de los 8 pueblos del Valle del Ambroz (Cáceres): Hervás, Baños de Montemayor,
La Garganta, Gargantilla, Aldeanueva del Camino, Segura de Toro, Casas del Monte y Abadía.

Reúne en una sola página la previsión de 10 modelos meteorológicos, la predicción y los
avisos oficiales de AEMET, estaciones cercanas, embalses, mapas con radar y un histórico
diario desde 1940.

## Cómo arrancarla

Solo necesita Python 3.9 o superior (el que trae el Mac). No hay que instalar nada.

```bash
python3 server.py --open
```

Se abre en <http://127.0.0.1:8790>. La primera vez tarda unos segundos en reunir los datos.

Para verla desde el móvil con la misma wifi:

```bash
python3 server.py --host 0.0.0.0
```

El servidor muestra la dirección que hay que abrir en el móvil.

### Estación oficial de Hervás (opcional)

La estación automática de AEMET en Hervás (3504X) solo da datos con una clave gratuita de
AEMET OpenData (se pide en <https://opendata.aemet.es/centrodedescargas/altaUsuario>). Con ella:

```bash
AEMET_API_KEY="tu-clave" python3 server.py --open
```

### Publicada en GitHub Pages

La web pública se genera sola con GitHub Actions:

- `.github/workflows/publicar.yml` reúne los datos cada hora (minuto 17) con
  `python3 server.py --snapshot` y publica la carpeta `public/`. Si no consigue datos de
  los modelos, no publica y se queda la versión anterior.
- `.github/workflows/historico.yml` añade cada lunes los días nuevos de la serie ERA5 al
  repositorio. Así además el repositorio no se queda inactivo (GitHub pausa las tareas
  programadas tras 60 días sin cambios).

Para que la web pública muestre la estación oficial de Hervás, guarda tu clave de AEMET
OpenData como secreto del repositorio con el nombre `AEMET_API_KEY`
(Settings → Secrets and variables → Actions).

`python3 server.py --snapshot` también sirve para cualquier otro alojamiento estático:
escribe todos los datos en `public/api/` y la carpeta `public/` queda lista para subirla.

## Qué hay en cada sección

- **Ahora**: el tiempo actual del pueblo elegido sobre un fondo que cambia con el cielo
  real (sol, nubes, lluvia, tormenta, nieve, niebla, de día o de noche), las próximas
  24 horas, los 8 pueblos en un mapa, estaciones cercanas y "hoy en la historia".
- **Previsión**: 16 días con máximas, mínimas, lluvia, probabilidad, rachas, confianza y
  comparación con lo normal; detalle por tramos del día y meteograma de 48 h, 7 o 16 días.
- **Modelos**: pesos de cada modelo y por qué, error reciente medido, temperatura y lluvia
  acumulada de cada modelo, tabla día a día y probabilidades de los conjuntos.
- **Mapa**: relieve, callejero o satélite; temperatura, lluvia o rachas por pueblo; radar
  animado de las últimas 2 horas; estaciones y embalses.
- **Histórico**: últimos 7, 30 o 92 días; comparación entre pueblos; año hidrológico;
  últimos 24 meses frente a lo normal; franjas de temperatura desde 1940; lluvia anual,
  temperatura media y días de helada; récords absolutos, del mes y de hoy.
- **Embalses**: Baños, Gabriel y Galán, Guijo de Granadilla y Valdeobispo, con el boletín
  semanal, la lectura en tiempo real y la evolución del último año.
- **Fuentes**: estado de cada fuente, método de cálculo y enlaces a otras webs.

## Cómo se calcula la media ponderada

1. Se descarga la previsión horaria de 10 modelos para cada pueblo, a su altitud: ECMWF IFS,
   ECMWF AIFS, UKMO, AROME/ARPEGE (Météo-France), ICON (DWD), GFS, AIGFS, GEM, GSM (JMA) y
   GRAPES (CMA).
2. Cada modelo parte de un peso según su calidad en las verificaciones internacionales y su
   resolución sobre terreno de montaña (ECMWF IFS 1,00 … GRAPES 0,40).
3. AROME recibe ×1,4 en las primeras 48 h e ICON-EU ×1,15 hasta 5 días. Desde el tercer día
   los pesos se igualan poco a poco, y cada modelo pierde peso en sus últimas 18 horas para
   evitar saltos.
4. Acierto reciente: se compara lo que cada modelo previó con 1 y 3 días de antelación con
   la temperatura real (ERA5) de los últimos 14 días en Hervás. El que más acierta gana hasta
   ×1,5; el que más falla baja hasta ×0,6.
5. AEMET entra con el 25 % del peso los dos primeros días, bajando hasta el 12 % el séptimo,
   y con un 20 % en las horas en que publica dato horario.
6. La probabilidad de lluvia combina el acuerdo entre modelos (45 %), los 143 escenarios de
   los conjuntos ECMWF, GEFS, ICON y GEM (35 %) y la probabilidad de AEMET (20 %).

Los parámetros están en `ambroz/config.py`.

## Fuentes

| Fuente | Uso |
|---|---|
| [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) | Modelos, conjuntos, verificación, últimos 92 días y serie ERA5 |
| [AEMET](https://www.aemet.es/) | Predicción por municipios (XML abierto), avisos y estación 3504X (con clave) |
| [MeteoAlarm](https://meteoalarm.org/) | Avisos de AEMET para la zona Norte de Cáceres |
| [Meteoclimatic](https://www.meteoclimatic.net/) | Estaciones de aficionados a menos de 45 km |
| [embalses.net](https://www.embalses.net/) | Embalses (boletín del MITECO y SAIH Tajo) |
| [RainViewer](https://www.rainviewer.com/) | Radar de precipitación |
| OpenStreetMap, OpenTopoMap, Esri | Mapas base |

Meteologix, meteoblue, Windy y Weather Underground no ofrecen datos abiertos: se enlazan
desde la página, pero no se descargan.

## Límites conocidos

- No hay estaciones de Meteoclimatic dentro del valle; se muestran las más cercanas.
- Los récords salen del reanálisis ERA5 (celda de unos 30 km, con la temperatura corregida
  por altitud en cada pueblo). Son coherentes desde 1940, pero no son los récords oficiales
  de una estación. Las rachas de viento de ERA5 son orientativas.
- Los últimos días del histórico (ERA5 va unos 6 días por detrás) se completan con los
  análisis de los modelos y se marcan como provisionales.
- Open-Meteo es gratuito para uso no comercial, con un límite de unas 10.000 llamadas al
  día. El servidor guarda copia de todo en `data/` y respeta ese límite.

## Estructura

```
server.py            servidor y rutas /api/*.json
ambroz/config.py     pueblos, modelos, pesos, embalses y tiempos de caché
ambroz/openmeteo.py  modelos, conjuntos, verificación y días recientes
ambroz/aemet.py      predicción oficial y estación de Hervás
ambroz/stations.py   Meteoclimatic, embalses y avisos
ambroz/blend.py      media ponderada, símbolos y textos de cada día
ambroz/history.py    serie ERA5, normales, récords y año hidrológico
ambroz/net.py        descargas, caché en disco y control de cuota
public/              la página (HTML, CSS y JavaScript sin dependencias salvo Leaflet)
data/                caché y serie histórica (se crea sola)
```
