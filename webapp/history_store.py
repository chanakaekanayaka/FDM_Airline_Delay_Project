import csv
import io
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_HISTORY_DB = PROJECT_DIR / "prediction_history.db"


def _resolve_db_path(db_path=None):
    if db_path is None:
        path = DEFAULT_HISTORY_DB
    else:
        path = Path(db_path)
        if not path.is_absolute():
            path = PROJECT_DIR / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(path)


class HistoryStorageError(RuntimeError):
    """Raised when the SQLite history database is not available or cannot be used."""


def init_history_db(db_path=None):
    db_path = _resolve_db_path(db_path)
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS prediction_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                carrier TEXT NOT NULL,
                airport TEXT NOT NULL,
                month INTEGER NOT NULL,
                year INTEGER NOT NULL,
                arr_flights INTEGER NOT NULL,
                prediction_label TEXT NOT NULL,
                prediction_level TEXT NOT NULL,
                confidence REAL,
                probability_json TEXT,
                summary TEXT,
                dedupe_key TEXT UNIQUE NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_prediction_history_created_at ON prediction_history(created_at DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_prediction_history_risk ON prediction_history(prediction_label)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_prediction_history_route ON prediction_history(carrier, airport)"
        )
        conn.commit()
    except sqlite3.Error as exc:
        raise HistoryStorageError(f"Unable to initialize prediction history database: {exc}") from exc
    finally:
        if conn is not None:
            conn.close()
    return db_path


def _sanitize_csv_value(value):
    if value is None:
        return ""
    text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def _make_dedupe_key(payload):
    input_values = payload.get("input", {})
    prediction = payload.get("prediction", {})
    carrier = str(input_values.get("carrier", "")).strip().upper()
    airport = str(input_values.get("airport", "")).strip().upper()
    month = int(input_values.get("month", 0))
    year = int(input_values.get("year", 0))
    arr_flights = int(input_values.get("arr_flights", 0))
    label = str(prediction.get("label", "")).strip()
    created_at = datetime.now(timezone.utc)
    bucket = created_at.strftime("%Y-%m-%dT%H:%M")
    return f"{carrier}|{airport}|{month}|{year}|{arr_flights}|{label}|{bucket}"


