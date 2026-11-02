"""Download the Elexon BMRS wind data used by the app and save it as CSV snapshots.

The analysis window is fixed (purchase decisions made in January 2026), so the
data is historical and immutable. We snapshot it into backend/data/ so the app
starts instantly and does not depend on Elexon being reachable at runtime.

Usage:  python backend/scripts/fetch_data.py
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# Decisions are made 1 Jan .. 31 Jan 2026, for delivery days 2 Jan .. 1 Feb.
# We also pull ~2 weeks of December so the rolling error band has history
# from the very first decision day.
WARMUP_START = date(2025, 12, 15)
LAST_DELIVERY_DAY = date(2026, 2, 1)


def _get(client: httpx.Client, path: str, params: dict) -> list[dict]:
    resp = client.get(f"{BASE_URL}/{path}", params=params, timeout=120)
    resp.raise_for_status()
    return resp.json()


def fetch_actuals(client: httpx.Client) -> pd.DataFrame:
    rows: list[dict] = []
    day = WARMUP_START
    while day <= LAST_DELIVERY_DAY:
        chunk_end = min(day + timedelta(days=13), LAST_DELIVERY_DAY)
        rows += _get(client, "FUELHH/stream", {
            "settlementDateFrom": day.isoformat(),
            "settlementDateTo": chunk_end.isoformat(),
            "fuelType": "WIND",
        })
        day = chunk_end + timedelta(days=1)
    df = pd.DataFrame(rows)[["startTime", "generation"]]
    return df.drop_duplicates("startTime").sort_values("startTime")


def fetch_forecasts(client: httpx.Client) -> pd.DataFrame:
    rows: list[dict] = []
    start = datetime.combine(WARMUP_START - timedelta(days=3), datetime.min.time(), timezone.utc)
    end = datetime.combine(LAST_DELIVERY_DAY, datetime.min.time(), timezone.utc)
    while start < end:
        chunk_end = min(start + timedelta(days=7), end)
        rows += _get(client, "WINDFOR/stream", {
            "publishDateTimeFrom": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "publishDateTimeTo": chunk_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
        start = chunk_end
    df = pd.DataFrame(rows)[["publishTime", "startTime", "generation"]]
    return df.drop_duplicates(["publishTime", "startTime"]).sort_values(["publishTime", "startTime"])


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client() as client:
        actuals = fetch_actuals(client)
        forecasts = fetch_forecasts(client)
    actuals.to_csv(DATA_DIR / "actuals.csv", index=False)
    forecasts.to_csv(DATA_DIR / "forecasts.csv", index=False)
    print(f"actuals: {len(actuals)} rows, forecasts: {len(forecasts)} rows -> {DATA_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
