"""API tests against the real January 2026 snapshot in backend/data."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_meta():
    body = client.get("/api/meta").json()
    assert body["first_delivery_day"] == "2026-01-02"
    assert body["last_delivery_day"] == "2026-02-01"
    assert body["default_cutoff"] == "09:20"


def test_decision_uses_latest_forecast_before_cutoff():
    body = client.get("/api/decision/2026-01-15", params={"cutoff": "09:20"}).json()
    assert body["publish_time"] == "2026-01-14T07:30:00Z"
    assert len(body["points"]) == 24
    assert len(body["actuals"]) == 48
    assert body["band"]["available"]
    p = body["points"][0]
    assert p["p10"] <= p["forecast"] <= p["p90"]


def test_decision_later_cutoff_gets_newer_forecast():
    body = client.get("/api/decision/2026-01-15", params={"cutoff": "15:00"}).json()
    assert body["publish_time"] == "2026-01-14T11:30:00Z"


def test_decision_rejects_days_outside_scope():
    assert client.get("/api/decision/2026-03-01").status_code == 404


def test_decision_rejects_bad_cutoff():
    assert client.get("/api/decision/2026-01-15", params={"cutoff": "9am"}).status_code == 422


def test_accuracy_report_shape():
    body = client.get("/api/accuracy").json()
    assert body["overall"]["count"] == 31 * 24
    assert len(body["daily"]) == 31
    assert len(body["by_hour"]) == 24
    assert 60 < body["band_coverage_pct"] < 100
    assert [c["time"] for c in body["cutoff_comparison"]] == ["09:20", "09:50", "15:30"]
