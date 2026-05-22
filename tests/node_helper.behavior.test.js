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
