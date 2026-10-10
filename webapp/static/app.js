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
const pdfReportBtn = document.getElementById("pdf-report-btn");
const heatmapCarrier = document.getElementById("heatmap-carrier");
const heatmapYear = document.getElementById("heatmap-year");
const comparisonForm = document.getElementById("comparison-form");
const comparisonBtn = document.getElementById("compare-btn");
const reportStatus = document.getElementById("report-status");
const reportCarrier = document.getElementById("report-carrier");
const reportYear = document.getElementById("report-year");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const historyPrev = document.getElementById("history-prev");
const historyNext = document.getElementById("history-next");
const historyPageLabel = document.getElementById("history-page-label");
const AIRPORTS = Object.fromEntries(JSON.parse(document.getElementById("airport-data").textContent));
const AIRPORT_HELP = airportName.textContent;
const yearInput = document.getElementById("year");
const YEAR_MIN = Number(yearInput.min);
const YEAR_MAX = Number(yearInput.max);
const FLIGHTS_MAX = Number(document.getElementById("arr_flights").max);
let typicalValue = null;
let businessOverview = null;
let modelPerformance = null;
let airlineComparison = null;
let historyOffset = 0;
const HISTORY_PAGE_SIZE = 25;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RISK_CLASS = { "Low Risk": "low", "Moderate Risk": "moderate", "High Risk": "high" };
const RISK_COLORS = { "Low Risk": "var(--low)", "Moderate Risk": "var(--moderate)", "High Risk": "var(--high)" };
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
  if (total === 0) {
    donut.style.background = "var(--surface-2)";
    return;
  }
  let current = 0;
  const segments = ["Low Risk", "Moderate Risk", "High Risk"].map((label) => {
    const value = data.distribution[label] || 0;
    const start = current;
    current += value;
    return `${RISK_COLORS[label]} ${start}% ${current}%`;
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
    swatch.style.background = RISK_COLORS[label];

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
    limit: String(HISTORY_PAGE_SIZE),
    offset: String(historyOffset),
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
      const totalFiltered = Number(payload.total_filtered ?? payload.total ?? 0);
      historyPrev.disabled = historyOffset === 0;
      historyNext.disabled = historyOffset + (payload.records || []).length >= totalFiltered;
      const currentPage = Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1;
      const lastPage = Math.max(1, Math.ceil(totalFiltered / HISTORY_PAGE_SIZE));
      historyPageLabel.textContent = totalFiltered === 0
        ? "No matching records"
        : `Page ${currentPage} of ${lastPage} · ${totalFiltered} matching records`;
    } else {
      renderHistory([]);
      historyPrev.disabled = true;
      historyNext.disabled = true;
      historyPageLabel.textContent = "History could not be loaded";
    }
  } catch (error) {
    renderAnalytics({
      total_predictions: 0,
      counts: { "Low Risk": 0, "Moderate Risk": 0, "High Risk": 0 },
      distribution: { "Low Risk": 0, "Moderate Risk": 0, "High Risk": 0 },
      trend: [],
    });
    renderHistory([]);
    historyPrev.disabled = true;
    historyNext.disabled = true;
    historyPageLabel.textContent = "History could not be loaded";
  }
}

function airlineName(code) {
  const option = Array.from(document.getElementById("compare-carrier-a").options).find((item) => item.value === code);
  return option ? option.textContent : code;
}

