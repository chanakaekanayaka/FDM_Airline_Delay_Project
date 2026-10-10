# Airline Delay Risk Prediction (IT3051 – Fundamentals of Data Mining)

Predicts the **delay risk** of an airline's arrivals at a U.S. airport in a given month as
**Low** (< 15% of arrivals delayed 15+ min), **Moderate** (15–25%) or **High** (> 25%), and recommends an action.

- **Data:** U.S. Bureau of Transportation Statistics, *Airline Delay Cause* (via Kaggle), 2013–2023
- **Final model:** Random Forest (200 trees, `max_depth=25`). Test set: **Macro F1 0.615, accuracy 0.629**
- **System:** Flask backend + HTML/CSS/JavaScript frontend

## Project structure

```
FDM_Airline_Delay_Project/
├── Stage_3_EDA.ipynb                  Stage 3  - exploratory data analysis
├── Stage_4_Preprocessing.ipynb        Stage 4  - cleaning, encoding, scaling, split; saves the preprocessing
├── Model_1_Logistic_Regression.ipynb  Stage 6/7 - model + tuning
├── Model_2_Decision_Tree.ipynb        Stage 6/7
├── Model_3_Random_Forest.ipynb        Stage 6/7
├── Model_4_KNN.ipynb                  Stage 6/7
├── Final_Model_Comparison.ipynb       Stage 7  - comparison, feature selection, test set, saves the model
├── data/                              raw CSV + processed train/test sets
├── results/                           cross-validation results of each model
├── models/
│   ├── final_model.joblib             trained Random Forest (not in git, ~175 MB)
│   ├── final_features.json            the 29 model columns, in order
│   └── preprocessor.joblib            values learned in Stage 4 (scaler, airport frequencies, cap, ...)
├── webapp/                            Stage 9 + 10 - the prediction system
│   ├── app.py                         Flask routes (backend API + web page)
│   ├── predictor.py                   loads the model, validates input, same preprocessing as Stage 4
│   ├── templates/index.html           web page
│   └── static/style.css, app.js       styling and frontend logic
├── tests/test_system.py               system tests
└── requirements.txt
```

## Setup

Use **Python 3.11** with the versions in `requirements.txt`. The model was saved with scikit-learn 1.9.0,
and the same version must be used to load it.

```
pip install -r requirements.txt
```

## Run the notebooks (only needed to rebuild the data, results or model)

Run in this order, with the project folder as the working directory:

1. `Stage_3_EDA.ipynb` (charts only)
2. `Stage_4_Preprocessing.ipynb` → `data/*_processed.csv`, `models/preprocessor.joblib`
3. `Model_1` … `Model_4` (any order) → `results/*.csv` (Random Forest ~15 min, KNN ~20–30 min)
4. `Final_Model_Comparison.ipynb` → `models/final_model.joblib`, `models/final_features.json`

If you only need the model file, run `Final_Model_Comparison.ipynb`; everything it needs is already in the repo.

## Run the web system

From the project folder:

```
python webapp/app.py
```

Wait for the model to load (about 15 seconds), then open **http://127.0.0.1:5000**. Stop the server with `Ctrl+C`.

## How the system works

```
Browser (index.html + app.js)                 Flask backend (app.py + predictor.py)
─────────────────────────────                 ──────────────────────────────────────
1. User fills the form          ──JSON──►     2. Validate every field (errors per field)
   (checked in the browser)                   3. Same preprocessing as Stage 4:
                                                 season + carrier one-hot, airport frequency,
                                                 arr_flights cap, StandardScaler, column order
                                              4. Random Forest predict_proba
5. Show risk level, confidence, ◄──JSON──     5. Risk level, confidence, all probabilities,
   probability bars, action, warnings            recommended action, warnings
```

**Inputs:** airline, arrival airport (3-letter code), month, year, number of scheduled arrivals in that month.
The form can fill in the typical number of arrivals for the chosen airline and airport.

**Outputs:** risk level, confidence (%), probability of each level, meaning in plain words, recommended action,
and warnings when the result is less reliable (year after 2023, airport not in the data, airline never
flew to that airport).

### API

