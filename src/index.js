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
    DEFAULT_FIELDS
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

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server({
    name: "graylog-mcp",
    version: "2.0.1",
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
            }
        ]
    };
});

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case "search_logs_absolute":
                return await searchLogsAbsolute(args);

            case "search_logs_relative":
                return await searchLogsRelative(args);

            case "trace_request":
                return await traceRequest(args);

            case "get_surrounding_logs":
                return await getSurroundingLogs(args);

            case "list_streams":
                return await listStreams();

            case "get_system_info":
                return await getSystemInfo();

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
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

    // Use caller-specified fields, or default set that includes tracing fields
    const fields = args.fields === '*' ? undefined : (args.fields || DEFAULT_FIELDS);

    // Build request parameters
    const params = {
        query,
        from: from.trim(),
        to: to.trim(),
        limit
    };

    if (fields) {
        params.fields = fields;
    }

    if (streamId) {
        params.filter = `streams:${streamId}`;
    }

    // Execute search
    const data = await graylogRequest('/api/search/universal/absolute', params);

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

    // Use caller-specified fields, or default set that includes tracing fields
    const fields = args.fields === '*' ? undefined : (args.fields || DEFAULT_FIELDS);

    // Build request parameters
    const params = {
        query,
        range: rangeSeconds,
        limit
    };

    if (fields) {
        params.fields = fields;
    }

    if (streamId) {
        params.filter = `streams:${streamId}`;
    }

    // Execute search
    const data = await graylogRequest('/api/search/universal/relative', params);

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
    const params = {
        query: `trace_id:${traceId.trim()}`,
        from: from.trim(),
        to: to.trim(),
        limit
    };

    const data = await graylogRequest('/api/search/universal/absolute', params);
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

    const params = {
        query,
        from,
        to,
        limit,
        sort: 'timestamp:asc'
    };

    if (streamId) {
        params.filter = `streams:${streamId}`;
    }

    const data = await graylogRequest('/api/search/universal/absolute', params);

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
// SERVER STARTUP
// ============================================================================

validateEnvironment();

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[graylog-mcp] Server running and ready');
