const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(__dirname, "fixtures");

function loadFixture(fileName) {
  const filePath = path.join(FIXTURE_DIR, fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeMinutesSort(value) {
  if (value == null) {
    return 999;
  }

  const text = String(value).trim().toUpperCase();
  if (text === "ARR" || text === "BRD") {
    return 0;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 999;
}

test("module source files pass node syntax check", () => {
  const files = ["MMM-DCMetroTrains.js", "node_helper.js"];

  files.forEach((fileName) => {
    const target = path.join(ROOT, fileName);
    execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
  });
});

test("station fixtures contain valid station code and name", () => {
  const stations = loadFixture("wmata-stations.json");
  assert.ok(Array.isArray(stations.Stations));
  assert.ok(stations.Stations.length > 0);

  stations.Stations.forEach((station) => {
    assert.equal(typeof station.Code, "string");
    assert.ok(station.Code.trim().length > 0);
    assert.equal(typeof station.Name, "string");
    assert.ok(station.Name.trim().length > 0);
  });
});

test("prediction fixtures normalize minute sorting as expected", () => {
  const payload = loadFixture("wmata-predictions.json");
  assert.ok(Array.isArray(payload.Trains));
  assert.ok(payload.Trains.length > 0);

  const values = payload.Trains.map((prediction) => normalizeMinutesSort(prediction.Min));
  assert.deepEqual(values, [3, 0, 0]);
});

test("incident fixtures include required descriptive fields", () => {
  const payload = loadFixture("wmata-incidents.json");
  assert.ok(Array.isArray(payload.Incidents));
  assert.ok(payload.Incidents.length > 0);

  payload.Incidents.forEach((incident) => {
    assert.equal(typeof incident.Description, "string");
    assert.ok(incident.Description.trim().length > 0);
    assert.equal(typeof incident.LinesAffected, "string");
  });
});

test("metrobus fixtures include route and minutes", () => {
  const payload = loadFixture("wmata-metrobus.json");
  assert.equal(typeof payload.StopName, "string");
  assert.ok(Array.isArray(payload.Predictions));
  assert.ok(payload.Predictions.length > 0);

  payload.Predictions.forEach((prediction) => {
    assert.equal(typeof prediction.RouteID, "string");
    assert.ok(prediction.RouteID.trim().length > 0);
    assert.notEqual(prediction.Minutes, undefined);
  });
});
