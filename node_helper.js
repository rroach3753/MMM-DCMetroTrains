const NodeHelper = require("node_helper");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

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

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
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

function normalizeLineOrderToUpperCase(lineOrder) {
  return normalizeList(lineOrder).map((entry) => entry.toUpperCase());
}

function normalizeLowercase(value, fallback) {
  return String(value || fallback || "").toLowerCase();
}

function isEmpty(array) {
  return !array || !array.length;
}

const NA_LINE = "NA";
const SEVERITY_RANK = {
  all: 0,
  advisory: 1,
  major: 2,
  critical: 3
};

const MAX_RETRY_DELAY_MS = 300000;
const MAX_SHARED_CACHE_ENTRIES = 64;
const SNAPSHOT_DIR = path.join(__dirname, ".cache");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "dcmetro-last-good.json");

module.exports = NodeHelper.create({
  start() {
    this.config = null;
    this.fetchTimer = null;
    this.incidentTimer = null;
    this.retryTimer = null;
    this.stationMap = {};
    this.latestIncidents = [];
    this.latestStations = [];
    this.latestBusStops = [];
    this.stationProfiles = [];
    this.busStopProfiles = [];
    this.stationCodesByName = {};
    this.normalizedLineOrderCache = [];
    this.retryAttempt = 0;
    this.degradedMode = false;
    this.lastSuccessAt = null;
    this.latestDataTimestamp = null;
    this.lastErrorMessage = null;
    this.lastErrorCode = null;
    this.requestCache = new Map();
    this.snapshotLoaded = false;
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

    const stationRotationInterval = parseNumber(config.stationRotationInterval, null);
    if (config.stationRotationInterval != null && (!Number.isFinite(stationRotationInterval) || stationRotationInterval < 2000)) {
      errors.push("stationRotationInterval must be >= 2000 ms");
    }

    const staleAfterSeconds = parseNumber(config.staleAfterSeconds, null);
    if (config.staleAfterSeconds != null && (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds < 1)) {
      errors.push("staleAfterSeconds must be >= 1");
    }

    const summaryCount = parseNumber(config.summaryCount, null);
    if (config.summaryCount != null && (!Number.isFinite(summaryCount) || summaryCount < 1)) {
      errors.push("summaryCount must be >= 1");
    }

    const fontScale = parseNumber(config.fontScale, null);
    if (config.fontScale != null && (!Number.isFinite(fontScale) || fontScale <= 0 || fontScale > 3)) {
      errors.push("fontScale must be > 0 and <= 3");
    }

    const maxIncidentRows = parseNumber(config.maxIncidentRows, null);
    if (config.maxIncidentRows != null && (!Number.isFinite(maxIncidentRows) || maxIncidentRows < 1)) {
      errors.push("maxIncidentRows must be >= 1");
    }

    const incidentScrollSpeed = parseNumber(config.incidentScrollSpeed, null);
    if (config.incidentScrollSpeed != null && (!Number.isFinite(incidentScrollSpeed) || incidentScrollSpeed < 1)) {
      errors.push("incidentScrollSpeed must be >= 1");
    }

    const incidentScrollSpeedMin = parseNumber(config.incidentScrollSpeedMin, null);
    if (config.incidentScrollSpeedMin != null && (!Number.isFinite(incidentScrollSpeedMin) || incidentScrollSpeedMin < 1)) {
      errors.push("incidentScrollSpeedMin must be >= 1");
    }

    if (config.incidentScrollSpeed != null && config.incidentScrollSpeedMin != null && incidentScrollSpeed < incidentScrollSpeedMin) {
      errors.push("incidentScrollSpeed must be >= incidentScrollSpeedMin");
    }

    const commuteMaxRows = parseNumber(config.commuteMaxRows, null);
    if (config.commuteMaxRows != null && (!Number.isFinite(commuteMaxRows) || commuteMaxRows < 1)) {
      errors.push("commuteMaxRows must be >= 1");
    }

    const animationSpeed = parseNumber(config.animationSpeed, null);
    if (config.animationSpeed != null && (!Number.isFinite(animationSpeed) || animationSpeed < 0)) {
      errors.push("animationSpeed must be >= 0");
    }

    const updateJitterMs = parseNumber(config.updateJitterMs, null);
    if (config.updateJitterMs != null && (!Number.isFinite(updateJitterMs) || updateJitterMs < 0)) {
      errors.push("updateJitterMs must be >= 0");
    }

    const directionMode = normalizeLowercase(config.directionMode, "cardinal");
    if (directionMode && !["cardinal", "terminal"].includes(directionMode)) {
      errors.push("directionMode must be 'cardinal' or 'terminal'");
    }

    const metroBusStopRotationInterval = parseNumber(config.metroBusStopRotationInterval, null);
    if (config.metroBusStopRotationInterval != null && (!Number.isFinite(metroBusStopRotationInterval) || metroBusStopRotationInterval < 2000)) {
      errors.push("metroBusStopRotationInterval must be >= 2000 ms");
    }

    const walkBufferMinutes = parseNumber(config.walkBufferMinutes, null);
    if (config.walkBufferMinutes != null && (!Number.isFinite(walkBufferMinutes) || walkBufferMinutes < 0)) {
      errors.push("walkBufferMinutes must be >= 0");
    }

    const leaveNowWindowMinutes = parseNumber(config.leaveNowWindowMinutes, null);
    if (config.leaveNowWindowMinutes != null && (!Number.isFinite(leaveNowWindowMinutes) || leaveNowWindowMinutes < 1)) {
      errors.push("leaveNowWindowMinutes must be >= 1");
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
    this.instanceId = this.config.instanceId || null;

    if (!this.validateConfig()) {
      this.sendSocketNotification("DC_METRO_ERROR", {
        instanceId: this.instanceId,
        error: "Invalid MMM-DCMetroTrains configuration. Check server logs for details."
      });
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
    this.loadPersistedSnapshot();

    try {
      if (this.isMetroBusOnlyMode()) {
        this.stationMap = {};
      } else {
        await this.fetchStations();
        this.validateStationProfiles();
      }
      const predictionsOk = await this.refreshPredictionsAndWeather();
      if (predictionsOk) {
        await this.refreshIncidents();
      }
      this.scheduleNextPredictionRefresh();
      this.scheduleNextIncidentRefresh();
    } catch (error) {
      this.handleRefreshFailure(error, "initialize");
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

      // Retry timer takes over scheduling when prediction refreshes fail.
      if (!this.retryTimer) {
        this.scheduleNextPredictionRefresh();
      }
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

  scheduleRetry(source) {
    this.clearRetryTimer();
    const baseRetryDelay = Math.max(1000, this.getConfigNumber("retryDelay", 15000));
    const retryDelay = Math.min(MAX_RETRY_DELAY_MS, baseRetryDelay * Math.pow(2, Math.max(0, this.retryAttempt - 1)));
    this.retryTimer = setTimeout(() => this.initialize(), retryDelay);

    this.reportError(`DC Metro update failed (${source}). Retrying in ${Math.round(retryDelay / 1000)}s.`, {
      degradedMode: this.degradedMode,
      retryAttempt: this.retryAttempt,
      retryDelay,
      lastSuccessAt: this.lastSuccessAt,
      errorCode: this.lastErrorCode
    });
  },

  reportError(message, extra = {}) {
    this.sendSocketNotification("DC_METRO_ERROR", {
      instanceId: this.instanceId,
      error: message,
      degradedMode: this.degradedMode,
      retryAttempt: this.retryAttempt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorCode: this.lastErrorCode,
      ...extra
    });
  },

  handleRefreshFailure(error, source) {
    this.retryAttempt += 1;
    this.degradedMode = true;
    this.lastErrorMessage = error.message;
    this.lastErrorCode = this.classifyErrorCode(error);
    this.tryRestoreFromSnapshot(source);
    this.scheduleRetry(source);
  },

  markRefreshHealthy() {
    this.retryAttempt = 0;
    this.degradedMode = false;
    this.lastErrorMessage = null;
    this.lastErrorCode = null;
    this.lastSuccessAt = Date.now();
    this.clearRetryTimer();
  },

  classifyErrorCode(error) {
    const message = String(error && error.message ? error.message : "").toLowerCase();

    if (message.includes("timed out")) {
      return "timeout";
    }

    const httpMatch = /http\s+(\d{3})/.exec(message);
    if (httpMatch) {
      const statusCode = Number(httpMatch[1]);
      if (statusCode === 429) {
        return "rate_limited";
      }

      if (statusCode >= 500) {
        return "api_unavailable";
      }

      return "api_error";
    }

    if (message.includes("parse")) {
      return "parse_error";
    }

    return "unknown";
  },

  tryRestoreFromSnapshot(sourceLabel) {
    this.loadPersistedSnapshot();

    const hasSnapshot = isEmpty(this.latestStations) && isEmpty(this.latestBusStops)
      ? false
      : (this.lastSuccessAt != null);

    if (!hasSnapshot) {
      return false;
    }

    this.degradedMode = true;
    this.lastErrorCode = this.lastErrorCode || "cache_fallback";
    this.broadcastData();
    this.reportError(`Using last-known-good snapshot while ${sourceLabel} retries continue.`, {
      lastSuccessAt: this.lastSuccessAt,
      lastErrorCode: this.lastErrorCode
    });
    return true;
  },

  broadcastData() {
    this.lastBroadcastAt = Date.now();
    const fetchedAt = this.latestDataTimestamp || this.lastBroadcastAt;
    this.sendSocketNotification("DC_METRO_DATA", {
      instanceId: this.instanceId,
      stations: this.latestStations,
      busStops: this.latestBusStops,
      incidents: this.latestIncidents,
      fetchedAt,
      degradedMode: this.degradedMode,
      retryAttempt: this.retryAttempt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorCode: this.lastErrorCode
    });
  },

  async refreshPredictionsAndWeather() {
    try {
      const metroBusOnly = this.isMetroBusOnlyMode();
      const [predictions, busStops] = await Promise.all([
        metroBusOnly ? Promise.resolve([]) : this.fetchPredictions(),
        this.fetchMetroBusPredictions()
      ]);

      // Build complete data set before updating module state (atomic update)
      const grouped = this.groupPredictionsByStation(predictions);
      const newStations = metroBusOnly ? [] : this.buildStationPayload(grouped, this.latestIncidents);

      // Update state atomically
      this.latestBusStops = busStops;
      this.latestStations = newStations;
      this.markRefreshHealthy();
      this.latestDataTimestamp = this.lastSuccessAt || Date.now();
      this.persistLastGoodSnapshot();
      this.broadcastData();
      return true;
    } catch (error) {
      this.handleRefreshFailure(error, "predictions");
      return false;
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
      const severity = this.classifyIncident(item);
      const dateRangeText = this.formatIncidentDateRange(item);
      const description = String(item.Description || "").replace(/\s+/g, " ").trim();
      const impact = this.scoreIncidentImpact({
        description,
        lineCodes: normalized,
        rank: severity.rank
      });

      return {
        linesText: normalized.length ? normalized.join("/") : "System",
        lineCodes: normalized,
        description,
        dateRangeText,
        severity: severity.severity,
        severityLabel: severity.severityLabel,
        rank: severity.rank,
        impactScore: impact.score,
        impactLabel: impact.label,
        impactedStations: impact.impactedStations
      };
    }).sort((a, b) => {
      if (a.impactScore !== b.impactScore) {
        return b.impactScore - a.impactScore;
      }

      if (a.rank !== b.rank) {
        return b.rank - a.rank;
      }

      return a.description.localeCompare(b.description);
    });
  },

  scoreIncidentImpact(incident) {
    const configuredLines = this.getConfiguredLineSet();
    const lineOverlap = ensureArray(incident.lineCodes).filter((line) => configuredLines.has(normalizeLineCode(line, ""))).length;
    const descriptionText = normalizeLowercase(incident.description, "");

    let stationHits = 0;
    this.stationProfiles.forEach((profile) => {
      const stationName = normalizeLowercase(this.stationMap[profile.code], "");
      const codeText = normalizeLowercase(profile.code, "");
      if ((stationName && descriptionText.includes(stationName)) || (codeText && descriptionText.includes(codeText))) {
        stationHits += 1;
      }
    });

    const score = (incident.rank || 1) * 100 + lineOverlap * 40 + stationHits * 30;
    if (score >= 300) {
      return { score, label: "High", impactedStations: stationHits };
    }

    if (score >= 180) {
      return { score, label: "Medium", impactedStations: stationHits };
    }

    return { score, label: "Low", impactedStations: stationHits };
  },

  getConfiguredLineSet() {
    const lines = new Set();
    normalizeList(this.config.lineFilter).forEach((line) => lines.add(normalizeLineCode(line, "")));
    this.stationProfiles.forEach((profile) => {
      normalizeList(profile.lineFilter).forEach((line) => lines.add(normalizeLineCode(line, "")));
    });
    return lines;
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
      rotate: parseBoolean(isObject && entry.rotate != null ? entry.rotate : this.getConfigBool("metroBusRotateStops", false), false),
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
        const routes = [...new Set(limitedPredictions.map((item) => String(item.route || "").trim()).filter(Boolean))];

        return {
          stopId: profile.stopId,
          name: profile.name || response.StopName || profile.stopId,
          predictions: limitedPredictions,
          routes,
          rotate: profile.rotate
        };
      } catch (error) {
        console.warn(`[MMM-DCMetroTrains] Failed to fetch Metrobus predictions for stop ${profile.stopId}:`, error.message);
        return {
          stopId: profile.stopId,
          name: profile.name || profile.stopId,
          predictions: [],
          routes: [],
          rotate: profile.rotate
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
          direction: this.directionFromNumber(item.Group, item.DestinationName),
          displayMinutes: this.formatDisplayMinutes(item.Min),
          minutesSort: this.normalizeMinutesSort(item.Min),
          cars: item.Car
        });
      });

    return grouped;
  },

  buildStationPayload(grouped, incidents) {
    const profiles = sortCopy(this.stationProfiles, (a, b) => a.priority - b.priority);

    return profiles.map((profile) => {
      const rawPredictions = grouped[profile.code] || [];
      const predictions = this.filterAndDecoratePredictions(rawPredictions, profile, incidents);
      const alerts = this.collectAlerts(predictions, incidents, profile);
      const condition = this.buildConditionSummary(predictions, incidents);

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

  buildConditionSummary(predictions, incidents) {
    const freshness = this.getFreshnessState(this.lastBroadcastAt || Date.now());
    const safePredictions = ensureArray(predictions);
    const safeIncidents = ensureArray(incidents);
    const activeIncidents = safeIncidents.filter((incident) => this.matchesSeverityFilter(incident.severity));
    const delayedTrains = safePredictions.filter((prediction) => this.predictionsAreDamaged(prediction));

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

  directionFromNumber(group, destination) {
    const mode = this.getConfigString("directionMode", "cardinal");
    if (mode === "terminal") {
      const name = String(destination || "").trim();
      if (name) {
        return `Toward ${name}`;
      }
    }

    if (String(group) === "1") {
      return "Northbound";
    }

    if (String(group) === "2") {
      return "Southbound";
    }

    return "-";
  },

  classifyIncident(incident) {
    const text = normalizeLowercase(incident && incident.Description, "");
    const title = normalizeLowercase(incident && (incident.Title || incident.Summary), "");
    const source = `${title} ${text}`;

    let score = 0;
    const criticalTerms = [
      /\b(no\s+service|suspend|shutdown|evacuat|fire|police|disabled|bus\s+bridge)\b/,
      /\b(major\s+delay|serious\s+delay|signal\s+problem|power\s+problem|derail)\b/
    ];
    const majorTerms = [
      /\b(delay|delayed|single\s+track|slow\s+zone|construction|maintenance)\b/,
      /\b(crowding|platform\s+change|operator\s+availability)\b/
    ];

    criticalTerms.forEach((pattern) => {
      if (pattern.test(source)) {
        score += 3;
      }
    });

    majorTerms.forEach((pattern) => {
      if (pattern.test(source)) {
        score += 2;
      }
    });

    const isSystemWide = !String(incident && incident.LinesAffected || "").trim();
    if (isSystemWide) {
      score += 1;
    }

    if (score >= 6) {
      return { rank: 3, severity: "critical", severityLabel: "Critical" };
    }

    if (score >= 3) {
      return { rank: 2, severity: "major", severityLabel: "Major" };
    }

    return { rank: 1, severity: "advisory", severityLabel: "Advisory" };
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

  loadPersistedSnapshot() {
    if (this.snapshotLoaded) {
      return;
    }

    this.snapshotLoaded = true;

    try {
      if (!fs.existsSync(SNAPSHOT_FILE)) {
        return;
      }

      const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      this.latestStations = ensureArray(parsed.stations);
      this.latestBusStops = ensureArray(parsed.busStops);
      this.latestIncidents = ensureArray(parsed.incidents);
      this.latestDataTimestamp = parsed.fetchedAt || parsed.lastSuccessAt || null;
      this.lastSuccessAt = parsed.lastSuccessAt || parsed.fetchedAt || this.lastSuccessAt;
    } catch (error) {
      console.warn("[MMM-DCMetroTrains] Failed to load persisted snapshot:", error.message);
    }
  },

  persistLastGoodSnapshot() {
    try {
      const snapshot = {
        fetchedAt: this.latestDataTimestamp || Date.now(),
        lastSuccessAt: this.lastSuccessAt || Date.now(),
        stations: this.latestStations,
        busStops: this.latestBusStops,
        incidents: this.latestIncidents
      };

      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      const tempFile = `${SNAPSHOT_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempFile, SNAPSHOT_FILE);
    } catch (error) {
      console.warn("[MMM-DCMetroTrains] Failed to persist snapshot:", error.message);
    }
  },

  pruneRequestCache(now) {
    if (!this.requestCache.size) {
      return;
    }

    for (const [url, entry] of this.requestCache.entries()) {
      if (!entry || (!entry.promise && entry.expiresAt <= now)) {
        this.requestCache.delete(url);
      }
    }

    if (this.requestCache.size <= MAX_SHARED_CACHE_ENTRIES) {
      return;
    }

    const sorted = [...this.requestCache.entries()]
      .filter(([, entry]) => entry && !entry.promise)
      .sort((a, b) => (a[1].expiresAt || 0) - (b[1].expiresAt || 0));

    const overflow = this.requestCache.size - MAX_SHARED_CACHE_ENTRIES;
    for (let i = 0; i < overflow && i < sorted.length; i++) {
      this.requestCache.delete(sorted[i][0]);
    }
  },

  getSharedCacheTtl(url) {
    if (/\/jStations/i.test(url)) {
      return 86400000;
    }

    if (/Incidents\.svc/i.test(url)) {
      return 30000;
    }

    if (/NextBusService\.svc/i.test(url)) {
      return 5000;
    }

    if (/StationPrediction\.svc/i.test(url)) {
      return 5000;
    }

    return 10000;
  },

  getJson(url) {
    if (!this.getConfigBool("enableSharedApiCache", true)) {
      return this.fetchJson(url);
    }

    const now = Date.now();
    this.pruneRequestCache(now);
    const ttl = this.getSharedCacheTtl(url);
    const cached = this.requestCache.get(url);

    if (cached && cached.data && cached.expiresAt > now) {
      return Promise.resolve(cached.data);
    }

    if (cached && cached.promise) {
      return cached.promise;
    }

    const promise = this.fetchJson(url)
      .then((data) => {
        this.requestCache.set(url, {
          data,
          expiresAt: Date.now() + ttl,
          promise: null
        });
        return data;
      })
      .catch((error) => {
        this.requestCache.delete(url);
        throw error;
      });

    this.requestCache.set(url, {
      data: cached ? cached.data : null,
      expiresAt: cached ? cached.expiresAt : 0,
      promise
    });

    return promise;
  },

  fetchJson(url) {
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

      request.setTimeout(15000, () => {
        request.destroy(new Error("WMATA request timed out after 15000ms"));
      });

      request.on("error", (error) => reject(error));
      request.end();
    });
  }
});