| Method | Route | Description |
|---|---|---|
| GET | `/` | Web page |
| POST | `/api/predict` | Body: `{"carrier": "DL", "airport": "ATL", "month": 7, "year": 2026, "arr_flights": 2500}` |
| GET | `/api/typical-flights?carrier=DL&airport=ATL` | Typical monthly arrivals for the route (`null` if no history) |
| GET | `/api/health` | Checks that the model is loaded |
| GET | `/api/history` | Saved predictions with optional risk/search filters and `limit`/`offset` pagination (`total_filtered` gives the matching count) |
| GET | `/api/history/analytics` | Risk counts and saved-prediction trend |
| GET | `/api/history/export` | CSV export of saved predictions |
| GET | `/api/business/overview?carrier=DL&year=2023` | History-backed risk counts, high-risk cases, and latest airport/month predictions |
| POST | `/api/business/compare` | Two same-input model predictions and exact-input matching history |
| GET | `/api/business/performance` | Verified test-set metrics and model limitations |

`/api/predict` returns **200** with the prediction, or **400** with an error message for each invalid field.

### Business dashboard

The dashboard's risk counts, high-risk cases, and airport/month heatmap summarize saved model predictions in the local SQLite history. The heatmap shows the latest saved prediction for each selected airline, airport, month, and year; each cell includes its scheduled-arrival count because those inputs can differ. A blank cell means no saved prediction, not Low Risk. Scheduled arrivals are not actual delayed-flight counts, and this application does not estimate financial impact.

Airline comparison runs two current model predictions using the same airport, month, year, and scheduled-arrival count. It does not save those comparisons to history. Historical records appear separately and only when all five model inputs match exactly; the comparison is not an airline ranking.

The performance panel reports only the verified held-out test accuracy (0.6286) and macro F1 (0.6153), as documented in `Final_Model_Comparison.ipynb` and checked by `tests/test_system.py`. Class-level precision/recall and a confusion matrix are not published because verified values are not present in the checked project artifacts. Test-set metrics do not measure the reliability of an individual application prediction.

The **Download PDF report** action opens the browser print dialog with a report assembled from current history, comparison selection, and verified performance values. Choose **Save as PDF** in that dialog. This browser-based approach adds no PDF-generation dependency.

## System testing

```
python -m unittest discover -s tests -v
```

| # | Test | Input | Expected result | Result |
|---|---|---|---|---|
| 1 | Page loads | `GET /` | Form with all airlines and airports | Pass |
| 2 | Valid prediction | DL, ATL, July 2023, 2500 | Risk level, probabilities add up to 1, confidence = highest probability | Pass |
| 3 | Input cleaning | `" dl "`, `"atl "`, numbers as text | Same result as test 2 | Pass |
| 4 | All months and airlines | months 1–12, all 21 airlines | All predicted | Pass |
| 5 | Very large flight count | 6,000 and 40,000 | Same result (capped as in Stage 4) | Pass |
| 6 | Future year | 2026 | Prediction + warning | Pass |
| 7 | Unknown airport | QQQ | Prediction + warning (frequency 0, as in Stage 4) | Pass |
| 8 | Route with no history | Hawaiian Airlines at ABE | Prediction + warning | Pass |
| 9 | Missing fields | empty input / one field missing | 400, error for each missing field | Pass |
| 10 | Invalid month | 0, 13, -1, 2.5, "July", true | 400, month error | Pass |
| 11 | Invalid year | 2012, 2034, "abc", 2020.5 | 400, year error | Pass |
| 12 | Invalid flight count | 0, -5, 1.5, "many", 50001 | 400, arr_flights error | Pass |
| 13 | Invalid airline | ZZ | 400, carrier error | Pass |
| 14 | Invalid airport format | AT, ATLA, 12A, A-L | 400, airport error | Pass |
| 15 | Body is not a JSON object | plain text, JSON list | 400 | Pass |
| 16 | Unknown API route | `/api/does-not-exist` | 404 as JSON | Pass |
| 17 | Typical flights helper | DL+ATL / DL+QQQ | Number / `null` | Pass |
| 18 | **Same preprocessing as Stage 4** | all 34,245 raw test-set rows | Backend features identical to `test_processed.csv` | Pass |
| 19 | **Same results as the notebook** | all 34,245 test-set rows | Accuracy 0.6286, Macro F1 0.6153 | Pass |
| 20 | Health check | `GET /api/health` | 200, 29 features | Pass |

Tests 18 and 19 prove that the system uses the final model with exactly the same preprocessing as model development.

## Limitations

- About 6 out of 10 predictions are correct. Moderate Risk is the hardest level because it lies between the other two.
- The data has no weather or air-traffic information, and ends in August 2023.
- Predictions are for a whole month of an airline at an airport, not for a single flight.
