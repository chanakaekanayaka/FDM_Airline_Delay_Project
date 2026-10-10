import csv
import gc
import io
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
import sys

sys.path.insert(0, str(PROJECT_DIR / "webapp"))

from app import create_app
from predictor import DelayRiskPredictor
from history_store import save_prediction_record

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
        self.assertEqual(len(analytics["trend"]), 1)
        self.assertRegex(analytics["trend"][0]["date"], r"^\d{4}-\d{2}-\d{2}$")

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

    def test_history_offset_pagination_preserves_filter_total(self):
        self.save_record("DL", "ATL", 7, 2023, 2500, "High Risk")
        self.save_record("AA", "ATL", 7, 2023, 2400, "Low Risk")
        self.save_record("UA", "ORD", 8, 2023, 2300, "Moderate Risk")

        first_page = self.client.get("/api/history?risk=all&limit=1&offset=0").get_json()
        second_page = self.client.get("/api/history?risk=all&limit=1&offset=1").get_json()

        self.assertEqual(first_page["total_filtered"], 3)
        self.assertEqual(second_page["total_filtered"], 3)
        self.assertEqual(first_page["total"], 1)
        self.assertEqual(second_page["total"], 1)
        self.assertNotEqual(first_page["records"][0]["id"], second_page["records"][0]["id"])

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

    def save_record(self, carrier, airport, month, year, arrivals, label, confidence=0.8):
        levels = {"Low Risk": "low", "Moderate Risk": "moderate", "High Risk": "high"}
        probabilities = [
            {"label": name, "level": levels[name], "probability": confidence if name == label else (1 - confidence) / 2}
            for name in levels
        ]
        return save_prediction_record(self.db_path, {
            "input": {"carrier": carrier, "airport": airport, "month": month, "year": year, "arr_flights": arrivals},
            "prediction": {"label": label, "level": levels[label], "confidence": confidence},
            "probabilities": probabilities,
            "summary": f"{carrier} at {airport}: {label}",
        })

    def test_business_overview_counts_risks_and_uses_latest_heatmap_record(self):
        self.save_record("DL", "ATL", 7, 2023, 300, "High Risk")
        self.save_record("DL", "ATL", 7, 2023, 250, "Low Risk")
        self.save_record("AA", "JFK", 7, 2023, 180, "Moderate Risk")

        response = self.client.get("/api/business/overview?carrier=DL&year=2023")

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["risk_counts"], {"Low Risk": 1, "Moderate Risk": 1, "High Risk": 1})
        self.assertEqual(data["risk_by_airline"][0]["carrier"], "DL")
        self.assertEqual(data["risk_by_airline"][0]["total"], 2)
        self.assertEqual(data["risk_by_airport"][0]["airport"], "ATL")
        self.assertEqual(data["risk_by_airport"][0]["total"], 2)
        self.assertEqual(data["years"], [2023])
        self.assertEqual(len(data["heatmap"]), 1)
        self.assertEqual(data["heatmap"][0]["airport"], "ATL")
        self.assertEqual(data["heatmap"][0]["arr_flights"], 250)
        self.assertEqual(data["heatmap"][0]["prediction_label"], "Low Risk")
        self.assertEqual(len(data["high_risk_cases"]), 1)
        self.assertEqual(data["high_risk_cases"][0]["arr_flights"], 300)

    def test_empty_business_overview_and_invalid_trend_date(self):
        empty = self.client.get("/api/business/overview").get_json()
        self.assertEqual(empty["total_predictions"], 0)
        self.assertEqual(empty["heatmap"], [])
        self.assertEqual(empty["high_risk_cases"], [])

        connection = sqlite3.connect(self.db_path)
        connection.execute(
            """INSERT INTO prediction_history (
                created_at, carrier, airport, month, year, arr_flights,
                prediction_label, prediction_level, probability_json, dedupe_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("not-a-date", "DL", "ATL", 7, 2023, 100, "Low Risk", "low", "{broken", "invalid-date-test"),
        )
        connection.commit()
        connection.close()

        analytics = self.client.get("/api/history/analytics").get_json()
        self.assertEqual(analytics["total_predictions"], 1)
        self.assertEqual(analytics["trend"], [])
        overview = self.client.get("/api/business/overview?carrier=DL&year=2023")
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.get_json()["risk_counts"]["Low Risk"], 1)

    def test_airline_comparison_runs_without_saving_and_matches_history_scope(self):
        self.save_record("DL", "ATL", 7, 2023, 2500, "High Risk")
        before = self.client.get("/api/history").get_json()["total"]

        response = self.client.post("/api/business/compare", json={
            "carrier_a": "DL",
            "carrier_b": "AA",
            "airport": "ATL",
            "month": 7,
            "year": 2023,
            "arr_flights": 2500,
        })

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual([item["source"] for item in data["comparisons"]], ["Current model prediction"] * 2)
        self.assertEqual(data["comparisons"][0]["historical_record_count"], 1)
        self.assertEqual(data["comparisons"][0]["historical_records"][0]["prediction_label"], "High Risk")
        self.assertEqual(len(data["comparisons"][0]["historical_records"][0]["probabilities"]), 3)
        self.assertEqual(data["comparisons"][1]["historical_record_count"], 0)
        self.assertEqual(self.client.get("/api/history").get_json()["total"], before)

    def test_airline_comparison_rejects_identical_selection(self):
        response = self.client.post("/api/business/compare", json={
            "carrier_a": "DL", "carrier_b": "DL", "airport": "ATL",
            "month": 7, "year": 2023, "arr_flights": 2500,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("carrier_b", response.get_json()["errors"])

    def test_business_overview_rejects_invalid_filters(self):
        invalid_carrier = self.client.get("/api/business/overview?carrier=ZZ")
        invalid_year = self.client.get("/api/business/overview?year=next-year")
        self.assertEqual(invalid_carrier.status_code, 400)
        self.assertIn("carrier", invalid_carrier.get_json()["errors"])
        self.assertEqual(invalid_year.status_code, 400)
        self.assertIn("year", invalid_year.get_json()["errors"])

    def test_performance_endpoint_only_returns_verified_metrics(self):
        response = self.client.get("/api/business/performance")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["test_accuracy"], 0.6286)
        self.assertEqual(data["test_macro_f1"], 0.6153)
        self.assertEqual(data["evaluation_records"], 34245)
        self.assertIsNone(data["per_class_metrics"])
        self.assertIsNone(data["confusion_matrix"])

    def test_business_page_keeps_existing_controls_and_adds_sections(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        page = response.get_data(as_text=True)
        for element_id in [
            "business-impact-title", "airport-heatmap", "comparison-form",
            "performance-metrics", "pdf-report-btn", "export-csv-btn",
            "history-risk-filter", "risk-form",
        ]:
            self.assertIn(f'id="{element_id}"', page)
        self.assertEqual(page.count('class="page-view"'), 8)
        for view in ["overview", "predict", "business", "heatmap", "comparison", "performance", "history", "reports"]:
            self.assertIn(f'data-view="{view}"', page)


if __name__ == "__main__":
    unittest.main()