function renderBusinessOverview(data) {
  businessOverview = data;
  const counts = data.risk_counts || {};
  const countContainer = document.getElementById("business-risk-counts");
  countContainer.textContent = "";
  ["Low Risk", "Moderate Risk", "High Risk"].forEach((label) => {
    const item = document.createElement("div");
    item.className = `business-risk-count ${RISK_CLASS[label]}`;
    const title = document.createElement("span");
    title.textContent = label;
    const count = document.createElement("strong");
    count.textContent = String(counts[label] || 0);
    item.append(title, count);
    countContainer.appendChild(item);
  });
  renderRiskBreakdown("risk-by-airline", data.risk_by_airline || [], "carrier", "Airline");
  renderRiskBreakdown("risk-by-airport", data.risk_by_airport || [], "airport", "Airport");

  const body = document.getElementById("business-cases-body");
  const tableWrap = document.getElementById("business-cases-wrap");
  const empty = document.getElementById("business-cases-empty");
  body.textContent = "";
  const cases = data.high_risk_cases || [];
  empty.hidden = cases.length !== 0;
  tableWrap.hidden = cases.length === 0;
  cases.forEach((record) => {
    const row = document.createElement("tr");
    const values = [
      airlineName(record.carrier),
      `${record.airport || "Unknown"} (${record.airport || ""})`,
      `${MONTH_SHORT[(Number(record.month) || 1) - 1]} ${record.year ?? ""}`,
      Number(record.arr_flights || 0).toLocaleString(),
      record.prediction_label || "Unavailable",
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 4) cell.className = "risk-high";
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  document.getElementById("business-cases-note").textContent = data.high_risk_cases_truncated
    ? "Showing the 50 most recent high-risk records."
    : "No actual delayed-flight counts are stored for these records.";

  const overviewList = document.getElementById("overview-high-risk");
  overviewList.textContent = "";
  if (!cases.length) {
    const emptyText = document.createElement("p");
    emptyText.className = "muted overview-empty";
    emptyText.textContent = "No high-risk predictions are saved.";
    overviewList.appendChild(emptyText);
  } else {
    cases.slice(0, 5).forEach((record) => {
      const item = document.createElement("div");
      item.className = "overview-risk-row";
      const route = document.createElement("div");
      const airline = document.createElement("strong");
      airline.textContent = `${record.carrier} · ${record.airport}`;
      const period = document.createElement("span");
      period.textContent = `${MONTH_SHORT[(Number(record.month) || 1) - 1]} ${record.year} · ${Number(record.arr_flights || 0).toLocaleString()} scheduled arrivals`;
      route.append(airline, period);
      const risk = document.createElement("span");
      risk.className = "risk-tag high";
      risk.textContent = "High Risk";
      item.append(route, risk);
      overviewList.appendChild(item);
    });
  }

  const years = data.years || [];
  const previousYear = heatmapYear.value;
  heatmapYear.textContent = "";
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    heatmapYear.appendChild(option);
  });
  if (years.length) {
    const requestedYearExists = years.some((year) => String(year) === previousYear);
    heatmapYear.value = requestedYearExists ? previousYear : String(data.selected_year ?? years[years.length - 1]);
  }
  const currentReportYear = reportYear.value;
  if (reportCarrier.value === data.selected_carrier) {
    populateReportYears(years, currentReportYear);
  }
  renderAirportHeatmap(data);
}

function renderRiskBreakdown(containerId, rows, key, heading) {
  const container = document.getElementById(containerId);
  container.textContent = "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted compact-empty";
    empty.textContent = "No saved prediction data.";
    container.appendChild(empty);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "business-table-wrap";
  const table = document.createElement("table");
  table.className = "business-table breakdown-table";
  const tableHead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  [heading, "Low", "Moderate", "High", "Total"].forEach((label) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.appendChild(cell);
  });
  tableHead.appendChild(headerRow);
  table.appendChild(tableHead);
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = key === "carrier" ? airlineName(row[key]) : row[key];
    tableRow.appendChild(name);
    ["Low Risk", "Moderate Risk", "High Risk", "total"].forEach((metric) => {
      const cell = document.createElement("td");
      cell.textContent = String(row[metric] || 0);
      tableRow.appendChild(cell);
    });
    body.appendChild(tableRow);
  });
  table.appendChild(body);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

function populateReportYears(years, selectedYear = "") {
  reportYear.textContent = "";
  const latestOption = document.createElement("option");
  latestOption.value = "";
  latestOption.textContent = "Latest available";
  reportYear.appendChild(latestOption);
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    reportYear.appendChild(option);
  });
  reportYear.value = years.some((year) => String(year) === selectedYear) ? selectedYear : "";
}

