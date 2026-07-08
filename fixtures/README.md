# fixtures/

Real, captured snapshots of every external data source the F1 decision platform
consumes, so the system runs **clone → run with zero credentials**. All fixtures
were pulled from live, keyless/free APIs on **2026-07-07T00:00:00Z** — that
timestamp is hardcoded throughout (do not call `Date.now()`/`new Date()` in any
committed code that references these fixtures; use the literal capture string
`"2026-07-07T00:00:00Z"` instead).

See [`manifest.json`](./manifest.json) for a machine-readable index of every
fixture (name, path, source URL, capture timestamp, and notes).

## Contents & provenance

| Fixture | Source | Notes |
|---|---|---|
| `jolpica/driver_standings.json` | `GET https://api.jolpi.ca/ergast/f1/2025/driverStandings.json` | Ergast-compatible F1 2025 driver championship standings (Jolpica is a free, keyless Ergast mirror). Captured verbatim. |
| `jolpica/last_results.json` | `GET https://api.jolpi.ca/ergast/f1/2025/last/results.json` | Results of the most recent completed 2025 race at capture time. Captured verbatim. |
| `jolpica/constructor_standings.json` | `GET https://api.jolpi.ca/ergast/f1/2025/constructorStandings.json` | F1 2025 constructor championship standings. Captured verbatim. |
| `openf1/weather.json` | `GET https://api.openf1.org/v1/weather?session_key=9472` | Trackside weather telemetry, OpenF1 session 9472 (2024 Bahrain GP Race). Live payload has 157 rows; trimmed to the first 20 to bound fixture size. |
| `openf1/sessions.json` | `GET https://api.openf1.org/v1/sessions?year=2024&session_name=Race` | 2024-season Race sessions. Live payload has 24 rows; trimmed to the first 10. |
| `openmeteo/silverstone_forecast.json` | `GET https://api.open-meteo.com/v1/forecast?latitude=52.07&longitude=-1.01&hourly=temperature_2m,precipitation_probability&forecast_days=3` | 3-day hourly temperature/precipitation-probability forecast for Silverstone. Captured verbatim, free/keyless. |
| `news/autosport_f1.raw.xml` | `GET https://www.autosport.com/rss/f1/news/` | Raw RSS/XML as returned by Autosport. Untouched source-of-truth. |
| `news/autosport_f1.json` | derived from `autosport_f1.raw.xml` | First 15 `<item>` entries parsed into `{ title, link, isoDate, contentSnippet }`. `isoDate` is the item's `pubDate` normalized from RFC-822 to UTC ISO-8601. `contentSnippet` is the HTML-stripped, whitespace-collapsed `description`, truncated to ~300 chars. Parsed with a small `python3` regex/CDATA extractor — no npm dependency added. |
| `kalshi/kxf1_markets.json` | `GET https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXF1&limit=25` | See "Kalshi demo pricing" below. |

## Kalshi demo pricing (important)

`fixtures/kalshi/kxf1_markets.json` was captured live against Kalshi's public,
keyless `GET /trade-api/v2/markets` endpoint for the `KXF1` series. At capture
time the API returned all 22 real F1-2026-Drivers'-Championship markets
(tickers, titles, subtitles, `close_time`, `status`, `rules_primary`, etc. are
100% real, unmodified), but it is currently the F1 off-season calendar gap, so
every market's cent-denominated `yes_bid`/`yes_ask` fields came back **null**
(the order book is effectively empty — the API's `yes_bid_dollars`/
`yes_ask_dollars`/`liquidity_dollars` fields showed only nominal placeholder
ticks with near-zero liquidity).

To make the demo/system runnable with meaningful betting-edge signal, every
market's `yes_bid`/`yes_ask` (cents) was synthetically injected with a
plausible championship-odds price and tagged `"_demo_priced": true`:

| Driver | yes_bid | yes_ask |
|---|---|---|
| Max Verstappen | 30 | 33 |
| Lando Norris | 25 | 28 |
| Oscar Piastri | 22 | 25 |
| Charles Leclerc | 8 | 11 |
| George Russell | 6 | 9 |
| Lewis Hamilton | 5 | 8 |
| everyone else | 1 | 3 |

Every entry in the file also keeps `yes_bid_dollars_live` /
`yes_ask_dollars_live` / `liquidity_dollars_live` — the real (thin/near-zero)
values from the live API — for provenance and so a future refresh can tell at
a glance whether the real book has woken up. If a market's real `yes_bid`/
`yes_ask` are ever non-null on refresh, leave it untouched (no
`_demo_priced` flag, real prices used as-is) — see the refresh recipe below.

## Refresh recipe

Re-run these exact commands to refresh the raw captures (update the capture
timestamp in `manifest.json` and this file if you do):

```bash
# Jolpica (Ergast-compatible, free/keyless)
curl -sS "https://api.jolpi.ca/ergast/f1/2025/driverStandings.json" \
  -o fixtures/jolpica/driver_standings.json
curl -sS "https://api.jolpi.ca/ergast/f1/2025/last/results.json" \
  -o fixtures/jolpica/last_results.json
curl -sS "https://api.jolpi.ca/ergast/f1/2025/constructorStandings.json" \
  -o fixtures/jolpica/constructor_standings.json

# OpenF1 (free/keyless) — then trim to first 20 / first 10 rows respectively
curl -sS "https://api.openf1.org/v1/weather?session_key=9472" \
  -o fixtures/openf1/weather.json
curl -sS "https://api.openf1.org/v1/sessions?year=2024&session_name=Race" \
  -o fixtures/openf1/sessions.json

# Open-Meteo (free/keyless)
curl -sS "https://api.open-meteo.com/v1/forecast?latitude=52.07&longitude=-1.01&hourly=temperature_2m,precipitation_probability&forecast_days=3" \
  -o fixtures/openmeteo/silverstone_forecast.json

# Autosport RSS (free/keyless) — then parse into fixtures/news/autosport_f1.json
curl -sS -A "Mozilla/5.0 (compatible; FixtureBot/1.0)" \
  "https://www.autosport.com/rss/f1/news/" \
  -o fixtures/news/autosport_f1.raw.xml

# Kalshi (free/keyless public markets endpoint) — then re-apply demo pricing
# to any market whose yes_bid/yes_ask are still null
curl -sS "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXF1&limit=25" \
  -o /tmp/kxf1_markets_raw.json
```

After refreshing, re-run the validator:

```bash
node fixtures/validate.mjs
```

## Validation

`fixtures/validate.mjs` loads every JSON fixture in this directory, asserts it
parses, and checks each has its expected top-level shape (array vs. object,
required keys present). Run it any time you touch a fixture:

```bash
node fixtures/validate.mjs
```
