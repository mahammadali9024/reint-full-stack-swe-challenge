# Wind Forecast Desk

A web app for a UK energy utility's day-ahead power purchasing team. It shows:

1. **The latest wind forecast available at the moment you place your day-ahead order**, with an
   80% error range (P10–P90) built only from information you had at that moment.
2. **How accurate those forecasts were**, measured across every January 2026 decision, so the error
   can be quantified and factored into how much power to buy.

Data: Elexon BMRS national **wind** generation only:
[FUELHH](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) (actuals, half-hourly)
and [WINDFOR](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream) (forecasts, hourly, about 8 runs a day).

**Live app:** https://reint-full-stack-swe-challenge.vercel.app

---

## Key findings (January 2026, 09:20 cutoff)

| Metric | Value |
|---|---|
| Mean absolute error | 2.02 GW (17.9% of mean output) |
| Bias (actual − forecast) | **−1.75 GW**: the forecast was too high on 27 of 31 days |
| P90 absolute error | 4.15 GW |
| 80% range coverage | 81.6% of outcomes (target 80%), so the range is well calibrated |
| Deciding at 15:30 instead of 09:20 | MAE falls to 1.86 GW (about 8% better) |

What this means for the desk: buying against the raw forecast systematically leaves the team short of
wind, so the cautious (P10) case is the safer basis for planning.

---

## Domain assumptions

| Topic | Decision |
|---|---|
| **Which decisions are in scope** | Purchases made 1–31 Jan 2026, so delivery days **2 Jan – 1 Feb 2026**. |
| **Decision time** | Day before delivery (D-1). The default is **09:20 UK time**, gate closure of the EPEX GB day-ahead 60-min auction. Presets: N2EX 09:50, half-hourly auction 15:30. Any custom time can be picked. |
| **"Latest forecast"** | The newest WINDFOR run whose `publishTime` ≤ cutoff and that covers the whole delivery day. |
| **Delivery day** | UK local calendar day (Europe/London). In January this is the same as UTC. DST is handled. |
| **Alignment** | Hourly forecast points are matched to the actual for the same `startTime`. |
| **Error** | `actual − forecast`. Negative means less wind than forecast, so the team would be short. |
| **Uncertainty range** | For delivery day D: the 10th/90th percentile of hourly day-ahead errors over the 14 previous delivery days that were fully settled at decision time (D-15 … D-2). This avoids look-ahead bias. December 2025 data is loaded as warm-up so the first January days also have a range. |
| **Forecast rows in the past** | WINDFOR runs also include hours before their publish time. Those rows are dropped (horizon < 0). |

## Architecture

```
            ┌────────────── React (Vite, Recharts) ──────────────┐
            │  Day-ahead forecast view │ Forecast accuracy view  │
            └───────────────┬────────────────────────────────────┘
                            │ GET /api/meta · /api/decision/{day}?cutoff · /api/accuracy?cutoff
            ┌───────────────▼────────────────────────────────────┐
            │ FastAPI  main.py    (validation, HTTP)             │
            │          service.py (response shaping, caching)    │
            │          analysis.py(pure pandas functions)        │
            │          data.py    (loads CSV snapshot once)      │
            └───────────────┬────────────────────────────────────┘
                            │
             backend/data/*.csv  ◄── scripts/fetch_data.py ◄── Elexon BMRS API
```

* **Snapshot rather than live calls.** The analysis window is historical and fixed, so the data is downloaded once
  (`fetch_data.py`) and committed (1.5 MB). The app starts instantly, its results are reproducible, and it does not
  depend on Elexon being up. To refresh, re-run the script.
* **Pure analysis core.** `analysis.py` has no I/O and no HTTP. It is unit tested with synthetic data.
  `service.py` combines it into responses and memoises per cutoff, since the data never changes.
* **One deployable.** In Docker, FastAPI also serves the built React app. On Vercel, the React app is
  static and `api/index.py` runs the same FastAPI app as a serverless function.

## Repository layout

```
.
├── api/index.py              Vercel serverless entry (wraps backend FastAPI app)
├── backend/
│   ├── app/
│   │   ├── analysis.py       Core domain logic: delivery windows, cutoffs, latest run, errors, metrics, bands
│   │   ├── service.py        Builds API responses (decision view, accuracy report); scope constants
│   │   ├── data.py           Loads the CSV snapshot
│   │   └── main.py           FastAPI routes; serves the built frontend when present
│   ├── data/                 actuals.csv (FUELHH WIND) and forecasts.csv (WINDFOR), 15 Dec 2025 – 1 Feb 2026
│   ├── scripts/fetch_data.py Downloads/refreshes the snapshot from Elexon
│   ├── tests/                pytest: unit tests (analysis) + API tests on the real snapshot
│   └── requirements*.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx           Layout, tabs, decision-cutoff picker
│   │   ├── components/       DecisionView, AccuracyView, CutoffPicker, shared UI
│   │   ├── api.js            API client
│   │   └── format.js         Unit/time formatting (UK local time, GW/GWh)
│   └── vite.config.js        Dev proxy /api → :8000, Vitest config
├── Dockerfile                Multi-stage: build React, then Python image serving API + UI
├── docker-compose.yml
├── vercel.json               Vercel build + routing
└── requirements.txt          Python deps for the Vercel function
```

## Running it

### Docker (recommended)

```bash
docker compose up --build
# open http://localhost:8000
```

### Local development

```bash
# backend (Python 3.10+)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# frontend (Node 18+), in another terminal
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to :8000
```

### Tests

```bash
cd backend && pytest          # 18 tests
cd frontend && npm test       # 9 tests
```

### Refresh the data

```bash
cd backend && python scripts/fetch_data.py
```

### Deploy to Vercel

```bash
npm i -g vercel
vercel --prod     # vercel.json configures the build and /api routing
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/meta` | Scope, default cutoff, cutoff presets |
| `GET /api/decision/{YYYY-MM-DD}?cutoff=HH:MM` | Forecast run used for that delivery day, P10/P90 range, half-hourly actuals, 3 earlier runs, energy summary |
| `GET /api/accuracy?cutoff=HH:MM` | Overall metrics, range coverage, daily/hourly/lead-time breakdowns, error histogram, cutoff comparison |
| `GET /docs` | Interactive OpenAPI docs |

## Possible next steps

* Add a national demand forecast so the app can show the residual volume to buy, not only wind.
* Make the range depend on the forecast level and season (errors grow at high wind) and use a longer history.
* Bias-correct the forecast and back-test whether the correction holds up out of sample.
* Fetch live data on a schedule when the app moves beyond the pilot window.

## Use of AI tools

This project was built with the help of an AI coding assistant (Claude Code by Anthropic). It was used for
scaffolding, writing code and tests, and drafting this README. All design decisions, domain assumptions and results
were reviewed and checked against the Elexon data.
