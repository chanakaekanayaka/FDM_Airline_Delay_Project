"""
System tests for the Flight Delay Risk web system (Stages 9 and 10).

Run from the project folder:   python -m unittest discover -s tests -v
"""

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR / "webapp"))

from app import create_app  # noqa: E402
from predictor import DelayRiskPredictor  # noqa: E402

# Loading the model takes a few seconds, so it is loaded once for all tests
PREDICTOR = DelayRiskPredictor()
VALID = {"carrier": "DL", "airport": "ATL", "month": 7, "year": 2023, "arr_flights": 2500}


class TestApi(unittest.TestCase):
    """Backend: valid requests, invalid requests and error handling."""

    @classmethod
    def setUpClass(cls):
        cls.client = create_app(PREDICTOR).test_client()

    def post(self, **changes):
        body = {**VALID, **changes}
        body = {k: v for k, v in body.items() if v is not ...}   # `...` = leave the field out
        return self.client.post("/api/predict", json=body)

    # ---------- valid input

    def test_home_page_loads(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        page = res.get_data(as_text=True)
        self.assertIn("Flight Delay Risk Checker", page)
        self.assertIn('value="DL"', page)
        self.assertIn('value="ATL"', page)

    def test_health(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["features"], 29)

    def test_valid_prediction(self):
        res = self.post()
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn(data["prediction"]["label"], ["Low Risk", "Moderate Risk", "High Risk"])
        probs = [p["probability"] for p in data["probabilities"]]
        self.assertAlmostEqual(sum(probs), 1.0, places=3)
        self.assertEqual(data["prediction"]["confidence"], max(probs))
        self.assertTrue(data["prediction"]["recommended_action"])
        self.assertEqual(data["input"]["season"], "Summer")
        self.assertEqual(data["warnings"], [])

    def test_input_is_cleaned(self):
        # lower case, spaces and numbers sent as text are accepted
        res = self.post(carrier=" dl ", airport="atl ", month="7", year="2023", arr_flights="2500")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["prediction"], self.post().get_json()["prediction"])

    def test_every_month_and_carrier(self):
        for month in range(1, 13):
            self.assertEqual(self.post(month=month).status_code, 200, month)
        for carrier in PREDICTOR.carriers:
            self.assertEqual(self.post(carrier=carrier).status_code, 200, carrier)

    def test_flights_above_cap_are_capped(self):
        # above the training 99th percentile the value is capped, as in Stage 4
        a = self.post(arr_flights=6000).get_json()["probabilities"]
        b = self.post(arr_flights=40000).get_json()["probabilities"]
        self.assertEqual(a, b)

    # ---------- inputs that give a warning

    def test_future_year_warns(self):
        res = self.post(year=2026)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(any("2013-2023" in w for w in res.get_json()["warnings"]))

    def test_unknown_airport_warns(self):
        res = self.post(airport="QQQ")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(any("not in the historical data" in w for w in res.get_json()["warnings"]))

    def test_route_without_history_warns(self):
        airport = next(a for a, _ in PREDICTOR.airport_options() if PREDICTOR.get_typical_flights("HA", a) is None)
        res = self.post(carrier="HA", airport=airport)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(any("no recorded arrivals" in w for w in res.get_json()["warnings"]))

    # ---------- invalid or missing input

    def assert_field_error(self, res, field):
        self.assertEqual(res.status_code, 400)
        self.assertIn(field, res.get_json()["errors"])

    def test_missing_fields(self):
        res = self.client.post("/api/predict", json={})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.get_json()["errors"]), {"carrier", "airport", "month", "year", "arr_flights"})
        self.assert_field_error(self.post(month=...), "month")
        self.assert_field_error(self.post(airport="  "), "airport")

    def test_invalid_month(self):
        for month in [0, 13, -1, 2.5, "July", True]:
            self.assert_field_error(self.post(month=month), "month")

    def test_invalid_year(self):
        for year in [2012, 2034, "abc", 2020.5]:
            self.assert_field_error(self.post(year=year), "year")

    def test_invalid_flights(self):
        for flights in [0, -5, 1.5, "many", 50001]:
            self.assert_field_error(self.post(arr_flights=flights), "arr_flights")

    def test_invalid_carrier(self):
        self.assert_field_error(self.post(carrier="ZZ"), "carrier")

    def test_invalid_airport_format(self):
        for airport in ["AT", "ATLA", "12A", "A-L"]:
            self.assert_field_error(self.post(airport=airport), "airport")

    def test_not_json(self):
        res = self.client.post("/api/predict", data="carrier=DL", content_type="text/plain")
        self.assertEqual(res.status_code, 400)
        res = self.client.post("/api/predict", json=["DL", "ATL"])
        self.assertEqual(res.status_code, 400)

    def test_unknown_api_route_returns_json(self):
        res = self.client.get("/api/does-not-exist")
        self.assertEqual(res.status_code, 404)
        self.assertIn("message", res.get_json())

    # ---------- helper endpoint

    def test_typical_flights(self):
        data = self.client.get("/api/typical-flights?carrier=dl&airport=atl").get_json()
        self.assertGreater(data["typical_flights"], 0)
        data = self.client.get("/api/typical-flights?carrier=DL&airport=QQQ").get_json()
        self.assertIsNone(data["typical_flights"])


class TestSamePreprocessingAsStage4(unittest.TestCase):
    """
    The backend must apply exactly the same preprocessing as Stage 4.
    The raw test-set rows are passed through the backend and compared with data/test_processed.csv.
    """

    @classmethod
    def setUpClass(cls):
        # Repeat the Stage 4 cleaning and split to get the raw rows of the test set
        df = pd.read_csv(PROJECT_DIR / "data" / "Airline_Delay_Cause.csv").dropna()
        df = df[df["arr_flights"] > 0]
        rate = df["arr_del15"] / df["arr_flights"]
        y = np.where(rate < 0.15, "Low Risk", np.where(rate <= 0.25, "Moderate Risk", "High Risk"))
        _, raw_test = train_test_split(df, test_size=0.2, random_state=42, stratify=y)

        cls.raw_test = raw_test[["carrier", "airport", "month", "year", "arr_flights"]].reset_index(drop=True)
        cls.processed = pd.read_csv(PROJECT_DIR / "data" / "test_processed.csv")

    def test_features_match_stage4(self):
        X_backend = PREDICTOR.transform(self.raw_test)
        X_stage4 = self.processed.drop(columns=["delay_risk_category"])
        self.assertEqual(list(X_backend.columns), list(X_stage4.columns))
        np.testing.assert_allclose(X_backend.to_numpy(float), X_stage4.to_numpy(float), rtol=0, atol=1e-9)

    def test_test_set_scores_match_final_notebook(self):
        X = PREDICTOR.transform(self.raw_test)
        y_true = self.processed["delay_risk_category"]
        y_pred = PREDICTOR.model.predict(X)
        # Final_Model_Comparison.ipynb: Test Accuracy 0.6286, Test Macro F1 0.6153
        self.assertAlmostEqual(accuracy_score(y_true, y_pred), 0.6286, places=4)
        self.assertAlmostEqual(f1_score(y_true, y_pred, average="macro"), 0.6153, places=4)


if __name__ == "__main__":
    unittest.main()
