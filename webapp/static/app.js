// Stage 10 - Frontend logic: validates the form, calls the Flask backend and shows the result.

const FIELDS = ["carrier", "airport", "month", "year", "arr_flights"];
const GAUGE_LENGTH = 2 * Math.PI * 52;
const form = document.getElementById("risk-form");
const submitBtn = document.getElementById("submit-btn");
const submitText = submitBtn.querySelector(".btn-text");
const airportInput = document.getElementById("airport");
const airportName = document.getElementById("airport-name");
const typicalBox = document.getElementById("typical");
const typicalText = document.getElementById("typical-text");
const typicalBtn = document.getElementById("typical-btn");
const historyRiskFilter = document.getElementById("history-risk-filter");
const historySearch = document.getElementById("history-search");
const exportBtn = document.getElementById("export-csv-btn");
const AIRPORTS = Object.fromEntries(JSON.parse(document.getElementById("airport-data").textContent));
const AIRPORT_HELP = airportName.textContent;
const yearInput = document.getElementById("year");
const YEAR_MIN = Number(yearInput.min);
const YEAR_MAX = Number(yearInput.max);
const FLIGHTS_MAX = Number(document.getElementById("arr_flights").max);
let typicalValue = null;
const RISK_ALERTS = {
  low: {
    title: "Low risk estimate",
    text: "The model estimates a relatively low chance of delay for this route. Delays are still possible, so it is still wise to keep an eye on the latest operational updates.",
    className: "low",
  },
  moderate: {
    title: "Monitor this route",
    text: "This is an attention-level risk estimate. Allow additional time for travel and keep an eye on airline or airport updates before departure.",
    className: "moderate",
  },
  high: {
    title: "High risk estimate",
    text: "This route is flagged as elevated risk based on historical patterns. Check the airline's latest updates, allow extra travel time, and consider alternate arrangements where practical.",
    className: "high",
  },
};

async function checkStatus() {
  const status = document.getElementById("status");
  const text = document.getElementById("status-text");
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error();
    status.dataset.state = "online";
    text.textContent = "Model online";
  } catch {
    status.dataset.state = "offline";
    text.textContent = "Server offline";
  }
}

