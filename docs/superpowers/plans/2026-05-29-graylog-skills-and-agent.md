# Graylog MCP — Skills & Agent Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 skills + 1 subagent to the `graylog-log-search` plugin (v2.2.1 → v2.3.0), without modifying the MCP server source.

**Architecture:** Pure docs/playbook release. Skills land under `skills/<name>/SKILL.md` (auto-discovered), agent under `agents/graylog-trace-analyzer.md` (auto-discovered). Version bumps in `plugin.json` and `package.json`; CHANGELOG and README updated; one final smoke-test loop.

**Tech Stack:** Markdown with YAML frontmatter. Claude Code plugin format. No code changes.

**Spec:** `docs/superpowers/specs/2026-05-28-graylog-skills-and-agent-design.md`

**Working tree:** `~/Documents/mcp-server-graylog` on branch `feat/skills-and-trace-agent` (already created and holds the spec commit `d9a5a83`).

---

## File Structure (after)

```
mcp-server-graylog/
├── .claude-plugin/
│   └── plugin.json                                  # MODIFIED: version 2.2.1 → 2.3.0
├── package.json                                     # MODIFIED: version 2.2.1 → 2.3.0
├── README.md                                        # MODIFIED: add "Skills & agents" section
├── CHANGELOG.md                                     # MODIFIED: v2.3.0 entry
├── skills/                                          # NEW
│   ├── graylog/SKILL.md                             # NEW
│   ├── trace-debugging/SKILL.md                     # NEW
│   ├── incident-triage/SKILL.md                     # NEW
│   └── troubleshooting/SKILL.md                     # NEW
└── agents/                                          # NEW
    └── graylog-trace-analyzer.md                    # NEW
```

`src/`, `test/`, `.mcp.json`, `server.json`, `.claude-plugin/marketplace.json` are untouched.

---

### Task 1: Pre-flight verification

Confirm assumptions about the plugin runtime before writing playbooks.

**Files:** None (read-only checks)

- [ ] **Step 1: Confirm skill auto-discovery**

```bash
PD=$(ls -d ~/.claude/plugins/cache/claude-plugins-official/chrome-devtools-mcp/*/ | tail -1)
find "$PD" -name SKILL.md
grep -c skills "$PD/.claude-plugin/plugin.json"
```

Expected: 6 SKILL.md paths under `$PD/skills/<name>/SKILL.md`; `grep -c` returns `0` (no `skills` key declared — auto-discovery confirmed).

- [ ] **Step 2: Confirm agent auto-discovery convention**

```bash
grep -l agents ~/.claude/plugins/cache/*/*/.claude-plugin/plugin.json 2>/dev/null
find ~/.claude/plugins/cache -path '*/agents/*.md' -maxdepth 6 2>/dev/null | head
```

Expected: empty (no installed plugin currently ships agents — convention not directly observable from cache).

Fallback: project-level `.claude/agents/*.md` convention is documented and known to work (see `~/Documents/memory/.claude/agents/code-reviewer.md`). Assume plugin convention mirrors: `<plugin>/agents/<name>.md`. Task 10 (smoke test) will verify. If agent does not appear, fall back to declaring `agents` key in `plugin.json` then re-test.

- [ ] **Step 3: Confirm current branch + working tree clean**

```bash
cd ~/Documents/mcp-server-graylog && git branch --show-current && git status --short
```

Expected: `feat/skills-and-trace-agent`, no uncommitted changes (spec was committed in `d9a5a83`).

---

### Task 2: Skill — `graylog` (entry-point)

**Files:**
- Create: `~/Documents/mcp-server-graylog/skills/graylog/SKILL.md`

- [ ] **Step 1: Write the skill file**

```markdown
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
```

- [ ] **Step 2: Verify file**

```bash
cd ~/Documents/mcp-server-graylog && head -5 skills/graylog/SKILL.md && wc -l skills/graylog/SKILL.md
```

