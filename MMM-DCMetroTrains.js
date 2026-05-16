/* global Module */

const LINE_ORDER = {
  RD: 1,
  OR: 2,
  SV: 3,
  BL: 4,
  YL: 5,
  GR: 6,
  NA: 99
};

function normalizeList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return [String(value).trim()].filter(Boolean);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
  }

  return Boolean(value);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function timeToMinutes(value) {
  const match = /^([0-1]\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim());
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

const SEVERITY_RANK = {
  all: 0,
  advisory: 1,
  major: 2,
  critical: 3
};

function sortCopy(array, compareFn) {
  return array.slice(0).sort(compareFn);
}

function normalizeLineCode(code, fallback) {
  return String(code || fallback || "NA").toUpperCase();
}

function calculateLineWeight(lineCode, customOrder) {
  const normalizedLine = normalizeLineCode(lineCode);
  const index = customOrder.indexOf(normalizedLine);
  if (index >= 0) {
    return index + 1;
  }

  return LINE_ORDER[String(lineCode || "NA").toUpperCase()] || 90;
}

function createPredictionGroups(predictions, lineOrder, getLineWeightFn) {
  const grouped = {};
  const customOrder = normalizeList(lineOrder).map((entry) => entry.toUpperCase());

  predictions.forEach((prediction) => {
    const line = normalizeLineCode(prediction.line);
    if (!grouped[line]) {
      grouped[line] = [];
    }

    grouped[line].push(prediction);
  });

  return Object.keys(grouped)
    .sort((a, b) => getLineWeightFn(a, customOrder) - getLineWeightFn(b, customOrder))
    .map((line) => ({
      line,
      predictions: sortCopy(grouped[line], (a, b) => {
        if (a.minutesSort !== b.minutesSort) {
          return a.minutesSort - b.minutesSort;
        }

        return a.destination.localeCompare(b.destination);
      })
    }));
}

function isEmpty(array) {
  return !array || !array.length;
}

function isNotEmpty(array) {
  return array && array.length > 0;
}

const NA_LINE = "NA";

function normalizeLineOrderToUpperCase(lineOrder) {
  return normalizeList(lineOrder).map((entry) => entry.toUpperCase());
}

function normalizeLowercase(value, fallback) {
  return String(value || fallback || "").toLowerCase();
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text != null) {
    el.textContent = text;
  }
  return el;
}
function getStaleClass(isStale) {
  return isStale ? "dcmetro__updated--stale" : "";
}

function getStatusClassName(statusClass) {
  return `dcmetro__status--${statusClass}`;
}

function getClassForSeverity(severity) {
  return `dcmetro__incident--${severity}`;
}

function getRowAlertClass(alerts) {
  return isNotEmpty(alerts) ? "dcmetro__row--alert" : "";
}

function buildForecastChip(prediction) {
  return makeEl("span", classNames("dcmetro__forecastChip", `dcmetro__forecastChip--${prediction.statusClass}`), `${prediction.line} ${prediction.destination} ${prediction.displayMinutes}`);
}

function limitArray(array, maxLength) {
  return array.slice(0, Math.max(1, maxLength));
}