async function refreshReportYears() {
  try {
    const params = new URLSearchParams({ carrier: reportCarrier.value });
    const response = await fetch(`/api/business/overview?${params}`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    populateReportYears(data.years || [], reportYear.value);
  } catch {
    populateReportYears([]);
  }
}

function renderAirportHeatmap(data) {
  const container = document.getElementById("airport-heatmap");
  const empty = document.getElementById("heatmap-empty");
  container.textContent = "";
  const records = data.heatmap || [];
  empty.hidden = records.length !== 0;
  empty.textContent = "No predictions for this airline and year yet.";
  if (!records.length) return;

  const grid = document.createElement("div");
  grid.className = "heatmap-grid";
  grid.setAttribute("role", "grid");
  const headerRow = document.createElement("div");
  headerRow.className = "heatmap-row";
  headerRow.setAttribute("role", "row");
  const corner = document.createElement("span");
  corner.className = "heatmap-label";
  corner.setAttribute("role", "columnheader");
  corner.textContent = "Airport";
  headerRow.appendChild(corner);
  MONTH_SHORT.forEach((month) => {
    const heading = document.createElement("span");
    heading.className = "heatmap-month";
    heading.setAttribute("role", "columnheader");
    heading.textContent = month;
    headerRow.appendChild(heading);
  });
  grid.appendChild(headerRow);

  const byAirport = new Map();
  records.forEach((record) => {
    if (!byAirport.has(record.airport)) byAirport.set(record.airport, new Map());
    byAirport.get(record.airport).set(Number(record.month), record);
  });
  Array.from(byAirport.keys()).sort().forEach((airport) => {
    const row = document.createElement("div");
    row.className = "heatmap-row";
    row.setAttribute("role", "row");
    const label = document.createElement("span");
    label.className = "heatmap-label";
    label.setAttribute("role", "rowheader");
    label.textContent = airport;
    row.appendChild(label);
    for (let month = 1; month <= 12; month += 1) {
      const record = byAirport.get(airport).get(month);
      if (!record) {
        const missing = document.createElement("span");
        missing.className = "heatmap-cell missing";
        missing.setAttribute("role", "gridcell");
        missing.setAttribute("aria-label", `No saved prediction for ${airport}, ${MONTH_SHORT[month - 1]} ${data.selected_year}`);
        row.appendChild(missing);
        continue;
      }
      const riskClass = RISK_CLASS[record.prediction_label] || "";
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `heatmap-cell ${riskClass}`;
      cell.setAttribute("role", "gridcell");
      cell.textContent = record.prediction_label === "Low Risk" ? "L" : record.prediction_label === "Moderate Risk" ? "M" : "H";
      const flights = Number(record.arr_flights);
      const flightText = Number.isFinite(flights) ? `${flights.toLocaleString()} scheduled arrivals` : "arrival count unavailable";
      const monthName = MONTH_SHORT[month - 1];
      cell.title = `${record.prediction_label} | ${airlineName(record.carrier)} | ${airport} | ${monthName} ${record.year} | ${flightText}`;
      cell.setAttribute("aria-label", cell.title);
      row.appendChild(cell);
    }
    grid.appendChild(row);
  });
  container.appendChild(grid);
}

async function fetchBusinessOverview() {
  const heatmap = document.getElementById("airport-heatmap");
  const heatmapEmpty = document.getElementById("heatmap-empty");
  heatmap.setAttribute("aria-busy", "true");
  heatmapEmpty.hidden = false;
  heatmapEmpty.textContent = "Loading saved prediction history...";
  const params = new URLSearchParams();
  if (heatmapCarrier.value) params.set("carrier", heatmapCarrier.value);
  if (heatmapYear.value) params.set("year", heatmapYear.value);
  try {
    const response = await fetch(`/api/business/overview?${params}`);
    if (!response.ok) throw new Error("Business analytics could not be loaded.");
    renderBusinessOverview(await response.json());
  } catch (error) {
    heatmapEmpty.hidden = false;
    heatmapEmpty.textContent = "Business analytics could not be loaded.";
    document.getElementById("business-cases-empty").hidden = false;
    document.getElementById("business-cases-empty").textContent = "Business analytics could not be loaded.";
  } finally {
    heatmap.removeAttribute("aria-busy");
  }
}

async function fetchBusinessOverviewForReport() {
  const params = new URLSearchParams({ carrier: reportCarrier.value });
  if (reportYear.value) params.set("year", reportYear.value);
  const response = await fetch(`/api/business/overview?${params}`);
  if (!response.ok) throw new Error("Report data could not be loaded.");
  return response.json();
}

function renderPerformance(data) {
  modelPerformance = data;
  const container = document.getElementById("performance-metrics");
  const limitations = document.getElementById("performance-limitations");
  container.textContent = "";
  limitations.textContent = "";
  if (data.status !== "available") {
    const unavailable = document.createElement("p");
    unavailable.className = "method-note";
    unavailable.textContent = "Verified model evaluation metrics are unavailable.";
    container.appendChild(unavailable);
    return;
  }

  const metrics = [
    ["Held-out test accuracy", `${(data.test_accuracy * 100).toFixed(2)}%`],
    ["Held-out macro F1", `${data.test_macro_f1.toFixed(4)} (0-1 scale)`],
    ["Test records", Number(data.evaluation_records).toLocaleString()],
  ];
  metrics.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "performance-metric";
    const name = document.createElement("span");
    name.textContent = label;
    const result = document.createElement("strong");
    result.textContent = value;
    item.append(name, result);
    container.appendChild(item);
  });
  const scope = document.createElement("p");
  scope.className = "method-note performance-source";
  scope.textContent = `${data.evaluation_scope} Source: ${data.source}. Macro F1 weights each risk category equally; accuracy is the overall share of correct classifications.`;
  container.appendChild(scope);
  (data.limitations || []).forEach((limitation) => {
    const item = document.createElement("li");
    item.textContent = limitation;
    limitations.appendChild(item);
  });
}

