const NodeHelper = require("node_helper");
const https = require("node:https");

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

function lineSortWeight(lineCode) {
  return LINE_ORDER[String(lineCode || "NA").toUpperCase()] || 90;
}

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value) {
  return String(value || "").trim();
}

function limitArray(array, maxLength) {
  return array.slice(0, Math.max(1, maxLength));
}

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

function formatWeatherDisplay(weather) {
  const temperature = Math.round(Number(weather.temperature));
  const summary = weatherSummary(weather.weathercode);
  return `${Number.isFinite(temperature) ? `${temperature}°F` : "Weather"} ${summary}`.trim();
}

function normalizeLineOrderToUpperCase(lineOrder) {
  return normalizeList(lineOrder).map((entry) => entry.toUpperCase());
}

function normalizeLowercase(value, fallback) {
  return String(value || fallback || "").toLowerCase();
}

function isEmpty(array) {
  return !array || !array.length;
}

function isNotEmpty(array) {
  return array && array.length > 0;
}

const NA_LINE = "NA";
const SEVERITY_RANK = {
  all: 0,
  advisory: 1,
  major: 2,
  critical: 3
};

module.exports = NodeHelper.create({
  start() {
    this.config = null;
    this.fetchTimer = null;
    this.incidentTimer = null;
    this.retryTimer = null;
    this.stationMap = {};
    this.latestIncidents = [];
    this.latestWeather = null;
    this.latestStations = [];
    this.latestBusStops = [];
    this.stationProfiles = [];
    this.busStopProfiles = [];
    this.stationCodesByName = {};
    this.normalizedLineOrderCache = [];
  },

  stop() {
    this.stopTimers();
    this.clearRetryTimer();
  },

  validateConfig() {
    const errors = [];
    const config = this.config || {};

    if (!config.apiKey) {
      errors.push("Missing apiKey");
    }

    if (config.stationCodes != null && !Array.isArray(config.stationCodes) && typeof config.stationCodes !== "string") {
      errors.push("stationCodes must be an array or string");
    }

    if (typeof config.stationCodes === "string" && !config.stationCodes.trim()) {
      errors.push("stationCodes string cannot be empty");
    }

    if (Array.isArray(config.stationCodes)) {
      const hasInvalidEntry = config.stationCodes.some((entry) => {
        const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
        const rawCode = isObject ? entry.code || entry.stationCode || entry.id : entry;
        return !String(rawCode || "").trim();
      });

      if (hasInvalidEntry) {
        errors.push("stationCodes contains an empty or invalid station code entry");
      }
    }

    const maxRows = parseNumber(config.maxRows, null);
    if (config.maxRows != null && (!Number.isFinite(maxRows) || maxRows < 1)) {
      errors.push("maxRows must be >= 1");
    }

    const refreshInterval = parseNumber(config.refreshInterval, null);
    if (config.refreshInterval != null && (!Number.isFinite(refreshInterval) || refreshInterval < 5000)) {
      errors.push("refreshInterval must be >= 5000 ms");
    }

    const incidentsRefreshInterval = parseNumber(config.incidentsRefreshInterval, null);
    if (config.incidentsRefreshInterval != null && (!Number.isFinite(incidentsRefreshInterval) || incidentsRefreshInterval < 5000)) {
      errors.push("incidentsRefreshInterval must be >= 5000 ms");
    }

    const retryDelay = parseNumber(config.retryDelay, null);
    if (config.retryDelay != null && (!Number.isFinite(retryDelay) || retryDelay < 1000)) {
      errors.push("retryDelay must be >= 1000 ms");
    }

    if (errors.length > 0) {
      console.error("[MMM-DCMetroTrains] Config validation errors:", errors.join("; "));
      return false;
    }

    return true;
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "DC_METRO_CONFIG") {
      return;
    }

    this.config = payload || {};

    if (!this.validateConfig()) {
      this.sendSocketNotification("DC_METRO_ERROR", "Invalid MMM-DCMetroTrains configuration. Check server logs for details.");
      return;
    }

    this.stationProfiles = this.resolveStationProfiles();
    this.busStopProfiles = this.resolveMetroBusStopProfiles();
    this.normalizedLineOrderCache = normalizeLineOrderToUpperCase(this.config.lineOrder);

    this.initialize();
  },

  async initialize() {
    this.stopTimers();
    this.clearRetryTimer();

    try {
      if (this.isMetroBusOnlyMode()) {
        this.stationMap = {};
      } else {
        await this.fetchStations();
        this.validateStationProfiles();
      }
      await this.refreshPredictionsAndWeather();
      await this.refreshIncidents();
      this.scheduleNextPredictionRefresh();
      this.scheduleNextIncidentRefresh();
    } catch (error) {
      this.reportError(`DC Metro update failed: ${error.message}`);
      this.scheduleRetry();
    }
  },

  stopTimers() {
    this.clearTimer("fetchTimer");
    this.clearTimer("incidentTimer");
  },

  clearTimer(timerName) {
    if (this[timerName]) {
      clearTimeout(this[timerName]);
      this[timerName] = null;
    }
  },

  scheduleNextPredictionRefresh() {
    const interval = Math.max(5000, this.getConfigNumber("refreshInterval", 30000));
    this.fetchTimer = setTimeout(async () => {
      await this.refreshPredictionsAndWeather();
      this.scheduleNextPredictionRefresh();
    }, this.withJitter(interval));
  },

  scheduleNextIncidentRefresh() {
    const interval = Math.max(5000, this.getConfigNumber("incidentsRefreshInterval", 120000));
    this.incidentTimer = setTimeout(async () => {
      await this.refreshIncidents();
      this.scheduleNextIncidentRefresh();
    }, this.withJitter(interval));
  },

  withJitter(baseInterval) {
    const jitter = Math.max(0, this.getConfigNumber("updateJitterMs", 0));
    if (!jitter) {
      return baseInterval;
    }

    const delta = Math.floor(Math.random() * (jitter * 2 + 1)) - jitter;
    return Math.max(1000, baseInterval + delta);
  },

  clearRetryTimer() {
    this.clearTimer("retryTimer");
  },

  scheduleRetry() {
    this.clearRetryTimer();
    const retryDelay = Math.max(1000, this.getConfigNumber("retryDelay", 15000));
    this.retryTimer = setTimeout(() => this.initialize(), retryDelay);
  },

  reportError(message) {
    this.sendSocketNotification("DC_METRO_ERROR", message);
  },

  broadcastData() {
    this.lastBroadcastAt = Date.now();
    this.sendSocketNotification("DC_METRO_DATA", {
      stations: this.latestStations,
      busStops: this.latestBusStops,
      incidents: this.latestIncidents,
      weather: this.latestWeather,
      fetchedAt: this.lastBroadcastAt
    });
  },

  async refreshPredictionsAndWeather() {
    try {
      const metroBusOnly = this.isMetroBusOnlyMode();
      const [predictions, weather, busStops] = await Promise.all([
        metroBusOnly ? Promise.resolve([]) : this.fetchPredictions(),
        metroBusOnly ? Promise.resolve(null) : this.fetchWeather(),
        this.fetchMetroBusPredictions()
      ]);

      // Build complete data set before updating module state (atomic update)
      const grouped = this.groupPredictionsByStation(predictions);
      const newStations = metroBusOnly ? [] : this.buildStationPayload(grouped, this.latestIncidents, weather);

      // Update state atomically
      this.latestWeather = weather;
      this.latestBusStops = busStops;
      this.latestStations = newStations;
      this.broadcastData();
    } catch (error) {
      this.reportError(`DC Metro update failed: ${error.message}`);
      this.scheduleRetry();
    }
  },

  async refreshIncidents() {
    try {
      this.latestIncidents = await this.fetchIncidents();

      if (this.latestStations.length) {
        this.broadcastData();
      }
    } catch (error) {
      console.warn("[MMM-DCMetroTrains] Failed to refresh incidents:", error.message);
      this.latestIncidents = [];
    }
  },

  async fetchStations() {
    const url = "https://api.wmata.com/Rail.svc/json/jStations";
    const response = await this.getJson(url);
    const stations = response.Stations || [];

    this.stationMap = {};
    this.stationCodesByName = {};

    stations.forEach((station) => {
      const code = String(station.Code || "").trim();
      const name = String(station.Name || "").trim();

      if (!code) {
        return;
      }

      this.stationMap[code] = name || code;

      if (name) {
        const list = (this.stationCodesByName[name] ??= []);
        if (!list.includes(code)) {
          list.push(code);
        }
      }
    });
  },

  validateStationProfiles() {
    const validCodes = Object.keys(this.stationMap);
    const invalidProfiles = this.stationProfiles.filter(
      (profile) => !validCodes.includes(profile.code)
    );

    if (invalidProfiles.length > 0) {
      const invalidCodes = invalidProfiles.map((p) => p.code).join(", ");
      const sample = validCodes.slice(0, 5).join(", ");
      const suffix = validCodes.length > 5 ? ` ... (${validCodes.length - 5} more)` : "";
      console.warn(
        `[MMM-DCMetroTrains] Configured station code(s) not found in WMATA: ${invalidCodes}. Sample valid: ${sample}${suffix}`
      );
    }
  },

  async fetchPredictions() {
    const stationCodes = this.stationProfiles.map((station) => station.code);
    const stationSegment = stationCodes.length ? stationCodes.join(",") : "All";
    const url = `https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${stationSegment}`;
    const response = await this.getJson(url);
    return response.Trains || [];
  },

  async fetchIncidents() {
    if (!this.config.showIncidents || this.isMetroBusOnlyMode()) {
      return [];
    }

    const url = "https://api.wmata.com/Incidents.svc/json/Incidents";
    const response = await this.getJson(url);
    const incidents = response.Incidents || [];

    return incidents.map((item) => {
      const normalized = this.normalizeLines(item.LinesAffected || "");
      const severity = this.classifyIncident(item.Description || "");
      const dateRangeText = this.formatIncidentDateRange(item);

      return {
        linesText: normalized.length ? normalized.join("/") : "System",
        lineCodes: normalized,
        description: String(item.Description || "").replace(/\s+/g, " ").trim(),
        dateRangeText,
        severity: severity.severity,
        severityLabel: severity.severityLabel,
        rank: severity.rank
      };
    });
  },

  async fetchWeather() {
    const latitude = this.getConfigNumber("weatherLatitude", null);
    const longitude = this.getConfigNumber("weatherLongitude", null);

    if (!this.config.showWeather || latitude == null || longitude == null) {
      return null;
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      console.warn("[MMM-DCMetroTrains] Invalid weather coordinates: latitude must be between -90 and 90, longitude between -180 and 180.");
      return null;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current_weather=true&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
    const response = await this.getJson(url);
    const weather = response.current_weather || null;

    if (!weather) {
      return null;
    }

    return {
      temperature: weather.temperature,
      weathercode: weather.weathercode,
      isDay: weather.is_day
    };
  },

  resolveMetroBusStopProfiles() {
    const configuredStops = ensureArray(this.config.metroBusStops);

    return configuredStops
      .map((entry, index) => this.normalizeMetroBusStopProfile(entry, index))
      .filter(Boolean);
  },

  normalizeMetroBusStopProfile(entry, index) {
    const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
    const stopId = isObject ? entry.stopId || entry.id || entry.code : entry;

    if (!stopId) {
      return null;
    }

    return {
      stopId: String(stopId).trim(),
      name: isObject ? entry.name || entry.label || null : null,
      routeFilter: isObject && entry.routeFilter ? normalizeList(entry.routeFilter) : normalizeList(this.config.metroBusRouteFilter),
      maxRows: parseNumber(isObject && entry.maxRows != null ? entry.maxRows : this.config.metroBusMaxRows, this.config.metroBusMaxRows),
      priority: parseNumber(isObject && entry.priority != null ? entry.priority : index, index)
    };
  },

  async fetchMetroBusPredictions() {
    if (!this.isMetroBusEnabled()) {
      return [];
    }

    const stopProfiles = this.busStopProfiles;
    if (!stopProfiles.length) {
      return [];
    }

    const stops = await Promise.all(stopProfiles.map(async (profile) => {
      try {
        const url = `https://api.wmata.com/NextBusService.svc/json/jPredictions?StopID=${encodeURIComponent(profile.stopId)}`;
        const response = await this.getJson(url);
        const rawPredictions = ensureArray(response.Predictions);

        const predictions = rawPredictions
          .filter((prediction) => this.matchesLineFilter(prediction.RouteID || prediction.Route, profile.routeFilter))
          .map((prediction) => {
            const minutesRaw = prediction.Minutes != null ? prediction.Minutes : prediction.Min;
            return {
              route: prediction.RouteID || prediction.Route || "--",
              destination: prediction.DirectionText || prediction.TripHeadSign || prediction.DestinationName || "Unknown",
              direction: prediction.DirectionText || prediction.Direction || "-",
              displayMinutes: this.formatDisplayMinutes(minutesRaw),
              minutesSort: this.normalizeMinutesSort(minutesRaw)
            };
          })
          .sort((a, b) => {
            if (a.minutesSort !== b.minutesSort) {
              return a.minutesSort - b.minutesSort;
            }

            return String(a.route).localeCompare(String(b.route));
          });

        const limitedPredictions = limitArray(predictions, profile.maxRows);

        return {
          stopId: profile.stopId,
          name: profile.name || response.StopName || profile.stopId,
          predictions: limitedPredictions
        };
      } catch (error) {
        console.warn(`[MMM-DCMetroTrains] Failed to fetch Metrobus predictions for stop ${profile.stopId}:`, error.message);
        return {
          stopId: profile.stopId,
          name: profile.name || profile.stopId,
          predictions: []
        };
      }
    }));

    const priorityMap = new Map(stopProfiles.map((item) => [item.stopId, item.priority]));
    return stops.sort((a, b) => (priorityMap.get(a.stopId) ?? 0) - (priorityMap.get(b.stopId) ?? 0));
  },

  formatDisplayMinutes(value) {
    if (value == null) {
      return "--";
    }

    const text = String(value).trim().toUpperCase();
    if (text === "ARR") {
      return "Arriving";
    }

    if (text === "BRD") {
      return "Boarding";
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? `${parsed} min` : text;
  },

  normalizeMinutesSort(value) {
    if (value == null) {
      return 999;
    }

    const text = String(value).trim().toUpperCase();
    if (text === "ARR" || text === "BRD") {
      return 0;
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 999;
  },

  isMetroBusOnlyMode() {
    return parseBoolean(this.config.metroBusOnlyMode, false);
  },

  isMetroBusEnabled() {
    return parseBoolean(this.config.showMetroBus, false) || this.isMetroBusOnlyMode();
  },

  resolveStationProfiles() {
    const rawConfigured = this.config.stationCodes;
    const configured = Array.isArray(rawConfigured)
      ? rawConfigured
      : (rawConfigured != null ? [rawConfigured] : []);
    const configuredStations = configured.length ? configured : ["A01"];

    return configuredStations
      .map((entry, index) => this.normalizeStationProfile(entry, index))
      .filter(Boolean);
  },

  normalizeStationProfile(entry, index) {
    const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
    const rawCode = isObject ? entry.code || entry.stationCode || entry.id : entry;
    const code = String(rawCode || "").trim();

    if (!code) {
      return null;
    }

    return {
      code,
      name: isObject ? entry.name || entry.label || null : null,
      lineFilter: isObject && entry.lineFilter ? normalizeList(entry.lineFilter) : normalizeList(this.config.lineFilter),
      destinationIncludes: isObject && entry.destinationIncludes ? normalizeList(entry.destinationIncludes) : normalizeList(this.config.destinationIncludes),
      maxRows: parseNumber(isObject && entry.maxRows != null ? entry.maxRows : this.config.maxRows, this.config.maxRows),
      compact: Boolean(isObject && entry.compact != null ? entry.compact : this.config.compact),
      groupByLine: isObject && entry.groupByLine != null ? Boolean(entry.groupByLine) : Boolean(this.config.groupByLine),
      showIncidents: isObject && entry.showIncidents != null ? Boolean(entry.showIncidents) : Boolean(this.config.showIncidents),
      alerts: isObject && entry.alerts ? normalizeList(entry.alerts) : normalizeList(this.config.alertRules),
      priority: parseNumber(isObject && entry.priority != null ? entry.priority : index, index)
    };
  },

  groupPredictionsByStation(predictions) {
    const grouped = {};

    this.filterPredictionsByLineAndDest(predictions, this.config.lineFilter, this.config.destinationIncludes).forEach((item) => {
        const stationCode = item.LocationCode;
        if (!stationCode) {
          return;
        }

        if (!grouped[stationCode]) {
          grouped[stationCode] = [];
        }

        grouped[stationCode].push({
          line: item.Line || NA_LINE,
          destination: item.DestinationName || "Unknown",
          direction: this.directionFromNumber(item.Group),
          displayMinutes: this.formatDisplayMinutes(item.Min),
          minutesSort: this.normalizeMinutesSort(item.Min),
          cars: item.Car
        });
      });

    return grouped;
  },

  buildStationPayload(grouped, incidents, weather) {
    const profiles = sortCopy(this.stationProfiles, (a, b) => a.priority - b.priority);

    return profiles.map((profile) => {
      const rawPredictions = grouped[profile.code] || [];
      const predictions = this.filterAndDecoratePredictions(rawPredictions, profile, incidents);
      const alerts = this.collectAlerts(predictions, incidents, profile);
      const condition = this.buildConditionSummary(predictions, incidents, weather);

      return {
        code: profile.code,
        name: this.stationMap[profile.code] || profile.code,
        displayName: profile.name || this.stationMap[profile.code] || profile.code,
        profile,
        predictions,
        nextSummary: limitArray(predictions, this.getConfigNumber("summaryCount", 3)),
        alerts,
        conditionText: condition.text,
        conditionClass: condition.className
      };
    });
  },

  filterAndDecoratePredictions(predictions, profile, incidents) {
    const incidentLines = this.collectIncidentLines(incidents);

    return predictions
      .filter((item) => this.matchesLineFilter(item.line, profile.lineFilter) && this.matchesDestinationFilter(item.destination, profile.destinationIncludes))
      .map((item) => this.decoratePrediction(item, incidentLines));
  },

  decoratePrediction(prediction, incidentLines) {
    const status = this.classifyPrediction(prediction, incidentLines);
    const carsClass = this.classifyCars(prediction.cars);

    return {
      line: prediction.line || NA_LINE,
      destination: prediction.destination || "Unknown",
      direction: prediction.direction || "-",
      displayMinutes: prediction.displayMinutes,
      minutesSort: prediction.minutesSort,
      cars: prediction.cars || "",
      carsLabel: this.formatCars(prediction.cars),
      carsClass,
      statusClass: status.className,
      statusLabel: status.label,
      alerts: []
    };
  },

  classifyPrediction(prediction, incidentLines) {
    const line = normalizeLineCode(prediction.line, "");
    const matchedIncident = incidentLines[line] || null;

    const thresholds = this.getStatusThresholds();

    if (matchedIncident && matchedIncident.rank >= 3) {
      return { className: "alert", label: "Alert" };
    }

    if (prediction.displayMinutes === "Boarding") {
      return { className: "boarding", label: "Boarding" };
    }

    if (prediction.displayMinutes === "Arriving") {
      return { className: "arriving", label: "Arriving" };
    }

    if (prediction.minutesSort >= thresholds.critical) {
      return { className: "critical", label: "Critical wait" };
    }

    if (prediction.minutesSort >= thresholds.delayed) {
      return { className: "delayed", label: "Delayed" };
    }

    if (prediction.minutesSort >= thresholds.watch) {
      return { className: "watch", label: "Watch" };
    }

    return { className: "normal", label: "On time" };
  },

  classifyCars(cars) {
    if (!cars) {
      return "dcmetro__cars--unknown";
    }

    const numeric = Number(String(cars).replace(/[^0-9]/g, ""));

    if (!numeric) {
      return "dcmetro__cars--unknown";
    }

    if (numeric >= 8) {
      return "dcmetro__cars--high";
    }

    if (numeric >= 6) {
      return "dcmetro__cars--medium";
    }

    return "dcmetro__cars--low";
  },

  formatCars(cars) {
    const raw = String(cars || "").trim();
    if (!raw) {
      return "-";
    }

    if (/[^0-9]/.test(raw)) {
      return raw;
    }

    return `${raw} cars`;
  },

  collectAlerts(predictions, incidents, profile) {
    const alerts = [];
    const rules = normalizeList(profile.alerts || this.config.alertRules);

    rules.forEach((ruleText) => {
      const rule = String(ruleText || "").trim();
      if (!rule) {
        return;
      }

      const lowerRule = rule.toLowerCase();
      const hit = predictions.some((prediction) => `${prediction.line} ${prediction.destination} ${prediction.displayMinutes}`.toLowerCase().includes(lowerRule))
        || incidents.some((incident) => `${incident.linesText} ${incident.description}`.toLowerCase().includes(lowerRule));

      if (hit) {
        alerts.push({
          severity: "major",
          message: `Alert: ${rule}`
        });
      }
    });

    if (alerts.length) {
      predictions.forEach((prediction) => {
        prediction.alerts = alerts;
      });
    }

    return alerts;
  },

  buildConditionSummary(predictions, incidents, weather) {
    const freshness = this.getFreshnessState(this.lastBroadcastAt || Date.now());
    const safePredictions = ensureArray(predictions);
    const safeIncidents = ensureArray(incidents);
    const activeIncidents = safeIncidents.filter((incident) => this.matchesSeverityFilter(incident.severity));
    const delayedTrains = safePredictions.filter((prediction) => this.predictionsAreDamaged(prediction));

    if (weather && this.config.showWeather) {
      return {
        text: `${activeIncidents.length ? pluralize(activeIncidents.length, "alert") : "Service normal"} • ${this.formatWeather(weather)}`,
        className: weather.isDay === 0 ? "dcmetro__condition--night" : "dcmetro__condition--weather"
      };
    }

    if (activeIncidents.length) {
      return {
        text: `${pluralize(activeIncidents.length, "service alert")}${delayedTrains.length ? ` • ${pluralize(delayedTrains.length, "delayed train")}` : ""}`,
        className: "dcmetro__condition--alert"
      };
    }

    if (delayedTrains.length) {
      return {
        text: `${pluralize(delayedTrains.length, "train")} delayed`,
        className: "dcmetro__condition--delayed"
      };
    }

    return {
      text: freshness.isStale ? "Data stale" : "Service normal",
      className: freshness.isStale ? "dcmetro__condition--stale" : "dcmetro__condition--normal"
    };
  },

  collectIncidentLines(incidents) {
    const map = {};

    ensureArray(incidents).forEach((incident) => {
      ensureArray(incident.lineCodes).forEach((line) => {
        const key = normalizeLineCode(line, "");
        const existing = map[key];
        if (!existing || incident.rank > existing.rank) {
          map[key] = incident;
        }
      });
    });

    return map;
  },

  groupPredictionsByLine(predictions) {
    return createPredictionGroups(predictions, this.config.lineOrder, this.getLineWeight.bind(this));
  },

  getLineWeight(lineCode, customOrder) {
    const order = customOrder || this.normalizedLineOrderCache;
    return calculateLineWeight(lineCode, order);
  },

  matchesLineFilter(line, lineFilter) {
    const filter = normalizeList(lineFilter);
    if (isEmpty(filter)) {
      return true;
    }

    const upperLine = normalizeLineCode(line, "");
    return filter.some((entry) => entry.toUpperCase() === upperLine);
  },

  matchesDestinationFilter(destination, destinationIncludes) {
    const includes = normalizeList(destinationIncludes);
    if (isEmpty(includes)) {
      return true;
    }

    const needle = normalizeLowercase(destination, "");
    return includes.some((entry) => needle.includes(entry.toLowerCase()));
  },

  matchesSeverityFilter(severity) {
    const filter = this.getConfigString("incidentSeverityFilter", "all");
    return (SEVERITY_RANK[String(severity || "advisory").toLowerCase()] || 1) >= (SEVERITY_RANK[filter] || 0);
  },

  formatIncidentDateRange(item) {
    const start = this.parseIncidentDateValue(item, ["StartTime", "StartDate", "BeginTime", "BeginDate", "EffectiveDate", "PublishedDate"]);
    const end = this.parseIncidentDateValue(item, ["EndTime", "EndDate", "ExpireTime", "ExpirationDate", "ToTime", "ToDate", "ThroughDate"]);

    if (!start && !end) {
      return "";
    }

    if (start && end) {
      const startStr = this.formatIncidentDateOnly(start);
      const endStr = this.formatIncidentDateOnly(end);
      return startStr === endStr ? startStr : `${startStr} - ${endStr}`;
    }

    return this.formatIncidentDateOnly(start || end);
  },

  parseIncidentDateValue(item, keys) {
    for (const key of keys) {
      const rawValue = item && item[key];
      if (!rawValue) {
        continue;
      }

      const parsed = new Date(rawValue);
      const timeMs = parsed.getTime();
      // Valid date must be finite, not NaN, and not epoch (1970-01-01)
      if (Number.isFinite(timeMs) && timeMs > 0) {
        return parsed;
      }
    }

    return null;
  },

  formatIncidentDateOnly(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    const options = { month: "short", day: "numeric" };
    if (date.getFullYear() !== new Date().getFullYear()) {
      options.year = "numeric";
    }

    return date.toLocaleDateString("en-US", options);
  },

  normalizeLines(linesAffected) {
    return String(linesAffected || "")
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean);
  },

  predictionsAreDamaged(prediction) {
    return prediction.statusClass === "delayed"
      || prediction.statusClass === "critical"
      || prediction.statusClass === "alert";
  },

  filterPredictionsByLineAndDest(predictions, lineFilter, destIncludes) {
    return predictions.filter(
      (item) => this.matchesLineFilter(item.Line, lineFilter) && this.matchesDestinationFilter(item.DestinationName, destIncludes)
    );
  },

  getStatusThresholds() {
    const thresholds = this.config.statusThresholds || {};
    const watch = Math.max(0, parseNumber(thresholds.watchMinutes, 8));
    const delayed = Math.max(watch, parseNumber(thresholds.delayedMinutes, 15));
    const critical = Math.max(delayed, parseNumber(thresholds.criticalMinutes, 25));
    return {
      watch,
      delayed,
      critical
    };
  },

  directionFromNumber(group) {
    if (String(group) === "1") {
      return "Northbound";
    }

    if (String(group) === "2") {
      return "Southbound";
    }

    return "-";
  },

  classifyIncident(description) {
    const text = normalizeLowercase(description, "");

    // Critical: Use word boundaries (\b) to prevent partial matches (e.g., "suspend" in "unsuspend")
    if (/\b(suspend|suspended|no\s+service|shutdown|evacuat|fire|police|disabled|track\s+work|bus\s+bridge|major\s+delay)\b/.test(text)) {
      return { rank: 3, severity: "critical", severityLabel: "Critical" };
    }

    if (/\b(delay|delayed|single\s+track|slow|minor|construction|maintenance)\b/.test(text)) {
      return { rank: 2, severity: "major", severityLabel: "Major" };
    }

    return { rank: 1, severity: "advisory", severityLabel: "Advisory" };
  },

  formatWeather(weather) {
    return formatWeatherDisplay(weather);
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

  getFreshnessState(timestamp) {
    return {
      isStale: (Date.now() - timestamp) > this.config.staleAfterSeconds * 1000
    };
  },

  getJson(url) {
    const headers = {
      api_key: this.config.apiKey
    };

    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers }, (response) => {
        let body = "";
        let limitExceeded = false;
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1048576) {
            limitExceeded = true;
            request.destroy(new Error("Response body exceeded 1 MB limit"));
          }
        });

        response.on("end", () => {
          if (limitExceeded) {
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const errorPreview = body.slice(0, 500).replace(/\n\s*/g, " ");
            reject(new Error(`HTTP ${response.statusCode}: ${errorPreview}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Failed parsing WMATA response: ${error.message}`));
          }
        });
      });

      request.on("error", (error) => reject(error));
      request.end();
    });
  }
});