Expected: frontmatter starts with `---`, second line `name: graylog`, line count between 50 and 100.

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add skills/graylog/SKILL.md && git commit -m "feat(skills): add graylog entry-point skill"
```

---

### Task 3: Skill — `trace-debugging`

**Files:**
- Create: `~/Documents/mcp-server-graylog/skills/trace-debugging/SKILL.md`

- [ ] **Step 1: Write the skill file**

```markdown
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
```

- [ ] **Step 2: Verify file**

```bash
cd ~/Documents/mcp-server-graylog && head -5 skills/trace-debugging/SKILL.md && wc -l skills/trace-debugging/SKILL.md
```

Expected: frontmatter present, line count between 60 and 100.

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add skills/trace-debugging/SKILL.md && git commit -m "feat(skills): add trace-debugging skill"
```

---

### Task 4: Skill — `incident-triage`

**Files:**
- Create: `~/Documents/mcp-server-graylog/skills/incident-triage/SKILL.md`

- [ ] **Step 1: Write the skill file**

```markdown
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
```

- [ ] **Step 2: Verify file**

```bash
cd ~/Documents/mcp-server-graylog && head -5 skills/incident-triage/SKILL.md && wc -l skills/incident-triage/SKILL.md
```

Expected: frontmatter present, line count between 70 and 110.

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add skills/incident-triage/SKILL.md && git commit -m "feat(skills): add incident-triage skill"
```

---

### Task 5: Skill — `troubleshooting`

**Files:**
- Create: `~/Documents/mcp-server-graylog/skills/troubleshooting/SKILL.md`

- [ ] **Step 1: Write the skill file**

```markdown
---
name: troubleshooting
description: Use when Graylog MCP tools return errors (connection refused, 401, target not found, empty results when results are expected). Diagnoses connectivity, auth, and configuration. Triggers on graylog tool failures, "connection refused", "401", "target not found", "graylog isn't returning anything".
---

# Graylog MCP — Troubleshooting

Use this skill when Graylog MCP tool calls fail or return nothing unexpectedly.

## Step 1 — Always start with `get_system_info`

If any other tool fails, call `get_system_info` first. It tells you whether the server is reachable and the credentials are valid. If it returns successfully, the connection is fine and the issue is in the query.

If `get_system_info` itself fails, work through Steps 2–4 below.

## Step 2 — `BASE_URL` checks

The `BASE_URL` env var must:

