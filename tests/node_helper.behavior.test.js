const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

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

test("server WMATA API key takes precedence over renderer config", () => {
  const previousApiKey = process.env.WMATA_API_KEY;
  process.env.WMATA_API_KEY = "server-key";

  try {
    assert.equal(helper.applyServerSecrets({ apiKey: "renderer-key" }).apiKey, "server-key");
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
  const originalRefresh = helper.refreshPredictionsAndWeather;
  const scheduledCallbacks = [];
  let finishRefresh;

  global.setTimeout = (callback) => {
    scheduledCallbacks.push(callback);
    return { callback };
  };
  global.clearTimeout = () => {};
  helper.refreshPredictionsAndWeather = () => new Promise((resolve) => {
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
    helper.refreshPredictionsAndWeather = originalRefresh;
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