async function fetchModelPerformance() {
  try {
    const response = await fetch("/api/business/performance");
    if (!response.ok) throw new Error("Evaluation metrics could not be loaded.");
    renderPerformance(await response.json());
  } catch {
    renderPerformance({ status: "unavailable" });
  }
}

function renderAirlineComparison(data) {
  airlineComparison = data;
  const container = document.getElementById("comparison-results");
  container.textContent = "";
  data.comparisons.forEach((comparison) => {
    const card = document.createElement("article");
    card.className = `comparison-item ${RISK_CLASS[comparison.prediction.label] || ""}`;
    const title = document.createElement("h4");
    title.textContent = `${comparison.carrier_name} (${comparison.carrier})`;
    const source = document.createElement("p");
    source.className = "small muted";
    source.textContent = comparison.source;
    const risk = document.createElement("p");
    risk.className = "comparison-risk";
    risk.textContent = `${comparison.prediction.label} | ${percent(comparison.prediction.confidence)} confidence`;
    const probabilities = document.createElement("div");
    probabilities.className = "comparison-probabilities";
    comparison.probabilities.forEach((item) => {
      const line = document.createElement("span");
      line.textContent = `${item.label}: ${percent(item.probability)}`;
      probabilities.appendChild(line);
    });
    const history = document.createElement("div");
    history.className = "comparison-history";
    const historyTitle = document.createElement("strong");
    historyTitle.textContent = `Historical matching records: ${comparison.historical_record_count}`;
    history.appendChild(historyTitle);
    const pastRecords = comparison.historical_records || [];
    if (!pastRecords.length) {
      const noRecords = document.createElement("p");
      noRecords.textContent = "No historical predictions with exactly matching inputs.";
      history.appendChild(noRecords);
    } else {
      const list = document.createElement("ul");
      pastRecords.forEach((record) => {
        const item = document.createElement("li");
        const probabilities = (record.probabilities || [])
          .filter((probability) => probability && typeof probability.label === "string" && Number.isFinite(Number(probability.probability)))
          .map((probability) => `${probability.label} ${percent(Number(probability.probability))}`)
          .join(", ");
        item.textContent = `${record.prediction_label} | ${record.created_at || "time unavailable"} | ${percent(Number(record.confidence) || 0)} confidence | ${probabilities || "historical probabilities unavailable"}`;
        list.appendChild(item);
      });
      history.appendChild(list);
    }
    card.append(title, source, risk, probabilities, history);
    container.appendChild(card);
  });
}

comparisonForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("comparison-status");
  const carriers = [document.getElementById("compare-carrier-a").value, document.getElementById("compare-carrier-b").value];
  if (carriers[0] === carriers[1]) {
    status.textContent = "Choose two different supported airlines.";
    return;
  }
  comparisonBtn.disabled = true;
  status.textContent = "Calculating comparable predictions...";
  try {
    const response = await fetch("/api/business/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrier_a: carriers[0],
        carrier_b: carriers[1],
        airport: document.getElementById("compare-airport").value,
        month: Number(document.getElementById("compare-month").value),
        year: Number(document.getElementById("compare-year").value),
        arr_flights: Number(document.getElementById("compare-arrivals").value),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Comparison could not be completed.");
    renderAirlineComparison(data);
    status.textContent = "Current predictions use identical airport, month, year, and scheduled-arrival inputs. Historical records are shown separately.";
  } catch (error) {
    status.textContent = error.message || "Comparison could not be completed.";
  } finally {
    comparisonBtn.disabled = false;
  }
});

function addReportSection(root, title) {
  const section = document.createElement("section");
  section.className = "report-section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.appendChild(heading);
  root.appendChild(section);
  return section;
}

function addReportTable(section, headers, rows) {
  const table = document.createElement("table");
  table.className = "report-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((text) => {
    const cell = document.createElement("th");
    cell.textContent = text;
    headerRow.appendChild(cell);
  });
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    row.forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = String(text ?? "");
      tableRow.appendChild(cell);
    });
    body.appendChild(tableRow);
  });
  table.appendChild(body);
  section.appendChild(table);
}

