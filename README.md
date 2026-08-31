# MMM-DCMetroTrains

A full-featured [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module for live Washington DC Metro train arrivals and active service alerts using the WMATA API.

## Features

- Live arrival predictions for one or more WMATA station codes
- Per-station favorites and overrides for line filters, row counts, grouping, and compact display
- Station rotation mode for multi-station setups
- Route-aware grouping by line with sorted arrivals underneath each line header
- Next-train summary strip for a fast commute glance
- Line filtering (show only selected rail lines)
- Destination filtering (keyword includes)
- Optional display controls for direction, cars, and status badges
- Color-coded car counts that highlight longer and shorter consists
- Service alert severity filtering and custom keyword alerts
- Optional incident ticker scrolling and row caps
- Active Metro service incidents panel
- Freshness indicators and relative "last updated" timestamp
- Live countdown chips for next station rotation and next data refresh
- Degraded-mode connection chips with clearer timeout/rate-limit/API status
- Refreshes and station rotation update in place after the first render without flashing the module
- Commute / peak-hour compact mode
- Profile-based display modes (`workday`, `weekend`, `event`) with auto schedule support
- Quiet-hours mode for lower-motion overnight display
- Custom line order, station title formatting, and configurable thresholds
- Debug overlay and custom fallback messages
- Optional MetroBus stop predictions section
- MetroBus route badges, incident overlays, and optional stop rotation
- Shared helper-side WMATA request cache and persistent last-known-good fallback
- Exponential retry backoff with degraded-mode status when the API fails

Current npm/package version is `3.0.1`. See [CHANGELOG.md](CHANGELOG.md) for the full release notes and upgrade details.

## Requirements

1. A working MagicMirror² installation.
2. A WMATA API key from: <https://developer.wmata.com/>

This module will not function without a valid API key.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full release history.

## Upgrade Notes For 3.0.0

Version 3.0.0 formalizes the breaking configuration removals that accumulated during the late 1.x cleanup cycle.

If you are upgrading from an earlier 1.x install, remove these deprecated options from your config before restarting MagicMirror:

- `showWeather`
- `weatherLatitude`
- `weatherLongitude`
- `showFirstLastTrains`
- `firstLastTrainMode`

No replacement settings are required for those removed options. All other new features in 3.0.0 are additive and can be adopted incrementally.

## Installation

Using MagicMirror Package Manager (MMPM):

```bash
mmpm install MMM-DCMetroTrains
```

Then restart MagicMirror.

Using git from your MagicMirror `modules` folder:

```bash
git clone https://github.com/rroach3753/MMM-DCMetroTrains.git
cd MMM-DCMetroTrains
npm install
```

If you copied this folder manually, place it at:

```text
MagicMirror/modules/MMM-DCMetroTrains
```

## Update

Using MMPM:

```bash
mmpm update MMM-DCMetroTrains
```

Using git from your module folder:

```bash
cd MMM-DCMetroTrains
git pull
npm install
```

Restart MagicMirror after updating.

## Configuration

### Basic Config Example (Quick Start)

Add this module block to your MagicMirror `config/config.js` file to get started:

1. Install the module in your `MagicMirror/modules` folder.
2. Add this module block to the modules array in `config/config.js`.
3. Save and restart MagicMirror.

```js
{
  module: "MMM-DCMetroTrains",
  position: "top_right",
  config: {
    apiKey: "YOUR_WMATA_API_KEY",
    stationCodes: ["A01"]
  }
},
```

Then restart MagicMirror. You can expand from there once trains are rendering.

## Example Config

Add this to your `config/config.js` file:

```js
{
  module: "MMM-DCMetroTrains",
  position: "top_right",
  config: {
    apiKey: "YOUR_WMATA_API_KEY",
    stationCodes: [
      "A01",
      {
        code: "C01",
        name: "Favorite Station",
        lineFilter: ["RD", "BL"],
        destinationIncludes: ["Glenmont"],
        maxRows: 5,
        compact: true,
        groupByLine: true
      }
    ],
    refreshInterval: 30000,
    incidentsRefreshInterval: 120000,
    stationRotationInterval: 15000,
    maxRows: 7,
    summaryCount: 3,
    lineFilter: ["RD", "OR", "SV", "BL", "YL", "GR"],
    lineOrder: ["RD", "BL", "OR", "SV", "YL", "GR", "NA"],
    destinationIncludes: [],
    alertRules: ["Glenmont", "single track"],
    hideWhenNoTrains: false,
    onlyShowAlertsForVisibleLines: true,
    maxIncidentRows: 2,
    incidentScroll: false,
    incidentScrollSpeed: 28,
    incidentScrollSpeedMin: 8,
    etaColorMode: "gradient",
    carsColorMode: "wmata",
    statusThresholds: {
      watchMinutes: 8,
      delayedMinutes: 15,
      criticalMinutes: 25
    },
    stationTitleFormat: "nameWithCode",
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
    blinkOnCritical: true,
    updateJitterMs: 2500,
    debugOverlay: false,
    fallbackMessage: "No trains right now",
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
    metroBusRotateStops: false,
    metroBusStopRotationInterval: 15000,
    metroBusStops: [
      "1001195",
      {
        stopId: "1001436",
        name: "14th St & Irving",
        routeFilter: ["52", "54"],
        maxRows: 4,
        rotate: true
      }
    ],
    metroBusMaxRows: 5,
    metroBusRouteFilter: [],
    enableSharedApiCache: true,
    directionMode: "terminal",
    activeProfile: "auto",
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
    walkBufferMinutes: 5,
    leaveNowWindowMinutes: 6,
    compact: false
  }
},
```

## Configuration Options

Only one setting is required:

- `apiKey` must be set to a valid WMATA API key.

All other settings are optional and fall back to the defaults shown below.

| Option | Type | Required? | Default | What it does |
| --- | --- | --- | --- | --- |
| `apiKey` | String | Yes | `""` | WMATA API key used for all API requests. Module will show an error until this is set. |
| `stationCodes` | Array<String or Object> or String | No | `["A01"]` | Station codes to query. You can provide an array (recommended) or a single string code. Values are trimmed and must not be empty. Each array entry can be a string code or an object with per-station overrides such as `name`, `lineFilter`, `destinationIncludes`, `maxRows`, `compact`, `groupByLine`, `showIncidents`, and `alerts`. |
| `refreshInterval` | Number | No | `30000` | How often train predictions refresh, in milliseconds. Must be >= `5000`. |
| `incidentsRefreshInterval` | Number | No | `120000` | How often service incidents refresh, in milliseconds. Must be >= `5000`. |
| `retryDelay` | Number | No | `15000` | Base retry delay before retrying after a failed predictions request. Exponential backoff is applied for repeated failures. Must be >= `1000`. |
| `stationRotationInterval` | Number | No | `20000` | Time each station remains visible before rotating to the next station. Must be >= `2000`. |
| `maxRows` | Number | No | `8` | Maximum number of train rows rendered per station card. Must be >= `1`. |
| `summaryCount` | Number | No | `3` | Number of upcoming trains shown in the summary strip. Must be >= `1`. |
| `lineFilter` | Array<String> | No | `[]` | Optional line filter. Empty means all lines. Example values: `RD`, `OR`, `SV`, `BL`, `YL`, `GR`. |
| `lineOrder` | Array<String> | No | `["RD", "OR", "SV", "BL", "YL", "GR", "NA"]` | Custom line display order used for grouped sections. |
| `destinationIncludes` | Array<String> | No | `[]` | Optional destination keyword filter (case-insensitive). Empty means all destinations. |
| `alertRules` | Array<String> | No | `[]` | Keyword list for custom alerts. If a keyword matches an arrival or service alert, the station card shows an alert badge. |
| `hideWhenNoTrains` | Boolean | No | `false` | Hides station cards with no current train predictions. |
| `onlyShowAlertsForVisibleLines` | Boolean | No | `false` | Restricts incident panel items to lines currently visible in station predictions. |
| `maxIncidentRows` | Number | No | `3` | Maximum number of incident rows shown in the incident panel. Must be >= `1`. |
| `incidentScroll` | Boolean | No | `false` | Enables a horizontal ticker-style incident scroll mode. |
| `incidentScrollSpeed` | Number | No | `28` | Incident ticker cycle duration in seconds (higher is slower). Must be >= `1`, and must be >= `incidentScrollSpeedMin` when both are set. |
| `incidentScrollSpeedMin` | Number | No | `8` | Minimum ticker cycle duration floor in seconds used to prevent overly fast scrolling. Must be >= `1`. |
| `etaColorMode` | String | No | `status` | ETA coloring mode: `off`, `status`, or `gradient`. |
| `carsColorMode` | String | No | `wmata` | Car badge coloring mode: `wmata`, `capacity`, or `off`. WMATA uses plain line colors; `capacity` keeps the older filled highlight-style look. |
| `statusThresholds` | Object | No | `{ watchMinutes: 8, delayedMinutes: 15, criticalMinutes: 25 }` | Minute thresholds for status classification and ETA highlighting. |
| `stationTitleFormat` | String | No | `name` | Station title format: `name`, `code`, or `nameWithCode`. |
| `quietHours` | Object | No | see defaults in module | Quiet-time windows to reduce motion and suppress lower-priority summary chips. |
| `blinkOnCritical` | Boolean | No | `false` | Adds a subtle pulse effect when critical incidents are active. |
| `updateJitterMs` | Number | No | `0` | Adds random refresh jitter (+/- ms) to reduce synchronized API bursts. |
| `debugOverlay` | Boolean | No | `false` | Shows a compact debug line with station, row, incident, and mode counters. |
| `fallbackMessage` | String | No | `"No upcoming trains."` | Custom message used when no predictions are available. |
| `fontScale` | Number | No | `1` | Scales module text size. Example: `0.9`, `1`, `1.1`. Must be > `0` and <= `3`. |
| `showIncidents` | Boolean | No | `true` | Shows or hides Metro incident messages panel. |
| `incidentSeverityFilter` | String | No | `all` | Filters incident items by severity. Use `all`, `advisory`, `major`, or `critical`. Advisories will also show a date-range chip when WMATA includes start and end dates. |
| `showHeader` | Boolean | No | `true` | Shows or hides station name header row. |
| `showBorders` | Boolean | No | `true` | Shows or hides border/card chrome around the module and station sections. Use boolean values (`true` / `false`). |
| `showBackground` | Boolean | No | `true` | Shows or hides translucent panel backgrounds behind the module and cards. |
| `showConditions` | Boolean | No | `true` | Shows or hides the transit conditions row. |
| `showLastUpdated` | Boolean | No | `true` | Shows or hides relative "updated x ago" timestamp. |
| `showFreshnessChip` | Boolean | No | `true` | Shows or hides top summary chips for freshness plus countdowns (`Next station`, `Refresh`). |
| `showCars` | Boolean | No | `true` | Shows or hides the train car-count column. Car badges are color-coded by train length. |
| `showCarHighlights` | Boolean | No | `false` | Switches car badges to the older filled highlight-style format instead of the WMATA color palette. |
| `showDirection` | Boolean | No | `true` | Shows or hides the direction column (northbound/southbound). |
| `showStationCode` | Boolean | No | `false` | Shows or hides station code chip in the header. |
| `showStatus` | Boolean | No | `true` | Shows or hides the status badge column. |
| `showNextSummary` | Boolean | No | `true` | Shows or hides the top-of-card next-train summary strip. |
| `showMetroBus` | Boolean | No | `false` | Enables the MetroBus predictions section. Off by default. |
| `metroBusOnlyMode` | Boolean | No | `false` | MetroBus-only compact mode. Hides rail cards/incidents and shows only MetroBus content in a tighter layout. |
| `showMetroBusHeader` | Boolean | No | `true` | Shows or hides the MetroBus section header label. |
| `metroBusRotateStops` | Boolean | No | `false` | Enables MetroBus stop-card rotation when multiple stops are configured. |
| `metroBusStopRotationInterval` | Number | No | `15000` | MetroBus stop-card rotation interval in milliseconds. Must be >= `2000`. |
| `metroBusStops` | Array<String or Object> | No | `[]` | MetroBus stop IDs. Supports string IDs or object entries with `stopId`, `name`, `routeFilter`, `maxRows`, and `priority`. |
| `metroBusMaxRows` | Number | No | `5` | Maximum buses shown per stop card (unless a stop-level `maxRows` overrides it). |
| `metroBusRouteFilter` | Array<String> | No | `[]` | Global MetroBus route filter; empty means all routes. |
| `staleAfterSeconds` | Number | No | `180` | Time threshold used to mark the feed as stale in the freshness indicators. Must be >= `1`. |
| `directionMode` | String | No | `cardinal` | Direction label mode for train rows. Use `cardinal` (`Northbound` / `Southbound`) or `terminal` (`Toward <destination>`). |
| `activeProfile` | String | No | `auto` | Display profile mode. Use `auto`, `workday`, `weekend`, or `event`. |
| `profiles` | Object | No | built-in profile map | Override display behavior per profile (for example `compact`, `autoCompact`, `summaryCount`, `maxRows`). |
| `profileSchedule` | Object | No | built-in schedule | Auto profile schedule using `workday`, `weekend`, and optional `eventDates` (`YYYY-MM-DD`). |
| `rotateStations` | Boolean | No | `true` | Enables station rotation when more than one station is configured. |
| `groupByLine` | Boolean | No | `true` | Groups arrivals by rail line instead of showing one flat table. |
| `commuteMode` | Boolean | No | `true` | Enables commute-aware UI behavior such as the peak-hour summary chip and auto-compact logic. |
| `commuteSchedule` | Object | No | `{ weekdays: [...], weekends: [] }` | Defines commute windows. Each window uses `{ start: "HH:MM", end: "HH:MM" }`. |
| `autoCompact` | Boolean | No | `true` | Uses compact styling automatically during commute windows. |
| `commuteMaxRows` | Number | No | `5` | Maximum rows shown during commute/compact windows. Must be >= `1`. |
| `walkBufferMinutes` | Number | No | `5` | Walking/prep buffer used by the `Departure` summary chip. Must be >= `0`. |
| `leaveNowWindowMinutes` | Number | No | `6` | Additional planning window used by the `Departure` summary chip. Must be >= `1`. |
| `compact` | Boolean | No | `false` | Forces the compact layout at all times. |
| `animationSpeed` | Number | No | `1000` | DOM update animation speed in milliseconds. Must be >= `0`. |
| `enableSharedApiCache` | Boolean | No | `true` | Enables helper-side shared request caching with endpoint-aware TTLs to reduce duplicate WMATA calls. |

## Notes

- Direction labels default to WMATA group values (`1` = Northbound, `2` = Southbound). Set `directionMode: "terminal"` for `Toward <destination>` labels.
- If incidents fail to load, train predictions continue to update normally.
- If predictions fail after a successful fetch, the module keeps displaying last-known-good in-memory data and surfaces degraded-mode retry status.
- Car badges are color-coded to give a quick sense of train length at a glance.
- If you want station-specific behavior, use object entries inside `stationCodes` instead of only string codes.
- For best results, keep `refreshInterval` at 20-60 seconds to avoid excessive API usage.
- Invalid config values are rejected at startup with a visible module error and detailed server-side log message.

## Testing

Run lint checks:

```bash
node --run lint
```

Run tests (Node built-in test runner):

```bash
node --run test
```

Fixture payloads for WMATA responses live under `tests/fixtures`.

## Troubleshooting Matrix

| Symptom | Likely Cause | What to Check | Suggested Fix |
| --- | --- | --- | --- |
| `Connection: Timeout` chip appears repeatedly | WMATA request timeout or network instability | Network reachability from MagicMirror host, firewall rules, WMATA status | Increase `retryDelay`, keep default timeout behavior, validate internet routing |
| `Connection: Rate limited` chip appears | WMATA API throttling (`HTTP 429`) | Refresh cadence and number of running transit modules | Increase `refreshInterval`, keep `enableSharedApiCache: true`, reduce duplicate polling |
| Module shows degraded mode with old data | Upstream API failing, module using snapshot fallback | `lastGood` freshness in summary chips and server logs | Keep mirror running while API recovers; verify API key and upstream health |
| No rail arrivals but module is not errored | Filters remove all trains or station has no active trains | `lineFilter`, `destinationIncludes`, station-specific overrides | Relax filters and verify station codes are valid WMATA rail station IDs |
| MetroBus section is empty | Stops missing/invalid or filters too strict | `metroBusStops`, `metroBusRouteFilter`, per-stop `routeFilter` | Confirm stop IDs, remove route filters temporarily, then narrow again |
| Incident list looks noisy | Severity filter too broad | `incidentSeverityFilter`, `onlyShowAlertsForVisibleLines` | Use `major`/`critical` and enable visible-line filtering |

## Advanced Configuration Guide

This module is designed to work in layers. Think of the config as a stack where global settings apply first, and then each station can override a subset of them.

### 1. Global settings versus station overrides

Use top-level config values when you want the same behavior for every station card.

Use an object inside `stationCodes` when one station needs special handling.

Example:

```js
stationCodes: [
  "B35",
  {
    code: "C01",
    name: "My Regular Stations",
    lineFilter: [],
    destinationIncludes: [],
    maxRows: 5,
    compact: true,
    groupByLine: true
  }
]
```

In that example:

- `B35` uses the module-wide defaults.
- `C01` gets its own card title, row count, compact layout, and grouping behavior.

### 2. How station objects are merged

When you use an object inside `stationCodes`, the module reads the following station-specific values first:

- `name`
- `lineFilter`
- `destinationIncludes`
- `maxRows`
- `compact`
- `groupByLine`
- `showIncidents`
- `alerts`
- `priority`

If a value is not present in the station object, the module falls back to the matching global setting.

Important:

- `lineFilter: []` means no line filtering for that station.
- `destinationIncludes: []` means no destination filtering for that station.
- `showIncidents` can be disabled for one station while staying enabled for the rest.

### 3. Filtering order

The module filters trains in this order:

1. WMATA data is loaded for the configured stations.
2. Global line and destination filters are applied.
3. Station-level line and destination filters are applied.
4. The remaining trains are grouped, sorted, and displayed.

That means a station object can narrow the global data set, but it cannot re-add trains that the global filters already removed.

### 4. Grouped versus flat display

`groupByLine: true` groups the arrivals under each line badge.

`groupByLine: false` shows a flat table.

This can be set globally or per station:

- Global `groupByLine` sets the default.
- Station-level `groupByLine` overrides it for that one card.

### 5. Compact and commute behavior

There are three related layout controls:

- `compact`: forces compact layout all the time.
- `autoCompact`: switches to compact layout only during commute windows.
- `commuteMode`: enables the commute-window logic that drives the summary chip and compact mode.

Recommended pattern:

- Leave `commuteMode: true`.
- Set `autoCompact: true` if you want the module to tighten up during commute periods.
- Use `compact: true` only if you always want the smaller layout.

### 6. Quiet hours

`quietHours` is useful when the mirror is in a bedroom, hallway, or other low-motion environment.

During quiet hours the module reduces visual noise by suppressing or minimizing some summary chips and animations. It does not stop live data updates.

Typical use:

- Keep daytime behavior normal.
- Add late-night and early-morning windows in `quietHours.weekdays` and `quietHours.weekends`.

### 7. Incident controls

These options control service alerts and how much room they take:

- `showIncidents`: master on/off switch for the incident section.
- `incidentSeverityFilter`: controls which severities are shown.
- `onlyShowAlertsForVisibleLines`: only show alerts that match the lines currently visible in the station predictions.
- `maxIncidentRows`: limits how many incident messages are shown.
- `incidentScroll`: switches long incident text into a ticker-style scroll.
- `incidentScrollSpeed`: controls how fast that ticker cycles.
- `incidentScrollSpeedMin`: enforces the minimum ticker cycle duration floor.

Suggested setup:

- Use `incidentSeverityFilter: "major"` or `"critical"` if you only want more serious disruptions.
- Use `onlyShowAlertsForVisibleLines: true` if you want the alerts panel to stay relevant to your commute.
- Keep `maxIncidentRows` low if the module is taking up too much vertical space.

### 8. Styling controls

These options change the visual treatment rather than the data:

- `showBorders`: removes module/card outlines when set to `false`.
- `showBackground`: removes the translucent panel backgrounds when set to `false`.
- `fontScale`: scales the whole module text size.
- `showFreshnessChip`: hides the top freshness/countdown chips.
- `showLastUpdated`: hides the bottom relative timestamp.

Useful combinations:

- Minimal card: `showBorders: false`, `showBackground: false`
- Soft card: `showBorders: false`, `showBackground: true`
- Dense display: `compact: true`, `fontScale: 0.9`

### 9. ETA and car color modes

`etaColorMode` and `carsColorMode` let you change how arrival urgency and car counts look:

- `etaColorMode: "status"` colors ETAs based on the module’s status classification.
- `etaColorMode: "gradient"` uses minute thresholds from `statusThresholds`.
- `etaColorMode: "off"` removes special ETA coloring.

- `carsColorMode: "wmata"` uses the default plain-color WMATA palette.
- `carsColorMode: "capacity"` colors badges by count/capacity logic and keeps the filled badge look.
- `carsColorMode: "off"` turns off special car coloring.

If you want the older filled highlight-style badges without changing the color mode explicitly, set `showCarHighlights: true`.

If you want the module to match a specific visual theme, the most common pairing is:

- `etaColorMode: "gradient"`
- `carsColorMode: "wmata"`

### 10. Status thresholds and line order

`statusThresholds` changes what the module considers watch, delayed, and critical.

Example:

```js
statusThresholds: {
  watchMinutes: 8,
  delayedMinutes: 15,
  criticalMinutes: 25
}
```

Use this when your local travel patterns make the default thresholds too aggressive or too relaxed.

`lineOrder` controls the order used when arrivals are grouped by line.

Example:

```js
lineOrder: ["RD", "BL", "OR", "SV", "YL", "GR", "NA"]
```

That example places Red and Blue ahead of the others, regardless of the default WMATA ordering.

### 11. Title and fallback text

`stationTitleFormat` controls how the card title is displayed:

- `name` shows the station name.
- `code` shows only the station code.
- `nameWithCode` shows both.

`fallbackMessage` changes the text shown when no arrivals are available.

Use this if you want a friendlier message like:

```js
fallbackMessage: "No trains right now"
```

### 12. Debugging and refresh pacing

`debugOverlay: true` adds a small diagnostic line to the bottom of the module showing counts and mode state.

`updateJitterMs` adds a small random offset to refresh timing. This is useful if you run multiple mirrors or multiple transit modules and want to avoid all of them hitting the API at the exact same second.

Recommended values:

- `updateJitterMs: 0` for a single mirror or if you want fixed timing.
- `updateJitterMs: 1000` to `3000` if you want softer refresh synchronization.

### 13. MetroBus setup (optional)

MetroBus is disabled by default (`showMetroBus: false`).

To enable it, set:

```js
showMetroBus: true,
metroBusStops: ["1001195", "1001436"]
```

You can also use object entries for per-stop overrides:

```js
metroBusStops: [
  "1001195",
  {
    stopId: "1001436",
    name: "14th St & Irving",
    routeFilter: ["52", "54"],
    maxRows: 4
  }
]
```

MetroBus behavior rules:

- Global `metroBusRouteFilter` applies first.
- Stop-level `routeFilter` can narrow routes for that stop.
- Global `metroBusMaxRows` is the default row count.
- Stop-level `maxRows` overrides global row count for that stop.
- `showMetroBusHeader` controls the section title only.

MetroBus-only compact mode:

```js
showMetroBus: true,
metroBusOnlyMode: true,
metroBusStops: ["1001195", "1001436"]
```

When `metroBusOnlyMode` is enabled, the module hides rail station cards and rail incidents, and renders only MetroBus in compact layout.

### 14. Station code best practice

For the simplest setup, use only station code strings:

```js
stationCodes: ["A01", "C01"]
```

Use station objects only when you need per-station differences.

That keeps the config easier to read and reduces the chance of accidentally overriding a setting you meant to keep global.

## Screenshots

1. Boarder and Background Enabled, Cars highlighted
![alt text](images/image.png)

2. Boarder and Background Disabled, Cars highlighted
![alt text](images/image-1.png)

3. Boarder and Background Disabled, Cars not highlighted
![alt text](images/image-2.png)
