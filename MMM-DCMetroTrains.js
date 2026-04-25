/* global Module */

const LINE_ORDER = {
  rd: 1,
  or: 2,
  sv: 3,
  bl: 4,
  yl: 5,
  gr: 6,
  na: 99
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
  const match = /^([0-2]\d):([0-5]\d)$/.exec(String(value || "").trim());
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function lineSortWeight(lineCode) {
  return LINE_ORDER[String(lineCode || "na").toLowerCase()] || 90;
}

function weatherSummary(code) {
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
    showTrack: true,
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
    showWeather: false,
    weatherLatitude: null,
    weatherLongitude: null,
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
    this.dataState = {
      stations: [],
      busStops: [],
      incidents: [],
      weather: null,
      fetchedAt: null,
      error: null
    };
    this.currentStationIndex = 0;
    this.rotationTimer = null;
    this.retryTimer = null;
    this.loaded = false;
    this.stationProfiles = this.resolveStationProfiles();

    this.sendSocketNotification("DC_METRO_CONFIG", this.config);
    this.startRotation();
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
    wrapper.className = `dcmetro ${isCompact ? "dcmetro--compact" : ""} ${isMetroBusOnly ? "dcmetro--busOnly" : ""} ${isCommuteTime ? "dcmetro--commute" : ""} ${isQuietHours ? "dcmetro--quiet" : ""} ${shouldBlinkCritical ? "dcmetro--criticalBlink" : ""} ${showBorders ? "" : "dcmetro--noBorders"} ${showBackground ? "" : "dcmetro--noBackground"}`.trim();
    wrapper.style.fontSize = `${parseNumber(this.config.fontScale, 1)}em`;

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

    if (this.dataState.error) {
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
      const stamp = document.createElement("div");
      const freshness = this.getFreshnessState(this.dataState.fetchedAt);
      stamp.className = `dcmetro__updated xsmall dimmed ${freshness.isStale ? "dcmetro__updated--stale" : ""}`.trim();
      stamp.textContent = `Updated ${this.relativeTime(this.dataState.fetchedAt)}`;
      wrapper.appendChild(stamp);
    }

    return wrapper;
  },

  buildSummaryStrip(isCommuteTime, isCompact, isQuietHours) {
    const station = this.getActiveStation();
    if (!station) {
      return null;
    }

    const summary = document.createElement("div");
    summary.className = "dcmetro__summary";

    if (this.config.showNextSummary && !isQuietHours) {
      const next = station.nextSummary || [];
      if (next.length) {
        const chip = document.createElement("div");
        chip.className = "dcmetro__summaryChip";
        const label = document.createElement("span");
        label.className = "dcmetro__summaryLabel";
        label.textContent = "Next";
        const value = document.createElement("span");
        value.textContent = next.map((item) => `${item.line} ${item.destination} ${item.displayMinutes}`).join(" • ");
        chip.appendChild(label);
        chip.appendChild(value);
        summary.appendChild(chip);
      }
    }

    if (this.config.showFreshnessChip && this.dataState.fetchedAt) {
      const freshness = this.getFreshnessState(this.dataState.fetchedAt);
      const chip = document.createElement("div");
      chip.className = `dcmetro__summaryChip ${freshness.isStale ? "dcmetro__summaryChip--stale" : ""}`.trim();
      const label = document.createElement("span");
      label.className = "dcmetro__summaryLabel";
      label.textContent = freshness.isStale ? "Stale" : "Fresh";
      const value = document.createElement("span");
      value.textContent = this.relativeTime(this.dataState.fetchedAt);
      chip.appendChild(label);
      chip.appendChild(value);
      summary.appendChild(chip);
    }

    if (isCommuteTime && !isQuietHours) {
      const chip = document.createElement("div");
      chip.className = `dcmetro__summaryChip ${isCompact ? "dcmetro__summaryChip--compact" : ""}`.trim();
      const label = document.createElement("span");
      label.className = "dcmetro__summaryLabel";
      label.textContent = "Commute";
      const value = document.createElement("span");
      value.textContent = isCompact ? "Compact mode" : "Peak window";
      chip.appendChild(label);
      chip.appendChild(value);
      summary.appendChild(chip);
    }

    if (this.dataState.weather && this.config.showWeather && !isQuietHours) {
      const chip = document.createElement("div");
      chip.className = "dcmetro__summaryChip";
      const label = document.createElement("span");
      label.className = "dcmetro__summaryLabel";
      label.textContent = "Weather";
      const value = document.createElement("span");
      value.textContent = this.formatWeather(this.dataState.weather);
      chip.appendChild(label);
      chip.appendChild(value);
      summary.appendChild(chip);
    }

    return summary.childNodes.length ? summary : null;
  },

  buildStationCard(station, isCompact) {
    const card = document.createElement("section");
    const freshness = this.getFreshnessState(this.dataState.fetchedAt);
    card.className = `dcmetro__stationCard ${station.alerts.length ? "dcmetro__stationCard--alert" : ""} ${freshness.isStale ? "dcmetro__stationCard--stale" : ""}`.trim();

    if (this.config.showHeader) {
      card.appendChild(this.buildHeader(station));
    }

    if (this.config.showConditions) {
      card.appendChild(this.buildConditionsRow(station));
    }

    if (station.alerts.length) {
      card.appendChild(this.buildAlertBanner(station.alerts));
    }

    if (this.config.showNextSummary && station.nextSummary.length) {
      card.appendChild(this.buildForecastSummary(station.nextSummary));
    }

    card.appendChild(this.buildArrivals(station, isCompact));
    return card;
  },

  buildHeader(station) {
    const header = document.createElement("div");
    header.className = "dcmetro__header";

    const title = document.createElement("div");
    title.className = "dcmetro__station";
    title.textContent = this.formatStationTitle(station);
    header.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "dcmetro__meta";

    if (this.config.showStationCode) {
      const code = document.createElement("span");
      code.className = "dcmetro__chip";
      code.textContent = station.code;
      meta.appendChild(code);
    }

    if (this.dataState.stations.length > 1 && this.config.rotateStations) {
      const index = document.createElement("span");
      index.className = "dcmetro__chip";
      index.textContent = `${this.currentStationIndex + 1}/${this.dataState.stations.length}`;
      meta.appendChild(index);
    }

    if (station.profile.compact) {
      const compactChip = document.createElement("span");
      compactChip.className = "dcmetro__chip";
      compactChip.textContent = "Compact";
      meta.appendChild(compactChip);
    }

    header.appendChild(meta);
    return header;
  },

  buildConditionsRow(station) {
    const conditions = document.createElement("div");
    conditions.className = "dcmetro__conditions";

    const transitChip = document.createElement("div");
    transitChip.className = `dcmetro__condition ${station.conditionClass || "dcmetro__condition--normal"}`.trim();
    transitChip.textContent = station.conditionText;
    conditions.appendChild(transitChip);

    if (this.config.showWeather && this.dataState.weather) {
      const weatherChip = document.createElement("div");
      weatherChip.className = "dcmetro__condition dcmetro__condition--weather";
      weatherChip.textContent = this.formatWeather(this.dataState.weather);
      conditions.appendChild(weatherChip);
    }

    return conditions;
  },

  buildAlertBanner(alerts) {
    const banner = document.createElement("div");
    banner.className = "dcmetro__alerts";

    alerts.slice(0, 3).forEach((alert) => {
      const item = document.createElement("div");
      item.className = `dcmetro__alert dcmetro__alert--${alert.severity}`;
      item.textContent = alert.message;
      banner.appendChild(item);
    });

    return banner;
  },

  buildForecastSummary(nextSummary) {
    const forecast = document.createElement("div");
    forecast.className = "dcmetro__forecast";

    nextSummary.slice(0, this.config.summaryCount).forEach((prediction) => {
      const chip = document.createElement("span");
      chip.className = `dcmetro__forecastChip dcmetro__forecastChip--${prediction.statusClass}`;
      chip.textContent = `${prediction.line} ${prediction.destination} ${prediction.displayMinutes}`;
      forecast.appendChild(chip);
    });

    return forecast;
  },

  buildArrivals(station, isCompact) {
    const includeLine = !this.getStationEffectiveSetting(station, "groupByLine", this.config.groupByLine);
    const rows = station.predictions.slice(0, this.getStationEffectiveRows(station, isCompact));

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "dcmetro__empty dimmed";
      empty.textContent = this.getFallbackMessage("No upcoming trains.");
      return empty;
    }

    if (this.getStationEffectiveSetting(station, "groupByLine", this.config.groupByLine)) {
      const grouped = this.groupPredictionsByLine(rows);
      const container = document.createElement("div");
      container.className = "dcmetro__groups";

      grouped.forEach((group) => {
        const section = document.createElement("section");
        section.className = "dcmetro__group";

        const groupHeader = document.createElement("div");
        groupHeader.className = "dcmetro__groupHeader";
        const badge = this.buildLineBadge(group.line);
        groupHeader.appendChild(badge);

        const groupMeta = document.createElement("span");
        groupMeta.className = "dcmetro__groupMeta dimmed xsmall";
        groupMeta.textContent = `${group.predictions.length} trains`;
        groupHeader.appendChild(groupMeta);

        section.appendChild(groupHeader);
        section.appendChild(this.buildPredictionTable(group.predictions, includeLine, true));
        container.appendChild(section);
      });

      return container;
    }

    return this.buildPredictionTable(rows, includeLine, false);
  },

  buildPredictionTable(predictions, includeLine, groupedMode) {
    const table = document.createElement("table");
    table.className = `dcmetro__table small ${groupedMode ? "dcmetro__table--grouped" : "dcmetro__table--flat"}`;

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");

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
    if (this.config.showTrack) {
      columns.push("Track");
    }
    if (this.config.showStatus) {
      columns.push("Status");
    }

    columns.forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });

    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");

    predictions.forEach((prediction) => {
      const row = document.createElement("tr");
      row.className = `dcmetro__row dcmetro__row--${prediction.statusClass} ${prediction.alerts.length ? "dcmetro__row--alert" : ""}`.trim();

      if (includeLine) {
        const lineCell = document.createElement("td");
        lineCell.appendChild(this.buildLineBadge(prediction.line));
        row.appendChild(lineCell);
      }

      const destination = document.createElement("td");
      destination.className = "dcmetro__dest";
      destination.textContent = prediction.destination;
      row.appendChild(destination);

      if (this.config.showDirection) {
        const direction = document.createElement("td");
        direction.className = "dcmetro__dir dimmed";
        direction.textContent = prediction.direction;
        row.appendChild(direction);
      }

      const minutes = document.createElement("td");
      minutes.className = `dcmetro__eta ${this.getEtaClass(prediction)}`.trim();
      minutes.textContent = prediction.displayMinutes;
      row.appendChild(minutes);

      if (this.config.showCars) {
        const cars = document.createElement("td");
        cars.className = `dcmetro__cars ${this.getCarsClassForMode(prediction)}`.trim();
        cars.textContent = prediction.carsLabel;
        row.appendChild(cars);
      }

      if (this.config.showTrack) {
        const track = document.createElement("td");
        track.className = "dcmetro__track dimmed";
        track.textContent = prediction.track || "-";
        row.appendChild(track);
      }

      if (this.config.showStatus) {
        const status = document.createElement("td");
        status.className = `dcmetro__status dcmetro__status--${prediction.statusClass}`;
        status.textContent = prediction.statusLabel;
        row.appendChild(status);
      }

      body.appendChild(row);
    });

    table.appendChild(body);
    return table;
  },

  buildLineBadge(lineCode) {
    const line = String(lineCode || "NA").toLowerCase();
    const badge = document.createElement("span");
    badge.className = `dcmetro__line dcmetro__line--${line}`;
    badge.textContent = lineCode || "--";
    return badge;
  },

  buildIncidents() {
    const container = document.createElement("div");
    container.className = "dcmetro__incidents";

    const incidents = this.getFilteredIncidentsForDisplay();
    const maxIncidentRows = Math.max(1, parseNumber(this.config.maxIncidentRows, 3));

    if (this.config.incidentScroll) {
      container.classList.add("dcmetro__incidents--scroll");
      container.style.setProperty("--dcmetro-incident-scroll-duration", `${Math.max(8, parseNumber(this.config.incidentScrollSpeed, 28))}s`);
    }

    if (!incidents.length) {
      container.classList.add("xsmall", "dimmed");
      container.textContent = "No active Metro service alerts.";
      return container;
    }

    incidents.slice(0, maxIncidentRows).forEach((incident) => {
      const line = document.createElement("div");
      line.className = `dcmetro__incident dcmetro__incident--${incident.severity}`;

      const chip = document.createElement("span");
      chip.className = `dcmetro__incidentSeverity dcmetro__incidentSeverity--${incident.severity}`;
      chip.textContent = incident.severityLabel;
      line.appendChild(chip);

      if (incident.dateRangeText) {
        const range = document.createElement("span");
        range.className = "dcmetro__incidentRange";
        range.textContent = incident.dateRangeText;
        line.appendChild(range);
      }

      const text = document.createElement("span");
      text.textContent = `${incident.linesText}: ${incident.description}`;
      line.appendChild(text);

      container.appendChild(line);
    });

    return container;
  },

  buildMetroBusSection() {
    const section = document.createElement("section");
    section.className = "dcmetro__bus";

    if (this.config.showMetroBusHeader) {
      const header = document.createElement("div");
      header.className = "dcmetro__busHeader";
      header.textContent = "Metrobus";
      section.appendChild(header);
    }

    const stops = Array.isArray(this.dataState.busStops) ? this.dataState.busStops : [];
    if (!stops.length) {
      const empty = document.createElement("div");
      empty.className = "dcmetro__empty dimmed";
      empty.textContent = "No Metrobus stops configured.";
      section.appendChild(empty);
      return section;
    }

    stops.forEach((stop) => {
      section.appendChild(this.buildMetroBusStopCard(stop));
    });

    return section;
  },

  buildMetroBusStopCard(stop) {
    const card = document.createElement("div");
    card.className = "dcmetro__busStop";

    const title = document.createElement("div");
    title.className = "dcmetro__busStopName";
    title.textContent = stop.name || stop.stopId;
    card.appendChild(title);

    const predictions = Array.isArray(stop.predictions) ? stop.predictions : [];
    if (!predictions.length) {
      const empty = document.createElement("div");
      empty.className = "dcmetro__empty dimmed";
      empty.textContent = "No upcoming buses.";
      card.appendChild(empty);
      return card;
    }

    const table = document.createElement("table");
    table.className = "dcmetro__table small dcmetro__busTable";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Route", "Destination", "Min"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    predictions.slice(0, Math.max(1, parseNumber(this.config.metroBusMaxRows, 5))).forEach((prediction) => {
      const row = document.createElement("tr");

      const route = document.createElement("td");
      route.className = "dcmetro__busRoute";
      route.textContent = prediction.route || "--";
      row.appendChild(route);

      const destination = document.createElement("td");
      destination.className = "dcmetro__dest";
      destination.textContent = prediction.destination || "Unknown";
      row.appendChild(destination);

      const minutes = document.createElement("td");
      minutes.className = "dcmetro__eta";
      minutes.textContent = prediction.displayMinutes || "--";
      row.appendChild(minutes);

      body.appendChild(row);
    });

    table.appendChild(body);
    card.appendChild(table);
    return card;
  },

  getVisibleStations() {
    let visibleStations = this.dataState.stations;
    if (this.config.hideWhenNoTrains) {
      visibleStations = visibleStations.filter((station) => (station.predictions || []).length > 0);
    }

    if (!visibleStations.length) {
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
      if (this.dataState.stations.length < 2) {
        return;
      }

      this.currentStationIndex = (this.currentStationIndex + 1) % this.dataState.stations.length;
      this.updateDom(this.config.animationSpeed);
    }, this.config.stationRotationInterval);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "DC_METRO_DATA") {
      this.loaded = true;
      this.dataState = {
        stations: payload.stations || [],
        busStops: payload.busStops || [],
        incidents: payload.incidents || [],
        weather: payload.weather || null,
        fetchedAt: payload.fetchedAt || Date.now(),
        error: null
      };

      if (this.currentStationIndex >= this.dataState.stations.length) {
        this.currentStationIndex = 0;
      }

      this.updateDom(this.config.animationSpeed);
      return;
    }

    if (notification === "DC_METRO_ERROR") {
      this.loaded = true;
      this.dataState.error = payload || "Unable to load Metro train data.";
      this.updateDom(this.config.animationSpeed);
    }
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

    const profile = {
      code: String(code).trim(),
      name: isObject ? entry.name || entry.label || null : null,
      lineFilter: isObject && entry.lineFilter ? normalizeList(entry.lineFilter) : normalizeList(this.config.lineFilter),
      destinationIncludes: isObject && entry.destinationIncludes ? normalizeList(entry.destinationIncludes) : normalizeList(this.config.destinationIncludes),
      maxRows: parseNumber(isObject && entry.maxRows != null ? entry.maxRows : this.config.maxRows, this.config.maxRows),
      compact: Boolean(isObject && entry.compact != null ? entry.compact : this.config.compact),
      groupByLine: isObject && entry.groupByLine != null ? Boolean(entry.groupByLine) : Boolean(this.config.groupByLine),
      showIncidents: isObject && entry.showIncidents != null ? Boolean(entry.showIncidents) : Boolean(this.config.showIncidents),
      alerts: normalizeList(isObject && entry.alerts ? entry.alerts : this.config.alertRules),
      priority: parseNumber(isObject && entry.priority != null ? entry.priority : index, index)
    };

    return profile;
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

    return lineSortWeight(normalizedLine);
  },

  getEtaClass(prediction) {
    const mode = String(this.config.etaColorMode || "status").toLowerCase();
    if (mode === "off") {
      return "";
    }

    if (mode === "gradient") {
      if (prediction.displayMinutes === "Boarding" || prediction.displayMinutes === "Arriving") {
        return "dcmetro__eta--boarding";
      }

      const minutes = parseNumber(prediction.minutesSort, 999);
      const thresholds = this.config.statusThresholds || {};
      const watchMinutes = parseNumber(thresholds.watchMinutes, 8);
      const delayedMinutes = parseNumber(thresholds.delayedMinutes, 15);
      const criticalMinutes = parseNumber(thresholds.criticalMinutes, 25);

      if (minutes >= criticalMinutes) {
        return "dcmetro__eta--critical";
      }
      if (minutes >= delayedMinutes) {
        return "dcmetro__eta--delayed";
      }
      if (minutes >= watchMinutes) {
        return "dcmetro__eta--watch";
      }
      return "dcmetro__eta--normal";
    }

    return `dcmetro__eta--${prediction.statusClass}`;
  },

  getCarsClassForMode(prediction) {
    const mode = parseBoolean(this.config.showCarHighlights, false)
      ? "capacity"
      : String(this.config.carsColorMode || "wmata").toLowerCase();
    if (mode === "off") {
      return "dcmetro__cars--off";
    }

    if (mode === "capacity") {
      return prediction.carsClass || "dcmetro__cars--unknown";
    }

    if (mode === "wmata") {
      if (prediction.carsClass === "dcmetro__cars--high") {
        return "dcmetro__cars--wmata-high";
      }
      if (prediction.carsClass === "dcmetro__cars--medium") {
        return "dcmetro__cars--wmata-medium";
      }
      if (prediction.carsClass === "dcmetro__cars--low") {
        return "dcmetro__cars--wmata-low";
      }
      return "dcmetro__cars--unknown";
    }

    return prediction.carsClass || "dcmetro__cars--unknown";
  },

  getFilteredIncidentsForDisplay() {
    let incidents = (this.dataState.incidents || []).filter((incident) => this.matchesSeverityFilter(incident.severity));

    if (!this.config.onlyShowAlertsForVisibleLines) {
      return incidents;
    }

    const visibleLines = new Set();
    this.getVisibleStations().forEach((station) => {
      (station.predictions || []).forEach((prediction) => {
        visibleLines.add(String(prediction.line || "").toUpperCase());
      });
    });

    if (!visibleLines.size) {
      return [];
    }

    incidents = incidents.filter((incident) => {
      const lines = incident.lineCodes || [];
      if (!lines.length) {
        return true;
      }
      return lines.some((line) => visibleLines.has(String(line || "").toUpperCase()));
    });

    return incidents;
  },

  hasCriticalIncident() {
    return this.getFilteredIncidentsForDisplay().some((incident) => String(incident.severity || "").toLowerCase() === "critical");
  },

  isQuietHours() {
    const quietHours = this.config.quietHours || {};
    const now = new Date();
    return this.matchesAnyWindow(now, quietHours);
  },

  matchesAnyWindow(now, schedule) {
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    const windows = Array.isArray(isWeekend ? schedule.weekends : schedule.weekdays)
      ? (isWeekend ? schedule.weekends : schedule.weekdays)
      : [];

    return windows.some((window) => this.matchesWindow(now, window));
  },

  formatStationTitle(station) {
    const mode = String(this.config.stationTitleFormat || "name").toLowerCase();
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
    const debug = document.createElement("div");
    debug.className = "dcmetro__debug xsmall dimmed";
    const stations = this.getVisibleStations();
    const rows = stations.reduce((sum, station) => sum + (station.predictions || []).length, 0);
    const incidents = this.getFilteredIncidentsForDisplay().length;
    debug.textContent = `Debug stations=${stations.length} rows=${rows} incidents=${incidents} commute=${isCommuteTime} quiet=${isQuietHours} compact=${isCompact} fetched=${this.dataState.fetchedAt || 0}`;
    return debug;
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

    return clamp(Math.min(baseRows, parseNumber(this.config.commuteMaxRows, 5)), 1, baseRows);
  },

  isMetroBusOnlyMode() {
    return parseBoolean(this.config.metroBusOnlyMode, false);
  },

  fetchWeatherIfConfigured() {
    const latitude = parseNumber(this.config.weatherLatitude, null);
    const longitude = parseNumber(this.config.weatherLongitude, null);

    if (!this.config.showWeather || latitude == null || longitude == null) {
      return Promise.resolve(null);
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current_weather=true&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
    return this.getJson(url)
      .then((response) => response.current_weather || null)
      .catch(() => null);
  },

  fetchStationsAndData() {
    return Promise.all([
      this.fetchPredictions(),
      this.fetchIncidents(),
      this.fetchWeatherIfConfigured()
    ]);
  },

  startDataRefresh() {
    this.fetchAndBroadcast();

    this.fetchTimer = setInterval(() => this.fetchAndBroadcast(), this.config.refreshInterval);
    this.incidentTimer = setInterval(() => this.fetchAndBroadcast(), this.config.incidentsRefreshInterval);
  },

  buildStationPayload(groupedPredictions, incidents, weather) {
    const now = Date.now();
    const profiles = this.stationProfiles.slice(0).sort((a, b) => a.priority - b.priority);

    return profiles.map((profile) => {
      const rawPredictions = groupedPredictions[profile.code] || [];
      const predictions = this.filterAndDecoratePredictions(rawPredictions, profile, incidents, now);
      const groupedByLine = this.groupPredictionsByLine(predictions);
      const alerts = this.collectAlerts(predictions, incidents, profile);
      const condition = this.buildConditionSummary(predictions, incidents, weather, now);

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
        conditionClass: condition.className
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
      track: prediction.track || "",
      statusClass: status.className,
      statusLabel: status.label,
      alerts: prediction.alerts || [],
      isStale: now - (prediction.fetchedAt || now) > this.config.staleAfterSeconds * 1000
    };
  },

  classifyPrediction(prediction, incidentLines) {
    const line = String(prediction.line || "").toUpperCase();
    const matchedIncident = incidentLines[line] || null;

    if (matchedIncident && matchedIncident.rank >= 3) {
      return { className: "alert", label: "Alert" };
    }

    if (prediction.displayMinutes === "Boarding") {
      return { className: "boarding", label: "Boarding" };
    }

    if (prediction.displayMinutes === "Arriving") {
      return { className: "arriving", label: "Arriving" };
    }

    if (prediction.minutesSort >= 15) {
      return { className: "delayed", label: "Delayed" };
    }

    if (prediction.minutesSort >= 8) {
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
    const alertRules = normalizeList(profile.alerts || this.config.alertRules);

    alertRules.forEach((rule) => {
      if (typeof rule !== "string") {
        return;
      }

      const ruleText = rule.toLowerCase();
      const hit = predictions.some((prediction) => {
        const haystack = `${prediction.line} ${prediction.destination} ${prediction.displayMinutes}`.toLowerCase();
        return haystack.includes(ruleText);
      }) || incidents.some((incident) => `${incident.linesText} ${incident.description}`.toLowerCase().includes(ruleText));

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
    const freshness = this.getFreshnessState(this.dataState.fetchedAt || now);
    const criticalIncidents = incidents.filter((incident) => this.matchesSeverityFilter(incident.severity));
    const delayedTrains = predictions.filter((prediction) => prediction.statusClass === "delayed" || prediction.statusClass === "alert");

    if (weather && this.config.showWeather) {
      return {
        text: `${criticalIncidents.length ? `${criticalIncidents.length} alert${criticalIncidents.length === 1 ? "" : "s"}` : "Service normal"} • ${this.formatWeather(weather)}`,
        className: weather.isDay === 0 ? "dcmetro__condition--night" : "dcmetro__condition--weather"
      };
    }

    if (criticalIncidents.length) {
      return {
        text: `${criticalIncidents.length} service alert${criticalIncidents.length === 1 ? "" : "s"}${delayedTrains.length ? ` • ${delayedTrains.length} delayed train${delayedTrains.length === 1 ? "" : "s"}` : ""}`,
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
      text: freshness.isStale ? `Data stale ${this.relativeTime(this.dataState.fetchedAt || now)}` : "Service normal",
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

  formatWeather(weather) {
    const temperature = Math.round(Number(weather.temperature));
    const summary = weatherSummary(weather.weathercode);
    return `${Number.isFinite(temperature) ? `${temperature}°F` : "Weather"} ${summary}`.trim();
  },

  getFreshnessState(timestamp) {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return {
      ageSeconds,
      isStale: ageSeconds > this.config.staleAfterSeconds
    };
  },

  isCommuteTime() {
    if (!this.config.commuteMode) {
      return false;
    }

    const schedule = this.config.commuteSchedule || {};
    const now = new Date();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;

    const normalizedWindows = Array.isArray(isWeekend ? schedule.weekends : schedule.weekdays)
      ? (isWeekend ? schedule.weekends : schedule.weekdays)
      : [];

    return normalizedWindows.some((window) => this.matchesWindow(now, window));
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
