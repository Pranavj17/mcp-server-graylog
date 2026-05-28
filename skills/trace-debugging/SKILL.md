---
name: trace-debugging
description: Use when investigating a specific trace_id — following a single request across services to understand where it failed, hung, or behaved unexpectedly. Triggers on "trace_id", "follow this request", "distributed trace", "trace across services", "what happened to request X".
---

# Trace Debugging

Use this skill when you have a `trace_id` and need to understand the end-to-end behavior of a single request.

## When to dispatch the agent instead

If `trace_request` returns >200 logs OR the trace spans >5 services, stop and dispatch the `graylog-trace-analyzer` subagent. It returns a synthesized timeline (~50 lines) instead of flooding the main context with raw logs. Inline investigation is for smaller, focused traces.

## Playbook

### Step 1 — Pull the trace

Call `trace_request` with:
- `traceId`: the trace ID the user gave you (or you extracted from a Sentry/dashboard URL).
- `from` / `to`: a generous window — ±15 minutes around the suspected event. Trace IDs are unique enough that overshooting is cheap.
- `limit`: 200 to start. Raise to 500 if you see truncation hints.

The response groups logs by `service` and orders by timestamp. Read it once before doing anything else.

### Step 2 — Identify the failure span

Scan the trace for:
- The first `error` or `fatal` level entry — that is the proximate failure.
- The originating service — usually the entry-point (gateway, API server) or the service that emitted the first error.
- Latency outliers — gaps > 1s between consecutive spans often indicate a hung dependency.

### Step 3 — Pull surrounding context for each error span

For each error span, call `get_surrounding_logs` with:
- `centerTimestamp`: the error timestamp.
- `source` or `pod`: filter to the same pod, since adjacent context from other pods is noise.
- `secondsBefore` / `secondsAfter`: start with 5 each.

The error message itself is rarely the cause. The cause is usually 1–10 lines before, in the same pod, often at `info` or `warn` level (e.g., a connection timeout, a config reload, a retry exhaustion).

### Step 4 — Build the timeline

Assemble a human-readable summary:
- Originating service / pod
- Trace duration (first timestamp to last)
- Error spans in chronological order, each with: timestamp, service, message, likely cause from surrounding context
- Propagation: did the error originate downstream and bubble up, or originate at the entry point?

## Pitfalls

- **Window too narrow.** Long-running jobs (batch processors, background workers) can have trace IDs alive for hours. If `trace_request` returns very few results, widen the window before assuming the trace is small.
- **Missing trace_id on some lines.** Not every log emits trace_id. The trace_request results only show lines tagged with the ID. Use `get_surrounding_logs` to pull adjacent untagged context.
- **Re-used trace IDs.** Rare but possible if a service is misconfigured to reuse IDs. If you see two clearly-different requests under one ID, widen `from`/`to` and check the timestamps.
- **Clock skew.** Pods on different hosts can have skewed clocks. A "downstream first" timeline order can be an artifact of skew, not actual causation.

## What to return to the user

A 5–10 line synthesis:
- Originating service / pod
- Root-cause line (from surrounding context, not the propagated error)
- Blast radius (how many downstream services were affected)
- Suggested next step (look at deploy times? check dependency health? read a specific service's recent commits?)
