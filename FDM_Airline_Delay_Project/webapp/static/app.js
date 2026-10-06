// Stage 10 - Frontend logic: validates the form, calls the Flask backend and shows the result.

const FIELDS = ["carrier", "airport", "month", "year", "arr_flights"];
const GAUGE_LENGTH = 2 * Math.PI * 52;   // circumference of the gauge circle (r = 52)
const ALERT_ICON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>' +
  '<path d="M12 9v4M12 17h.01"/></svg>';

const form = document.getElementById("risk-form");
const submitBtn = document.getElementById("submit-btn");
const submitText = submitBtn.querySelector(".btn-text");
const airportInput = document.getElementById("airport");
const airportName = document.getElementById("airport-name");
const typicalBox = document.getElementById("typical");
const typicalText = document.getElementById("typical-text");
const typicalBtn = document.getElementById("typical-btn");

// code -> name of every airport the model knows (sent by the server in the page)
const AIRPORTS = Object.fromEntries(JSON.parse(document.getElementById("airport-data").textContent));
const AIRPORT_HELP = airportName.textContent;

const yearInput = document.getElementById("year");
const YEAR_MIN = Number(yearInput.min);
const YEAR_MAX = Number(yearInput.max);
const FLIGHTS_MAX = Number(document.getElementById("arr_flights").max);

let typicalValue = null;

// ---------------------------------------------------------------- backend status in the top bar

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
checkStatus();

// ---------------------------------------------------------------- field errors

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

// ---------------------------------------------------------------- read and check the form

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

// Same rules as the backend, so most mistakes are shown before anything is sent
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

// ---------------------------------------------------------------- helpers while typing

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

// Ask the backend for the usual number of monthly arrivals of this airline at this airport
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
    // Ignore the answer if the user changed the fields while waiting
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
    // The hint is optional, so a failed request is ignored
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

// ---------------------------------------------------------------- show the result

const percent = (p) => `${Math.round(p * 100)}%`;

function showResult(data) {
  const p = data.prediction;

  document.getElementById("risk-hero").className = `risk-hero ${p.level}`;
  document.getElementById("result-label").textContent = p.label;
  document.getElementById("result-confidence").textContent = percent(p.confidence);
  document.getElementById("result-meaning").textContent =
    p.meaning.charAt(0).toUpperCase() + p.meaning.slice(1) + ".";
  document.getElementById("result-summary").textContent = data.summary;
  document.getElementById("result-action").textContent = p.recommended_action;

  // Probability bars
  const bars = document.getElementById("result-bars");
  bars.textContent = "";
  data.probabilities.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `<span></span><div class="bar-track"><div class="bar-fill ${item.level}"></div></div><span class="bar-value"></span>`;
    row.children[0].textContent = item.label;
    row.querySelector(".bar-value").textContent = percent(item.probability);
    row.querySelector(".bar-fill").dataset.width = percent(item.probability);
    bars.append(row);
  });

  // Warnings
  const warnings = document.getElementById("result-warnings");
  warnings.textContent = "";
  data.warnings.forEach((w) => {
    const div = document.createElement("div");
    div.className = "warning";
    div.innerHTML = ALERT_ICON;
    const span = document.createElement("span");
    span.textContent = w;
    div.append(span);
    warnings.append(div);
  });
  warnings.hidden = data.warnings.length === 0;

  // Detail tiles
  const i = data.input;
  const details = {
    Airline: `${i.carrier_name} (${i.carrier})`,
    Airport: `${i.airport_name} (${i.airport})`,
    Period: `${i.month_name} ${i.year} · ${i.season}`,
    "Scheduled arrivals": i.arr_flights.toLocaleString(),
  };
  const grid = document.getElementById("result-details");
  grid.textContent = "";
  Object.entries(details).forEach(([k, v]) => {
    const tile = document.createElement("div");
    tile.className = "detail";
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = k;
    value.textContent = v;
    tile.append(label, value);
    grid.append(tile);
  });

  // Show the result, then animate the gauge and bars from zero
  const gauge = document.getElementById("gauge-fill");
  gauge.style.strokeDashoffset = GAUGE_LENGTH;
  document.getElementById("result-empty").hidden = true;
  const result = document.getElementById("result");
  result.hidden = false;
  result.style.animation = "none";
  void result.offsetWidth;          // restart the fade-in animation
  result.style.animation = "";

  requestAnimationFrame(() => requestAnimationFrame(() => {
    gauge.style.strokeDashoffset = GAUGE_LENGTH * (1 - p.confidence);
    bars.querySelectorAll(".bar-fill").forEach((b) => { b.style.width = b.dataset.width; });
  }));

  // On small screens the result is below the form, so scroll to it
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

// ---------------------------------------------------------------- submit

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();

  const input = readForm();
  const errors = validate(input);
  if (Object.keys(errors).length > 0) {
    showErrors(errors);
    return;
  }

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
    } else {
      hideResult();
      showErrors(data.errors || {});
      if (!FIELDS.some((f) => data.errors && data.errors[f])) setError("form", data.message || "Request failed.");
    }
  } catch {
    hideResult();
    setError("form", "Could not reach the prediction service. Make sure the server is running and try again.");
  } finally {
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
