"""
Stage 9 - Prediction logic of the backend.

Loads the final model (Final_Model_Comparison.ipynb) and the preprocessing values
learned from the training data (Stage_4_Preprocessing.ipynb, section 11), validates
a user input and repeats exactly the same preprocessing before predicting.
"""

import json
import re
from pathlib import Path

import joblib
import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = PROJECT_DIR / "models"

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]

# The five values the user has to give
INPUT_FIELDS = ["carrier", "airport", "month", "year", "arr_flights"]

# Upper limit for the flight count (the busiest record in the data is about 22,000)
MAX_ARR_FLIGHTS = 50_000

# How far after the last data year a prediction is still accepted
MAX_YEARS_AHEAD = 10

# Meaning of each class (thresholds from Stage 4, section 3) and the recommended action
RISK_DETAILS = {
    0: {
        "level": "low",
        "delay_rate": "fewer than 15% of arrivals are expected to be delayed by 15 minutes or more",
        "action": "Routine monitoring. The normal schedule and staffing plan should be enough.",
    },
    1: {
        "level": "moderate",
        "delay_rate": "about 15% to 25% of arrivals are expected to be delayed by 15 minutes or more",
        "action": "Monitor more closely and review schedule buffers (turnaround time, spare crew and gates).",
    },
    2: {
        "level": "high",
        "delay_rate": "more than 25% of arrivals are expected to be delayed by 15 minutes or more",
        "action": "Priority review: add schedule buffers, plan backup aircraft and crew, "
                  "and investigate the main causes of delay on this route.",
    },
}


class ValidationError(Exception):
    """Raised when the user input is missing or invalid. `errors` maps field -> message."""

    def __init__(self, errors):
        super().__init__("Invalid input")
        self.errors = errors


