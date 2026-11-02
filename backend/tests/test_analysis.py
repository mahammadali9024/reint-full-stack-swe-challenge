from datetime import date, time

import pandas as pd
import pytest

from app import analysis as an


def make_dataset(forecast_rows, actual_mw=1000.0):
    actuals = pd.DataFrame({
        "startTime": pd.date_range("2026-01-08", "2026-01-12", freq="30min", tz="UTC", inclusive="left"),
    }).assign(generation=actual_mw)
    forecasts = pd.DataFrame(forecast_rows, columns=["publishTime", "startTime", "generation"])
    return an.Dataset.from_frames(actuals, forecasts)


def run(publish, value, day="2026-01-10"):
    hours = pd.date_range(day, periods=24, freq="h", tz="UTC")
    return [(publish, h.isoformat(), value) for h in hours]


def test_delivery_window_is_uk_local_day():
    start, end = an.delivery_window(date(2026, 1, 10))
    assert start == pd.Timestamp("2026-01-10T00:00Z")
    assert end == pd.Timestamp("2026-01-11T00:00Z")
    # Summer: UK local midnight is 23:00 UTC the previous day
    start, _ = an.delivery_window(date(2026, 7, 1))
    assert start == pd.Timestamp("2026-06-30T23:00Z")


def test_decision_cutoff_is_previous_day():
    assert an.decision_cutoff(date(2026, 1, 10), time(9, 20)) == pd.Timestamp("2026-01-09T09:20Z")


def test_latest_publish_time_picks_newest_run_before_cutoff():
    ds = make_dataset(
        run("2026-01-09T04:30Z", 900) + run("2026-01-09T07:30Z", 950) + run("2026-01-09T09:30Z", 990)
    )
    assert an.latest_publish_time(ds, date(2026, 1, 10), time(9, 20)) == pd.Timestamp("2026-01-09T07:30Z")
    assert an.latest_publish_time(ds, date(2026, 1, 10), time(9, 30)) == pd.Timestamp("2026-01-09T09:30Z")


def test_latest_publish_time_none_when_nothing_published():
    ds = make_dataset(run("2026-01-09T12:30Z", 900))
    assert an.latest_publish_time(ds, date(2026, 1, 10), time(9, 20)) is None


def test_latest_publish_time_ignores_runs_not_covering_whole_day():
    partial = run("2026-01-09T08:30Z", 900)[:10]
    ds = make_dataset(run("2026-01-09T07:30Z", 950) + partial)
    assert an.latest_publish_time(ds, date(2026, 1, 10), time(9, 20)) == pd.Timestamp("2026-01-09T07:30Z")


def test_rows_in_the_past_are_not_forecasts():
    ds = make_dataset([("2026-01-10T05:00Z", "2026-01-10T03:00Z", 1)])
    assert ds.forecasts.empty


def test_day_ahead_errors_actual_minus_forecast():
    ds = make_dataset(run("2026-01-09T07:30Z", 1200), actual_mw=1000)
    errs = an.day_ahead_errors(ds, [date(2026, 1, 10)], time(9, 20))
    assert len(errs) == 24
    assert (errs["error"] == -200).all()


def test_metrics():
    errs = pd.DataFrame({"actual": [100.0, 100.0, 100.0, 100.0], "error": [10.0, -10.0, 30.0, -30.0]})
    m = an.metrics(errs)
    assert m["mae"] == 20
    assert m["bias"] == 0
    assert m["rmse"] == pytest.approx((500) ** 0.5)
    assert m["nmae_pct"] == 20
    assert m["max_shortfall"] == 30


def test_metrics_empty():
    assert an.metrics(pd.DataFrame(columns=["actual", "error"])) == {"count": 0}


def test_error_quantiles_needs_a_day_of_history():
    assert an.error_quantiles(pd.Series(range(10))) is None
    lo, hi = an.error_quantiles(pd.Series(range(101)))
    assert (lo, hi) == (10, 90)


def test_band_history_excludes_days_not_known_at_decision_time():
    days = an.band_history_days(date(2026, 1, 20), lookback=3)
    assert days == [date(2026, 1, 18), date(2026, 1, 17), date(2026, 1, 16)]


def test_error_histogram_counts_all_errors():
    h = an.error_histogram(pd.Series([-600.0, -100.0, 0.0, 450.0]), bin_mw=500)
    assert sum(b["count"] for b in h) == 4
