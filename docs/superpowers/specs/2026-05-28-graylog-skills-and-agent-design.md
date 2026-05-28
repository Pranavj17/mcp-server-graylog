# Graylog MCP — Skills & Agent Bundle (v2.3.0)

**Date:** 2026-05-28
**Plugin version target:** 2.3.0 (current: 2.2.1)
**Branch:** `feat/skills-and-trace-agent`

## Goal

`graylog-log-search` ships today as a pure MCP-server plugin: 8 tools, no skills, no agents. Without skills, Claude has to infer when and how to use the tools from the tool descriptions alone. This release adds a layer of generic, marketplace-friendly playbooks so Claude reaches for Graylog at the right moments and follows known-good debugging flows — without changing the server itself.

Out of scope: any change to `src/`, any Scripbox-specific content (stream IDs, service names, lead_id), and any new MCP tools.

## Deliverables

Four skills and one subagent, all distributed via the existing plugin:

- `skills/graylog/SKILL.md` — entry-point playbook
- `skills/trace-debugging/SKILL.md` — `trace_id`-driven investigation
- `skills/incident-triage/SKILL.md` — error-spike triage flow
- `skills/troubleshooting/SKILL.md` — MCP connectivity diagnostics
- `agents/graylog-trace-analyzer.md` — subagent for log-volume-heavy trace work

Plus a version bump to 2.3.0, a CHANGELOG entry, and a README section listing the additions.

## Repo layout (after)

```
mcp-server-graylog/
├── .claude-plugin/
│   ├── plugin.json          # version 2.2.1 → 2.3.0
│   └── marketplace.json     # unchanged unless re-publish requires a touch
├── skills/
│   ├── graylog/SKILL.md
│   ├── trace-debugging/SKILL.md
│   ├── incident-triage/SKILL.md
│   └── troubleshooting/SKILL.md
├── agents/
│   └── graylog-trace-analyzer.md
├── src/                     # unchanged
├── test/                    # unchanged
├── docs/
│   └── superpowers/specs/2026-05-28-graylog-skills-and-agent-design.md   # this file
├── README.md                # add "Skills & agents" section
└── CHANGELOG.md             # v2.3.0 entry
```

Plugin manifests auto-discover `skills/` and `agents/` by directory convention (matches the chrome-devtools-mcp plugin shape). The implementation plan will verify this against an installed reference plugin before relying on it; if explicit declaration is required, `plugin.json` gets `skills` and `agents` keys pointing at the directories.

## Skills

Each skill is a markdown file with YAML frontmatter (`name`, `description`) followed by the playbook body. The `description` is what Claude reads to decide whether to invoke; the body is the procedural detail Claude executes once invoked.

All skills are written generically — they reference Graylog concepts only (`trace_id`, streams, levels, fields). No internal service names, no organization-specific stream IDs, no embedded API tokens.

### 1. `graylog` — entry-point

**Description:** Use when the user wants to search, query, or investigate production logs via Graylog. Covers basic concepts (streams, trace_id, log levels, time windows) and routes to the specialty skills below for deeper flows.

**Body covers:**

- Quick map: question → tool
  - "I have a trace_id" → `trace_request`
  - "Errors are spiking" → `aggregate_logs` grouped by `service` or `logger_level`
  - "What happened around time T" → `get_surrounding_logs`
  - "I need to find log X from stream Y" → `search_logs_absolute` / `search_logs_relative`
  - "Is Graylog reachable" → `get_system_info`
- Concepts: streams are application/source partitions; trace_id correlates a single request across services; common levels are `error`, `warn`, `info`, `debug`.
- Query syntax: Elasticsearch query string (`logger_level:error AND service:foo`, quoted phrases, wildcards).
- Result limits: default 50, max 1000. Narrow time windows before raising limits.
- Cross-references to `trace-debugging`, `incident-triage`, `troubleshooting`.

### 2. `trace-debugging`

**Description:** Use when investigating a specific `trace_id` — following a single request across services to understand where it failed, hung, or behaved unexpectedly.

**Body covers:**

- Step 1 — pull the trace: `trace_request` with the `trace_id` and a generous window (start with ±15 min around the suspected event).
- Step 2 — read the per-service grouping. Identify error/warn spans and the originating service.
- Step 3 — for each error span, call `get_surrounding_logs` to pull ±5s of adjacent context from that service/pod. This often surfaces the cause (the error message itself is rarely the cause).
- Step 4 — synthesize: timeline of (timestamp, service, level, message), the originating failure, propagation path.
- When to escalate to the agent: if step 1 returns >200 logs or spans >5 services, dispatch `graylog-trace-analyzer` instead of continuing inline (keeps main context clean).
- Pitfalls: trace_id may span a longer window than expected (long-running jobs); some services may not emit trace_id on every line (filter out null trace_id entries).

### 3. `incident-triage`

**Description:** Use when the user reports an active incident — errors spiking, an alert fired, "something just broke." Helps localize the failure before deep-diving.

**Body covers:**

