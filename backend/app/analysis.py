"""Pure functions that turn raw actuals/forecasts into decision-ready numbers.

Conventions
-----------
* All timestamps are tz-aware UTC internally; "days" are UK local calendar days
  (Europe/London), because that is how the trading desk thinks about delivery.
* error = actual - forecast (MW). Positive error => wind came in higher than
  forecast (we over-bought); negative => shortfall we have to cover.
* A "day-ahead forecast" for delivery day D is the latest WINDFOR run published
  at or before the decision cutoff on D-1.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

UK = ZoneInfo("Europe/London")
BAND_QUANTILES = (0.1, 0.9)
BAND_LOOKBACK_DAYS = 14


@dataclass(frozen=True)
class Dataset:
    actuals: pd.Series  # MW, indexed by half-hour startTime (UTC)
    forecasts: pd.DataFrame  # publishTime, startTime, generation, horizon_h

    @classmethod
    def from_frames(cls, actuals: pd.DataFrame, forecasts: pd.DataFrame) -> "Dataset":
        a = actuals.assign(startTime=pd.to_datetime(actuals["startTime"], utc=True))
        f = forecasts.assign(
            publishTime=pd.to_datetime(forecasts["publishTime"], utc=True),
            startTime=pd.to_datetime(forecasts["startTime"], utc=True),
        )
        f["horizon_h"] = (f["startTime"] - f["publishTime"]).dt.total_seconds() / 3600
        # Rows describing the past at publish time are not forecasts.
        f = f[f["horizon_h"] >= 0].sort_values(["publishTime", "startTime"]).reset_index(drop=True)
        return cls(actuals=a.set_index("startTime")["generation"].sort_index(), forecasts=f)


def delivery_window(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC [start, end) of a UK local delivery day."""
    start = datetime.combine(day, time(0), UK)
    end = datetime.combine(day + timedelta(days=1), time(0), UK)
    return pd.Timestamp(start).tz_convert("UTC"), pd.Timestamp(end).tz_convert("UTC")


def decision_cutoff(day: date, cutoff: time) -> pd.Timestamp:
    """Moment on D-1 (UK local) by which the purchase for delivery day D is made."""
    return pd.Timestamp(datetime.combine(day - timedelta(days=1), cutoff, UK)).tz_convert("UTC")


def latest_publish_time(ds: Dataset, day: date, cutoff: time) -> pd.Timestamp | None:
    """Most recent forecast run available at the cutoff that covers the whole delivery day."""
    start, end = delivery_window(day)
    f = ds.forecasts
    candidates = f[(f["publishTime"] <= decision_cutoff(day, cutoff)) & (f["startTime"] >= start) & (f["startTime"] < end)]
    if candidates.empty:
        return None
    counts = candidates.groupby("publishTime")["startTime"].nunique()
    full = counts[counts == counts.max()]
    return full.index.max()


def forecast_run(ds: Dataset, publish_time: pd.Timestamp, day: date) -> pd.DataFrame:
    start, end = delivery_window(day)
    f = ds.forecasts
    run = f[(f["publishTime"] == publish_time) & (f["startTime"] >= start) & (f["startTime"] < end)]
    out = run[["startTime", "generation", "horizon_h"]].rename(columns={"generation": "forecast"})
    out["actual"] = out["startTime"].map(ds.actuals)
    return out.reset_index(drop=True)


def day_ahead_errors(ds: Dataset, days: list[date], cutoff: time) -> pd.DataFrame:
    """One row per forecast hour of each delivery day, with the forecast used for the decision."""
    frames = []
    for day in days:
        pt = latest_publish_time(ds, day, cutoff)
        if pt is None:
            continue
        run = forecast_run(ds, pt, day).assign(delivery_day=day, publishTime=pt)
        frames.append(run)
    if not frames:
        return pd.DataFrame(columns=["startTime", "forecast", "horizon_h", "actual", "delivery_day", "publishTime", "error"])
    out = pd.concat(frames, ignore_index=True).dropna(subset=["actual"])
    out["error"] = out["actual"] - out["forecast"]
    return out


def error_quantiles(errors: pd.Series, quantiles: tuple[float, float] = BAND_QUANTILES) -> tuple[float, float] | None:
    if len(errors) < 24:  # less than a day of history is not a credible band
        return None
    lo, hi = np.quantile(errors.to_numpy(dtype=float), quantiles)
    return float(lo), float(hi)


def band_history_days(day: date, lookback: int = BAND_LOOKBACK_DAYS) -> list[date]:
    """Delivery days whose outcome is fully known at the D-1 decision time (D-2 and earlier)."""
    return [day - timedelta(days=k) for k in range(2, lookback + 2)]


def metrics(errors: pd.DataFrame) -> dict:
    """Headline accuracy metrics for a set of (forecast, actual, error) rows."""
    if errors.empty:
        return {"count": 0}
    e = errors["error"].to_numpy(dtype=float)
    a = errors["actual"].to_numpy(dtype=float)
    abs_e = np.abs(e)
    return {
        "count": int(len(e)),
        "mae": float(abs_e.mean()),
        "rmse": float(np.sqrt((e**2).mean())),
        "bias": float(e.mean()),
        "nmae_pct": float(100 * abs_e.mean() / a.mean()),
        "p50_abs_error": float(np.quantile(abs_e, 0.5)),
        "p90_abs_error": float(np.quantile(abs_e, 0.9)),
        "max_shortfall": float(-e.min()),
        "mean_actual": float(a.mean()),
    }


def horizon_accuracy(ds: Dataset, days: list[date], bucket_h: int = 4, max_h: int = 48) -> list[dict]:
    """MAE of *all* forecast runs for the given delivery days, bucketed by forecast horizon.

    Answers "how much better would the forecast be if we decided later?".
    """
    start, _ = delivery_window(min(days))
    _, end = delivery_window(max(days))
    f = ds.forecasts
    f = f[(f["startTime"] >= start) & (f["startTime"] < end) & (f["horizon_h"] < max_h)].copy()
    f["actual"] = f["startTime"].map(ds.actuals)
    f = f.dropna(subset=["actual"])
    f["abs_error"] = (f["actual"] - f["generation"]).abs()
    f["bucket"] = (f["horizon_h"] // bucket_h).astype(int) * bucket_h
    g = f.groupby("bucket")["abs_error"].agg(["mean", "count"]).reset_index()
    return [
        {"horizon_from_h": int(r.bucket), "horizon_to_h": int(r.bucket + bucket_h), "mae": float(r["mean"]), "count": int(r["count"])}
        for _, r in g.iterrows()
    ]


def error_histogram(errors: pd.Series, bin_mw: int = 500) -> list[dict]:
    if errors.empty:
        return []
    lo = int(np.floor(errors.min() / bin_mw) * bin_mw)
    hi = int(np.ceil(errors.max() / bin_mw) * bin_mw) + bin_mw
    counts, edges = np.histogram(errors, bins=np.arange(lo, hi + 1, bin_mw))
    return [{"from_mw": int(edges[i]), "to_mw": int(edges[i + 1]), "count": int(c)} for i, c in enumerate(counts)]