function buildBusinessReport(overview, performance) {
  const root = document.getElementById("business-report-content");
  root.textContent = "";
  const title = document.createElement("h1");
  title.className = "report-title";
  title.textContent = "Airline Delay Risk | Business Report";
  root.appendChild(title);
  const generated = document.createElement("p");
  generated.className = "report-generated";
  generated.textContent = `Generated ${new Date().toLocaleString()}`;
  root.appendChild(generated);

  const counts = overview.risk_counts || {};
  const summary = addReportSection(root, "Executive summary");
  const summaryText = document.createElement("p");
  summaryText.textContent = `${overview.total_predictions || 0} saved predictions are available. Risk counts: ${counts["Low Risk"] || 0} Low, ${counts["Moderate Risk"] || 0} Moderate, and ${counts["High Risk"] || 0} High. These are model estimates for operational planning, not observed delay outcomes or guaranteed reductions in delays.`;
  summary.appendChild(summaryText);

  const distribution = addReportSection(root, "Risk distribution");
  addReportTable(distribution, ["Predicted category", "Saved records"], [
    ["Low Risk", counts["Low Risk"] || 0],
    ["Moderate Risk", counts["Moderate Risk"] || 0],
    ["High Risk", counts["High Risk"] || 0],
  ]);
  const airlineBreakdown = overview.risk_by_airline || [];
  const airportBreakdown = overview.risk_by_airport || [];
  if (airlineBreakdown.length) {
    const airlineTitle = document.createElement("h3");
    airlineTitle.textContent = "Risk counts by airline";
    distribution.appendChild(airlineTitle);
    addReportTable(distribution, ["Airline", "Low", "Moderate", "High", "Total"], airlineBreakdown.map((row) => [
      airlineName(row.carrier), row["Low Risk"], row["Moderate Risk"], row["High Risk"], row.total,
    ]));
  }
  if (airportBreakdown.length) {
    const airportTitle = document.createElement("h3");
    airportTitle.textContent = "Risk counts by airport";
    distribution.appendChild(airportTitle);
    addReportTable(distribution, ["Airport", "Low", "Moderate", "High", "Total"], airportBreakdown.map((row) => [
      row.airport, row["Low Risk"], row["Moderate Risk"], row["High Risk"], row.total,
    ]));
  }

  const highRisk = addReportSection(root, "High-risk airline and airport cases");
  const highCases = overview.high_risk_cases || [];
  if (highCases.length) {
    addReportTable(highRisk, ["Airline", "Airport", "Period", "Scheduled arrivals", "Risk"], highCases.map((record) => [
      airlineName(record.carrier), record.airport, `${MONTH_SHORT[(Number(record.month) || 1) - 1]} ${record.year}`,
      Number(record.arr_flights || 0).toLocaleString(), record.prediction_label,
    ]));
    if (overview.high_risk_cases_truncated) {
      const truncated = document.createElement("p");
      truncated.className = "report-muted";
      truncated.textContent = "Showing the 50 most recent high-risk records.";
      highRisk.appendChild(truncated);
    }
  } else {
    const empty = document.createElement("p");
    empty.textContent = "No high-risk saved records are available.";
    highRisk.appendChild(empty);
  }

  const airportOverview = addReportSection(root, "Airport risk overview");
  const scope = document.createElement("p");
  scope.className = "report-scope";
  scope.textContent = `${overview.heatmap_method} Filter: ${airlineName(overview.selected_carrier)}; year ${overview.selected_year ?? "not selected"}.`;
  airportOverview.appendChild(scope);
  const heatmap = overview.heatmap || [];
  if (heatmap.length) {
    addReportTable(airportOverview, ["Airport", "Month", "Predicted risk", "Scheduled arrivals", "Latest saved"], heatmap.map((record) => [
      record.airport, MONTH_SHORT[(Number(record.month) || 1) - 1], record.prediction_label,
      Number(record.arr_flights || 0).toLocaleString(), record.created_at || "Unavailable",
    ]));
  } else {
    const empty = document.createElement("p");
    empty.textContent = "Insufficient saved predictions for this airline/year heatmap selection.";
    airportOverview.appendChild(empty);
  }

  const comparisons = addReportSection(root, "Airline comparison");
  if (airlineComparison) {
    const comparisonScope = document.createElement("p");
    comparisonScope.textContent = `Same current-model inputs: ${airlineComparison.scope.airport}, ${MONTH_SHORT[airlineComparison.scope.month - 1]} ${airlineComparison.scope.year}, ${Number(airlineComparison.scope.arr_flights).toLocaleString()} scheduled arrivals.`;
    comparisons.appendChild(comparisonScope);
    addReportTable(comparisons, ["Airline", "Current predicted risk", "Low probability", "Moderate probability", "High probability", "Exact-match history"], airlineComparison.comparisons.map((item) => {
      const probabilities = Object.fromEntries(item.probabilities.map((probability) => [probability.label, probability.probability]));
      return [item.carrier_name, item.prediction.label, percent(probabilities["Low Risk"] || 0), percent(probabilities["Moderate Risk"] || 0), percent(probabilities["High Risk"] || 0), item.historical_record_count];
    }));
    const note = document.createElement("p");
    note.textContent = "Current predictions are separate from historical records. Exact-match historical scope uses airline, airport, month, year, and scheduled arrivals.";
    comparisons.appendChild(note);
  } else {
    const empty = document.createElement("p");
    empty.textContent = "No comparison was selected for this report.";
    comparisons.appendChild(empty);
  }

  const modelSection = addReportSection(root, "Model performance and limitations");
  if (performance.status === "available") {
    addReportTable(modelSection, ["Verified held-out test metric", "Value"], [
      ["Accuracy", `${(performance.test_accuracy * 100).toFixed(2)}%`],
      ["Macro F1", performance.test_macro_f1.toFixed(4)],
      ["Test records", Number(performance.evaluation_records).toLocaleString()],
    ]);
    const source = document.createElement("p");
    source.textContent = `${performance.evaluation_scope} Source: ${performance.source}.`;
    modelSection.appendChild(source);
    const limitations = document.createElement("ul");
    (performance.limitations || []).forEach((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      limitations.appendChild(item);
    });
    modelSection.appendChild(limitations);
  } else {
    const unavailable = document.createElement("p");
    unavailable.textContent = "Verified performance metrics are unavailable.";
    modelSection.appendChild(unavailable);
  }

  const recommendations = addReportSection(root, "Operational recommendations");
  const list = document.createElement("ul");
  document.querySelectorAll(".recommendations-list li").forEach((item) => {
    const copy = document.createElement("li");
    copy.textContent = item.textContent;
    list.appendChild(copy);
  });
  recommendations.appendChild(list);

  const notes = addReportSection(root, "Data scope and methodology");
  const note = document.createElement("p");
  note.textContent = `The report uses ${overview.total_predictions || 0} records in the local prediction history. Scheduled arrivals are not delayed-arrival counts. The app predicts monthly airline-airport risk from historical data and does not receive live weather, traffic, or airline feeds. No financial estimates are calculated.`;
  notes.appendChild(note);
}