- Step 1 — quantify the spike: `aggregate_logs` with `query: 'logger_level:error'`, `group_by: 'service'`, `rangeSeconds: 1800`. This tells you which service is bleeding.
- Step 2 — baseline: rerun the same aggregation against the previous 30-min window (`from`/`to` shifted back) to confirm the spike is new.
- Step 3 — drill: `search_logs_relative` against the top offender service with `logger_level:error` to read sample messages.
- Step 4 — pattern detect: if a single `trace_id` keeps recurring, hand off to `trace-debugging`. If errors cluster by `pod`, narrow to one pod and inspect.
- Step 5 — deploy check: was there a deploy in the spike window? Look for restart / startup log lines (`Starting`, `boot`, version banners) just before the spike start.
- Stop conditions: localized to one service + one error pattern → done, hand back to user with findings. Multiple services failing → likely upstream cause (database, network, dependency); investigate that service first.

### 4. `troubleshooting`

**Description:** Use when Graylog MCP tools return errors (connection refused, 401, target not found, empty results when results are expected). Diagnoses connectivity, auth, and configuration issues.

**Body covers:**

- Always start with `get_system_info`. If it fails, the rest will too.
- `BASE_URL` checks: must include scheme (`https://`), no trailing slash before `/api`, hostname resolvable from where the MCP server runs.
- `API_TOKEN` checks: token still valid, not the username — Graylog API auth uses token as the username and `token` as the password.
- HTTP status mapping:
  - 401 → token invalid or expired; regenerate in Graylog UI under Account → Tokens.
  - 403 → token lacks read permission on the target stream; ask admin to grant.
  - 404 on stream filter → stream ID doesn't exist or token can't see it; verify via `list_streams`.
  - 5xx → Graylog server-side issue, not the MCP server.
- `list_streams` returns empty: token has no stream-read scope.
- Searches return 0 results when results are expected: check time window (UTC vs. local), check query syntax (Elasticsearch, not Lucene-only), check field name casing.

## Agent

### `graylog-trace-analyzer`

**Purpose:** Subagent dispatched from the main loop when a trace-id investigation would dump hundreds of raw log lines into the parent context. Returns a synthesized structured timeline instead of the raw stream.

**Frontmatter (planned):**

```yaml
---
name: graylog-trace-analyzer
description: Investigate a trace_id that spans multiple services or is likely to surface >200 log lines. Returns a structured timeline (timestamp, service, span, level, message, is_error) plus a short verdict — not raw logs.
tools: mcp__plugin_graylog-log-search_graylog__trace_request, mcp__plugin_graylog-log-search_graylog__get_surrounding_logs, mcp__plugin_graylog-log-search_graylog__search_logs_absolute, Read
---
```

**Playbook body:**

1. Call `trace_request` with the supplied `trace_id` and time window.
2. For each span where `level ∈ {error, warn}`, call `get_surrounding_logs` for ±5s context, filtered to the originating service/pod.
3. Optionally call `search_logs_absolute` to pull a baseline (same window, no trace_id filter) to distinguish trace-specific failures from cluster-wide noise.
4. Build a timeline as a list of objects: `{timestamp, service, span_id, level, message, is_error}`.
5. Return: the timeline (capped at ~50 most informative entries), the originating service/pod, the propagation path, and a one-paragraph verdict.

**When NOT to dispatch:**

- Single-service traces — the `trace-debugging` skill handles those inline.
- Traces with under ~50 log lines total — the overhead of agent dispatch isn't worth it.
- Investigations that need iterative human-driven follow-up — stay inline so the user can redirect.

**Tool restrictions:** Only the Graylog MCP read tools plus `Read`. No write tools (`Edit`, `Write`, `Bash`) — this agent reads and synthesizes, it does not modify state.

## Release

- **Branch:** `feat/skills-and-trace-agent` off `main`.
- **`plugin.json`:** version 2.2.1 → 2.3.0. Add explicit `skills` / `agents` declarations only if discovery convention isn't sufficient (verified during implementation).
- **`README.md`:** new "Skills & agents" section listing the 5 additions with one-line descriptions and trigger summaries.
- **`CHANGELOG.md`:** v2.3.0 entry — "Added skills (graylog, trace-debugging, incident-triage, troubleshooting) and agent (graylog-trace-analyzer)."
- **Verification:** after merging and tagging, `/reload-plugins` in a fresh Claude Code session; confirm the 4 skills appear in the skills list and the agent appears as a dispatchable subagent type. Smoke-test each skill by triggering its keyword and confirming Claude reaches for the correct MCP tool first.
- **No src/ changes**, no test changes — zero risk to the MCP server runtime.

## Risks & open questions

- **Skill discovery convention:** assumed to be directory-based per `skills/<name>/SKILL.md`. Implementation plan must verify against an installed reference plugin (chrome-devtools-mcp) before relying on it. If explicit declaration is required, add to `plugin.json`.
- **Agent tool scoping:** the exact tool-id format for plugin-prefixed MCP tools in agent frontmatter (`mcp__plugin_graylog-log-search_graylog__*`) needs verification. Fall back to wildcard or omit `tools:` if exact-list scoping is brittle.
- **Generic-only constraint:** keep an eye out during skill drafting for accidental Scripbox-isms (stream IDs, service names from memory). Each skill body should be reviewable in isolation by a non-Scripbox user.
