---
name: graylog
description: Use when the user wants to search, query, or investigate production logs via Graylog. Covers concepts (streams, trace_id, log levels, query syntax) and routes to specialty skills for deeper debugging flows. Triggers on "graylog", "check logs", "search logs", "find the log for", "what does graylog say", "grep logs".
---

# Graylog MCP — Entry Point

You have access to a Graylog MCP server with 8 tools for log search, distributed tracing, and incident investigation. This skill teaches you which tool to reach for and when to hand off to a specialty skill.

## Quick map: question → tool

| If the user says... | Reach for | And then... |
|---|---|---|
| "I have a trace_id, what happened" | `trace_request` | If >200 lines or >5 services, dispatch the `graylog-trace-analyzer` agent. Otherwise see `trace-debugging` skill. |
| "Errors are spiking" / "something just broke" | `aggregate_logs` (group_by: service, query: `logger_level:error`) | See `incident-triage` skill. |
| "What was happening around time T on host H" | `get_surrounding_logs` | Center timestamp + source filter. |
| "Show me logs matching X in the last N minutes" | `search_logs_relative` | Default fields are fine for most cases. |
| "Show me logs between timestamps A and B" | `search_logs_absolute` | Use UTC ISO 8601. |
| "What streams / applications exist" | `list_streams` | Use IDs returned to filter subsequent searches. |
| "Is Graylog reachable" | `get_system_info` | Always run this first if other tools fail (see `troubleshooting` skill). |

## Core concepts

- **Stream** — a Graylog stream is roughly one application or log source. Use `list_streams` to discover IDs, then pass `streamId` to filter.
- **trace_id / span_id** — distributed trace correlation IDs. A single request will have one trace_id across all services that handle it. `span_id` identifies a unit of work within the trace.
- **Levels** — common: `error`, `warn`, `info`, `debug`. Filter via `logger_level:error`.
- **Time windows** — choose absolute (`from`/`to` ISO 8601 UTC) for known incidents; relative (`rangeSeconds`) for "the last N minutes."

## Query syntax

Graylog uses Elasticsearch query string syntax:

- Field filter: `logger_level:error`, `service:foo`
- Boolean: `logger_level:error AND service:foo`
- Phrase: `"GET /api/v1/users"` (quoted)
- Wildcard: `service:foo-*`
- Negation: `NOT service:health-check`

## Result limits

- Default 50, max 1000 results per call.
- If a search hits the cap, narrow the time window before raising the limit.
- For `aggregate_logs`, if `truncated: true` appears in the response, the matched window exceeded `fetchLimit` (default 5000) — narrow the time range.

## When to hand off

- Trace investigations → `trace-debugging` skill (single-service inline) or `graylog-trace-analyzer` agent (multi-service, log-heavy)
- Active incidents → `incident-triage` skill
- Tools returning errors / empty results → `troubleshooting` skill

## Defaults that matter

- Searches return `message,timestamp,source,level,logger_level,trace_id,span_id,pod,service,container_name` by default. That covers most debugging without needing `*`.
- Pass `fields: '*'` only when you need a field outside the default set — it increases response size significantly.