let previousReportTitle = "";
pdfReportBtn.addEventListener("click", async () => {
  pdfReportBtn.disabled = true;
  reportStatus.textContent = "Preparing report...";
  document.getElementById("report-feedback").textContent = "Preparing report data...";
  try {
    const [overview, performanceResponse] = await Promise.all([
      fetchBusinessOverviewForReport(),
      fetch("/api/business/performance"),
    ]);
    if (!performanceResponse.ok) throw new Error("The report data could not be loaded.");
    const performance = await performanceResponse.json();
    buildBusinessReport(overview, performance);
    document.getElementById("business-report").hidden = false;
    document.body.classList.add("printing-report");
    previousReportTitle = document.title;
    document.title = "Airline Delay Risk Business Report";
    reportStatus.textContent = "Print dialog opened. Choose Save as PDF to create the report.";
    document.getElementById("report-feedback").textContent = "Print dialog opened. Choose Save as PDF to download the business report.";
    window.print();
  } catch (error) {
    reportStatus.textContent = error.message || "The report could not be prepared.";
    document.getElementById("report-feedback").textContent = error.message || "The report could not be prepared.";
  } finally {
    pdfReportBtn.disabled = false;
  }
});

window.addEventListener("afterprint", () => {
  document.body.classList.remove("printing-report");
  document.getElementById("business-report").hidden = true;
  if (previousReportTitle) document.title = previousReportTitle;
});
reportCarrier.addEventListener("change", refreshReportYears);

const VIEW_TITLES = Object.fromEntries(
  Array.from(document.querySelectorAll(".page-view")).map((view) => [view.id.replace("view-", ""), view.dataset.pageTitle]),
);

function activateView(viewName, updateHash = false) {
  const view = document.getElementById(`view-${viewName}`) ? viewName : "overview";
  document.querySelectorAll(".page-view").forEach((section) => {
    section.hidden = section.id !== `view-${view}`;
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("current-view-title").textContent = VIEW_TITLES[view] || "Overview dashboard";
  sidebar.classList.remove("sidebar-open");
  sidebarToggle.setAttribute("aria-expanded", "false");
  if (updateHash && window.location.hash !== `#${view}`) window.location.hash = view;
  document.getElementById("app-main").scrollTop = 0;
}

document.querySelectorAll(".nav-link, .shortcut-list a, .page-heading a[href^='#']").forEach((link) => {
  link.addEventListener("click", (event) => {
    const view = link.getAttribute("href").slice(1);
    if (!document.getElementById(`view-${view}`)) return;
    event.preventDefault();
    activateView(view, true);
  });
});

window.addEventListener("hashchange", () => activateView(window.location.hash.slice(1)));
sidebarToggle.addEventListener("click", () => {
  const open = sidebar.classList.toggle("sidebar-open");
  sidebarToggle.setAttribute("aria-expanded", String(open));
});
activateView(window.location.hash.slice(1) || "overview");
refreshReportYears();

historyRiskFilter.addEventListener("change", () => {
  historyOffset = 0;
  fetchHistoryData();
});
historySearch.addEventListener("input", () => {
  historyOffset = 0;
  fetchHistoryData();
});
historyPrev.addEventListener("click", () => {
  historyOffset = Math.max(0, historyOffset - HISTORY_PAGE_SIZE);
  fetchHistoryData();
});
historyNext.addEventListener("click", () => {
  historyOffset += HISTORY_PAGE_SIZE;
  fetchHistoryData();
});
heatmapCarrier.addEventListener("change", () => {
  heatmapYear.value = "";
  fetchBusinessOverview();
});
heatmapYear.addEventListener("change", fetchBusinessOverview);

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
        historyOffset = 0;
        await fetchHistoryData();
        await fetchBusinessOverview();
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
fetchBusinessOverview();
fetchModelPerformance();
