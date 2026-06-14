# Overhead — Live Flight Surveillance

A fully client-side ADS-B flight tracker. It locates you, surfaces the **nearest aircraft overhead** as a primary target, and pairs it with an in-depth radar map: switchable basemaps, live weather radar, distance rings, trails, airport overlays, filters, and field statistics. No backend, no API keys, no build step — just static files that run on GitHub Pages.

```
overhead/
├── index.html        ← structure + script/style wiring
├── css/
│   └── styles.css     ← all styling, dark/light themes
└── js/
    ├── airports.js    ← bundled airport dataset  (window.AIRPORTS)
    ├── aircraft.js    ← classification, icons, alt bands (window.AC)
    └── app.js         ← map, data fetching, UI, state (main app)
```

Scripts load in order (`leaflet → airports → aircraft → app`) as plain `<script>` tags — intentionally **not** ES modules, so it works from any path and over `file://` without CORS surprises.

## Deploy to GitHub Pages

1. Put these files in a repository, preserving the structure above (`index.html` at the repo root, or inside `/docs`).
2. In the repo: **Settings → Pages**.
3. Under *Build and deployment*, set **Source = Deploy from a branch**, pick your branch and the folder (`/root` or `/docs`), and save.
4. Open the published `https://<user>.github.io/<repo>/` URL.

**Geolocation requires HTTPS.** GitHub Pages serves over HTTPS by default, so this works once deployed. Opening `index.html` directly from disk will block location in most browsers — use the Pages URL (or a local `https`/`localhost` server) and allow the location prompt. If you deny location, the map still loads; use **SYNC** to retry after granting permission.

## Using it

- **PRIMARY TARGET** — the closest airborne return to you, with photo, route, altitude tape, and live telemetry.
- **RADAR map** — pan to load traffic for the view; planes are colored by altitude band and rotated to their track.
- **MAP LAYERS** — switch basemap (Dark / Light / Sat / Terrain) and toggle overlays: Trails, Rings, Airports, Labels, WX Radar. Weather radar adds a playback strip (prev / play / next / opacity).
- **FILTERS** — search by registration, hex, or callsign; toggle category chips; set an altitude floor/ceiling; or restrict to airborne / military / emergency only.
- **FIELD STATS** — live counts, category and altitude breakdowns, and closest / highest / fastest superlatives.
- **Top bar** — switch units (imperial/metric), theme (auto/dark/light), follow-nearest, and manual SYNC. An emergency banner appears whenever a 7500 / 7600 / 7700 squawk is in range.

Preferences (theme, units, filters, layers) persist in `localStorage`.

## Data sources & attribution

- **Aircraft positions** — [airplanes.live](https://airplanes.live/) (`/v2/point/{lat}/{lon}/{radius}`), community ADS-B, free and CORS-enabled. Radius is capped at 250 NM per query.
- **Aircraft & route metadata** — [adsbdb](https://www.adsbdb.com/) (registration, type, operator, origin/destination).
- **Weather radar** — [RainViewer](https://www.rainviewer.com/) public weather-maps API (no key). Radar tiles render up to ~zoom 7; they look soft when zoomed in tight — that's the source resolution.
- **Basemaps** — CARTO (dark/light), Esri World Imagery (satellite), OpenTopoMap (terrain), © OpenStreetMap contributors.
- **Map engine** — [Leaflet 1.9.4](https://leafletjs.com/) via CDN.

## Notes & limits

- ADS-B coverage is community-sourced. Aircraft without ADS-B, or outside receiver range, won't appear. **Not for navigation.**
- Everything runs in the browser; the only network calls are to the public data sources above.
- Auto-refresh runs about every 8 seconds while a location is set.
