# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-06-25

### Changed

- **Migrated all log search from Graylog's deprecated `/api/search/universal/{relative,absolute}` endpoints to the modern Views Search API** (`POST /api/views/search` → `POST /{id}/execute`). On Graylog 5.x the legacy endpoints fail cryptically with `Missing search type result!` on multi-term / OR queries; the Views API is the supported path and surfaces the real backend error.
- Backend search failures are now reported clearly. The common OpenSearch boolean `maxClauseCount` limit (hit by broad / unqualified multi-term queries) is translated into actionable guidance instead of an opaque error.
- `aggregate_logs` no longer relies on per-field projection (the Views message list returns full messages); it still aggregates client-side on the requested field, so results are unchanged.

### Notes

- POST requests now send the `X-Requested-By` header (Graylog CSRF guard).
- Making broad / OR queries actually *return results* (rather than erroring clearly) still requires raising `indices.query.bool.max_clause_count` on the OpenSearch cluster — a server-side change outside this package.

## [2.3.0] - 2026-05-29

### Added

- 4 skills (`graylog`, `trace-debugging`, `incident-triage`, `troubleshooting`) auto-loaded from `skills/`.
- 1 subagent (`graylog-trace-analyzer`) auto-loaded from `agents/` — dispatch for trace investigations expected to surface >200 log lines or span >5 services.
- README "Skills & agents" section documenting triggers and use cases.

### Changed

- None. No `src/` modifications; the MCP server runtime is unchanged from 2.2.1.

## [2.2.1] - 2026-05-13

### Added
- **Structured stderr logging on every tool dispatch**. Three log lines per call:
  - `[graylog-mcp] tool_call: <name> <args>` — pre-execution, includes redacted args
  - `[graylog-mcp] tool_done: <name> · <duration>ms` — on success
  - `[graylog-mcp] tool_error: <name> · <duration>ms { message, args }` — on failure
- **`redactArgs()` helper** — masks credential-looking keys (regex: `token|password|secret|auth|cred|apikey`) before any args reach stderr; also truncates string values longer than 200 chars to prevent log spam from large Elasticsearch queries.
- **`dispatchTool()` helper** — extracted the switch statement from the request handler so the logging wrapper stays compact.

### Why
Before this patch, the only error visible on the server side was HTTP-level failures from `graylogRequest` (already logged). Validation errors, parse errors, and any handler-internal throw were silently caught at the top-level and returned only to the MCP client — making post-hoc debugging from server logs effectively impossible. Now every tool invocation is grep-able with full timing.

### Operator notes
- Logs go to **stderr** (MCP convention — stdout is reserved for the JSON-RPC protocol). Redirect with `2>>graylog-mcp.log` if you want to persist them.
- Log volume: ~3 lines per tool call. For a busy session of 100 calls/hour, that's ~300 lines/hour. Trivial.
- No new dependencies, no schema change, no new tool. Pure observability addition.

### Changed
- Server version bumped to 2.2.1
- `server.json` bumped to 1.2.1

## [2.2.0] - 2026-05-13

### Added
- **`aggregate_logs` tool** — Count log entries grouped by a field (service, logger_level, pod, lead_id, http_status, container_name, etc.). Issues ONE Graylog search with `fields=<group_field>` projected (bandwidth-light) and aggregates client-side. Returns `{top, other, missing, truncated, unique_groups, total_matched, ...}`. Accepts either `{from, to}` or `rangeSeconds`. Caps at `fetchLimit` messages (default 5000, max 10000) — when matched total exceeds that, `truncated: true` is flagged and the caller is expected to narrow the window.

### Why it's client-side rather than a Graylog aggregation
Graylog 5.x dropped the legacy `/api/search/universal/{rel,abs}/terms` aggregation endpoints — verified by live-probe against `graylog.scripbox.net` returning 404 for `/terms`, `/stats`, `/histogram`. The Views API replacement is a multi-step search-create + execute + poll dance that's awkward for a single MCP tool call. Client-side aggregation over the legacy search endpoint (which IS still present) works on every Graylog 4.x+ version and stays simple. The `fields=` projection means we only download the column we need, so even at 10000 matches the response payload is small.

### Changed
- Server version bumped to 2.2.0
- `server.json` bumped to 1.2.0 (MCP registry · 1.1.1 → 1.2.0 for new tool)

### Notes
- Listed as planned for 2.2.0 in earlier CHANGELOG — this delivery covers `aggregate_logs`. `list_fields` and TypeScript types remain in the queue for 2.3.

## [2.1.1] - 2026-05-13

### Added
- **`api_calls` field on `analyze_incident` responses** — explicit count of outbound HTTP requests to Graylog (3 on the happy path, 1 when the trace is empty). Sits alongside `steps_executed`, which counts the algorithm's logical steps (4 — includes the in-memory anchor-selection step that doesn't hit the network). The old field was easy to misread as "API calls"; this disambiguates without breaking consumers that already read `steps_executed`.

### Changed
- Server version bumped to 2.1.1
- `server.json` bumped to 1.1.1

### Why
- Originated in a live demo: after watching the v2.1.0 tool run through an HTTP proxy that captured exactly 3 outbound Graylog requests, it was obvious that the `steps_executed: 4` field was misleading by exactly one. Patch keeps the old field for backwards compat and adds the unambiguous one.

## [2.1.0] - 2026-05-13

