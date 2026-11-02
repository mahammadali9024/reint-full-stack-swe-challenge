"""HTTP API. Thin layer: validates input, delegates to service.py."""
from __future__ import annotations

import os
from datetime import date, time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import service

app = FastAPI(title="Wind Forecast Desk API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

CUTOFF_QUERY = Query(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="Decision cutoff on D-1, UK local time (HH:MM)")


def _parse_cutoff(value: str | None) -> time:
    return time.fromisoformat(value) if value else service.DEFAULT_CUTOFF


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    return service.meta()


@app.get("/api/decision/{delivery_day}")
def decision(delivery_day: date, cutoff: str | None = CUTOFF_QUERY) -> dict:
    if not service.FIRST_DELIVERY_DAY <= delivery_day <= service.LAST_DELIVERY_DAY:
        raise HTTPException(404, f"Delivery day must be between {service.FIRST_DELIVERY_DAY} and {service.LAST_DELIVERY_DAY}")
    view = service.decision_view(delivery_day, _parse_cutoff(cutoff))
    if view is None:
        raise HTTPException(404, "No forecast was published before this cutoff")
    return view


@app.get("/api/accuracy")
def accuracy(cutoff: str | None = CUTOFF_QUERY) -> dict:
    return service.accuracy_report(_parse_cutoff(cutoff))


# In the Docker image the built React app is served by the same process.
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")