def _to_int(value):
    """Return value as an int, or None if it is not a whole number (e.g. "abc", 2.5, True)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str) and re.fullmatch(r"\s*[+-]?\d+\s*", value):
        return int(value)
    return None


def _is_missing(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


class DelayRiskPredictor:
    """Loads the saved model and preprocessing values once, then predicts for each request."""

    def __init__(self, models_dir=MODELS_DIR):
        models_dir = Path(models_dir)
        model_path = models_dir / "final_model.joblib"
        prep_path = models_dir / "preprocessor.joblib"

        if not model_path.exists():
            raise FileNotFoundError(f"{model_path} not found. Run Final_Model_Comparison.ipynb to create it.")
        if not prep_path.exists():
            raise FileNotFoundError(f"{prep_path} not found. Run Stage_4_Preprocessing.ipynb to create it.")

        self.model = joblib.load(model_path)
        prep = joblib.load(prep_path)

        with open(models_dir / "final_features.json") as f:
            self.features = json.load(f)

        # The model and the preprocessing must describe the same 29 columns in the same order
        if self.features != prep["feature_order"]:
            raise ValueError("final_features.json does not match the saved preprocessing. "
                             "Re-run Stage_4_Preprocessing.ipynb and Final_Model_Comparison.ipynb.")

        self.season_of_month = prep["season_of_month"]
        self.carriers = prep["carriers"]
        self.airport_freq = prep["airport_freq"]
        self.arr_flights_cap = prep["arr_flights_cap"]
        self.scaler = prep["scaler"]
        self.num_cols = prep["num_cols"]
        self.risk_labels = prep["risk_labels"]
        self.first_year, self.last_year = prep["year_range"]
        self.carrier_names = prep["carrier_names"]
        self.airport_names = prep["airport_names"]
        self.typical_flights = prep["typical_flights"]

    # ------------------------------------------------------------------ options for the form

    def carrier_options(self):
        """[(code, name), ...] sorted by airline name."""
        return sorted(((c, self.carrier_names.get(c, c)) for c in self.carriers), key=lambda x: x[1])

    def airport_options(self):
        """[(code, name), ...] for the airports the model has seen, sorted by code."""
        return sorted((a, self.airport_names.get(a, a)) for a in self.airport_freq)

    def year_limits(self):
        return self.first_year, self.last_year + MAX_YEARS_AHEAD

    def get_typical_flights(self, carrier, airport):
        """Typical monthly arrivals of this airline at this airport, or None if there is no history."""
        key = f"{str(carrier).strip().upper()}|{str(airport).strip().upper()}"
        return self.typical_flights.get(key)

    # ------------------------------------------------------------------ validation

    def validate(self, data):
        """Check the raw user input. Returns (clean_input, warnings) or raises ValidationError."""
        if not isinstance(data, dict):
            raise ValidationError({"form": "The request must be a JSON object with the input fields."})

        errors = {}
        warnings = []
        clean = {}

        for field in INPUT_FIELDS:
            if _is_missing(data.get(field)):
                errors[field] = "This field is required."

        # Airline
        if "carrier" not in errors:
            carrier = str(data["carrier"]).strip().upper()
            if carrier not in self.carriers:
                errors["carrier"] = "Unknown airline. Please choose one of the airlines in the list."
            else:
                clean["carrier"] = carrier

        # Airport: must look like a 3-letter IATA code
        if "airport" not in errors:
            airport = str(data["airport"]).strip().upper()
            if not re.fullmatch(r"[A-Z]{3}", airport):
                errors["airport"] = "Enter a 3-letter airport code, for example ATL."
            else:
                clean["airport"] = airport
                if airport not in self.airport_freq:
                    # Same rule as Stage 4: an airport not seen in training gets frequency 0
                    warnings.append(f"Airport {airport} is not in the historical data, so the prediction "
                                    "for it is less reliable.")

        # Month
        if "month" not in errors:
            month = _to_int(data["month"])
            if month is None or not 1 <= month <= 12:
                errors["month"] = "Month must be a whole number from 1 to 12."
            else:
                clean["month"] = month

        # Year
        if "year" not in errors:
            year = _to_int(data["year"])
            low, high = self.year_limits()
            if year is None or not low <= year <= high:
                errors["year"] = f"Year must be a whole number from {low} to {high}."
            else:
                clean["year"] = year
                if year > self.last_year:
                    warnings.append(f"The model learned from {self.first_year}-{self.last_year} data. "
                                    f"For {year} it assumes delay patterns similar to recent years.")

        # Number of scheduled arrivals in that month
        if "arr_flights" not in errors:
            flights = _to_int(data["arr_flights"])
            if flights is None or not 1 <= flights <= MAX_ARR_FLIGHTS:
                errors["arr_flights"] = f"Scheduled arrivals must be a whole number from 1 to {MAX_ARR_FLIGHTS:,}."
            else:
                clean["arr_flights"] = flights

        if errors:
            raise ValidationError(errors)

        if self.get_typical_flights(clean["carrier"], clean["airport"]) is None:
            warnings.append(f"{self.carrier_names.get(clean['carrier'], clean['carrier'])} has no recorded "
                            f"arrivals at {clean['airport']} in the historical data, so the prediction "
                            "is less reliable.")

        return clean, warnings

    # ------------------------------------------------------------------ preprocessing (same as Stage 4)

    def transform(self, inputs):
        """
        Turn validated inputs into the 29 model columns, repeating the Stage 4 steps:
        season one-hot, carrier one-hot, airport frequency encoding, arr_flights cap,
        StandardScaler. `inputs` is a DataFrame with the columns in INPUT_FIELDS.
        """
        X = pd.DataFrame(0, index=inputs.index, columns=self.features)

        X["year"] = inputs["year"].astype(float)
        X["month"] = inputs["month"].astype(float)
        X["arr_flights"] = inputs["arr_flights"].astype(float).clip(upper=self.arr_flights_cap)
        X["airport_freq"] = inputs["airport"].map(self.airport_freq).fillna(0.0)

        seasons = inputs["month"].map(self.season_of_month)
        for col in self.features:
            if col.startswith("season_"):
                X[col] = (seasons == col.removeprefix("season_")).astype(int)
            elif col.startswith("carrier_"):
                X[col] = (inputs["carrier"] == col.removeprefix("carrier_")).astype(int)

        X[self.num_cols] = self.scaler.transform(X[self.num_cols])
        return X[self.features]

    # ------------------------------------------------------------------ prediction

    def predict(self, data):
        """Validate one user input, preprocess it and return the prediction as a dict."""
        clean, warnings = self.validate(data)

        X = self.transform(pd.DataFrame([clean]))
        probabilities = self.model.predict_proba(X)[0]
        classes = [int(c) for c in self.model.classes_]

        best = classes[probabilities.argmax()]
        label = self.risk_labels[best]
        confidence = float(probabilities.max())

        carrier_name = self.carrier_names.get(clean["carrier"], clean["carrier"])
        airport_name = self.airport_names.get(clean["airport"], "Unknown airport")
        month_name = MONTH_NAMES[clean["month"] - 1]

        return {
            "prediction": {
                "class_id": best,
                "label": label,
                "level": RISK_DETAILS[best]["level"],
                "confidence": round(confidence, 4),
                "meaning": RISK_DETAILS[best]["delay_rate"],
                "recommended_action": RISK_DETAILS[best]["action"],
            },
            "probabilities": [
                {"label": self.risk_labels[c], "level": RISK_DETAILS[c]["level"], "probability": round(float(p), 4)}
                for c, p in zip(classes, probabilities)
            ],
            "summary": (f"{carrier_name} arrivals at {clean['airport']} in {month_name} {clean['year']}: "
                        f"{label} ({confidence:.0%} confidence)."),
            "input": {
                **clean,
                "carrier_name": carrier_name,
                "airport_name": airport_name,
                "month_name": month_name,
                "season": self.season_of_month[clean["month"]],
            },
            "warnings": warnings,
        }
