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

function lineWeight(lineCode) {
  return LINE_ORDER[String(lineCode || "NA").toUpperCase()] || 90;
}

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
    this.stationCodesByName = {};
    this.latestStationTimes = {};
    this.stationTimesLastFetchedAt = null;
  },

  socketNotificationReceived(notification, payload) {
    if (notification !== "DC_METRO_CONFIG") {
      return;
    }

    this.config = payload || {};
    this.stationProfiles = this.resolveStationProfiles();

    if (!this.config.apiKey) {
      this.sendSocketNotification("DC_METRO_ERROR", "Missing apiKey in MMM-DCMetroTrains config.");
      return;
    }

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
        await this.fetchStationTimesIfNeeded();
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
    if (this.fetchTimer) {
      clearTimeout(this.fetchTimer);
      this.fetchTimer = null;
    }

    if (this.incidentTimer) {
      clearTimeout(this.incidentTimer);
      this.incidentTimer = null;
    }
  },

  scheduleNextPredictionRefresh() {
    const interval = parseNumber(this.config.refreshInterval, 30000);
    this.fetchTimer = setTimeout(async () => {
      await this.refreshPredictionsAndWeather();
      this.scheduleNextPredictionRefresh();
    }, this.withJitter(interval));
  },

  scheduleNextIncidentRefresh() {
    const interval = parseNumber(this.config.incidentsRefreshInterval, 120000);
    this.incidentTimer = setTimeout(async () => {
      await this.refreshIncidents();
      this.scheduleNextIncidentRefresh();
    }, this.withJitter(interval));
  },

  withJitter(baseInterval) {
    const jitter = Math.max(0, parseNumber(this.config.updateJitterMs, 0));
    if (!jitter) {
      return baseInterval;
    }

    const delta = Math.floor(Math.random() * (jitter * 2 + 1)) - jitter;
    return Math.max(1000, baseInterval + delta);
  },

  clearRetryTimer() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  },

  scheduleRetry() {
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => this.initialize(), this.config.retryDelay);
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

      const grouped = this.groupPredictionsByStation(predictions);
      this.latestWeather = weather;
      this.latestBusStops = busStops;
      if (!metroBusOnly) {
        await this.fetchStationTimesIfNeeded();
      }
      this.latestStations = metroBusOnly ? [] : this.buildStationPayload(grouped, this.latestIncidents, weather);
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
    } catch {
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
        if (!this.stationCodesByName[name]) {
          this.stationCodesByName[name] = [];
        }

        if (!this.stationCodesByName[name].includes(code)) {
          this.stationCodesByName[name].push(code);
        }
      }
    });
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
    const latitude = parseNumber(this.config.weatherLatitude, null);
    const longitude = parseNumber(this.config.weatherLongitude, null);

    if (!this.config.showWeather || latitude == null || longitude == null) {
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
      windspeed: weather.windspeed,
      weathercode: weather.weathercode,
      isDay: weather.is_day
    };
  },

  async fetchStationTimesIfNeeded() {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const shouldFetch = !this.stationTimesLastFetchedAt || (now - this.stationTimesLastFetchedAt) > oneDayMs;

    if (shouldFetch) {
      const fetched = await this.fetchStationTimes();
      if (fetched) {
        this.stationTimesLastFetchedAt = now;
      }
    }
  },

  async fetchStationTimes() {
    const profileCodes = this.stationProfiles.map((profile) => profile.code).filter(Boolean);
    const codesToFetch = new Set();

    profileCodes.forEach((code) => {
      this.getRelatedStationCodes(code).forEach((relatedCode) => codesToFetch.add(relatedCode));
    });

    if (!codesToFetch.size) {
      return false;
    }

    const mergedStationTimes = { ...this.latestStationTimes };
    let successCount = 0;

    await Promise.all([...codesToFetch].map(async (stationCode) => {
      try {
        const url = `https://api.wmata.com/Rail.svc/json/jStationTimes?StationCode=${encodeURIComponent(stationCode)}`;
        const response = await this.getJson(url);
        const entries = this.extractStationTimesEntries(response);
        const selected = entries.find((entry) => String(entry.Code || "").trim() === stationCode) || entries[0] || null;

        if (!selected) {
          return;
        }

        mergedStationTimes[stationCode] = {
          code: stationCode,
          firstTrains: this.normalizeScheduleRows(selected.FirstTrains),
          lastTrains: this.normalizeScheduleRows(selected.LastTrains)
        };

        successCount += 1;
      } catch {
        // Keep the last successful cached payload when a station request fails.
      }
    }));

    if (successCount > 0) {
      this.latestStationTimes = mergedStationTimes;
      return true;
    }

    return false;
  },

  deriveFirstLastTrains(stationCode, profile) {
    const mode = String(profile && profile.firstLastTrainMode ? profile.firstLastTrainMode : "filtered").toLowerCase();
    const scopedCodes = mode === "all" ? this.getRelatedStationCodes(stationCode) : [stationCode];
    const result = {
      northbound: { first: null, last: null },
      southbound: { first: null, last: null }
    };

    const firstRows = [];
    const lastRows = [];

    scopedCodes.forEach((code) => {
      const stationTimeData = this.latestStationTimes[code];
      if (!stationTimeData) {
        return;
      }

      stationTimeData.firstTrains.forEach((row) => {
        if (mode === "filtered" && profile && profile.lineFilter && !this.matchesLineFilter(row.line, profile.lineFilter)) {
          return;
        }

        firstRows.push(row);
      });

      stationTimeData.lastTrains.forEach((row) => {
        if (mode === "filtered" && profile && profile.lineFilter && !this.matchesLineFilter(row.line, profile.lineFilter)) {
          return;
        }

        lastRows.push(row);
      });
    });

    ["northbound", "southbound"].forEach((direction) => {
      const firstByDirection = firstRows
        .filter((row) => row.direction === direction)
        .sort((a, b) => a.sortValue - b.sortValue);

      const lastByDirection = lastRows
        .filter((row) => row.direction === direction)
        .sort((a, b) => b.sortValue - a.sortValue);

      if (firstByDirection.length) {
        const row = firstByDirection[0];
        result[direction].first = {
          line: row.line,
          time: row.time,
          destination: row.destination
        };
      }

      if (lastByDirection.length) {
        const row = lastByDirection[0];
        result[direction].last = {
          line: row.line,
          time: row.time,
          destination: row.destination
        };
      }
    });

    return result;
  },

  normalizeStationTime(timeStr) {
    const raw = String(timeStr || "").trim();
    if (!raw) {
      return "";
    }

    const colonMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
      const hour = parseNumber(colonMatch[1], NaN);
      const minute = parseNumber(colonMatch[2], NaN);
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        return `${String(Math.max(0, hour)).padStart(2, "0")}:${String(Math.min(Math.max(0, minute), 59)).padStart(2, "0")}`;
      }
      return raw;
    }

    const digitsOnly = raw.replace(/[^0-9]/g, "");
    if (!digitsOnly || digitsOnly.length < 3 || digitsOnly.length > 4) {
      return raw;
    }

    const hourStr = digitsOnly.substring(0, digitsOnly.length - 2);
    const minStr = digitsOnly.substring(digitsOnly.length - 2);
    const hour = parseNumber(hourStr, 0);
    const min = parseNumber(minStr, 0);

    if (!Number.isFinite(hour) || !Number.isFinite(min)) {
      return raw;
    }

    const normalizedHour = Math.max(0, hour);
    const normalizedMin = Math.min(Math.max(0, min), 59);

    const paddedHour = String(normalizedHour).padStart(2, "0");
    const paddedMin = String(normalizedMin).padStart(2, "0");

    return `${paddedHour}:${paddedMin}`;
  },

  getRelatedStationCodes(stationCode) {
    const code = String(stationCode || "").trim();
    if (!code) {
      return [];
    }

    const stationName = this.stationMap[code];
    if (!stationName) {
      return [code];
    }

    const related = Array.isArray(this.stationCodesByName[stationName]) ? this.stationCodesByName[stationName] : [];
    const merged = new Set([code, ...related]);
    return [...merged];
  },

  extractStationTimesEntries(response) {
    if (!response) {
      return [];
    }

    if (Array.isArray(response.StationTimes)) {
      return response.StationTimes;
    }

    if (response.StationTimes && typeof response.StationTimes === "object") {
      return [response.StationTimes];
    }

    if (Array.isArray(response)) {
      return response;
    }

    if (response.FirstTrains || response.LastTrains) {
      return [response];
    }

    return [];
  },

  normalizeScheduleRows(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((item) => {
        const rawTime = item && (item.Time || item.ScheduleTime || item.DepartureTime || item.DepTime || "");
        const time = this.normalizeStationTime(rawTime);
        const sortValue = this.parseScheduleSortValue(rawTime);
        const direction = this.normalizeScheduleDirection(item && (item.DirectionNum || item.Group || item.Direction || item.Dir));

        return {
          line: String((item && (item.LineCode || item.Line || item.LineAbbrev)) || "NA").toUpperCase(),
          destination: String((item && (item.DestinationStationName || item.DestinationName || item.DestinationStation || item.Destination)) || "Unknown").trim() || "Unknown",
          direction,
          time,
          sortValue
        };
      })
      .filter((item) => (item.direction === "northbound" || item.direction === "southbound") && Number.isFinite(item.sortValue));
  },

  normalizeScheduleDirection(directionValue) {
    const normalized = String(directionValue || "").trim().toLowerCase();
    if (["1", "northbound", "north", "n", "nb"].includes(normalized)) {
      return "northbound";
    }

    if (["2", "southbound", "south", "s", "sb"].includes(normalized)) {
      return "southbound";
    }

    return null;
  },

  parseScheduleSortValue(rawTime) {
    const raw = String(rawTime || "").trim();
    if (!raw) {
      return Number.POSITIVE_INFINITY;
    }

    const colonMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
      const hour = parseNumber(colonMatch[1], NaN);
      const minute = parseNumber(colonMatch[2], NaN);
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        return (hour * 100) + minute;
      }
      return Number.POSITIVE_INFINITY;
    }

    const digitsOnly = raw.replace(/[^0-9]/g, "");
    if (digitsOnly.length < 3 || digitsOnly.length > 4) {
      return Number.POSITIVE_INFINITY;
    }

    const hour = parseNumber(digitsOnly.substring(0, digitsOnly.length - 2), NaN);
    const minute = parseNumber(digitsOnly.substring(digitsOnly.length - 2), NaN);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return Number.POSITIVE_INFINITY;
    }

    return (hour * 100) + minute;
  },

  resolveMetroBusStopProfiles() {
    const configuredStops = Array.isArray(this.config.metroBusStops) ? this.config.metroBusStops : [];

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

    const stopProfiles = this.resolveMetroBusStopProfiles();
    if (!stopProfiles.length) {
      return [];
    }

    const stops = await Promise.all(stopProfiles.map(async (profile) => {
      try {
        const url = `https://api.wmata.com/NextBusService.svc/json/jPredictions?StopID=${encodeURIComponent(profile.stopId)}`;
        const response = await this.getJson(url);
        const rawPredictions = Array.isArray(response.Predictions) ? response.Predictions : [];

        const predictions = rawPredictions
          .filter((prediction) => this.matchesBusRouteFilter(prediction.RouteID || prediction.Route, profile.routeFilter))
          .map((prediction) => {
            const minutesRaw = prediction.Minutes != null ? prediction.Minutes : prediction.Min;
            return {
              route: prediction.RouteID || prediction.Route || "--",
              destination: prediction.DirectionText || prediction.TripHeadSign || prediction.DestinationName || "Unknown",
              direction: prediction.DirectionText || prediction.Direction || "-",
              displayMinutes: this.formatBusMinutes(minutesRaw),
              minutesSort: this.normalizeBusMinutes(minutesRaw)
            };
          })
          .sort((a, b) => {
            if (a.minutesSort !== b.minutesSort) {
              return a.minutesSort - b.minutesSort;
            }

            return String(a.route).localeCompare(String(b.route));
          })
          .slice(0, Math.max(1, profile.maxRows));

        return {
          stopId: profile.stopId,
          name: profile.name || response.StopName || profile.stopId,
          predictions
        };
      } catch {
        return {
          stopId: profile.stopId,
          name: profile.name || profile.stopId,
          predictions: []
        };
      }
    }));

    return stops.sort((a, b) => {
      const pa = stopProfiles.find((item) => item.stopId === a.stopId);
      const pb = stopProfiles.find((item) => item.stopId === b.stopId);
      return (pa ? pa.priority : 0) - (pb ? pb.priority : 0);
    });
  },

  matchesBusRouteFilter(route, routeFilter) {
    const filter = normalizeList(routeFilter);
    if (!filter.length) {
      return true;
    }

    return filter.map((entry) => entry.toUpperCase()).includes(String(route || "").toUpperCase());
  },

  isMetroBusOnlyMode() {
    return parseBoolean(this.config.metroBusOnlyMode, false);
  },

  isMetroBusEnabled() {
    return parseBoolean(this.config.showMetroBus, false) || this.isMetroBusOnlyMode();
  },

  normalizeBusMinutes(value) {
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

  formatBusMinutes(value) {
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

  resolveStationProfiles() {
    const configuredStations = Array.isArray(this.config.stationCodes) && this.config.stationCodes.length
      ? this.config.stationCodes
      : ["A01"];

    return configuredStations
      .map((entry, index) => this.normalizeStationProfile(entry, index))
      .filter(Boolean);
  },

  normalizeStationProfile(entry, index) {
    const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
    const code = isObject ? entry.code || entry.stationCode || entry.id : entry;

    if (!code) {
      return null;
    }

    return {
      code: String(code).trim(),
      name: isObject ? entry.name || entry.label || null : null,
      lineFilter: isObject && entry.lineFilter ? normalizeList(entry.lineFilter) : normalizeList(this.config.lineFilter),
      destinationIncludes: isObject && entry.destinationIncludes ? normalizeList(entry.destinationIncludes) : normalizeList(this.config.destinationIncludes),
      maxRows: parseNumber(isObject && entry.maxRows != null ? entry.maxRows : this.config.maxRows, this.config.maxRows),
      compact: Boolean(isObject && entry.compact != null ? entry.compact : this.config.compact),
      groupByLine: isObject && entry.groupByLine != null ? Boolean(entry.groupByLine) : Boolean(this.config.groupByLine),
      showIncidents: isObject && entry.showIncidents != null ? Boolean(entry.showIncidents) : Boolean(this.config.showIncidents),
      alerts: isObject && entry.alerts ? normalizeList(entry.alerts) : normalizeList(this.config.alertRules),
      showFirstLastTrains: isObject && entry.showFirstLastTrains != null ? Boolean(entry.showFirstLastTrains) : Boolean(this.config.showFirstLastTrains),
      firstLastTrainMode: isObject && entry.firstLastTrainMode ? String(entry.firstLastTrainMode).toLowerCase() : String(this.config.firstLastTrainMode || "filtered").toLowerCase(),
      priority: parseNumber(isObject && entry.priority != null ? entry.priority : index, index)
    };
  },

  groupPredictionsByStation(predictions) {
    const grouped = {};

    predictions
      .filter((item) => this.matchesLineFilter(item.Line, this.config.lineFilter))
      .filter((item) => this.matchesDestinationFilter(item.DestinationName, this.config.destinationIncludes))
      .forEach((item) => {
        const stationCode = item.LocationCode;
        if (!stationCode) {
          return;
        }

        if (!grouped[stationCode]) {
          grouped[stationCode] = [];
        }

        grouped[stationCode].push({
          line: item.Line || "NA",
          destination: item.DestinationName || "Unknown",
          direction: this.directionFromNumber(item.Group),
          minutesRaw: item.Min,
          displayMinutes: this.formatMinutes(item.Min),
          minutesSort: this.normalizeMinutes(item.Min),
          cars: item.Car
        });
      });

    Object.keys(grouped).forEach((stationCode) => {
      grouped[stationCode].sort((a, b) => {
        if (a.minutesSort !== b.minutesSort) {
          return a.minutesSort - b.minutesSort;
        }

        return a.destination.localeCompare(b.destination);
      });
    });

    return grouped;
  },

  buildStationPayload(grouped, incidents, weather) {
    const now = Date.now();
    const profiles = this.stationProfiles.slice(0).sort((a, b) => a.priority - b.priority);

    return profiles.map((profile) => {
      const rawPredictions = grouped[profile.code] || [];
      const predictions = this.filterAndDecoratePredictions(rawPredictions, profile, incidents, now);
      const groupedByLine = this.groupPredictionsByLine(predictions);
      const alerts = this.collectAlerts(predictions, incidents, profile);
      const condition = this.buildConditionSummary(predictions, incidents, weather, now);
      const firstLastTrains = this.deriveFirstLastTrains(profile.code, profile);

      return {
        code: profile.code,
        name: this.stationMap[profile.code] || profile.code,
        displayName: profile.name || this.stationMap[profile.code] || profile.code,
        profile,
        predictions,
        groupedPredictions: groupedByLine,
        nextSummary: predictions.slice(0, parseNumber(this.config.summaryCount, 3)),
        alerts,
        conditionText: condition.text,
        conditionClass: condition.className,
        firstLastTrains
      };
    });
  },

  filterAndDecoratePredictions(predictions, profile, incidents, now) {
    const incidentLines = this.collectIncidentLines(incidents);

    return predictions
      .filter((item) => this.matchesLineFilter(item.line, profile.lineFilter))
      .filter((item) => this.matchesDestinationFilter(item.destination, profile.destinationIncludes))
      .map((item) => this.decoratePrediction(item, incidentLines, now));
  },

  decoratePrediction(prediction, incidentLines, now) {
    const status = this.classifyPrediction(prediction, incidentLines);
    const carsClass = this.classifyCars(prediction.cars);

    return {
      line: prediction.line || "NA",
      destination: prediction.destination || "Unknown",
      direction: prediction.direction || "-",
      displayMinutes: prediction.displayMinutes,
      minutesSort: prediction.minutesSort,
      cars: prediction.cars || "",
      carsLabel: this.formatCars(prediction.cars),
      carsClass,
      statusClass: status.className,
      statusLabel: status.label,
      alerts: prediction.alerts || [],
      fetchedAt: now
    };
  },

  classifyPrediction(prediction, incidentLines) {
    const line = String(prediction.line || "").toUpperCase();
    const matchedIncident = incidentLines[line] || null;

    const thresholds = this.config.statusThresholds || {};
    const watchMinutes = parseNumber(thresholds.watchMinutes, 8);
    const delayedMinutes = parseNumber(thresholds.delayedMinutes, 15);
    const criticalMinutes = parseNumber(thresholds.criticalMinutes, 25);

    if (matchedIncident && matchedIncident.rank >= 3) {
      return { className: "alert", label: "Alert" };
    }

    if (prediction.displayMinutes === "Boarding") {
      return { className: "boarding", label: "Boarding" };
    }

    if (prediction.displayMinutes === "Arriving") {
      return { className: "arriving", label: "Arriving" };
    }

    if (prediction.minutesSort >= criticalMinutes) {
      return { className: "critical", label: "Critical wait" };
    }

    if (prediction.minutesSort >= delayedMinutes) {
      return { className: "delayed", label: "Delayed" };
    }

    if (prediction.minutesSort >= watchMinutes) {
      return { className: "watch", label: "Watch" };
    }

    return { className: "normal", label: "On time" };
  },

  classifyCars(cars) {
    const numeric = Number(String(cars || "").replace(/[^0-9]/g, ""));

    if (!Number.isFinite(numeric)) {
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

    predictions.forEach((prediction) => {
      prediction.alerts = alerts;
    });

    return alerts;
  },

  buildConditionSummary(predictions, incidents, weather, now) {
    const freshness = this.getFreshnessState(this.lastBroadcastAt || now);
    const activeIncidents = incidents.filter((incident) => this.matchesSeverityFilter(incident.severity));
    const delayedTrains = predictions.filter((prediction) => prediction.statusClass === "delayed" || prediction.statusClass === "alert");

    if (weather && this.config.showWeather) {
      return {
        text: `${activeIncidents.length ? `${activeIncidents.length} alert${activeIncidents.length === 1 ? "" : "s"}` : "Service normal"} • ${this.formatWeather(weather)}`,
        className: weather.isDay === 0 ? "dcmetro__condition--night" : "dcmetro__condition--weather"
      };
    }

    if (activeIncidents.length) {
      return {
        text: `${activeIncidents.length} service alert${activeIncidents.length === 1 ? "" : "s"}${delayedTrains.length ? ` • ${delayedTrains.length} delayed train${delayedTrains.length === 1 ? "" : "s"}` : ""}`,
        className: "dcmetro__condition--alert"
      };
    }

    if (delayedTrains.length) {
      return {
        text: `${delayedTrains.length} train${delayedTrains.length === 1 ? "" : "s"} delayed`,
        className: "dcmetro__condition--delayed"
      };
    }

    return {
      text: freshness.isStale ? `Data stale ${this.relativeTime(now)}` : "Service normal",
      className: freshness.isStale ? "dcmetro__condition--stale" : "dcmetro__condition--normal"
    };
  },

  collectIncidentLines(incidents) {
    const map = {};

    incidents.forEach((incident) => {
      incident.lineCodes.forEach((line) => {
        const key = String(line || "").toUpperCase();
        const existing = map[key];
        if (!existing || incident.rank > existing.rank) {
          map[key] = incident;
        }
      });
    });

    return map;
  },

  groupPredictionsByLine(predictions) {
    const grouped = {};

    predictions.forEach((prediction) => {
      const line = String(prediction.line || "NA").toUpperCase();
      if (!grouped[line]) {
        grouped[line] = [];
      }

      grouped[line].push(prediction);
    });

    return Object.keys(grouped)
      .sort((a, b) => this.getLineWeight(a) - this.getLineWeight(b))
      .map((line) => ({
        line,
        predictions: grouped[line].slice(0).sort((a, b) => {
          if (a.minutesSort !== b.minutesSort) {
            return a.minutesSort - b.minutesSort;
          }

          return a.destination.localeCompare(b.destination);
        })
      }));
  },

  getLineWeight(lineCode) {
    const customOrder = normalizeList(this.config.lineOrder).map((entry) => entry.toUpperCase());
    const normalizedLine = String(lineCode || "NA").toUpperCase();
    const index = customOrder.indexOf(normalizedLine);
    if (index >= 0) {
      return index + 1;
    }

    return lineWeight(normalizedLine);
  },

  matchesLineFilter(line, lineFilter) {
    const filter = normalizeList(lineFilter);
    if (!filter.length) {
      return true;
    }

    return filter.map((entry) => entry.toUpperCase()).includes(String(line || "").toUpperCase());
  },

  matchesDestinationFilter(destination, destinationIncludes) {
    const includes = normalizeList(destinationIncludes);
    if (!includes.length) {
      return true;
    }

    const needle = String(destination || "").toLowerCase();
    return includes.some((entry) => needle.includes(entry.toLowerCase()));
  },

  matchesSeverityFilter(severity) {
    const filter = String(this.config.incidentSeverityFilter || "all").toLowerCase();
    const rank = { all: 0, advisory: 1, major: 2, critical: 3 };
    return (rank[String(severity || "advisory").toLowerCase()] || 1) >= (rank[filter] || 0);
  },

  formatIncidentDateRange(item) {
    const start = this.parseIncidentDateValue(item, ["StartTime", "StartDate", "BeginTime", "BeginDate", "EffectiveDate", "PublishedDate"]);
    const end = this.parseIncidentDateValue(item, ["EndTime", "EndDate", "ExpireTime", "ExpirationDate", "ToTime", "ToDate", "ThroughDate"]);

    if (!start && !end) {
      return "";
    }

    if (start && end) {
      return this.formatIncidentDateOnly(start) === this.formatIncidentDateOnly(end)
        ? this.formatIncidentDateOnly(start)
        : `${this.formatIncidentDateOnly(start)} - ${this.formatIncidentDateOnly(end)}`;
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
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    return null;
  },

  formatIncidentDateOnly(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
    const day = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(date);
    const year = date.getFullYear();
    const currentYear = new Date().getFullYear();
    const yearSuffix = year !== currentYear ? `, ${year}` : "";

    return `${month} ${day}${yearSuffix}`;
  },

  normalizeLines(linesAffected) {
    return String(linesAffected || "")
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean);
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

  normalizeMinutes(value) {
    if (value === "BRD" || value === "ARR") {
      return 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 999;
  },

  formatMinutes(value) {
    if (value === "BRD") {
      return "Boarding";
    }

    if (value === "ARR") {
      return "Arriving";
    }

    return `${value} min`;
  },

  classifyIncident(description) {
    const text = String(description || "").toLowerCase();

    if (/suspend|suspended|no service|shutdown|evacuat|fire|police|disabled|track work|bus bridge|major delay/.test(text)) {
      return { rank: 3, severity: "critical", severityLabel: "Critical" };
    }

    if (/delay|delayed|single track|slow|minor|construction|maintenance/.test(text)) {
      return { rank: 2, severity: "major", severityLabel: "Major" };
    }

    return { rank: 1, severity: "advisory", severityLabel: "Advisory" };
  },

  formatWeather(weather) {
    const temperature = Math.round(Number(weather.temperature));
    const summary = this.weatherSummary(weather.weathercode);
    return `${Number.isFinite(temperature) ? `${temperature}°F` : "Weather"} ${summary}`.trim();
  },

  weatherSummary(code) {
    const numeric = Number(code);

    if (numeric === 0) {
      return "Clear";
    }
    if (numeric === 1) {
      return "Mostly clear";
    }
    if (numeric === 2) {
      return "Partly cloudy";
    }
    if (numeric === 3) {
      return "Cloudy";
    }
    if (numeric === 45 || numeric === 48) {
      return "Fog";
    }
    if (numeric >= 51 && numeric <= 67) {
      return "Rain";
    }
    if (numeric >= 71 && numeric <= 77) {
      return "Snow";
    }
    if (numeric >= 80 && numeric <= 82) {
      return "Showers";
    }
    if (numeric >= 95) {
      return "Thunderstorms";
    }

    return "Weather";
  },

  getFreshnessState(timestamp) {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return {
      ageSeconds,
      isStale: ageSeconds > this.config.staleAfterSeconds
    };
  },

  getJson(url) {
    const headers = {
      api_key: this.config.apiKey
    };

    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers }, (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
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