function setError(field, message) {
  const el = document.getElementById(field === "form" ? "form-error" : `${field}-error`);
  if (el) el.textContent = message || "";
  const input = document.getElementById(field);
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearErrors() {
  FIELDS.forEach((f) => setError(f, ""));
  setError("form", "");
}

function showErrors(errors) {
  Object.entries(errors).forEach(([field, message]) => setError(field, message));
  const first = FIELDS.find((f) => errors[f]);
  if (first) document.getElementById(first).focus();
}

function readForm() {
  return {
    carrier: form.carrier.value.trim(),
    airport: form.airport.value.trim().toUpperCase(),
    month: form.month.value.trim(),
    year: form.year.value.trim(),
    arr_flights: form.arr_flights.value.trim(),
  };
}

const isWholeNumber = (v) => /^\d+$/.test(v);

function validate(input) {
  const errors = {};
  if (!input.carrier) errors.carrier = "Please select an airline.";
  if (!input.airport) errors.airport = "Please enter an airport code.";
  else if (!/^[A-Z]{3}$/.test(input.airport)) errors.airport = "Enter a 3-letter airport code, for example ATL.";
  if (!input.month) errors.month = "Please select a month.";
  if (!input.year) errors.year = "Please enter a year.";
  else if (!isWholeNumber(input.year) || +input.year < YEAR_MIN || +input.year > YEAR_MAX)
    errors.year = `Year must be from ${YEAR_MIN} to ${YEAR_MAX}.`;
  if (!input.arr_flights) errors.arr_flights = "Please enter the number of scheduled arrivals.";
  else if (!isWholeNumber(input.arr_flights) || +input.arr_flights < 1 || +input.arr_flights > FLIGHTS_MAX)
    errors.arr_flights = `Enter a whole number from 1 to ${FLIGHTS_MAX.toLocaleString()}.`;
  return errors;
}

function updateAirportName() {
  const code = airportInput.value.trim().toUpperCase();
  if (AIRPORTS[code]) {
    airportName.textContent = AIRPORTS[code];
  } else if (/^[A-Z]{3}$/.test(code)) {
    airportName.textContent = "This airport is not in the historical data. You can still check it, but the result is less reliable.";
  } else {
    airportName.textContent = AIRPORT_HELP;
  }
}

async function updateTypicalFlights() {
  const carrier = form.carrier.value;
  const airport = airportInput.value.trim().toUpperCase();
  typicalBox.hidden = true;
  if (!carrier || !/^[A-Z]{3}$/.test(airport)) return;

  try {
    const params = new URLSearchParams({ carrier, airport });
    const res = await fetch(`/api/typical-flights?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.carrier !== form.carrier.value || data.airport !== airportInput.value.trim().toUpperCase()) return;
    typicalValue = data.typical_flights;
    if (typicalValue) {
      typicalText.textContent = `Typical for this route: ${typicalValue.toLocaleString()} arrivals per month.`;
      typicalBtn.hidden = false;
    } else {
      typicalText.textContent = "This airline has no recorded arrivals at this airport in the historical data.";
      typicalBtn.hidden = true;
    }
    typicalBox.hidden = false;
  } catch {
    // Optional hint; ignore a failed request.
  }
}

typicalBtn.addEventListener("click", () => {
  if (!typicalValue) return;
  form.arr_flights.value = typicalValue;
  setError("arr_flights", "");
});

airportInput.addEventListener("input", () => {
  updateAirportName();
  setError("airport", "");
});
airportInput.addEventListener("change", updateTypicalFlights);
form.carrier.addEventListener("change", updateTypicalFlights);
FIELDS.forEach((f) => form[f].addEventListener("input", () => setError(f, "")));

const percent = (p) => `${Math.round(p * 100)}%`;

function renderRiskAlert(level) {
  const alertContainer = document.getElementById("risk-alert");
  alertContainer.textContent = "";
  alertContainer.classList.remove("low", "moderate", "high");
  const config = RISK_ALERTS[level];
  if (!config) return;
  alertContainer.classList.add(config.className);

  const badge = document.createElement("span");
  badge.className = "risk-alert-badge";
  badge.textContent = config.title;

  const text = document.createElement("p");
  text.textContent = config.text;

  const note = document.createElement("small");
  note.textContent = "Estimate based on historical flight data, not live operational conditions.";

  alertContainer.append(badge, text, note);
}

function showResult(data) {
  const p = data.prediction;
  const hero = document.getElementById("risk-hero");
  hero.className = `risk-hero ${p.level}`;
  document.getElementById("result-label").textContent = p.label;
  document.getElementById("result-confidence").textContent = percent(p.confidence);
  document.getElementById("result-meaning").textContent =
    p.meaning.charAt(0).toUpperCase() + p.meaning.slice(1) + ".";
  document.getElementById("result-summary").textContent = data.summary;
  document.getElementById("result-action").textContent = p.recommended_action;
  renderRiskAlert(p.level);

  const bars = document.getElementById("result-bars");
  bars.textContent = "";
  data.probabilities.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("span");
    label.textContent = item.label;

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className = `bar-fill ${item.level}`;
    fill.dataset.width = percent(item.probability);
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = percent(item.probability);

    row.append(label, track, value);
    bars.appendChild(row);
  });

  const warnings = document.getElementById("result-warnings");
  warnings.textContent = "";
  data.warnings.forEach((warningText) => {
    const warning = document.createElement("div");
    warning.className = "warning";

    const icon = document.createElement("span");
    icon.className = "warning-icon";
    icon.textContent = "!";

    const text = document.createElement("span");
    text.textContent = warningText;

    warning.append(icon, text);
    warnings.appendChild(warning);
  });
  warnings.hidden = data.warnings.length === 0;

  const i = data.input;
  const details = {
    Airline: `${i.carrier_name} (${i.carrier})`,
    Airport: `${i.airport_name} (${i.airport})`,
    Period: `${i.month_name} ${i.year} · ${i.season}`,
    "Scheduled arrivals": i.arr_flights.toLocaleString(),
  };

  const grid = document.getElementById("result-details");
  grid.textContent = "";
  Object.entries(details).forEach(([key, value]) => {
    const tile = document.createElement("div");
    tile.className = "detail";
    const label = document.createElement("span");
    const strong = document.createElement("strong");
    label.textContent = key;
    strong.textContent = value;
    tile.append(label, strong);
    grid.appendChild(tile);
  });

  const gauge = document.getElementById("gauge-fill");
  gauge.style.strokeDashoffset = GAUGE_LENGTH;
  document.getElementById("result-empty").hidden = true;
  const result = document.getElementById("result");
  result.hidden = false;
  result.style.animation = "none";
  void result.offsetWidth;
  result.style.animation = "";

  requestAnimationFrame(() => requestAnimationFrame(() => {
    gauge.style.strokeDashoffset = GAUGE_LENGTH * (1 - p.confidence);
    bars.querySelectorAll(".bar-fill").forEach((bar) => {
      bar.style.width = bar.dataset.width;
    });
  }));

  if (window.innerWidth <= 900) {
    document.getElementById("result-title").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hideResult() {
  document.getElementById("result").hidden = true;
  document.getElementById("result-empty").hidden = false;
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.classList.toggle("loading", loading);
  submitText.textContent = loading ? "Checking..." : "Check delay risk";
}

function buildDonut(data) {
  const donut = document.getElementById("risk-donut");
  const total = data.total_predictions || 0;
  document.getElementById("donut-total").textContent = total;
  const colors = { "Low Risk": "#16a34a", "Moderate Risk": "#d97706", "High Risk": "#dc2626" };
  if (total === 0) {
    donut.style.background = "linear-gradient(135deg, #f1f5f9, #e2e8f0)";
    return;
  }
  let current = 0;
  const segments = ["Low Risk", "Moderate Risk", "High Risk"].map((label) => {
    const value = data.distribution[label] || 0;
    const start = current;
    current += value;
    return `${colors[label]} ${start}% ${current}%`;
  });
  donut.style.background = `conic-gradient(${segments.join(", ")})`;
}

function buildLegend(data) {
  const legend = document.getElementById("risk-legend");
  legend.textContent = "";
  ["Low Risk", "Moderate Risk", "High Risk"].forEach((label) => {
    const item = document.createElement("li");
    item.className = "risk-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = label === "Low Risk" ? "#16a34a" : label === "Moderate Risk" ? "#d97706" : "#dc2626";

    const text = document.createElement("span");
    text.textContent = `${label} (${data.counts[label] || 0})`;

    const pct = document.createElement("strong");
    pct.textContent = `${data.distribution[label] || 0}%`;

    item.append(swatch, text, pct);
    legend.appendChild(item);
  });
}

function buildTrendChart(data) {
  const chart = document.getElementById("trend-chart");
  chart.textContent = "";

  const validEntries = (data.trend || []).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (typeof entry.date !== "string") return false;
    const value = entry.date.trim();
    return value.length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(value);
  });

  if (validEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "No valid trend data";
    chart.appendChild(empty);
    return;
  }

  const max = Math.max(...validEntries.map((item) => Number(item.count) || 0), 1);
  validEntries.forEach((entry) => {
    const count = Number(entry.count) || 0;
    const column = document.createElement("div");
    column.className = "trend-column";
    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.style.height = `${(count / max) * 100}%`;
    const label = document.createElement("span");
    label.className = "trend-label";
    label.textContent = entry.date.slice(5);
    const value = document.createElement("span");
    value.className = "trend-value";
    value.textContent = String(count);
    column.append(value, bar, label);
    chart.appendChild(column);
  });
}

function renderAnalytics(data) {
  const total = document.getElementById("metric-total");
  total.textContent = data.total_predictions ?? 0;
  document.getElementById("metric-low").textContent = data.counts["Low Risk"] || 0;
  document.getElementById("metric-moderate").textContent = data.counts["Moderate Risk"] || 0;
  document.getElementById("metric-high").textContent = data.counts["High Risk"] || 0;
  buildDonut(data);
  buildLegend(data);
  buildTrendChart(data);

  const analyticsEmpty = document.getElementById("analytics-empty");
  const analyticsGrid = document.getElementById("analytics-grid");
  if (data.total_predictions === 0) {
    analyticsEmpty.hidden = false;
    analyticsGrid.style.display = "none";
  } else {
    analyticsEmpty.hidden = true;
    analyticsGrid.style.display = "grid";
  }
}

function renderHistory(records) {
  const body = document.getElementById("history-body");
  const empty = document.getElementById("history-empty");
  const tableWrap = document.getElementById("history-table-wrap");
  body.textContent = "";
  if (!records || records.length === 0) {
    empty.hidden = false;
    tableWrap.style.display = "none";
    return;
  }
  empty.hidden = true;
  tableWrap.style.display = "block";
  records.forEach((record) => {
    const row = document.createElement("tr");
    const timestamp = document.createElement("td");
    timestamp.textContent = new Date(record.created_at).toLocaleString();
    const carrier = document.createElement("td");
    carrier.textContent = record.carrier;
    const airport = document.createElement("td");
    airport.textContent = record.airport;
    const month = document.createElement("td");
    month.textContent = record.month;
    const year = document.createElement("td");
    year.textContent = record.year;
    const arrivals = document.createElement("td");
    arrivals.textContent = Number(record.arr_flights).toLocaleString();
    const risk = document.createElement("td");
    risk.textContent = record.prediction_label;
    const confidence = document.createElement("td");
    const confidenceValue = record.confidence ?? 0;
    confidence.textContent = `${(confidenceValue * 100).toFixed(0)}%`;
    row.append(timestamp, carrier, airport, month, year, arrivals, risk, confidence);
    body.appendChild(row);
  });
}

async function fetchHistoryData() {
  const params = new URLSearchParams({
    limit: "25",
    risk: historyRiskFilter.value,
    search: historySearch.value.trim(),
  });

  try {
    const [analyticsRes, historyRes] = await Promise.all([
      fetch("/api/history/analytics"),
      fetch(`/api/history?${params}`),
    ]);

    if (analyticsRes.ok) {
      const analytics = await analyticsRes.json();
      renderAnalytics(analytics);
    } else {
      renderAnalytics({
        total_predictions: 0,
        counts: { "Low Risk": 0, "Moderate Risk": 0, "High Risk": 0 },
        distribution: { "Low Risk": 0, "Moderate Risk": 0, "High Risk": 0 },
        trend: [],
      });
    }

    if (historyRes.ok) {
      const payload = await historyRes.json();
      renderHistory(payload.records || []);
    } else {
      renderHistory([]);
    }
  } catch (error) {
    renderAnalytics({
      total_predictions: 0,
      counts: { "Low Risk": 0, "Moderate Risk": 0, "High Risk": 0 },
      distribution: { "Low Risk": 0, "Moderate Risk": 0, "High Risk": 0 },
      trend: [],
    });
    renderHistory([]);
  }
}

historyRiskFilter.addEventListener("change", fetchHistoryData);
historySearch.addEventListener("input", fetchHistoryData);

exportBtn.addEventListener("click", () => {
  const params = new URLSearchParams({
    risk: historyRiskFilter.value,
    search: historySearch.value.trim(),
  });
  window.location.href = `/api/history/export?${params}`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.dataset.submitting === "true") return;

  clearErrors();
  const input = readForm();
  const errors = validate(input);
  if (Object.keys(errors).length > 0) {
    showErrors(errors);
    return;
  }

  form.dataset.submitting = "true";
  setLoading(true);

  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        month: Number(input.month),
        year: Number(input.year),
        arr_flights: Number(input.arr_flights),
      }),
    });
    const data = await res.json();

    if (res.ok) {
      showResult(data);
      try {
        await fetchHistoryData();
      } catch {
        // History refresh errors are non-blocking; the prediction itself already succeeded.
      }
    } else {
      hideResult();
      showErrors(data.errors || {});
      if (!FIELDS.some((f) => data.errors && data.errors[f])) setError("form", data.message || "Request failed.");
    }
  } catch {
    hideResult();
    setError("form", "Could not reach the prediction service. Make sure the server is running and try again.");
  } finally {
    form.dataset.submitting = "false";
    setLoading(false);
  }
});

form.addEventListener("reset", () => {
  clearErrors();
  hideResult();
  typicalBox.hidden = true;
  typicalValue = null;
  airportName.textContent = AIRPORT_HELP;
});

checkStatus();
fetchHistoryData();
