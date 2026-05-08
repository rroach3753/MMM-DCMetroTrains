# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

## [1.0.8] - 2026-05-08

### Fixed
- Enforced startup config validation before initialization and surfaced clear runtime error messaging for invalid configuration.
- Hardened incident/condition processing with additional null-safe guards (`incidents`, `predictions`, and `lineCodes`).
- Corrected incident filtering logic in the browser module to avoid reassignment of immutable locals.
- Removed duplicate/dead helper definitions and streamlined retry timer helper ownership.
- Added explicit `node_helper` stop lifecycle cleanup for timers/retry handles to align with MagicMirror module lifecycle expectations.
- Enforced and documented minimum bounds for `incidentsRefreshInterval` and `retryDelay` to prevent runaway scheduling.

### Changed
- **Optimization Release (Passes 1-18)**: Comprehensive multi-pass code optimization and consolidation:
  - **Pass 1-4**: Safety fixes and dead code removal, removed unused error handlers and payload cleanup.
  - **Pass 5-7**: Advanced caching patterns, filter efficiency improvements, and array operation optimizations.
  - **Pass 8-9**: Introduced helper function infrastructure with 30+ reusable utility functions.
  - **Pass 10**: Removed first and last train of the day display feature (`showFirstLastTrains`, `firstLastTrainMode` config options) and related WMATA station service time caching.
  - **Pass 11-12**: High-impact pattern consolidation across prediction filtering, status classification, and incident grouping.
  - **Pass 13**: Free function extraction and comprehensive deduplication of utility methods.
  - **Pass 14**: Unified all configuration access methods via centralized `getConfigString`, `getConfigNumber`, `getConfigBool`, and `getConfigValue` helpers.
  - **Pass 15**: Applied isEmpty/isNotEmpty helpers to array checks, consolidated NA_LINE constant usage, cached freshness state via `extractFreshness` method, and added element creation helpers (makeDiv, makeSpan, makeEl).
  - **Pass 16**: Introduced CSS class building helpers (getStaleClass, getStatusClassName, getClassForSeverity, getRowAlertClass) to eliminate repeated template literal patterns; standardized all array safeguards with ensureArray; consolidated data fetch filtering with filterPredictionsByLineAndDest helper.
  - **Pass 17**: Extracted table cell rendering helpers (buildEtaCell, buildCarsCell, buildStatusCell, buildDirectionCell, buildDestinationCell, buildTableCell); consolidated forecast chip rendering with buildForecastChip; refactored incident rendering for consistency with helper naming; extracted status threshold helper (getStatusThresholds) in node_helper to eliminate threshold extraction duplication.
  - **Pass 18**: Introduced array limiting helper (limitArray) for consistent slice(0, Math.max(1, limit)) patterns; added scroll duration helper (getScrollDuration) for CSS duration formatting; refactored buildAlertBanner, buildForecastSummary, buildArrivals, and buildIncidents to use new helpers; consolidated MetroBus stop prediction limiting in node_helper.
- **Code Quality**: Comprehensive refactoring focused on DRY principles, maintainability, and consistency across codebase. 44+ helper functions enable easy pattern updates, reduce cognitive load for maintenance, and facilitate testing of individual concerns.
- **Performance**: Improved caching patterns, unified API call scheduling with jitter, and optimized array/object iteration patterns throughout the codebase.
- **Architecture**: Enhanced helper infrastructure with comprehensive abstraction covering array operations, CSS class building, config access, data filtering, element creation patterns, table cell rendering, forecast display, status classification, and scroll duration formatting.
- README now matches runtime behavior for validation constraints and includes `incidentScrollSpeedMin` in examples/options.

## [1.1.0] - 2026-04-28

Note: This release cycle included a short-lived first/last-train feature experiment that was added and then removed within the same version progression.

### Added
- Optional first and last train of the day display via `showFirstLastTrains` configuration option (defaults to off).
- Multi-platform station support for first/last trains with `firstLastTrainMode` option to show `"filtered"` (default) or `"all"` lines.
- Daily caching of WMATA station service time data per WMATA API recommendations to reduce request load.
- Separate styled summary block showing northbound and southbound first and last train times, rendered above the main arrivals table.
- Per-station configuration overrides for `showFirstLastTrains` and `firstLastTrainMode` to customize behavior per station.

### Removed
- Removed first and last train of the day display feature and associated WMATA station service time caching.
- Removed `showFirstLastTrains` and `firstLastTrainMode` configuration options.
- Removed related UI components for first/last train summary display.

