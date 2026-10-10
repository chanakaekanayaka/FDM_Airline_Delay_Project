import csv
import gc
import io
import os
import tempfile
import unittest
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
import sys

sys.path.insert(0, str(PROJECT_DIR / "webapp"))

from app import create_app
from predictor import DelayRiskPredictor

PREDICTOR = DelayRiskPredictor()
VALID_PAYLOAD = {"carrier": "DL", "airport": "ATL", "month": 7, "year": 2023, "arr_flights": 2500}


class TestHistoryFeatures(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tempdir.name, "history.db")
        self.client = create_app(PREDICTOR, history_db_path=self.db_path).test_client()

    def tearDown(self):
        gc.collect()
        try:
            self.client.application.config["HISTORY_DB_PATH"]
            if os.path.exists(self.db_path):
                try:
                    with open(self.db_path, "rb"):
                        pass
                except OSError:
                    pass
        finally:
            self.tempdir.cleanup()

    def test_prediction_history_persistence_and_analytics(self):
        response = self.client.post("/api/predict", json=VALID_PAYLOAD)
        self.assertEqual(response.status_code, 200)

        history = self.client.get("/api/history").get_json()
        self.assertEqual(history["total"], 1)
        self.assertEqual(history["records"][0]["carrier"], "DL")
        self.assertEqual(history["records"][0]["airport"], "ATL")
        self.assertIn(history["records"][0]["prediction_label"], ["Low Risk", "Moderate Risk", "High Risk"])

        analytics = self.client.get("/api/history/analytics").get_json()
        label = history["records"][0]["prediction_label"]
        self.assertEqual(analytics["total_predictions"], 1)
        self.assertEqual(analytics["counts"][label], 1)
        self.assertEqual(analytics["distribution"][label], 100.0)
        self.assertEqual(analytics["empty"], False)

    def test_failed_predictions_are_not_recorded(self):
        response = self.client.post("/api/predict", json={"carrier": "ZZ", "airport": "ATL", "month": 7, "year": 2023, "arr_flights": 2500})
        self.assertEqual(response.status_code, 400)

        history = self.client.get("/api/history").get_json()
        self.assertEqual(history["total"], 0)
        self.assertEqual(len(history["records"]), 0)

    def test_csv_export(self):
        response = self.client.post("/api/predict", json=VALID_PAYLOAD)
        self.assertEqual(response.status_code, 200)

        export = self.client.get("/api/history/export")
        self.assertEqual(export.status_code, 200)
        self.assertIn("text/csv", export.content_type)
        self.assertIn("airline_prediction_history.csv", export.headers.get("Content-Disposition", ""))
        rows = list(csv.reader(io.StringIO(export.get_data(as_text=True))))
        self.assertGreater(len(rows), 1)
        self.assertIn("carrier", rows[0])
        self.assertIn("DL", rows[1])

    def test_empty_history_analytics_and_export(self):
        analytics = self.client.get("/api/history/analytics").get_json()
        self.assertEqual(analytics["total_predictions"], 0)
        self.assertEqual(analytics["empty"], True)
        self.assertEqual(analytics["counts"]["Low Risk"], 0)

        response = self.client.get("/api/history/export")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response.content_type)
        csv_text = response.get_data(as_text=True)
        self.assertIn("carrier", csv_text)


if __name__ == "__main__":
    unittest.main()
