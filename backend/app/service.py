"""Builds the API responses from the dataset. Cached per cutoff: the data is immutable."""
from __future__ import annotations

from datetime import date, time, timedelta
from functools import lru_cache

import pandas as pd

from . import analysis as an
from .data import load_dataset

# Purchase decisions made during January 2026 => delivery days 2 Jan .. 1 Feb.
FIRST_DELIVERY_DAY = date(2026, 1, 2)
LAST_DELIVERY_DAY = date(2026, 2, 1)
DEFAULT_CUTOFF = time(9, 20)  # EPEX GB day-ahead 60-min auction gate closure (UK time)
CUTOFF_PRESETS = [
    {"time": "09:20", "label": "EPEX day-ahead auction (09:20)"},
    {"time": "09:50", "label": "N2EX day-ahead auction (09:50)"},
    {"time": "15:30", "label": "Half-hourly auction (15:30)"},
]
PREVIOUS_RUNS_SHOWN = 3


def delivery_days() -> list[date]:
    n = (LAST_DELIVERY_DAY - FIRST_DELIVERY_DAY).days + 1
    return [FIRST_DELIVERY_DAY + timedelta(days=i) for i in range(n)]


def _iso(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(x) -> float | None:
    return None if pd.isna(x) else round(float(x), 1)


@lru_cache(maxsize=32)
def _all_errors(cutoff: time) -> pd.DataFrame:
    """Day-ahead errors for every day we have data for, including the December warm-up."""
    ds = load_dataset()
    first = (ds.forecasts["publishTime"].min() + pd.Timedelta(days=1)).date()
    days = [first + timedelta(days=i) for i in range((LAST_DELIVERY_DAY - first).days + 1)]
    return an.day_ahead_errors(ds, days, cutoff)


def _band_for(day: date, cutoff: time) -> tuple[tuple[float, float] | None, int]:
    errs = _all_errors(cutoff)
    history = errs[errs["delivery_day"].isin(an.band_history_days(day))]
    return an.error_quantiles(history["error"]), int(history["delivery_day"].nunique())


def meta() -> dict:
    return {
        "first_delivery_day": FIRST_DELIVERY_DAY.isoformat(),
        "last_delivery_day": LAST_DELIVERY_DAY.isoformat(),
        "default_cutoff": DEFAULT_CUTOFF.strftime("%H:%M"),
        "cutoff_presets": CUTOFF_PRESETS,
        "band_quantiles": list(an.BAND_QUANTILES),
        "band_lookback_days": an.BAND_LOOKBACK_DAYS,
        "timezone": "Europe/London",
    }


def decision_view(day: date, cutoff: time) -> dict | None:
    ds = load_dataset()
    publish_time = an.latest_publish_time(ds, day, cutoff)
    if publish_time is None:
        return None
    run = an.forecast_run(ds, publish_time, day)
    band, band_days = _band_for(day, cutoff)
    lo, hi = band if band else (None, None)

    points = [
        {
            "time": _iso(r.startTime),
            "forecast": _num(r.forecast),
            "p10": _num(max(r.forecast + lo, 0)) if band else None,
            "p90": _num(r.forecast + hi) if band else None,
            "actual": _num(r.actual),
        }
        for r in run.itertuples()
    ]

    start, end = an.delivery_window(day)
    actuals = ds.actuals[(ds.actuals.index >= start) & (ds.actuals.index < end)]

    earlier = sorted(p for p in ds.forecasts["publishTime"].unique() if p < publish_time)[-PREVIOUS_RUNS_SHOWN:]
    previous_runs = [
        {
            "publish_time": _iso(pt),
            "points": [{"time": _iso(r.startTime), "forecast": _num(r.forecast)} for r in an.forecast_run(ds, pt, day).itertuples()],
        }
        for pt in reversed(earlier)
    ]

    hourly = run["forecast"]
    day_errors = run.dropna(subset=["actual"]).assign(error=lambda d: d["actual"] - d["forecast"])
    cutoff_ts = an.decision_cutoff(day, cutoff)
    return {
        "delivery_day": day.isoformat(),
        "cutoff_utc": _iso(cutoff_ts),
        "publish_time": _iso(publish_time),
        "forecast_age_minutes": int((cutoff_ts - publish_time).total_seconds() // 60),
        "lead_time_hours": round((start - publish_time).total_seconds() / 3600, 1),
        "band": {
            "available": band is not None,
            "low_offset_mw": _num(lo) if band else None,
            "high_offset_mw": _num(hi) if band else None,
            "history_days": band_days,
        },
        "summary": {
            "forecast_energy_mwh": _num(hourly.sum()),  # hourly points x 1h
            "p10_energy_mwh": _num((hourly + lo).clip(lower=0).sum()) if band else None,
            "p90_energy_mwh": _num((hourly + hi).sum()) if band else None,
            "forecast_min_mw": _num(hourly.min()),
            "forecast_max_mw": _num(hourly.max()),
            "forecast_mean_mw": _num(hourly.mean()),
            # half-hourly MW x 0.5h; only when the whole day has been settled
            "actual_energy_mwh": _num(actuals.sum() * 0.5) if len(actuals) == (end - start) / pd.Timedelta(minutes=30) else None,
            "day_mae_mw": _num(day_errors["error"].abs().mean()) if not day_errors.empty else None,
            "day_bias_mw": _num(day_errors["error"].mean()) if not day_errors.empty else None,
        },
        "points": points,
        "actuals": [{"time": _iso(t), "actual": _num(v)} for t, v in actuals.items()],
        "previous_runs": previous_runs,
    }


@lru_cache(maxsize=32)
def accuracy_report(cutoff: time) -> dict:
    ds = load_dataset()
    days = delivery_days()
    all_errs = _all_errors(cutoff)
    errs = all_errs[all_errs["delivery_day"].isin(days)].copy()

    # Did the rolling P10-P90 band (built only from information available at
    # decision time) actually contain ~80% of outcomes? => is it trustworthy?
    inside, covered = 0, 0
    for day, grp in errs.groupby("delivery_day"):
        band, _ = _band_for(day, cutoff)
        if band is None:
            continue
        inside += int(grp["error"].between(band[0], band[1]).sum())
        covered += len(grp)

    errs["local_hour"] = errs["startTime"].dt.tz_convert(an.UK).dt.hour
    by_hour = errs.groupby("local_hour")["error"].agg(mae=lambda e: e.abs().mean(), bias="mean").reset_index()
    daily = (
        errs.groupby("delivery_day")
        .agg(
            mae=("error", lambda e: e.abs().mean()),
            bias=("error", "mean"),
            mean_actual=("actual", "mean"),
            mean_forecast=("forecast", "mean"),
            publish_time=("publishTime", "first"),
        )
        .reset_index()
    )

    cutoff_comparison = []
    for preset in CUTOFF_PRESETS:
        c = time.fromisoformat(preset["time"])
        e = _all_errors(c)
        cutoff_comparison.append({**preset, **an.metrics(e[e["delivery_day"].isin(days)])})

    return {
        "cutoff": cutoff.strftime("%H:%M"),
        "first_delivery_day": days[0].isoformat(),
        "last_delivery_day": days[-1].isoformat(),
        "overall": an.metrics(errs),
        "band_coverage_pct": round(100 * inside / covered, 1) if covered else None,
        "band_target_pct": round(100 * (an.BAND_QUANTILES[1] - an.BAND_QUANTILES[0])),
        "daily": [
            {
                "day": r.delivery_day.isoformat(),
                "mae": _num(r.mae),
                "bias": _num(r.bias),
                "mean_actual": _num(r.mean_actual),
                "mean_forecast": _num(r.mean_forecast),
                "publish_time": _iso(r.publish_time),
            }
            for r in daily.itertuples()
        ],
        "by_hour": [{"hour": int(r.local_hour), "mae": _num(r.mae), "bias": _num(r.bias)} for r in by_hour.itertuples()],
        "histogram": an.error_histogram(errs["error"]),
        "horizon": an.horizon_accuracy(ds, days),
        "cutoff_comparison": cutoff_comparison,
    }
