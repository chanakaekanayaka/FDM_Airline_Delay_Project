"""
Stage 9 - Flask backend of the Flight Delay Risk system.

Run from the project folder:   python webapp/app.py
Then open:                     http://127.0.0.1:5000

Routes
  GET  /                      the web page (Stage 10 frontend)
  POST /api/predict           JSON input -> delay risk prediction
  GET  /api/typical-flights   typical monthly arrivals for an airline at an airport
  GET  /api/health            check that the model is loaded
  GET  /api/history           saved predictions
  GET  /api/history/analytics prediction analytics
  GET  /api/history/export    CSV export of saved predictions
"""

import logging
import os

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from history_store import (
    HistoryStorageError,
    export_history_csv,
    fetch_history,
    get_analytics,
    init_history_db,
    save_prediction_record,
)
from predictor import MAX_ARR_FLIGHTS, MONTH_NAMES, DelayRiskPredictor, ValidationError


def create_app(predictor=None, history_db_path=None):
    app = Flask(__name__)
    app.json.sort_keys = False

    predictor = predictor or DelayRiskPredictor()
    app.config["HISTORY_DB_PATH"] = init_history_db(history_db_path)
    app.logger.setLevel(logging.INFO)
    app.logger.info("Model and preprocessing loaded (%d features).", len(predictor.features))

    @app.get("/")
    def index():
        first_year, last_year = predictor.year_limits()
        return render_template(
            "index.html",
            carriers=predictor.carrier_options(),
            airports=predictor.airport_options(),
            months=list(enumerate(MONTH_NAMES, start=1)),
            first_year=first_year,
            last_year=last_year,
            data_years=f"{predictor.first_year}-{predictor.last_year}",
            n_years=predictor.last_year - predictor.first_year + 1,
            max_flights=MAX_ARR_FLIGHTS,
        )

    @app.post("/api/predict")
    def predict():
        data = request.get_json(silent=True)
        if data is None:
            return jsonify(message="Send the input as JSON (Content-Type: application/json).",
                           errors={"form": "Invalid request body."}), 400
        try:
            result = predictor.predict(data)
        except ValidationError as e:
            return jsonify(message="Please correct the highlighted fields.", errors=e.errors), 400

        try:
            saved_id = save_prediction_record(app.config["HISTORY_DB_PATH"], result)
            if saved_id is not None:
                result["history_saved"] = True
                result["history_id"] = saved_id
            else:
                result["history_saved"] = False
        except HistoryStorageError:
            app.logger.exception("Prediction succeeded but history could not be saved.")
            result["history_saved"] = False
            result["history_warning"] = "Prediction saved successfully, but the history database is unavailable."

        app.logger.info("Prediction: %s", result["summary"])
        return jsonify(result)

    @app.get("/api/history")
    def history():
        risk = request.args.get("risk", "").strip()
        search = request.args.get("search", "").strip()
        limit = request.args.get("limit", "25")
        try:
            limit_value = int(limit) if limit else 25
        except ValueError:
            limit_value = 25

        try:
            records = fetch_history(app.config["HISTORY_DB_PATH"], risk=risk, search=search, limit=limit_value)
        except HistoryStorageError:
            return jsonify(message="Unable to load prediction history right now.", errors={"history": "Database unavailable"}), 500
        return jsonify(total=len(records), records=records)

    @app.get("/api/history/analytics")
    def history_analytics():
        try:
            analytics = get_analytics(app.config["HISTORY_DB_PATH"])
        except HistoryStorageError:
            return jsonify(message="Unable to load analytics right now.", errors={"analytics": "Database unavailable"}), 500
        return jsonify(analytics)

    @app.get("/api/history/export")
    def export_history():
        risk = request.args.get("risk", "").strip()
        search = request.args.get("search", "").strip()
        try:
            csv_text = export_history_csv(app.config["HISTORY_DB_PATH"], risk=risk, search=search)
        except HistoryStorageError:
            return jsonify(message="Unable to export prediction history right now.", errors={"export": "Database unavailable"}), 500

        response = app.response_class(csv_text, mimetype="text/csv; charset=utf-8")
        response.headers["Content-Disposition"] = 'attachment; filename="airline_prediction_history.csv"'
        return response

    @app.get("/api/typical-flights")
    def typical_flights():
        carrier = request.args.get("carrier", "")
        airport = request.args.get("airport", "")
        return jsonify(carrier=carrier.strip().upper(), airport=airport.strip().upper(),
                       typical_flights=predictor.get_typical_flights(carrier, airport))

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", model=type(predictor.model).__name__, features=len(predictor.features))

    @app.errorhandler(HTTPException)
    def http_error(e):
        if request.path.startswith("/api/"):
            return jsonify(message=e.description, errors={"form": e.name}), e.code
        return e

    @app.errorhandler(Exception)
    def server_error(e):
        app.logger.exception("Unexpected error")
        return jsonify(message="Something went wrong on the server. Please try again.",
                       errors={"form": "Server error"}), 500

    return app


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    create_app().run(host=host, port=port, debug=False)
