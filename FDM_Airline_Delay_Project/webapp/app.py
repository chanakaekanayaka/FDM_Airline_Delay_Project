"""
Stage 9 - Flask backend of the Flight Delay Risk system.

Run from the project folder:   python webapp/app.py
Then open:                     http://127.0.0.1:5000

Routes
  GET  /                      the web page (Stage 10 frontend)
  POST /api/predict           JSON input -> delay risk prediction
  GET  /api/typical-flights   typical monthly arrivals for an airline at an airport
  GET  /api/health            check that the model is loaded
"""

import logging

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from predictor import MAX_ARR_FLIGHTS, MONTH_NAMES, DelayRiskPredictor, ValidationError


def create_app(predictor=None):
    app = Flask(__name__)
    app.json.sort_keys = False

    # The model is loaded once when the server starts, not on every request
    predictor = predictor or DelayRiskPredictor()
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
        app.logger.info("Prediction: %s", result["summary"])
        return jsonify(result)

    @app.get("/api/typical-flights")
    def typical_flights():
        carrier = request.args.get("carrier", "")
        airport = request.args.get("airport", "")
        return jsonify(carrier=carrier.strip().upper(), airport=airport.strip().upper(),
                       typical_flights=predictor.get_typical_flights(carrier, airport))

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", model=type(predictor.model).__name__, features=len(predictor.features))

    # Errors on the API always come back as JSON, so the frontend can show a clear message
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
    create_app().run(host="127.0.0.1", port=5000, debug=False)
