---
name: incident-triage
description: Use when the user reports an active incident — errors spiking, an alert fired, "something just broke." Helps localize the failure to a service and pattern before deep-diving. Triggers on "errors spiking", "outage", "incident", "something just broke", "alert fired", "service down".
---

# Incident Triage

Use this skill when the user reports active failure. Goal: in under 5 tool calls, identify which service is bleeding, what pattern of error, and whether a recent deploy is responsible.

## Playbook

### Step 1 — Quantify the spike

Call `aggregate_logs`:

```
query: "logger_level:error"
field: "service"
rangeSeconds: 1800
```

Response gives you error counts per service for the last 30 minutes. The top 1–3 services are your suspects.

### Step 2 — Baseline against the previous window

Run the same `aggregate_logs` query with `from` / `to` shifted back by 30 minutes (the previous half-hour). Compare:

- A service that went from low/zero to high count → new failure (likely a deploy or upstream).
- A service that was already high → ongoing issue, not the cause of *this* alert.
- All services up uniformly → likely a shared dependency (DB, network, auth) — investigate that service first.

### Step 3 — Drill into the top offender

For the highest-delta service, call `search_logs_relative`:

```
query: "logger_level:error AND service:<top-offender>"
rangeSeconds: 1800
limit: 50
```

Read the sample error messages. Look for:

- **One dominant error pattern** → the bug is localized; capture the error text.
- **A single trace_id repeating** → hand off to `trace-debugging` skill with that trace_id.
- **Many distinct errors** → likely a process crash / restart loop; check timestamps for clustering.

### Step 4 — Did a deploy cause this?

If the spike has a clear start time, search a small window around it for startup markers:

```
query: '("Starting" OR "Booting" OR "version") AND service:<top-offender>'
from: <spike start - 5min>
to: <spike start + 1min>
limit: 20
```

A startup log line within 5 minutes before the spike is a strong deploy signal.

### Step 5 — Pod / instance correlation

If errors cluster on one `pod`, narrow further:

```
aggregate_logs
  query: "logger_level:error AND service:<top-offender>"
  field: "pod"
  rangeSeconds: 1800
```

A single bad pod → restart that pod (action for the user), no code change needed.
Errors spread evenly across pods → real code or config issue.

## Stop conditions

- **Localized to one service + one error pattern + recent deploy** → Done. Report findings and suggest a rollback or a targeted code-look.
- **Multiple services failing simultaneously** → Likely upstream (DB, queue, auth service). Investigate the shared dependency first; don't keep drilling into individual services.
- **All errors in one pod** → Report pod, suggest restart, stop investigating.
- **Pattern is unclear after 5 tool calls** → Surface what you have and ask the user what they know about recent changes; don't keep guessing.

## What NOT to do

- Don't pull raw logs without aggregating first — you'll drown in noise.
- Don't filter to `error` only on the first call and miss `warn` precursors. After identifying the offender service, broaden to all levels in step 3 for a few sample windows.
- Don't ignore baseline data. "Errors are high" is meaningless without "errors were low 30 minutes ago."
