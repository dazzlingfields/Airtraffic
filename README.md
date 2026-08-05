# Overhead — Live Flight Surveillance

A fully client-side ADS-B flight tracker. It locates you, surfaces the **nearest aircraft overhead** as a primary target, and pairs it with an in-depth radar map: switchable basemaps, live weather radar, distance rings, trails, airport overlays, filters, and field statistics. No backend, no API keys, no build step — just static files that run on GitHub Pages.

```


- **PRIMARY TARGET** — the closest airborne return to you, with photo, route, altitude tape, and live telemetry.
- **RADAR map** — pan to load traffic for the view; planes are colored by altitude band and rotated to their track.
- **WATCHLIST** — a fixed set of registrations (`WATCH_REGS` in `js/app.js`, currently ZK-IPB / ZK-IPC / ZK-IPJ) tracked nationwide via the `/v2/reg/` endpoint rather than only inside the local query radius. The card appears only when at least one is contactable and its height follows the match count, so an empty watchlist costs no screen space. Each row shows state, a resolved position, and live telemetry; clicking one flies the map to it. A contact that drops off the feed is held for 90 s marked LOST with its last known position before being removed.
- **LAYERS** — one control, top right. Base map, overlays, weather playback, airspace chart and all filters live behind it at every breakpoint; nothing else is docked over the map.
- **FILTERS** — search by registration, hex, or callsign; toggle category chips; set an altitude floor/ceiling; or restrict to airborne / military / emergency only. Watchlist registrations bypass filtering, so a stray chip cannot hide a tracked aircraft.
- **FIELD STATS** — live counts, category and altitude breakdowns, and closest / highest / fastest superlatives.
- **Top bar** — manual Sync plus live connection state. Units, theme and follow-nearest sit at the foot of the rail. An emergency banner appears whenever a 7500 / 7600 / 7700 squawk is in range.

Preferences (theme, units, filters, layers) persist in `localStorage`.

## Data sources & attribution

- **Aircraft positions** — [airplanes.live](https://airplanes.live/) (`/v2/point/{lat}/{lon}/{radius}` for local traffic, `/v2/reg/{a,b,c}` for the watchlist), community ADS-B, free and CORS-enabled. Radius is capped at 250 NM per query and the API is rate limited to 1 request per second, so the watchlist call is staggered inside the existing poll rather than given its own timer.
- **Aircraft & route metadata** — [adsbdb](https://www.adsbdb.com/) (registration, type, operator, origin/destination).
- **Weather radar** — [RainViewer](https://www.rainviewer.com/) public weather-maps API (no key). Radar tiles render up to ~zoom 7; they look soft when zoomed in tight — that's the source resolution.
- **Airspace chart** — [openAIP](https://www.openaip.net/) tiles, optional. Requires a free personal key, entered in the layers panel and stored only in `localStorage`. No key ships with the source.
- **Basemaps** — CARTO (dark/light), Esri World Imagery (satellite), OpenTopoMap (terrain), © OpenStreetMap contributors.
- **Map engine** — [Leaflet 1.9.4](https://leafletjs.com/) via CDN.

## Notes & limits

- ADS-B coverage is community-sourced. Aircraft without ADS-B, or outside receiver range, won't appear. **Not for navigation.**
- Everything runs in the browser; the only network calls are to the public data sources above.
- Auto-refresh runs about every 8 seconds while a location is set.

## Design notes

The interface is deliberately map-first: one floating glass material, one accent, one radius family, three type sizes, and sentence case throughout. All controls other than the rail collapse behind a single layers button. Telemetry uses tabular figures so numbers do not jitter between polls.

Aircraft silhouettes are generated parametrically in `js/aircraft.js`: ogive noses, wing planforms with a mid-span station so the trailing edge kinks at the root fairing, nacelles positioned from the wing leading edge rather than hand-placed, and a per-kind fit scale so each shape fills its marker box. Contrast against the basemap comes from a stroke baked into the SVG via `paint-order`, not from CSS filters, which keeps hundreds of simultaneous markers cheap to composite.

## Local development

Static files, no build step. Serve the directory over HTTP so the `fetch` calls for `data/*.json` resolve:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
