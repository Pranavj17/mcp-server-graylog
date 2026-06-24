#!/usr/bin/env node

/**
 * Simple Graylog MCP Server
 * Independent, focused integration with Graylog for log searching
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import {
    isValidISO8601,
    validateTimeRange,
    validateQuery,
    validateStreamId,
    validateRangeSeconds,
    validateLimit,
    formatError,
    formatMessages,
    parseViewsResult
} from "./helpers.js";

// ============================================================================
// CONFIGURATION & VALIDATION
// ============================================================================

const CONFIG = {
    baseUrl: process.env.BASE_URL,
    apiToken: process.env.API_TOKEN,
    timeout: 30000, // 30 seconds
};

function validateEnvironment() {
    const required = { BASE_URL: CONFIG.baseUrl, API_TOKEN: CONFIG.apiToken };
    const missing = Object.entries(required)
        .filter(([_, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        console.error(`[graylog-mcp] FATAL: Missing environment variables: ${missing.join(', ')}`);
        console.error(`[graylog-mcp] Set these in your MCP client configuration.`);
        process.exit(1);
    }

    console.error(`[graylog-mcp] Connected to ${CONFIG.baseUrl}`);
}

// ============================================================================
// HTTP CLIENT
// ============================================================================

async function graylogRequest(endpoint, params = {}) {
    try {
        const response = await axios.get(`${CONFIG.baseUrl}${endpoint}`, {
            params,
            headers: { 'Accept': 'application/json' },
            auth: {
                username: CONFIG.apiToken,
                password: 'token'
            },
            timeout: CONFIG.timeout
        });
        return response.data;
    } catch (error) {
        console.error(`[graylog-mcp] Error: ${endpoint}`, {
            status: error.response?.status,
            message: error.message
        });
        throw new Error(formatError(error, CONFIG.baseUrl));
    }
}

// POST helper for the modern Views Search API. Graylog requires the
// `X-Requested-By` header on POSTs (CSRF guard); same token auth as GETs.
async function graylogPost(endpoint, body) {
    try {
        const response = await axios.post(`${CONFIG.baseUrl}${endpoint}`, body, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Requested-By': 'graylog-mcp'
            },
            auth: { username: CONFIG.apiToken, password: 'token' },
            timeout: CONFIG.timeout
        });
        return response.data;
    } catch (error) {
        console.error(`[graylog-mcp] Error: ${endpoint}`, {
            status: error.response?.status,
            message: error.message
        });
        throw new Error(formatError(error, CONFIG.baseUrl));
    }
}

// Build a Views Search request for a single message-list query.
//   timerange: { type: 'relative', range: <seconds> }
//            | { type: 'absolute', from: <ISO>, to: <ISO> }
//   sort: 'asc' | 'desc' (default 'desc' — newest first, matching the old API)
function buildSearchRequest({ query, timerange, limit, streamId, sort }) {
    const searchType = {
        id: 'st1',
        type: 'messages',
        limit,
        offset: 0,
        sort: [{ field: 'timestamp', order: sort === 'asc' ? 'ASC' : 'DESC' }]
    };
    if (streamId) {
        searchType.streams = [streamId];
    }
    return {
        queries: [{
            id: 'q1',
            query: { type: 'elasticsearch', query_string: query },
            timerange,
            search_types: [searchType]
        }]
    };
}

// Run a search via the modern Views Search API (create → execute) and return
// the universal-compatible shape { total_results, built_query, messages } that
// the tool handlers + formatMessages already consume. Replaces the deprecated
// /api/search/universal/{relative,absolute} endpoints, which on Graylog 5.x
// fail cryptically ("Missing search type result!") on multi-term/OR queries.
async function viewsSearch(opts) {
    const created = await graylogPost('/api/views/search', buildSearchRequest(opts));
    const searchId = created && created.id;
    if (!searchId) {
        throw new Error('Graylog did not return a search id from /api/views/search');
    }
    const exec = await graylogPost(`/api/views/search/${searchId}/execute`, {});
    return parseViewsResult(exec, opts.query);
}

// ============================================================================
// OBSERVABILITY HELPERS
// ============================================================================
//
// Structured stderr logging for tool dispatch. Pre/done/error trio gives
// operators a grep-able audit trail without altering the tool response shape.
// All logs go to stderr (the MCP convention — stdout is reserved for the
// JSON-RPC protocol).

const REDACT_KEY_RX = /token|password|secret|auth|cred|apikey/i;

// Sanitize args before logging. Two rules:
//   1. Keys that look like credentials → [REDACTED] (defensive · current
//      tools don't accept any, but future-proofs against handlers that do).
//   2. String values > 200 chars get truncated (prevents stderr spam from
//      large Elasticsearch queries or message bodies).
function redactArgs(args) {
    if (!args || typeof args !== 'object') return args;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
        if (REDACT_KEY_RX.test(k)) {
            out[k] = '[REDACTED]';
        } else if (typeof v === 'string' && v.length > 200) {
            out[k] = v.slice(0, 197) + '...';
        } else {
            out[k] = v;
        }
    }
    return out;
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server({
    name: "graylog-mcp",
    version: "2.2.1",
}, {
    capabilities: {
        tools: {},
    },
});

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search_logs_absolute",
                description: "Search Graylog logs using absolute timestamps (from/to). Returns all log fields by default including trace_id, span_id, pod, service, container_name for distributed tracing.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query using Elasticsearch syntax (e.g., '\"/api/v1/registrations\" AND \"PUT\"', 'trace_id:abc123', 'logger_level:error')"
                        },
                        from: {
                            type: "string",
                            description: "Start timestamp in ISO 8601 format (e.g., '2025-09-29T17:57:26.568Z')"
                        },
                        to: {
                            type: "string",
                            description: "End timestamp in ISO 8601 format (e.g., '2025-09-30T12:36:20.910Z')"
                        },
                        streamId: {
                            type: "string",
                            description: "Optional: Stream ID to filter results (use list_streams to find IDs)"
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of results (default: 50, max: 1000)",
                            default: 50
                        },
                        fields: {
                            type: "string",
                            description: "Comma-separated list of fields to return (default: message,timestamp,source,level,logger_level,trace_id,span_id,pod,service,container_name). Use '*' for all fields."
                        }
                    },
                    required: ["query", "from", "to"]
                }
            },
            {
                name: "search_logs_relative",
                description: "Search Graylog logs using relative time range (e.g., last 15 minutes). Returns all log fields by default for distributed tracing.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query using Elasticsearch syntax (e.g., 'logger_level:error', 'trace_id:abc123')"
                        },
                        rangeSeconds: {
                            type: "number",
                            description: "Time range in seconds (e.g., 900 = last 15 minutes)",
                            default: 900
                        },
                        streamId: {
                            type: "string",
                            description: "Optional: Stream ID to filter results"
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of results (default: 50)",
                            default: 50
                        },
                        fields: {
                            type: "string",
                            description: "Comma-separated list of fields to return (default includes trace_id, span_id, pod, service). Use '*' for all fields."
                        }
                    },
                    required: ["query"]
                }
            },
            {
                name: "trace_request",
                description: "Trace a request across all services using a trace_id. Fetches logs from ALL streams, groups by service/pod, and shows the full request lifecycle. Essential for distributed debugging.",
                inputSchema: {
                    type: "object",
                    properties: {
                        traceId: {
                            type: "string",
                            description: "The trace ID to follow across services (e.g., 'a528862190d94aa18c9eec9eeac858b5')"
                        },
                        from: {
                            type: "string",
                            description: "Start timestamp in ISO 8601 format (search window)"
                        },
                        to: {
                            type: "string",
                            description: "End timestamp in ISO 8601 format (search window)"
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of results (default: 200, max: 1000)",
                            default: 200
                        }
                    },
                    required: ["traceId", "from", "to"]
                }
            },
            {
                name: "get_surrounding_logs",
                description: "Get logs surrounding a specific timestamp (+-N seconds) from a specific source/pod. Useful for understanding what happened right before and after an error.",
                inputSchema: {
                    type: "object",
                    properties: {
                        timestamp: {
                            type: "string",
                            description: "Center timestamp in ISO 8601 format"
                        },
                        source: {
                            type: "string",
                            description: "Source hostname or pod name to filter by (optional)"
                        },
                        streamId: {
                            type: "string",
                            description: "Stream ID to filter results (optional)"
                        },
                        windowSeconds: {
                            type: "number",
                            description: "Number of seconds before and after the timestamp (default: 5)",
                            default: 5
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of results (default: 100)",
                            default: 100
                        }
                    },
                    required: ["timestamp"]
                }
            },
            {
                name: "list_streams",
                description: "List all available Graylog streams (applications). Use this to discover stream IDs for filtering.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "get_system_info",
                description: "Get Graylog system information and health status. Use this to verify connectivity.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "aggregate_logs",
                description: "Count log entries grouped by a field (service, logger_level, pod, lead_id, http_status, container_name, etc.). Fetches matching messages with ONLY the requested field projected (bandwidth-efficient) and aggregates client-side. Common usage: 'errors in last hour grouped by service' → query: 'logger_level:error', field: 'service', rangeSeconds: 3600. When the total matched exceeds `fetchLimit` (default 5000), `truncated: true` is set in the response and the caller should narrow the time window. Provide EITHER from+to OR rangeSeconds, not both.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Filter query (Elasticsearch syntax). Use '*' for all entries in the window."
                        },
                        field: {
                            type: "string",
                            description: "Field to group counts by. Common values: service, logger_level, pod, lead_id, http_status, container_name."
                        },
                        from: {
                            type: "string",
                            description: "Start ISO 8601 timestamp (use either from+to OR rangeSeconds)"
                        },
                        to: {
                            type: "string",
                            description: "End ISO 8601 timestamp"
                        },
                        rangeSeconds: {
                            type: "number",
                            description: "Relative window in seconds (alt to from+to)"
                        },
                        size: {
                            type: "number",
                            description: "Top N groups to return (default 25, max 100). The rest are summed into `other`.",
                            default: 25
                        },
                        fetchLimit: {
                            type: "number",
                            description: "Max messages to fetch and aggregate (default 5000, max 10000). Higher = more accurate counts but slower.",
                            default: 5000
                        },
                        streamId: {
                            type: "string",
                            description: "Optional stream filter"
                        }
                    },
                    required: ["query", "field"]
                }
            },
            {
                name: "analyze_incident",
                description: "Composite incident analysis. Given a trace_id, this ONE tool call fans out to: (1) the full trace hop chain across services, (2) surrounding logs scoped to the anchor pod for noise-free context around the first error, and (3) a service-level error baseline over the trailing 1h. Returns a single aggregated report with hop count, services involved, anchor service/pod, first-error context, request entry/exit summary (path/method/status/duration), and baseline error rate. Use this instead of orchestrating trace_request + get_surrounding_logs + search_logs manually whenever you need to investigate, root-cause, or analyze a specific trace — saves 2-3 LLM rounds and gives the model one rich result to reason over.",
                inputSchema: {
                    type: "object",
                    properties: {
                        traceId: {
                            type: "string",
                            description: "The trace ID to investigate (e.g., 'abbb27610a7fd76be8fb5af17edbe00d')"
                        },
                        from: {
                            type: "string",
                            description: "Start timestamp in ISO 8601 format (search window for the trace)"
                        },
                        to: {
                            type: "string",
                            description: "End timestamp in ISO 8601 format (search window for the trace)"
                        },
                        window: {
                            type: "number",
                            description: "Surrounding-logs window in seconds on each side of the anchor (default: 10, max: 300)",
                            default: 10
                        },
                        baselineSeconds: {
                            type: "number",
                            description: "Trailing window in seconds for the error baseline lookup ending at the trace start (default: 3600, max: 86400)",
                            default: 3600
                        }
                    },
                    required: ["traceId", "from", "to"]
                }
            }
        ]
    };
});

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

// Dispatch the request to the right handler. Extracted from the request
// handler so the logging wrapper around it stays compact.
async function dispatchTool(name, args) {
    switch (name) {
        case "search_logs_absolute":  return await searchLogsAbsolute(args);
        case "search_logs_relative":  return await searchLogsRelative(args);
        case "trace_request":         return await traceRequest(args);
        case "get_surrounding_logs":  return await getSurroundingLogs(args);
        case "list_streams":          return await listStreams();
        case "get_system_info":       return await getSystemInfo();
        case "analyze_incident":      return await analyzeIncident(args);
        case "aggregate_logs":        return await aggregateLogs(args);
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startMs = Date.now();

    // Pre-call log · grep-able audit trail entry for every invocation.
    console.error(`[graylog-mcp] tool_call: ${name}`, redactArgs(args));

    try {
        const result = await dispatchTool(name, args);
        // Success log · captures latency for slow-tool diagnosis.
        console.error(`[graylog-mcp] tool_done: ${name} · ${Date.now() - startMs}ms`);
        return result;
    } catch (error) {
        // Error log · structured so operators can correlate failures back to
        // the calling tool + args without having to read the client response.
        console.error(`[graylog-mcp] tool_error: ${name} · ${Date.now() - startMs}ms`, {
            message: error.message,
            args: redactArgs(args)
        });
        return {
            content: [{
                type: "text",
                text: `Error: ${error.message}`
            }],
            isError: true
        };
    }
});

// ============================================================================
// TOOL FUNCTIONS
// ============================================================================

async function searchLogsAbsolute(args) {
    const { from, to, streamId } = args;
    const query = validateQuery(args.query);
    const limit = validateLimit(args.limit);
    validateTimeRange(from, to);
    validateStreamId(streamId);

    // Execute search via the Views Search API (returns all message fields;
    // formatMessages strips gl2_* noise). The legacy `fields` projection is no
    // longer needed — the message list already carries the tracing fields.
    const data = await viewsSearch({
        query,
        timerange: { type: 'absolute', from: from.trim(), to: to.trim() },
        limit,
        streamId
    });

    // Format response
    const result = {
        total_results: data.total_results || 0,
        query: data.built_query,
        time_range: { from, to },
        messages: formatMessages(data.messages)
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

async function searchLogsRelative(args) {
    const { streamId } = args;
    const query = validateQuery(args.query);
    const rangeSeconds = validateRangeSeconds(args.rangeSeconds ?? 900);
    const limit = validateLimit(args.limit);
    validateStreamId(streamId);

    // Execute search via the Views Search API (see searchLogsAbsolute note).
    const data = await viewsSearch({
        query,
        timerange: { type: 'relative', range: rangeSeconds },
        limit,
        streamId
    });

    // Format response
    const result = {
        total_results: data.total_results || 0,
        query: data.built_query,
        time_range: `Last ${rangeSeconds} seconds`,
        messages: formatMessages(data.messages)
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

async function traceRequest(args) {
    const { traceId, from, to } = args;
    const limit = validateLimit(args.limit ?? 200);
    validateTimeRange(from, to);

    if (!traceId || typeof traceId !== 'string' || !traceId.trim()) {
        throw new Error("'traceId' parameter is required and must be a non-empty string");
    }

    // Search across ALL streams (no filter) for this trace_id
    const data = await viewsSearch({
        query: `trace_id:${traceId.trim()}`,
        timerange: { type: 'absolute', from: from.trim(), to: to.trim() },
        limit
    });
    const messages = formatMessages(data.messages);

    // Group messages by service/source for easier reading
    const byService = {};
    for (const msg of messages) {
        const service = msg.service || msg.container_name || msg.source || 'unknown';
        if (!byService[service]) {
            byService[service] = [];
        }
        byService[service].push(msg);
    }

    // Sort each service's messages by timestamp
    for (const svc of Object.keys(byService)) {
        byService[svc].sort((a, b) =>
            new Date(a.timestamp) - new Date(b.timestamp)
        );
    }

    const result = {
        trace_id: traceId.trim(),
        total_results: data.total_results || 0,
        services_found: Object.keys(byService).length,
        time_range: { from, to },
        by_service: byService
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

async function getSurroundingLogs(args) {
    const { timestamp, source, streamId } = args;
    const windowSeconds = args.windowSeconds ?? 5;
    const limit = validateLimit(args.limit ?? 100);

    if (!timestamp || !isValidISO8601(timestamp)) {
        throw new Error("'timestamp' must be a valid ISO 8601 timestamp");
    }
    validateStreamId(streamId);

    if (windowSeconds < 1 || windowSeconds > 300) {
        throw new Error("'windowSeconds' must be between 1 and 300");
    }

    const center = new Date(timestamp);
    const from = new Date(center.getTime() - windowSeconds * 1000).toISOString();
    const to = new Date(center.getTime() + windowSeconds * 1000).toISOString();

    // Build query — optionally filter by source
    let query = '*';
    if (source && typeof source === 'string' && source.trim()) {
        query = `source:${source.trim()}`;
    }

    const data = await viewsSearch({
        query,
        timerange: { type: 'absolute', from, to },
        limit,
        streamId,
        sort: 'asc'
    });

    const result = {
        center_timestamp: timestamp,
        window: `+-${windowSeconds}s`,
        total_results: data.total_results || 0,
        time_range: { from, to },
        messages: formatMessages(data.messages)
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

async function listStreams() {
    const data = await graylogRequest('/api/streams');

    const streams = (data.streams || [])
        .filter(s => !s.is_default) // Exclude default streams
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(s => ({
            id: s.id,
            title: s.title,
            description: s.description || '',
            disabled: s.disabled
        }));

    const result = {
        total: streams.length,
        streams
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

async function getSystemInfo() {
    const data = await graylogRequest('/api/system');

    const result = {
        version: data.version,
        codename: data.codename,
        cluster_id: data.cluster_id,
        node_id: data.node_id,
        hostname: data.hostname,
        is_processing: data.is_processing,
        timezone: data.timezone
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

// ============================================================================
// AGGREGATION TOOL · aggregate_logs
// ============================================================================
//
// Counts log entries grouped by an arbitrary field. Graylog 5.x dropped the
// legacy `/api/search/universal/{rel,abs}/terms` aggregation endpoints, so
// we issue a single regular search with `fields=<group_field>` (Graylog
// projects ONLY that field, dramatically reducing response bandwidth) and
// then aggregate client-side. For typical workloads this is fast and cheap;
// for high-cardinality queries above `fetchLimit`, the response flags
// `truncated: true` and the caller is expected to narrow the window.

async function aggregateLogs(args) {
    const { from, to, streamId, rangeSeconds } = args;
    const query = validateQuery(args.query);
    const field = String(args.field || '').trim();
    if (!field) {
        throw new Error("'field' parameter is required and must be a non-empty string");
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_.\-]*$/.test(field)) {
        // Stops trivially-malformed values; Graylog field names are alnum/_/. only.
        throw new Error(`'field' contains invalid characters: ${JSON.stringify(field)}`);
    }
    const size = Math.min(100, Math.max(1, args.size ?? 25));
    const fetchLimit = Math.min(10000, Math.max(1, args.fetchLimit ?? 5000));
    validateStreamId(streamId);

    // Fetch matching messages, then aggregate client-side. (The Views Search API
    // returns full messages — the old per-field projection is gone — but the
    // group-by below only reads `field`, so the result is identical.)
    let timerange;
    if (rangeSeconds !== undefined && rangeSeconds !== null) {
        if (from || to) {
            throw new Error("Provide EITHER rangeSeconds OR from+to, not both");
        }
        timerange = { type: 'relative', range: validateRangeSeconds(rangeSeconds) };
    } else if (from && to) {
        validateTimeRange(from, to);
        timerange = { type: 'absolute', from: from.trim(), to: to.trim() };
    } else {
        throw new Error("Provide EITHER rangeSeconds OR both from+to");
    }

    const data = await viewsSearch({ query, timerange, limit: fetchLimit, streamId });
    const messages = formatMessages(data.messages);

    // Client-side group-by-and-count
    const counts = {};
    let missing = 0;
    for (const m of messages) {
        const v = m[field];
        if (v === undefined || v === null || v === '') {
            missing++;
            continue;
        }
        const key = String(v);
        counts[key] = (counts[key] || 0) + 1;
    }

    // Sort descending, split into top-N + summed `other`
    const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topN = sortedEntries.slice(0, size);
    const otherCount = sortedEntries.slice(size).reduce((sum, [, c]) => sum + c, 0);

    const totalMatched = data.total_results || 0;
    const truncated = messages.length >= fetchLimit && totalMatched > fetchLimit;

    const result = {
        field,
        query: data.built_query || query,
        time_range: (rangeSeconds !== undefined && rangeSeconds !== null)
            ? `Last ${rangeSeconds} seconds`
            : { from: from.trim(), to: to.trim() },
        total_matched: totalMatched,
        messages_aggregated: messages.length,
        truncated,                          // true when the matched total exceeded fetchLimit
        unique_groups: sortedEntries.length,
        top: Object.fromEntries(topN),      // ordered insertion · top N descending by count
        other: otherCount,                  // sum of counts beyond top N
        missing,                            // messages where the requested field was null/empty
        api_calls: 1
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

// ============================================================================
// COMPOSITE TOOL · analyze_incident
// ============================================================================
//
// Fans out one tool call into three Graylog searches and returns an aggregated
// incident report. Demonstrates the "internal fan-out" MCP pattern: the LLM
// gets one tight result instead of burning 2-3 rounds orchestrating
// trace_request + get_surrounding_logs + search by hand. Designed against
// real Scripbox Graylog data shapes (logger_level lowercase, pod-scoped
// surrounding logs to avoid multi-tenant noise on shared EC2 hosts).

const INCIDENT_ERROR_LEVELS = new Set(['error', 'critical', 'fatal']);

async function analyzeIncident(args) {
    const { traceId, from, to } = args;
    const window = args.window ?? 10;
    const baselineSeconds = args.baselineSeconds ?? 3600;

    validateTimeRange(from, to);
    if (!traceId || typeof traceId !== 'string' || !traceId.trim()) {
        throw new Error("'traceId' parameter is required and must be a non-empty string");
    }
    if (window < 1 || window > 300) {
        throw new Error("'window' must be between 1 and 300 seconds");
    }
    if (baselineSeconds < 60 || baselineSeconds > 86400) {
        throw new Error("'baselineSeconds' must be between 60 and 86400 (24 hours)");
    }

    const tid = traceId.trim();

    // Step 1 · fetch the full trace hop chain
    const traceData = await viewsSearch({
        query: `trace_id:${tid}`,
        timerange: { type: 'absolute', from: from.trim(), to: to.trim() },
        limit: 500
    });
    const traceHops = formatMessages(traceData.messages)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (traceHops.length === 0) {
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    trace_id: tid,
                    found: false,
                    note: `no messages match trace_id "${tid}" between ${from} and ${to}`,
                    steps_executed: 1,
                    api_calls: 1   // only step 1 (trace lookup) fires when the trace is empty
                }, null, 2)
            }]
        };
    }

    // Step 2 · pick anchor — prefer first ERROR/CRITICAL/FATAL hop (case-insensitive),
    // else fall back to the first hop in chronological order
    const firstError = traceHops.find(h =>
        INCIDENT_ERROR_LEVELS.has(String(h.logger_level || h.level || '').toLowerCase())
    );
    const anchor = firstError || traceHops[0];
    const anchorPod = anchor.pod || null;
    const anchorService = anchor.service || anchor.container_name || anchor.source || 'unknown';
    const anchorTs = anchor.timestamp;

    // Step 3 · surrounding logs · pod-scoped to avoid multi-tenant noise.
    // Real production hosts run many pods on one EC2 instance; filtering by
    // pod (not source) keeps the context focused on the affected container.
    const centerMs = new Date(anchorTs).getTime();
    const surroundingData = await viewsSearch({
        query: anchorPod ? `pod:${anchorPod}` : '*',
        timerange: {
            type: 'absolute',
            from: new Date(centerMs - window * 1000).toISOString(),
            to: new Date(centerMs + window * 1000).toISOString()
        },
        limit: 100,
        sort: 'asc'
    });
    const surroundingLogs = formatMessages(surroundingData.messages);

    // Step 4 · trailing-window error baseline for the anchor service.
    // Compares the trace's error against recent prior load — "is this a one-off
    // or is the service already on fire?"
    const traceStartMs = new Date(from.trim()).getTime();
    const baselineData = await viewsSearch({
        query: `logger_level:error AND service:${anchorService}`,
        timerange: {
            type: 'absolute',
            from: new Date(traceStartMs - baselineSeconds * 1000).toISOString(),
            to: from.trim()
        },
        limit: 1
    });

    // Extract request entry/exit if present — gives the LLM a clean
    // "what API was called, did it succeed, how long did it take" line.
    const requestExit = traceHops.find(h => h.http_status);
    const requestSummary = requestExit ? {
        http_path:   requestExit.http_path   || null,
        http_method: requestExit.http_method || null,
        http_status: requestExit.http_status || null,
        duration_ms: typeof requestExit.duration === 'number' ? requestExit.duration : null
    } : null;

    // Aggregate
    const services_involved = [...new Set(
        traceHops.map(h => h.service || h.container_name || h.source).filter(Boolean)
    )];
    const errors_in_trace = traceHops.filter(h =>
        INCIDENT_ERROR_LEVELS.has(String(h.logger_level || h.level || '').toLowerCase())
    ).length;

    const result = {
        trace_id: tid,
        found: true,
        steps_executed: 4,   // algorithm steps · 4 logical, 3 hit Graylog
        api_calls: 3,        // actual outbound HTTP requests · step 2 (anchor selection) is in-memory only
        summary: {
            hops: traceHops.length,
            services_involved,
            errors_in_trace,
            anchor_timestamp: anchorTs,
            anchor_service: anchorService,
            anchor_pod: anchorPod,
            first_error: firstError ? {
                timestamp:    firstError.timestamp,
                service:      firstError.service || firstError.container_name || null,
                pod:          firstError.pod || null,
                logger_level: firstError.logger_level || firstError.level || null,
                message:      firstError.message || null,
                lead_id:      firstError.lead_id || null
            } : null,
            request: requestSummary,
            baseline_errors_in_service: baselineData.total_results || 0,
            baseline_window_seconds: baselineSeconds
        },
        time_range: { from: from.trim(), to: to.trim() },
        trace_hops: traceHops,
        surrounding_logs: surroundingLogs
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

validateEnvironment();

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[graylog-mcp] Server running and ready');