### Added
- **`analyze_incident` tool** — Composite incident analysis demonstrating the "internal fan-out" MCP pattern. ONE tool call fans out to three sequential Graylog searches: (1) the full trace hop chain via `trace_id:X`, (2) **pod-scoped** surrounding logs around the first ERROR/CRITICAL/FATAL hop (filters by `pod:` instead of `source:` to avoid multi-tenant noise on shared EC2 hosts), and (3) a trailing-hour error baseline for the anchor service. Returns one aggregated report — hops, services involved, anchor service/pod, first-error context, HTTP request entry/exit summary (path/method/status/duration), and baseline error rate. Designed for LLM consumption: saves 2-3 orchestration rounds when investigating a specific trace.
- New `summary.request` field extracts `http_path`, `http_method`, `http_status`, `duration_ms` from the trace's exit log when present.
- New `summary.first_error.lead_id` field surfaces the user identifier when Scripbox-style traces carry it.

### Changed
- Server version bumped to 2.1.0
- `server.json` registry metadata refreshed to list all 7 tools (was stale — still listed only 4 from v1.x)

### Notes
- Validated against real Graylog 5.0.3 production data before shipping. Key discoveries that shaped the design: `logger_level` is lowercase in practice (so error-level detection is case-insensitive), and a 10s surrounding-logs window matched 756 logs across 5+ pods on the same EC2 host — driving the pod-scoped filter decision.
- The previously-planned 2.1.0 features (`aggregate_logs`, `list_fields`) were not built in this release; they remain in the future-releases queue.

## [2.0.0] - 2026-04-27

### Breaking Changes
- `formatMessages()` now returns ALL fields from Graylog messages (filtering out `gl2_*` internals) instead of only `{timestamp, message, source, level}`. Consumers relying on the exact 4-field shape need to update.
- Default `fields` parameter changed from `message,timestamp,source,level` to include `logger_level,trace_id,span_id,pod,service,container_name`. Pass explicit `fields` to restore old behavior.

### Added
- **`trace_request` tool** — Trace a request across ALL services using a `trace_id`. Groups results by service, sorts by timestamp. Essential for distributed debugging in microservice architectures.
- **`get_surrounding_logs` tool** — Get logs within +-N seconds of a timestamp, optionally filtered by source/pod/stream. Reveals what happened immediately before and after an error.
- **`fields` parameter** on `search_logs_absolute` and `search_logs_relative` — Specify which fields to return. Use `'*'` for all fields. Default now includes tracing fields (`trace_id`, `span_id`, `pod`, `service`, `container_name`).
- `DEFAULT_FIELDS` exported constant in `helpers.js` for consistent field defaults.

### Changed
- `formatMessages()` passes through all non-internal fields instead of cherry-picking 4. Internal fields (`gl2_*`) are stripped to reduce noise.
- Server version bumped to 2.0.0
- Tool descriptions updated with distributed tracing examples (`trace_id:abc123`, `logger_level:error`)

### Fixed
- Distributed tracing was impossible — `trace_id`, `span_id`, `pod`, `service`, `container_name` were silently dropped by `formatMessages()`
- `logger_level` field (used by many apps instead of `level`) was not returned

## [1.0.3] - 2026-04-08

### Changed
- Extract shared helpers into `src/helpers.js` — tests now import real production code instead of copy-pasted duplicates
- `formatError` takes explicit `baseUrl` parameter (pure function, easier to test)
- Tool functions use extracted validators (`validateQuery`, `validateStreamId`, `validateRangeSeconds`, `validateLimit`, `formatMessages`)

### Fixed
- **CRITICAL**: Remove leaked MCP Registry credentials from git tracking
- Add `.mcpregistry_*` to `.gitignore`

### Added
- `src/helpers.js` — 8 exported validation and formatting functions
- `server.json` included in npm package files

## [1.0.0] - 2025-10-23

**First stable public release!**

### Added
- Complete rewrite as independent, focused Graylog MCP server
- Absolute timestamp search (`search_logs_absolute`) for debugging specific errors
- Relative timestamp search (`search_logs_relative`) for recent logs
- Stream discovery (`list_streams`) to find available applications
- System health check (`get_system_info`) to verify connectivity
- Comprehensive input validation with clear error messages
- ISO 8601 timestamp validation
- Stream ID filtering support
- Timeout handling (30 seconds)
- Production-ready error messages
- Comprehensive test suite (54 tests)
  - Unit tests for helper functions
  - Validation tests for all bug fixes
  - MCP protocol conformance tests
  - Integration tests for live Graylog instances
- Example Claude Desktop configuration
- Detailed README with usage examples
- Common query patterns documentation
- Troubleshooting guide

### Fixed
- **CRITICAL**: Message field access crash on malformed responses (Bug #1)
- **HIGH**: Missing rangeSeconds validation (Bug #2)
- **HIGH**: Missing streamId type validation (Bug #3)
- **MEDIUM**: Null query handling crash (Bug #4)
- **MEDIUM**: limit=0 bypassing default value (Bug #5)

### Changed
- Package name from `graylog-mcp-server` to `mcp-server-graylog`
- Architecture simplified to single file (429 lines)
- Dependencies reduced to 2 essential packages
- Error messages made more actionable
- Default limit set to 50 results
- Maximum time range limited to 24 hours (86400 seconds)

### Security
- Environment variable validation at startup
- API token authentication properly implemented
- No hardcoded credentials
- Input sanitization prevents injection attacks
- Error messages don't leak sensitive information

## [1.0.0] - 2025-10-20

### Added
- Initial release (cloned from lcaliani/graylog-mcp)
- Basic Graylog API integration
- Search functionality

### Known Issues
- 5 critical bugs identified by debugger agent
- Missing input validation
- No test coverage
- Incomplete error handling

---

## Future Releases

### [2.2.0] - Planned
- `aggregate_logs` tool — Count/group logs by service, level, pod
- `list_fields` tool — Discover available fields in a stream
- GitHub Actions CI/CD pipeline
- TypeScript type definitions (.d.ts)

### [3.0.0] - Planned
- Streaming logs support (WebSocket/SSE)
- Advanced filtering with saved searches
- Dashboard integration
- Alert query support