function getScrollDuration(configSpeed, minSpeed = 8) {
  return `${Math.max(minSpeed, configSpeed)}s`;
}
Module.register("MMM-DCMetroTrains", {
  defaults: {
    apiKey: "",
    stationCodes: ["A01"],
    refreshInterval: 30000,
    incidentsRefreshInterval: 120000,
    retryDelay: 15000,
    stationRotationInterval: 20000,
    maxRows: 8,
    summaryCount: 3,
    lineFilter: [],
    destinationIncludes: [],
    alertRules: [],
    hideWhenNoTrains: false,
    onlyShowAlertsForVisibleLines: false,
    maxIncidentRows: 3,
    incidentScroll: false,
    incidentScrollSpeed: 28,
    incidentScrollSpeedMin: 8,
    etaColorMode: "status",
    carsColorMode: "wmata",
    statusThresholds: {
      watchMinutes: 8,
      delayedMinutes: 15,
      criticalMinutes: 25
    },
    stationTitleFormat: "name",
    lineOrder: ["RD", "OR", "SV", "BL", "YL", "GR", "NA"],
    quietHours: {
      weekdays: [
        { start: "22:00", end: "23:59" },
        { start: "00:00", end: "05:30" }
      ],
      weekends: [
        { start: "23:00", end: "23:59" },
        { start: "00:00", end: "06:30" }
      ]
    },
    blinkOnCritical: false,
    updateJitterMs: 0,
    debugOverlay: false,
    fallbackMessage: "No upcoming trains.",
    fontScale: 1,
    showIncidents: true,
    incidentSeverityFilter: "all",
    showHeader: true,
    showBorders: true,
    showBackground: true,
    showConditions: true,
    showLastUpdated: true,
    showFreshnessChip: true,
    showCars: true,
    showCarHighlights: false,
    showDirection: true,
    showStationCode: false,
    showStatus: true,
    showNextSummary: true,
    showMetroBus: false,
    metroBusOnlyMode: false,
    showMetroBusHeader: true,
    metroBusStops: [],
    metroBusMaxRows: 5,
    metroBusRouteFilter: [],
    staleAfterSeconds: 180,
    rotateStations: true,
    groupByLine: true,
    commuteMode: true,
    commuteSchedule: {
      weekdays: [
        { start: "06:00", end: "09:30" },
        { start: "15:30", end: "19:00" }
      ],
      weekends: []
    },
    autoCompact: true,
    commuteMaxRows: 5,
    compact: false,
    animationSpeed: 1000
  },

  start() {
    this.instanceId = this.identifier || this.name;
    this.dataState = {
      stations: [],
      busStops: [],
      incidents: [],
      fetchedAt: null,
      error: null,
      errorAt: null
    };
    this.currentStationIndex = 0;
    this.rotationTimer = null;
    this.retryTimer = null;
    this.loaded = false;
    this.hasRenderedData = false;

    this.sendSocketNotification("DC_METRO_CONFIG", {
      ...this.config,
      instanceId: this.instanceId
    });
    this.startRotation();
  },

  stop() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  },

  getStyles() {
    return ["MMM-DCMetroTrains.css"];
  },

  getDom() {
    const wrapper = document.createElement("div");
    const isMetroBusOnly = this.isMetroBusOnlyMode();
    const isCommuteTime = this.isCommuteTime();
    const isQuietHours = this.isQuietHours();
    const isCompact = isMetroBusOnly || this.config.compact || (this.config.autoCompact && isCommuteTime);
    const showBorders = parseBoolean(this.config.showBorders, true);
    const showBackground = parseBoolean(this.config.showBackground, true);
    const shouldBlinkCritical = this.config.blinkOnCritical && this.hasCriticalIncident();
    const showMetroBus = parseBoolean(this.config.showMetroBus, false) || isMetroBusOnly;
    wrapper.className = classNames(
      "dcmetro",
      isCompact && "dcmetro--compact",
      isMetroBusOnly && "dcmetro--busOnly",
      isCommuteTime && "dcmetro--commute",
      isQuietHours && "dcmetro--quiet",
      shouldBlinkCritical && "dcmetro--criticalBlink",
      !showBorders && "dcmetro--noBorders",
      !showBackground && "dcmetro--noBackground"
    );
    wrapper.style.fontSize = `${this.getConfigNumber("fontScale", 1)}em`;

    if (!showBorders) {
      wrapper.style.border = "none";
      wrapper.style.boxShadow = "none";
      wrapper.style.outline = "none";
    }

    if (!showBackground) {
      wrapper.style.background = "transparent";
      wrapper.style.backdropFilter = "none";
    }

    if (!this.loaded && !this.dataState.error) {
      wrapper.classList.add("dimmed", "light", "small");
      wrapper.textContent = isMetroBusOnly ? "Loading Metrobus data..." : "Loading DC Metro train data...";
      return wrapper;
    }

    if (this.isErrorRecent()) {
      wrapper.classList.add("bright", "small", "dcmetro__error");
      wrapper.textContent = this.dataState.error;
      return wrapper;
    }

    if (!isMetroBusOnly && !this.dataState.stations.length) {
      wrapper.classList.add("dimmed", "small");
      wrapper.textContent = this.getFallbackMessage("No arrivals available for configured stations.");
      return wrapper;
    }

    if (!isMetroBusOnly) {
      const summary = this.buildSummaryStrip(isCommuteTime, isCompact, isQuietHours);
      if (summary) {
        wrapper.appendChild(summary);
      }

      this.getVisibleStations().forEach((station) => {
        wrapper.appendChild(this.buildStationCard(station, isCompact));
      });

      if (this.config.showIncidents) {
        wrapper.appendChild(this.buildIncidents());
      }
    }

    if (showMetroBus) {
      wrapper.appendChild(this.buildMetroBusSection());
    }

    if (this.config.debugOverlay) {
      wrapper.appendChild(this.buildDebugOverlay(isCommuteTime, isQuietHours, isCompact));
    }

    if (this.config.showLastUpdated && this.dataState.fetchedAt) {
      const freshness = this.extractFreshness(this.dataState.fetchedAt);
      wrapper.appendChild(makeEl("div", classNames("dcmetro__updated xsmall dimmed", getStaleClass(freshness.isStale)), `Updated ${this.relativeTime(this.dataState.fetchedAt)}`));
    }

    return wrapper;
  },

  buildTableHeader(columns) {
    const head = makeEl("thead");
    const headRow = makeEl("tr");
    columns.forEach((label) => {
      headRow.appendChild(makeEl("th", null, label));
    });
    head.appendChild(headRow);
    return head;
  },

  buildSummaryChip(labelText, valueText, extraClass) {
    const chip = makeEl("div", classNames("dcmetro__summaryChip", extraClass));
    chip.appendChild(makeEl("span", "dcmetro__summaryLabel", labelText));
    chip.appendChild(makeEl("span", null, valueText));
    return chip;
  },

  buildSummaryStrip(isCommuteTime, isCompact, isQuietHours) {
    const station = this.getActiveStation();
    if (!station) {
      return null;
    }

    const summary = makeEl("div", "dcmetro__summary");
    const freshness = this.extractFreshness(this.dataState.fetchedAt);

    if (this.config.showNextSummary && !isQuietHours) {
      const next = station.nextSummary || [];
      if (next.length) {
        summary.appendChild(this.buildSummaryChip("Next", next.map((item) => `${item.line} ${item.destination} ${item.displayMinutes}`).join(" • ")));
      }
    }

    if (this.config.showFreshnessChip && this.dataState.fetchedAt) {
      summary.appendChild(this.buildSummaryChip(freshness.isStale ? "Stale" : "Fresh", this.relativeTime(this.dataState.fetchedAt), freshness.isStale ? "dcmetro__summaryChip--stale" : null));
    }

    if (isCommuteTime && !isQuietHours) {
      summary.appendChild(this.buildSummaryChip("Commute", isCompact ? "Compact mode" : "Peak window", isCompact ? "dcmetro__summaryChip--compact" : null));
    }

    return summary.childNodes.length ? summary : null;
  },

  buildStationCard(station, isCompact) {
    const card = document.createElement("section");
    const freshness = this.extractFreshness(this.dataState.fetchedAt);
    card.className = classNames("dcmetro__stationCard", isNotEmpty(ensureArray(station.alerts)) && "dcmetro__stationCard--alert", freshness.isStale && "dcmetro__stationCard--stale");

    if (this.config.showHeader) {
      card.appendChild(this.buildHeader(station));
    }

    if (this.config.showConditions) {
      card.appendChild(this.buildConditionsRow(station));
    }

    if (isNotEmpty(ensureArray(station.alerts))) {
      card.appendChild(this.buildAlertBanner(station.alerts));
    }

    if (this.config.showNextSummary && isNotEmpty(station.nextSummary)) {
      card.appendChild(this.buildForecastSummary(station.nextSummary));
    }

    card.appendChild(this.buildArrivals(station, isCompact));
    return card;
  },

  buildHeader(station) {
    const header = makeEl("div", "dcmetro__header");
    header.appendChild(makeEl("div", "dcmetro__station", this.formatStationTitle(station)));
    const meta = makeEl("div", "dcmetro__meta");

    if (this.config.showStationCode) {
      meta.appendChild(makeEl("span", "dcmetro__chip", station.code));
    }

    if (this.dataState.stations.length > 1 && this.config.rotateStations) {
      meta.appendChild(makeEl("span", "dcmetro__chip", `${this.currentStationIndex + 1}/${this.dataState.stations.length}`));
    }

    if (station.profile.compact) {
      meta.appendChild(makeEl("span", "dcmetro__chip", "Compact"));
    }

    header.appendChild(meta);
    return header;
  },

  buildConditionsRow(station) {
    const conditions = makeEl("div", "dcmetro__conditions");
    const conditionText = station.conditionText || "Unknown status";
    const conditionClass = station.conditionClass || "dcmetro__condition--normal";
    conditions.appendChild(makeEl("div", classNames("dcmetro__condition", conditionClass), conditionText));

    return conditions;
  },

  buildAlertBanner(alerts) {
    return this.buildAlerts(alerts);
  },

  buildForecastSummary(nextSummary) {
    if (isEmpty(nextSummary)) {
      return null;
    }
    const forecast = makeEl("div", "dcmetro__forecast");
    const count = Math.max(1, this.config.summaryCount || 3);
    limitArray(nextSummary, count).forEach((prediction) => {
      forecast.appendChild(buildForecastChip(prediction));
    });
    return forecast;
  },

  buildArrivals(station, isCompact) {
    const groupByLine = this.getStationEffectiveSetting(station, "groupByLine", this.config.groupByLine);
    const includeLine = !groupByLine;
    const rows = limitArray(station.predictions, this.getStationEffectiveRows(station, isCompact));

    if (isEmpty(rows)) {
      return makeEl("div", "dcmetro__empty dimmed", this.getFallbackMessage("No upcoming trains."));
    }

    if (groupByLine) {
      const grouped = this.groupPredictionsByLine(rows);
      const container = makeEl("div", "dcmetro__groups");

      grouped.forEach((group) => {
        const section = makeEl("section", "dcmetro__group");
        const groupHeader = makeEl("div", "dcmetro__groupHeader");
        groupHeader.appendChild(this.buildLineBadge(group.line));
        groupHeader.appendChild(makeEl("span", "dcmetro__groupMeta dimmed xsmall", `${group.predictions.length} trains`));
        section.appendChild(groupHeader);
        section.appendChild(this.buildPredictionTable(group.predictions, includeLine, true));
        container.appendChild(section);
      });

      return container;
    }

    return this.buildPredictionTable(rows, includeLine, false);
  },

  buildPredictionTable(predictions, includeLine, groupedMode) {
    const table = makeEl("table", classNames("dcmetro__table small", groupedMode && "dcmetro__table--grouped", !groupedMode && "dcmetro__table--flat"));

    const columns = [];
    if (includeLine) {
      columns.push("Line");
    }
    columns.push("Destination");
    if (this.config.showDirection) {
      columns.push("Dir");
    }
    columns.push("Min");
    if (this.config.showCars) {
      columns.push("Cars");
    }
    if (this.config.showStatus) {
      columns.push("Status");
    }

    table.appendChild(this.buildTableHeader(columns));

    const body = makeEl("tbody");

    predictions.forEach((prediction) => {
      const row = makeEl("tr");
      row.className = classNames(`dcmetro__row dcmetro__row--${prediction.statusClass}`, getRowAlertClass(prediction.alerts));

      if (includeLine) {
        const lineCell = makeEl("td");
        lineCell.appendChild(this.buildLineBadge(prediction.line));
        row.appendChild(lineCell);
      }

      row.appendChild(this.buildDestinationCell(prediction.destination));

      if (this.config.showDirection) {
        row.appendChild(this.buildDirectionCell(prediction));
      }

      row.appendChild(this.buildEtaCell(prediction));

      if (this.config.showCars) {
        row.appendChild(this.buildCarsCell(prediction));
      }

      if (this.config.showStatus) {
        row.appendChild(this.buildStatusCell(prediction));
      }

      body.appendChild(row);
    });

    table.appendChild(body);
    return table;
  },

  buildLineBadge(lineCode) {
    const line = String(lineCode || NA_LINE).toLowerCase();
    return makeEl("span", `dcmetro__line dcmetro__line--${line}`, lineCode || "--");
  },

  buildIncidents() {
    const container = makeEl("div", "dcmetro__incidents");
    const incidents = this.getFilteredIncidentsForDisplay();

    if (this.config.incidentScroll) {
      container.classList.add("dcmetro__incidents--scroll");
      container.style.setProperty("--dcmetro-incident-scroll-duration", this.getIncidentScrollDuration());
    }

    if (isEmpty(incidents)) {
      container.classList.add("xsmall", "dimmed");
      container.textContent = "No active Metro service alerts.";
      return container;
    }

    limitArray(incidents, this.getMaxIncidentRows()).forEach((incident) => {
      const item = makeEl("div", classNames("dcmetro__incident", getClassForSeverity(incident.severity)));
      item.appendChild(makeEl("span", classNames("dcmetro__incidentSeverity", getClassForSeverity(incident.severity)), incident.severityLabel));

      if (incident.dateRangeText) {
        item.appendChild(makeEl("span", "dcmetro__incidentRange", incident.dateRangeText));
      }

      item.appendChild(makeEl("span", null, `${incident.linesText}: ${incident.description}`));
      container.appendChild(item);
    });

    return container;
  },

  buildMetroBusSection() {
    const section = makeEl("section", "dcmetro__bus");

    if (this.config.showMetroBusHeader) {
      section.appendChild(makeEl("div", "dcmetro__busHeader", "Metrobus"));
    }

    const stops = ensureArray(this.dataState.busStops);
    if (isEmpty(stops)) {
      section.appendChild(makeEl("div", "dcmetro__empty dimmed", "No Metrobus stops configured."));
      return section;
    }

    stops.forEach((stop) => {
      section.appendChild(this.buildMetroBusStopCard(stop));
    });

    return section;
  },

  buildMetroBusStopCard(stop) {
    const card = makeEl("div", "dcmetro__busStop");
    card.appendChild(makeEl("div", "dcmetro__busStopName", stop.name || stop.stopId));

    const predictions = ensureArray(stop.predictions);
    if (isEmpty(predictions)) {
      card.appendChild(makeEl("div", "dcmetro__empty dimmed", "No upcoming buses."));
      return card;
    }

    const table = makeEl("table", "dcmetro__table small dcmetro__busTable");
    table.appendChild(this.buildTableHeader(["Route", "Destination", "Min"]));

    const body = makeEl("tbody");
    predictions.forEach((prediction) => {
      const row = makeEl("tr");
      row.appendChild(makeEl("td", "dcmetro__busRoute", prediction.route || "--"));
      row.appendChild(makeEl("td", "dcmetro__dest", prediction.destination || "Unknown"));
      row.appendChild(makeEl("td", "dcmetro__eta", prediction.displayMinutes || "--"));
      body.appendChild(row);
    });

    table.appendChild(body);
    card.appendChild(table);
    return card;
  },

  getVisibleStations() {
    let visibleStations = this.dataState.stations;
    if (this.config.hideWhenNoTrains) {
      visibleStations = visibleStations.filter((station) => isNotEmpty(ensureArray(station.predictions)));
    }

    if (isEmpty(visibleStations)) {
      return [];
    }

    if (!this.config.rotateStations || visibleStations.length === 1) {
      return visibleStations;
    }

    const safeIndex = this.currentStationIndex % visibleStations.length;
    return [visibleStations[safeIndex]];
  },

  getActiveStation() {
    const stations = this.getVisibleStations();
    return stations.length ? stations[0] : null;
  },

  startRotation() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }

    if (this.isMetroBusOnlyMode()) {
      return;
    }

    if (!this.config.rotateStations || this.config.stationRotationInterval < 2000) {
      return;
    }

    this.rotationTimer = setInterval(() => {
      const stationPool = this.config.hideWhenNoTrains
        ? this.dataState.stations.filter((station) => isNotEmpty(ensureArray(station.predictions)))
        : this.dataState.stations;

      if (stationPool.length < 2) {
        return;
      }

      this.currentStationIndex = (this.currentStationIndex + 1) % stationPool.length;
      this.updateDom(this.hasRenderedData ? 0 : this.config.animationSpeed);
      this.hasRenderedData = true;
    }, this.config.stationRotationInterval);
  },

  socketNotificationReceived(notification, payload) {
    const data = payload || {};

    if (data.instanceId && data.instanceId !== this.instanceId) {
      return;
    }

    if (notification === "DC_METRO_DATA") {
      this.loaded = true;
      this.dataState = {
        stations: data.stations || [],
        busStops: data.busStops || [],
        incidents: data.incidents || [],
        fetchedAt: data.fetchedAt || Date.now(),
        error: null,
        errorAt: null
      };

      if (this.currentStationIndex >= this.dataState.stations.length) {
        this.currentStationIndex = 0;
      }

      this.updateDom(this.hasRenderedData ? 0 : this.config.animationSpeed);
      this.hasRenderedData = true;
      return;
    }

    if (notification === "DC_METRO_ERROR") {
      this.loaded = true;
      this.dataState.error = (data && data.error) || payload || "Unable to load Metro train data.";
      this.dataState.errorAt = Date.now();
      this.updateDom(this.hasRenderedData ? 0 : this.config.animationSpeed);
      this.hasRenderedData = true;
    }
  },

  groupPredictionsByLine(predictions) {
    return createPredictionGroups(predictions, this.config.lineOrder, this.getLineWeight.bind(this));
  },

  getLineWeight(lineCode, customOrder) {
    const order = customOrder || normalizeLineOrderToUpperCase(this.config.lineOrder);
    return calculateLineWeight(lineCode, order);
  },

  getEtaClass(prediction) {
    const mode = this.getConfigString("etaColorMode", "status");
    if (mode === "off") {
      return "";
    }

    if (mode === "gradient") {
      const map = { boarding: "boarding", arriving: "boarding", alert: "critical", critical: "critical", delayed: "delayed", watch: "watch" };
      return `dcmetro__eta--${map[prediction.statusClass] || "normal"}`;
    }

    return `dcmetro__eta--${prediction.statusClass}`;
  },

  getCarsClassForMode(prediction) {
    const mode = parseBoolean(this.config.showCarHighlights, false)
      ? "capacity"
      : this.getConfigString("carsColorMode", "wmata");
    if (mode === "off") {
      return "dcmetro__cars--off";
    }

    if (mode === "capacity") {
      return prediction.carsClass || "dcmetro__cars--unknown";
    }

    if (mode === "wmata") {
      const wmataMap = {
        "dcmetro__cars--high": "dcmetro__cars--wmata-high",
        "dcmetro__cars--medium": "dcmetro__cars--wmata-medium",
        "dcmetro__cars--low": "dcmetro__cars--wmata-low"
      };
      return wmataMap[prediction.carsClass] || "dcmetro__cars--unknown";
    }

    // Default for unknown modes
    return "dcmetro__cars--unknown";
  },

  buildEtaCell(prediction) {
    return makeEl("td", classNames("dcmetro__eta", this.getEtaClass(prediction)), prediction.displayMinutes);
  },

  buildCarsCell(prediction) {
    return makeEl("td", classNames("dcmetro__cars", this.getCarsClassForMode(prediction)), prediction.carsLabel);
  },

  buildStatusCell(prediction) {
    return makeEl("td", classNames("dcmetro__status", getStatusClassName(prediction.statusClass)), prediction.statusLabel);
  },

  buildDirectionCell(prediction) {
    return makeEl("td", "dcmetro__dir dimmed", prediction.direction);
  },

  buildDestinationCell(destination) {
    return makeEl("td", "dcmetro__dest", destination);
  },

  buildAlerts(alerts, maxCount = 3) {
    const banner = makeEl("div", "dcmetro__alerts");
    limitArray(alerts, maxCount).forEach((alert) => {
      banner.appendChild(makeEl("div", `dcmetro__alert dcmetro__alert--${alert.severity}`, alert.message));
    });
    return banner;
  },

  getMaxIncidentRows() {
    return Math.max(1, this.getConfigNumber("maxIncidentRows", 3));
  },

  getIncidentScrollDuration() {
    const speed = this.getConfigNumber("incidentScrollSpeed", 28);
    const minSpeed = this.getConfigNumber("incidentScrollSpeedMin", 8);
    return getScrollDuration(speed, minSpeed);
  },

  getFilteredIncidentsForDisplay() {
    const incidents = ensureArray(this.dataState.incidents).filter((incident) => this.matchesSeverityFilter(incident.severity));

    if (!this.config.onlyShowAlertsForVisibleLines) {
      return incidents;
    }

    const visibleLines = new Set();
    this.getVisibleStations().forEach((station) => {
      ensureArray(station.predictions).forEach((prediction) => {
        visibleLines.add(normalizeLineCode(prediction.line, ""));
      });
    });

    if (!visibleLines.size) {
      return [];
    }

    const filtered = incidents.filter((incident) => {
      const lines = incident.lineCodes || [];
      if (isEmpty(lines)) {
        return true;
      }
      return lines.some((line) => visibleLines.has(normalizeLineCode(line, "")));
    });

    return filtered;
  },

  hasCriticalIncident() {
    return this.getFilteredIncidentsForDisplay().some((incident) => this.isCriticalSeverity(incident.severity));
  },

  isQuietHours() {
    const quietHours = this.config.quietHours || {};
    const now = new Date();
    return this.matchesAnyWindow(now, quietHours);
  },

  matchesAnyWindow(now, schedule) {
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    const raw = isWeekend ? schedule.weekends : schedule.weekdays;
    const windows = Array.isArray(raw) ? raw : [];

    return windows.some((window) => this.matchesWindow(now, window));
  },

  isErrorRecent() {
    const ERROR_TIMEOUT_MS = 300000; // 5 minutes
    if (!this.dataState.error || !this.dataState.errorAt) {
      return false;
    }

    return (Date.now() - this.dataState.errorAt) < ERROR_TIMEOUT_MS;
  },

  formatStationTitle(station) {
    const mode = this.getConfigString("stationTitleFormat", "name");
    const name = station.displayName || station.name || station.code;
    const code = station.code || "";

    if (mode === "code") {
      return code || name;
    }

    if (mode === "namewithcode") {
      return code && name ? `${name} (${code})` : name;
    }

    return name;
  },

  getFallbackMessage(defaultText) {
    const configured = String(this.config.fallbackMessage || "").trim();
    return configured || defaultText;
  },

  buildDebugOverlay(isCommuteTime, isQuietHours, isCompact) {
    const stations = this.getVisibleStations();
    const rows = stations.reduce((sum, station) => sum + ensureArray(station.predictions).length, 0);
    const incidents = this.getFilteredIncidentsForDisplay().length;
    return makeEl("div", "dcmetro__debug xsmall dimmed", `Debug stations=${stations.length} rows=${rows} incidents=${incidents} commute=${isCommuteTime} quiet=${isQuietHours} compact=${isCompact} fetched=${this.dataState.fetchedAt || 0}`);
  },

  getStationEffectiveSetting(station, key, fallback) {
    if (station.profile && station.profile[key] != null) {
      return station.profile[key];
    }

    return fallback;
  },

  getStationEffectiveRows(station, isCompact) {
    const baseRows = parseNumber(station.profile.maxRows, this.config.maxRows);
    if (!this.isCommuteTime() || !isCompact) {
      return baseRows;
    }

    return clamp(Math.min(baseRows, this.getConfigNumber("commuteMaxRows", 5)), 1, baseRows);
  },

  isMetroBusOnlyMode() {
    return parseBoolean(this.config.metroBusOnlyMode, false);
  },

  matchesSeverityFilter(severity) {
    const filter = this.getConfigString("incidentSeverityFilter", "all");
    return (SEVERITY_RANK[String(severity || "advisory").toLowerCase()] || 1) >= (SEVERITY_RANK[filter] || 0);
  },

  getConfigBool(key, fallback) {
    return parseBoolean(this.config[key], fallback);
  },

  getConfigValue(key, fallback) {
    return this.config[key] != null ? this.config[key] : fallback;
  },

  getConfigString(key, fallback) {
    return String(this.config[key] || fallback || "").toLowerCase();
  },

  getConfigNumber(key, fallback) {
    return parseNumber(this.config[key], fallback);
  },

  isCriticalSeverity(severity) {
    return normalizeLowercase(severity, "") === "critical";
  },

  extractFreshness(timestamp) {
    return this.getFreshnessState(timestamp);
  },

  getFreshnessState(timestamp) {
    return {
      isStale: (Date.now() - timestamp) > this.config.staleAfterSeconds * 1000
    };
  },

  isCommuteTime() {
    if (!this.config.commuteMode) {
      return false;
    }

    const now = new Date();
    return this.matchesAnyWindow(now, this.config.commuteSchedule || {});
  },

  matchesWindow(now, window) {
    if (!window || typeof window !== "object") {
      return false;
    }

    const start = timeToMinutes(window.start);
    const end = timeToMinutes(window.end);
    if (start == null || end == null) {
      return false;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= start && currentMinutes <= end;
  },

  relativeTime(timestamp) {
    const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (deltaSeconds < 5) {
      return "just now";
    }
    if (deltaSeconds < 60) {
      return `${deltaSeconds}s ago`;
    }
    const minutes = Math.floor(deltaSeconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
});