- Include the scheme: `https://graylog.example.com` (or `http://` for local).
- Not end with `/api` or a trailing slash. The server adds the API path.
- Be reachable from the host running the MCP server (not from the user's laptop, if those differ).

Verify reachability:

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/system" -u "$API_TOKEN:token" && echo OK
```

If `curl` returns 200, the URL and token both work; the MCP server itself is misconfigured. If `curl` fails, it is a network / auth problem.

## Step 3 — `API_TOKEN` checks

- Tokens are generated in the Graylog UI under **Account → Edit profile → Create token**.
- Auth uses the token as the **username** and the literal string `token` as the **password** (Graylog convention). Confirm the MCP server's HTTP basic auth header reflects this.
- Tokens can expire or be revoked. If `curl` returns 401 with a known-good URL, regenerate the token.

## Step 4 — HTTP status → fix mapping

| Status | Meaning | Fix |
|---|---|---|
| 401 | Token invalid / expired | Regenerate token, update `API_TOKEN`. |
| 403 | Token valid, lacks scope | Ask the Graylog admin to grant read access to the streams you need. |
| 404 on stream filter | Stream ID doesn't exist or token can't see it | Call `list_streams` to confirm valid IDs visible to this token. |
| 5xx | Graylog server-side issue | Not the MCP server's fault. Check Graylog itself. |

## Step 5 — Empty results when results are expected

If a search returns zero hits but you know logs exist:

- **Time zone.** Graylog stores UTC. If you pass `from`/`to` as local-time ISO strings without a UTC offset, you may be querying the wrong window. Always use `Z`-suffixed UTC.
- **Query syntax.** Elasticsearch query string, not pure Lucene. `field=value` won't work; use `field:value`. `AND`/`OR` must be uppercase.
- **Field casing.** Field names are case-sensitive. `service:foo` ≠ `Service:foo`.
- **Stream filter mismatch.** If you pass a `streamId` the token can't read, you get an empty (not an error) response.

## Step 6 — `list_streams` returns empty

The token has no stream-read permissions. Ask the admin to grant read access; the MCP server itself is fine.

## When to give up and ask

If steps 1–5 all check out and the tool still fails, the problem is on the Graylog server side (cluster issue, indexer down, retention purge). Surface what you've verified and ask the user to check with their Graylog operator or check the Graylog `/api/system/cluster/health` endpoint directly.
```

- [ ] **Step 2: Verify file**

```bash
cd ~/Documents/mcp-server-graylog && head -5 skills/troubleshooting/SKILL.md && wc -l skills/troubleshooting/SKILL.md
```

Expected: frontmatter present, line count between 50 and 80.

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add skills/troubleshooting/SKILL.md && git commit -m "feat(skills): add troubleshooting skill"
```

---

### Task 6: Agent — `graylog-trace-analyzer`

**Files:**
- Create: `~/Documents/mcp-server-graylog/agents/graylog-trace-analyzer.md`

- [ ] **Step 1: Write the agent file**

```markdown
---
name: graylog-trace-analyzer
description: Dispatch when investigating a trace_id that spans multiple services or is likely to surface >200 log lines. Pulls the full trace, gathers surrounding context for error spans, and returns a structured timeline plus a verdict — not raw logs. Use to keep main-loop context clean.
tools: mcp__plugin_graylog-log-search_graylog__trace_request, mcp__plugin_graylog-log-search_graylog__get_surrounding_logs, mcp__plugin_graylog-log-search_graylog__search_logs_absolute, Read
model: inherit
---

You are a focused distributed-trace investigator. Your single job is to take a `trace_id` and return a concise, structured timeline that explains what happened during that request — not the raw logs.

## Inputs you expect

The dispatcher will give you:
- `trace_id` — required.
- A time window (`from` / `to` ISO 8601, or "the last N minutes"). If not given, default to the last 30 minutes.
- Optional context: suspected service, suspected failure mode.

If `trace_id` is missing, return immediately with an error explaining the agent needs a trace ID.

## What you do

1. **Pull the trace.** Call `trace_request` with the trace_id and window. `limit: 500` is fine — you are budgeted to handle volume.

2. **Identify error spans.** From the response, list every entry where `level` or `logger_level` is `error`, `fatal`, or `warn`. Note the timestamp, service, pod, and message.

3. **Pull surrounding context for each error span.** For each error span (cap at 10 to bound work), call `get_surrounding_logs`:
   - `centerTimestamp` = error timestamp
   - `source` = the error span's pod (or service if pod unknown)
   - `secondsBefore: 5, secondsAfter: 2`
   - `limit: 50`

   This usually surfaces the root cause line, which is rarely the error itself.

4. **Optional baseline.** If you cannot distinguish trace-specific failure from cluster-wide noise (e.g., the same error appears on every recent request), call `search_logs_absolute` once with the same window and a `logger_level:error AND service:<originating-service>` query, no trace_id filter. If the same error pattern appears on unrelated requests, the trace failed because of an ambient bug, not because of anything specific to this request.

5. **Build the timeline.** Produce a list of up to 50 entries, each `{timestamp, service, span_id, level, message, is_error}`. Pick the most informative entries: every error span, plus the 1–3 surrounding lines per error span that look causally relevant.

## What you return

A structured response, **not raw logs**:

```
TRACE: <trace_id>
WINDOW: <from> → <to>
ORIGIN: <service / pod where the failure started>
PROPAGATION: <which services saw the error, in order>
ROOT CAUSE LINE: <the single log line, with timestamp + service + message, that best explains why this trace failed>
VERDICT: <2–4 sentence summary in plain English: what went wrong, where, why>

TIMELINE (most informative 30–50 entries):
- HH:MM:SS.mmm | service | span | LEVEL | message
- ...
```

## What you do NOT do

- Do not dump raw `trace_request` output. Synthesize.
- Do not modify any files. You have no write tools by design.
- Do not investigate beyond this trace. If you find evidence of a broader incident, mention it in the verdict and stop — the parent agent will decide whether to dispatch a triage flow.
- Do not iterate with the user. You return one structured response and exit.

## Edge cases

- **Trace returns 0 logs.** Verify the window covers the suspected time. Widen to ±1 hour. If still empty, return verdict "trace_id not found in the given window."
- **Trace has no error/warn spans.** The request completed successfully (or failures were silenced). Return a brief timeline and verdict "no error events found in this trace."
- **Trace spans hundreds of services.** Cap at the 10 services with the most error spans; mention the cap in the verdict.
```

- [ ] **Step 2: Verify file**

```bash
cd ~/Documents/mcp-server-graylog && head -8 agents/graylog-trace-analyzer.md && wc -l agents/graylog-trace-analyzer.md
```

Expected: frontmatter has `name`, `description`, `tools`, `model`; line count between 60 and 100.

- [ ] **Step 3: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add agents/graylog-trace-analyzer.md && git commit -m "feat(agents): add graylog-trace-analyzer subagent"
```

---

### Task 7: Version bump

**Files:**
- Modify: `~/Documents/mcp-server-graylog/.claude-plugin/plugin.json`
- Modify: `~/Documents/mcp-server-graylog/package.json`

- [ ] **Step 1: Bump `plugin.json` version**

```bash
cd ~/Documents/mcp-server-graylog && sed -i '' 's/"version": "2.2.1"/"version": "2.3.0"/' .claude-plugin/plugin.json && grep '"version"' .claude-plugin/plugin.json
```

Expected: `"version": "2.3.0",`

- [ ] **Step 2: Bump `package.json` version**

```bash
cd ~/Documents/mcp-server-graylog && sed -i '' 's/"version": "2.2.1"/"version": "2.3.0"/' package.json && grep '"version"' package.json
```

Expected: `"version": "2.3.0",`

- [ ] **Step 3: Confirm no stray 2.2.1 references**

```bash
cd ~/Documents/mcp-server-graylog && grep -rn "2.2.1" --include='*.json' --include='*.md' . | grep -v CHANGELOG | grep -v package-lock
```

Expected: empty output. (CHANGELOG.md keeps historical 2.2.1; package-lock.json is regenerated by npm.)

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add .claude-plugin/plugin.json package.json && git commit -m "chore: bump version to 2.3.0"
```

---

### Task 8: Update `README.md`

**Files:**
- Modify: `~/Documents/mcp-server-graylog/README.md`

- [ ] **Step 1: Locate a good insertion point**

```bash
cd ~/Documents/mcp-server-graylog && grep -n "^## " README.md | head -15
```

Read the output to pick the right anchor. The new "Skills & agents" section should land after the "Tools" section (which documents the 8 MCP tools) and before any "Configuration" / "Development" section. If the structure differs, insert wherever a "feature surface" overview is most discoverable.

- [ ] **Step 2: Insert the section**

Use Edit to add this block at the chosen insertion point:

```markdown
## Skills & agents (v2.3.0+)

When installed as a Claude Code plugin, this package ships playbooks that teach Claude *when* and *how* to use the MCP tools above.

### Skills

| Skill | When it triggers | What it does |
|---|---|---|
| `graylog` | "search logs", "check graylog", general log questions | Entry-point. Maps common questions to the right tool, explains streams / trace_id / query syntax, points at the specialty skills. |
| `trace-debugging` | "trace_id", "follow this request", "distributed trace" | Single-request investigation across services. Pulls the trace, finds error spans, gathers surrounding context, synthesizes a timeline. |
| `incident-triage` | "errors spiking", "outage", "alert fired" | Localizes an active incident to a service + pattern. Aggregates errors by service, baselines against previous window, drills into the top offender, checks for deploy correlation. |
| `troubleshooting` | Graylog tool failures (401, connection refused, empty results) | Diagnoses connectivity, auth, query syntax. Always starts with `get_system_info`. |

### Agent

| Agent | When to dispatch | What it returns |
|---|---|---|
| `graylog-trace-analyzer` | Trace investigations expected to surface >200 log lines or span >5 services | A structured timeline (≤50 entries) plus origin, propagation, root-cause line, and a 2–4 sentence verdict. Keeps raw logs out of the parent context. |

Skills auto-load when the plugin is installed. The agent is dispatchable via Claude Code's subagent mechanism with `subagent_type: "graylog-trace-analyzer"`.
```

- [ ] **Step 3: Verify**

```bash
cd ~/Documents/mcp-server-graylog && grep -c "Skills & agents" README.md
```

Expected: `1`.

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add README.md && git commit -m "docs(readme): document skills and trace-analyzer agent"
```

---

### Task 9: Update `CHANGELOG.md`

**Files:**
- Modify: `~/Documents/mcp-server-graylog/CHANGELOG.md`

- [ ] **Step 1: Read the top of the file to confirm format**

```bash
cd ~/Documents/mcp-server-graylog && head -25 CHANGELOG.md
```

Expected: each release has a `## [X.Y.Z]` heading with bulleted entries. The newest is at the top.

- [ ] **Step 2: Insert the v2.3.0 entry above the existing v2.2.1 heading**

Use Edit. The block to insert immediately above `## [2.2.1]`:

```markdown
## [2.3.0] - 2026-05-29

### Added

- 4 skills (`graylog`, `trace-debugging`, `incident-triage`, `troubleshooting`) auto-loaded from `skills/`.
- 1 subagent (`graylog-trace-analyzer`) auto-loaded from `agents/` — dispatch for trace investigations expected to surface >200 log lines or span >5 services.
- README "Skills & agents" section documenting triggers and use cases.

### Changed

- None. No `src/` modifications; the MCP server runtime is unchanged from 2.2.1.

```

- [ ] **Step 3: Verify**

```bash
cd ~/Documents/mcp-server-graylog && grep -A1 "## \[2.3.0\]" CHANGELOG.md | head -3
```

Expected: heading present with the date line.

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/mcp-server-graylog && git add CHANGELOG.md && git commit -m "docs(changelog): v2.3.0 — skills and trace-analyzer agent"
```

---

### Task 10: Local smoke test

**Files:** None (verification only)

- [ ] **Step 1: Point the local plugin cache at this branch**

Because the plugin is installed from the marketplace at a specific commit SHA, the local working tree is not what Claude Code is loading. To smoke-test before publishing, either:

(a) Replace the cached plugin dir with a symlink to the working tree, or
(b) Push the branch + retag and let `/reload-plugins` re-fetch.

Option (a) is faster for the smoke loop:

```bash
CACHE=~/.claude/plugins/cache/pranavj17/graylog
mv "$CACHE/2.2.1" "$CACHE/2.2.1.bak"
ln -s ~/Documents/mcp-server-graylog "$CACHE/2.2.1"
ls -la "$CACHE"
```

Expected: `2.2.1` is now a symlink to the working tree; `2.2.1.bak` holds the original.

- [ ] **Step 2: Reload plugins in Claude Code**

In Claude Code, run `/reload-plugins`. Expected output mentions the graylog plugin and shows the same skill/agent/MCP counts plus 4 new skills.

- [ ] **Step 3: Verify skills appear**

In Claude Code, the new skills should appear in the skills list with names `graylog`, `trace-debugging`, `incident-triage`, `troubleshooting`. Check the system-reminder skill listing after reload.

If skills do NOT appear:
- Confirm file paths exactly match `skills/<name>/SKILL.md` (lowercase `SKILL.md`).
- Confirm frontmatter parses (no tab characters, `---` delimiters on their own lines).
- Re-run `/reload-plugins` once more.

- [ ] **Step 4: Verify agent appears**

The agent should appear as a valid `subagent_type` value. Test by inspecting the Agent tool description after reload — `graylog-trace-analyzer` should be listed.

If the agent does NOT appear:
- Fallback: add an explicit `agents` key to `plugin.json`:

  ```json
  "agents": "./agents"
  ```

  Commit and re-test.

- [ ] **Step 5: Trigger one skill end-to-end**

In Claude Code, send a test prompt that should trigger the `troubleshooting` skill (since it doesn't require live Graylog access to demonstrate skill loading):

> "graylog returned a 401, how do i debug"

Expected: Claude invokes the `troubleshooting` skill (visible as a Skill tool call) before responding.

- [ ] **Step 6: Restore cache, regardless of result**

```bash
CACHE=~/.claude/plugins/cache/pranavj17/graylog
rm "$CACHE/2.2.1"
mv "$CACHE/2.2.1.bak" "$CACHE/2.2.1"
ls -la "$CACHE"
```

Expected: `2.2.1` is the original directory again, no symlink.

If any step in 2–5 failed: capture what failed, fix in the working tree, re-run from Step 1.

---

### Task 11: Push branch + tag

**Files:** None (git operations)

- [ ] **Step 1: Confirm branch is clean and on the right commits**

```bash
cd ~/Documents/mcp-server-graylog && git log --oneline main..HEAD
```

Expected: ~10 commits — spec, 4 skills, 1 agent, version bump, README, CHANGELOG.

- [ ] **Step 2: Push the branch**

```bash
cd ~/Documents/mcp-server-graylog && git push -u origin feat/skills-and-trace-agent
```

- [ ] **Step 3: Open the PR (optional — depends on user's flow)**

Pause here. Ask the user whether to:
- Open a PR (`gh pr create`), or
- Merge directly to `main` (this is a personal repo per the marketplace.json), or
- Hold off entirely until further review.

Default if no answer: open a PR for visibility.

- [ ] **Step 4: After merge, tag v2.3.0**

Once on `main`:

```bash
cd ~/Documents/mcp-server-graylog && git checkout main && git pull && git tag -a v2.3.0 -m "v2.3.0 — skills and trace-analyzer agent" && git push origin v2.3.0
```

The marketplace fetches by commit SHA, not tag, so the tag is documentation. `/reload-plugins` in any session will pick up the new `main` SHA.

---

## Done criteria

- 4 SKILL.md files exist under `skills/<name>/` with valid frontmatter.
- 1 agent file exists at `agents/graylog-trace-analyzer.md` with valid frontmatter (`tools`, `model`).
- `plugin.json` and `package.json` both report `2.3.0`.
- README has a "Skills & agents" section.
- CHANGELOG has a v2.3.0 entry.
- Local smoke test confirmed all 4 skills load and at least 1 triggers on its keywords.
- Branch pushed; tag created if merged.

## Risks recap

- **Agent auto-discovery may not work via `agents/` convention alone.** Mitigation in Task 10 Step 4 — explicit `agents` key in `plugin.json` is a known-safe fallback.
- **Tool-id format in agent frontmatter** (`mcp__plugin_graylog-log-search_graylog__*`) is observed in the deferred-tool listing but not documented in any plugin SDK I've found. If the explicit `tools:` list breaks agent dispatch, fallback is omitting the `tools:` key, which gives the agent the default toolset.
- **Marketplace re-fetch timing.** Plugin cache is keyed by commit SHA. Users on older SHAs won't auto-update until they run `/reload-plugins` after the new commit lands on `main`.
