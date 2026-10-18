const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const vm = require("node:vm");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "node_helper") {
    return {
      create(definition) {
        return definition;
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const helper = require("../node_helper");
Module._load = originalLoad;

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_DIR = path.join(ROOT, ".cache");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "dcmetro-last-good.json");

test("malformed socket values are rejected without uncaught coercion errors", () => {
  helper.start();
  const originalSend = helper.sendSocketNotification;
  const originalKey = process.env.WMATA_API_KEY;
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });
  process.env.WMATA_API_KEY = "test-key";
  try {
    for (const payload of [
      [],
      "invalid",
      { stationCodes: [{ code: { toString: null } }] },
      { refreshInterval: { valueOf: null, toString: null } },
      { lineOrder: [{ toString: null }] }
    ]) {
      assert.doesNotThrow(() => helper.socketNotificationReceived("DC_METRO_CONFIG", payload));
      assert.equal(sent.at(-1).notification, "DC_METRO_ERROR");
      assert.equal(helper.config, null);
    }
    helper.config = { updateJitterMs: Number.MAX_VALUE };
    for (let index = 0; index < 10; index++) {
      const delay = helper.withJitter(Number.MAX_VALUE);
      assert.ok(Number.isFinite(delay) && delay >= 1000 && delay <= 2147483647);
    }
  } finally {
    helper.stop();
    helper.sendSocketNotification = originalSend;
    if (originalKey === undefined) delete process.env.WMATA_API_KEY;
    else process.env.WMATA_API_KEY = originalKey;
  }
});

function loadFrontendModule() {
  const source = fs.readFileSync(path.join(ROOT, "MMM-DCMetroTrains.js"), "utf8");
  let definition;
  vm.runInNewContext(source, {
    Module: {
      register(name, moduleDefinition) {
        definition = moduleDefinition;
      }
    },
    Intl,
    console,
    document: {
      createElement() {
        return {
          children: [], textContent: "", style: {}, classList: { add() {} },
          appendChild(child) { this.children.push(child); }
        };
      }
    }
  });
  return definition;
}

function withSnapshotFile(snapshotContent, runAssertions) {
  const hadSnapshot = fs.existsSync(SNAPSHOT_FILE);
  const original = hadSnapshot ? fs.readFileSync(SNAPSHOT_FILE, "utf8") : null;

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, snapshotContent, "utf8");

  try {
    runAssertions();
  } finally {
    if (hadSnapshot) {
      fs.writeFileSync(SNAPSHOT_FILE, original, "utf8");
    } else if (fs.existsSync(SNAPSHOT_FILE)) {
      fs.unlinkSync(SNAPSHOT_FILE);
      const remaining = fs.readdirSync(SNAPSHOT_DIR);
      if (!remaining.length) {
        fs.rmdirSync(SNAPSHOT_DIR);
      }
    }
  }
}

test("shared request cache pruning drops expired entries and enforces cap", () => {
  helper.start();

  const now = Date.now();
  helper.requestCache = new Map();

  for (let i = 0; i < 5; i++) {
    helper.requestCache.set(`expired-${i}`, {
      data: { value: i },
      expiresAt: now - 1000,
      promise: null
    });
  }

  for (let i = 0; i < 70; i++) {
    helper.requestCache.set(`active-${i}`, {
      data: { value: i },
      expiresAt: now + 10000 + i,
      promise: null
    });
  }

  helper.requestCache.set("pending", {
    data: null,
    expiresAt: now - 1000,
    promise: Promise.resolve({ ok: true })
  });

  helper.pruneRequestCache(now);

  assert.ok(!helper.requestCache.has("expired-0"));
  assert.ok(helper.requestCache.has("pending"));
  assert.ok(helper.requestCache.size <= 64);
  assert.ok(!helper.requestCache.has("active-0"));
  assert.ok(!helper.requestCache.has("active-1"));
  assert.ok(helper.requestCache.has("active-69"));
});

