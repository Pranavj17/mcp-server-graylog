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
