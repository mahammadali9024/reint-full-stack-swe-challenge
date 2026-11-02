"""Loads the Elexon snapshot shipped in backend/data (see scripts/fetch_data.py)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import pandas as pd

from .analysis import Dataset

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[1] / "data"))


@lru_cache(maxsize=1)
def load_dataset() -> Dataset:
    return Dataset.from_frames(
        pd.read_csv(DATA_DIR / "actuals.csv"),
        pd.read_csv(DATA_DIR / "forecasts.csv"),
    )