test("snapshot restoration preserves fetched timestamp in outbound payload", () => {
  const snapshot = {
    fetchedAt: 111111,
    lastSuccessAt: 222222,
    stations: [{ code: "A01", predictions: [] }],
    busStops: [{ stopId: "1001195", predictions: [] }],
    incidents: [{ description: "Test incident" }]
  };

  withSnapshotFile(JSON.stringify(snapshot), () => {
    helper.start();
    helper.snapshotLoaded = false;

    helper.loadPersistedSnapshot();

    assert.equal(helper.latestDataTimestamp, 111111);
    assert.equal(helper.lastSuccessAt, 222222);
    assert.equal(helper.latestStations.length, 1);
    assert.equal(helper.latestBusStops.length, 1);

    let emitted = null;
    helper.instanceId = "test-instance";
    helper.sendSocketNotification = (notification, payload) => {
      emitted = { notification, payload };
    };

    helper.broadcastData();

    assert.ok(emitted);
    assert.equal(emitted.notification, "DC_METRO_DATA");
    assert.equal(emitted.payload.fetchedAt, 111111);
    assert.equal(emitted.payload.lastSuccessAt, 222222);
  });
});

test("frontend omits the WMATA API key from its socket payload", () => {
  const definition = loadFrontendModule();
  let requestPayload;
  const moduleInstance = Object.assign({}, definition, {
    config: Object.assign({}, definition.defaults, { apiKey: "renderer-key" }),
    identifier: "test-instance",
    sendSocketNotification(notification, payload) {
      if (notification === "DC_METRO_CONFIG") {
        requestPayload = payload;
      }
    },
    startRotation() {},
    startBusRotation() {},
    startUiTicker() {}
  });

  moduleInstance.start();

  assert.equal(Object.hasOwn(requestPayload, "apiKey"), false);
});

test("frontend preserves grouped and flat arrivals and handles empty predictions", () => {
  const definition = loadFrontendModule();
  const renderer = {
    ...definition,
    config: { ...definition.defaults, showDirection: false, showCars: false, showStatus: false }
  };
  const station = {
    profile: {},
    predictions: [
      { line: "RD", destination: "Glenmont", displayMinutes: "5", minutesSort: 5, statusClass: "normal", alerts: [] },
      { line: "RD", destination: "Shady Grove", displayMinutes: "2", minutesSort: 2, statusClass: "normal", alerts: [] }
    ]
  };
  const text = (element) => [element.textContent, ...element.children.map(text)].join(" ");
  const grouped = renderer.buildArrivals(station, false);
  assert.equal(grouped.className, "dcmetro__groups");
  assert.match(text(grouped), /2 trains/);
  assert.ok(text(grouped).indexOf("Shady Grove") < text(grouped).indexOf("Glenmont"));
  renderer.config.groupByLine = false;
  assert.match(renderer.buildArrivals(station, false).className, /dcmetro__table--flat/);
  station.predictions = [];
  assert.match(text(renderer.buildArrivals(station, false)), /No upcoming trains/);
});

test("WMATA API key is accepted only from the server environment", () => {
  const previousApiKey = process.env.WMATA_API_KEY;
  process.env.WMATA_API_KEY = "server-key";

  try {
    assert.equal(helper.applyServerSecrets({ apiKey: "renderer-key" }).apiKey, "server-key");
    delete process.env.WMATA_API_KEY;
    assert.equal(helper.applyServerSecrets({ apiKey: "renderer-key" }).apiKey, "");
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.WMATA_API_KEY;
    } else {
      process.env.WMATA_API_KEY = previousApiKey;
    }
  }
});