## [1.0.7] - 2026-04-28

### Removed
- Removed track column and `showTrack` configuration option. WMATA prediction API does not expose track information.

## [1.0.6] - 2026-04-28

### Changed
- Cleanup release to align the module and release notes with the current 1.0.6 codebase.

## [1.0.5] - 2026-04-25

### Fixed
- Resolved MagicMirror lint issues by removing a duplicate `socketNotificationReceived` key and clearing unused catch variables.

### Changed
- Updated ESLint config to use `defineConfig` and aligned package metadata (`type`, `author`, and lint script style) with repository checks.

## [1.0.4] - 2026-04-24

### Changed
- Bumped the development dependency on ESLint to 10.2.1 and refreshed the lockfile.

## [Pre-Release] - 2026-04-18 to 2026-04-20

### Day 1 AM - Initial Build and Core Feature Foundation
- Started from a clean module request and scaffolded the full MagicMirror module structure:
  frontend module, node helper, stylesheet, README, package metadata, and ignore file.
- Implemented core WMATA rail functionality:
  station-based predictions, line/destination filtering, grouped display, sorting, status tags, and refresh scheduling.
- Expanded README to document all configuration options with required/optional status and defaults.

### Day 1 Midday - Advanced UX and Config Expansion
- Added advanced display and commute features in iterative passes:
  next-train summary strip, quiet hours, commute compact logic, stale/freshness indicators, debug overlay, custom line order, fallback messaging, update jitter, and styling controls.
- Added incident enhancements:
  severity classification/filtering, custom alert keyword matching, incident row caps, and optional ticker-style scroll mode.
- Added car visualization enhancements:
  multiple car color modes, WMATA-oriented badge styling, and later compatibility behavior for users preferring the previous highlight style.

### Day 2 (PM) - UI Toggles, Integrations, and Stabilization
- Added key visual toggles after user testing feedback:
  `showFreshnessChip`, `showBorders`, and `showBackground`.
- Refined borderless/backgroundless behavior with stronger CSS and runtime class handling to ensure truly chrome-free rendering.
- Added optional weather support (Open-Meteo) integrated into conditions/summary output.
- Added optional MetroBus support end-to-end (disabled by default):
  helper-side prediction fetch, stop-level route filters, per-stop row limits, section rendering, and full documentation.
- Added incident advisory date-range display support when WMATA provides date fields.
- Repeatedly validated JS/CSS/README diagnostics after each major patch.
- Fixed a major data-shape/rendering regression that caused `UNDEFINED` output by repairing malformed helper/render flow.
- Corrected WMATA car color mapping for 6-car trains to use the medium amber/yellow band.
- Confirmed user-reported UI issues were resolved through iterative test/fix cycles before tagging the release.

## [1.0.1] - 2026-04-21

### Changed
- Improved README structure and clarity for installation and configuration.
- Added MMPM installation instructions.
- Expanded screenshot/documentation coverage for easier setup and verification.

## [1.0.0] - 2026-04-20

### Added
- Initial public release of MMM-DCMetroTrains.
- Live WMATA rail predictions for one or more configured stations.
- Multi-station rotation support.
- Per-station overrides via object entries in `stationCodes` (name, filters, row caps, grouping, compact mode, incident visibility, alerts, priority).
- Line filtering, destination filtering, custom line order, and grouped-by-line display.
- Next-train summary strip and conditions row.
- Incident panel with severity classification/filtering, row caps, and optional ticker-style scroll mode.
- Freshness indicators and relative last-updated status.
- Quiet-hours and commute-aware compact behavior.
- Optional weather summary integration.
- Optional MetroBus section with per-stop route filters and row limits (disabled by default).
- Incident advisory date-range chip support when date fields are available from WMATA.
- Extensive display toggles for columns, chips, headers, and module chrome.
- Border/background controls (`showBorders`, `showBackground`) and freshness chip control (`showFreshnessChip`).
- Car badge modes and compatibility toggle (`carsColorMode`, `showCarHighlights`).
- Advanced configuration guide and full option reference in README.

### Fixed
- Corrected a rendering/data-flow issue that could display `UNDEFINED` instead of arrival data.
- Hardened borderless/backgroundless rendering behavior for true chrome-free layouts.
- Updated WMATA car color mapping so 6-car trains use the appropriate medium (amber/yellow) color band.