def save_prediction_record(db_path, prediction_result):
    if not isinstance(prediction_result, dict):
        return None
    input_values = prediction_result.get("input", {})
    prediction = prediction_result.get("prediction", {})
    if not input_values or not prediction:
        return None

    carrier = str(input_values.get("carrier", "")).strip().upper()
    airport = str(input_values.get("airport", "")).strip().upper()
    month = int(input_values.get("month", 0))
    year = int(input_values.get("year", 0))
    arr_flights = int(input_values.get("arr_flights", 0))
    label = str(prediction.get("label", "")).strip()
    level = str(prediction.get("level", label.lower().replace(" ", "_"))).strip()
    confidence = prediction.get("confidence")
    probability_json = json.dumps(prediction_result.get("probabilities", []), ensure_ascii=False)
    summary = str(prediction_result.get("summary", "")).strip()
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S%z")
    dedupe_key = _make_dedupe_key(prediction_result)

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        existing = conn.execute(
            "SELECT id FROM prediction_history WHERE dedupe_key = ?",
            (dedupe_key,),
        ).fetchone()
        if existing is not None:
            return existing[0]

        cursor = conn.execute(
            """
            INSERT INTO prediction_history (
                created_at, carrier, airport, month, year, arr_flights,
                prediction_label, prediction_level, confidence, probability_json, summary, dedupe_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                carrier,
                airport,
                month,
                year,
                arr_flights,
                label,
                level,
                confidence,
                probability_json,
                summary,
                dedupe_key,
            ),
        )
        conn.commit()
        return cursor.lastrowid
    except sqlite3.Error as exc:
        raise HistoryStorageError(f"Unable to save prediction history item: {exc}") from exc
    finally:
        if conn is not None:
            conn.close()


def fetch_history(db_path, risk=None, search=None, limit=25):
    db_path = _resolve_db_path(db_path)
    clauses = []
    params = []

    if risk:
        risk_value = str(risk).strip().lower()
        if risk_value in {"low", "low risk", "low_risk"}:
            clauses.append("prediction_level = ?")
            params.append("low")
        elif risk_value in {"moderate", "moderate risk", "moderate_risk"}:
            clauses.append("prediction_level = ?")
            params.append("moderate")
        elif risk_value in {"high", "high risk", "high_risk"}:
            clauses.append("prediction_level = ?")
            params.append("high")

    if search:
        term = f"%{str(search).strip()}%"
        clauses.append("(carrier LIKE ? OR airport LIKE ?)")
        params.extend([term, term])

    query = "SELECT * FROM prediction_history"
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY created_at DESC"
    if limit is not None:
        query += " LIMIT ?"
        params.append(int(limit))

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
    except sqlite3.Error as exc:
        raise HistoryStorageError(f"Unable to load prediction history: {exc}") from exc
    finally:
        if conn is not None:
            conn.close()

    history = []
    for row in rows:
        record = dict(row)
        record["probabilities"] = json.loads(record.get("probability_json") or "[]")
        record.pop("probability_json", None)
        history.append(record)
    return history


def get_analytics(db_path):
    db_path = _resolve_db_path(db_path)
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        total = conn.execute("SELECT COUNT(*) AS total FROM prediction_history").fetchone()["total"]
        counts = conn.execute(
            "SELECT prediction_label AS label, COUNT(*) AS n FROM prediction_history GROUP BY prediction_label"
        ).fetchall()
        trend = conn.execute(
            """
            SELECT strftime('%Y-%m-%d', created_at) AS date, COUNT(*) AS count
            FROM prediction_history
            GROUP BY date(created_at)
            ORDER BY date(created_at) DESC
            LIMIT 14
            """
        ).fetchall()
    except sqlite3.Error as exc:
        raise HistoryStorageError(f"Unable to compute prediction analytics: {exc}") from exc
    finally:
        if conn is not None:
            conn.close()

    count_map = {"Low Risk": 0, "Moderate Risk": 0, "High Risk": 0}
    for row in counts:
        count_map[row["label"]] = row["n"]

    distribution = {}
    for label in ["Low Risk", "Moderate Risk", "High Risk"]:
        pct = (count_map[label] / total * 100.0) if total else 0.0
        distribution[label] = round(pct, 2)

    trend_list = []
    for row in reversed(trend):
        date_value = row["date"]
        if date_value is None:
            continue
        date_text = str(date_value).strip()
        if not date_text or len(date_text) < 10:
            continue
        trend_list.append({"date": date_text, "count": row["count"]})

    return {
        "total_predictions": total,
        "empty": total == 0,
        "counts": count_map,
        "distribution": distribution,
        "trend": trend_list,
    }


def export_history_csv(db_path, risk=None, search=None):
    records = fetch_history(db_path, risk=risk, search=search, limit=None)
    fieldnames = [
        "timestamp",
        "carrier",
        "airport",
        "month",
        "year",
        "arr_flights",
        "prediction_label",
        "prediction_level",
        "confidence",
        "probability_low",
        "probability_moderate",
        "probability_high",
        "summary",
    ]

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames)
    writer.writeheader()

    for record in records:
        probabilities = record.get("probabilities") or []
        prob_map = {item.get("label"): item.get("probability", 0.0) for item in probabilities if isinstance(item, dict)}
        writer.writerow({
            "timestamp": _sanitize_csv_value(record.get("created_at")),
            "carrier": _sanitize_csv_value(record.get("carrier")),
            "airport": _sanitize_csv_value(record.get("airport")),
            "month": record.get("month"),
            "year": record.get("year"),
            "arr_flights": record.get("arr_flights"),
            "prediction_label": _sanitize_csv_value(record.get("prediction_label")),
            "prediction_level": _sanitize_csv_value(record.get("prediction_level")),
            "confidence": record.get("confidence"),
            "probability_low": prob_map.get("Low Risk", 0.0),
            "probability_moderate": prob_map.get("Moderate Risk", 0.0),
            "probability_high": prob_map.get("High Risk", 0.0),
            "summary": _sanitize_csv_value(record.get("summary")),
        })

    return buffer.getvalue()