test("incident refresh rebuilds, persists, and broadcasts derived station data", async () => {
  helper.start();
  helper.stopped = false;
  helper.lifecycleGeneration = 1;
  helper.config = { metroBusOnlyMode: false };
  helper.latestPredictions = [{ LocationCode: "A01" }];

  const incidents = [{ description: "Red Line delay" }];
  const originalFetchIncidents = helper.fetchIncidents;
  const originalGroupPredictions = helper.groupPredictionsByStation;
  const originalBuildStationPayload = helper.buildStationPayload;
  const originalPersistLastGoodSnapshot = helper.persistLastGoodSnapshot;
  const originalBroadcastData = helper.broadcastData;
  let persisted = 0;
  let broadcast = 0;

  helper.fetchIncidents = async () => incidents;
  helper.groupPredictionsByStation = (predictions) => {
    assert.equal(predictions, helper.latestPredictions);
    return { A01: predictions };
  };
  helper.buildStationPayload = (grouped, currentIncidents) => [{
    grouped,
    incidents: currentIncidents
  }];
  helper.persistLastGoodSnapshot = () => {
    persisted += 1;
  };
  helper.broadcastData = () => {
    broadcast += 1;
  };

  try {
    await helper.refreshIncidents(1);

    assert.equal(helper.latestIncidents, incidents);
    assert.equal(helper.latestStations[0].incidents, incidents);
    assert.equal(helper.latestStations[0].grouped.A01, helper.latestPredictions);
    assert.equal(persisted, 1);
    assert.equal(broadcast, 1);
  } finally {
    helper.fetchIncidents = originalFetchIncidents;
    helper.groupPredictionsByStation = originalGroupPredictions;
    helper.buildStationPayload = originalBuildStationPayload;
    helper.persistLastGoodSnapshot = originalPersistLastGoodSnapshot;
    helper.broadcastData = originalBroadcastData;
  }
});

test("completed async refresh does not restart prediction timer after stop", async () => {
  helper.start();
  helper.stopped = false;
  helper.lifecycleGeneration = 7;
  helper.config = {
    refreshInterval: 5000,
    updateJitterMs: 0
  };

  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalRefresh = helper.refreshPredictionsAndBus;
  const scheduledCallbacks = [];
  let finishRefresh;

  global.setTimeout = (callback) => {
    scheduledCallbacks.push(callback);
    return { callback };
  };
  global.clearTimeout = () => {};
  helper.refreshPredictionsAndBus = () => new Promise((resolve) => {
    finishRefresh = resolve;
  });

  try {
    helper.scheduleNextPredictionRefresh(7);
    assert.equal(scheduledCallbacks.length, 1);

    const pendingCallback = scheduledCallbacks[0]();
    helper.stop();
    finishRefresh(true);
    await pendingCallback;

    assert.equal(scheduledCallbacks.length, 1);
    assert.equal(helper.fetchTimer, null);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    helper.refreshPredictionsAndBus = originalRefresh;
  }
});

test("Metrobus stop validation caps profiles and fetches at bounded concurrency", async () => {
  helper.start();
  const configuredStops = Array.from({ length: 25 }, (_, index) => `stop-${index}`);
  helper.config = {
    apiKey: "test-key",
    showMetroBus: true,
    metroBusOnlyMode: false,
    metroBusStops: configuredStops,
    metroBusMaxRows: 5,
    metroBusRouteFilter: []
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(helper.validateConfig(), false);
  } finally {
    console.error = originalConsoleError;
  }

  helper.busStopProfiles = helper.resolveMetroBusStopProfiles();
  assert.equal(helper.busStopProfiles.length, 20);

  const originalGetJson = helper.getJson;
  let activeRequests = 0;
  let maxActiveRequests = 0;

  helper.getJson = async () => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise((resolve) => setImmediate(resolve));
    activeRequests -= 1;
    return { Predictions: [] };
  };

  try {
    const stops = await helper.fetchMetroBusPredictions();
    assert.equal(stops.length, 20);
    assert.equal(maxActiveRequests, 4);
  } finally {
    helper.getJson = originalGetJson;
  }
});
