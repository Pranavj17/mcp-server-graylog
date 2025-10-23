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
// HELPER FUNCTIONS
// ============================================================================

function isValidISO8601(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && dateString.includes('T');
}

function validateTimeRange(from, to) {
    if (!isValidISO8601(from)) {
        throw new Error(`Invalid 'from' timestamp. Use ISO 8601 format (e.g., '2025-09-29T17:57:26.568Z')`);
    }
    if (!isValidISO8601(to)) {
        throw new Error(`Invalid 'to' timestamp. Use ISO 8601 format (e.g., '2025-09-30T12:36:20.910Z')`);
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (fromDate >= toDate) {
        throw new Error(`'from' timestamp must be before 'to' timestamp`);
    }
}

function formatError(error) {
    if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        switch (status) {
            case 401:
                return 'Authentication failed. Check API_TOKEN in MCP configuration.';
            case 400:
                return `Invalid query: ${data?.message || 'Check query syntax and parameters'}`;
            case 404:
                return `Endpoint not found. Check BASE_URL in MCP configuration.`;
            case 500:
                return `Graylog server error: ${data?.message || error.message}`;
            default:
                return `Graylog API error (${status}): ${data?.message || error.message}`;
        }
    } else if (error.request) {
        return `Cannot reach Graylog at ${CONFIG.baseUrl}. Check network connectivity.`;
    } else {
        return error.message;
    }
}

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
        throw new Error(formatError(error));
    }
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server({
    name: "graylog-mcp",
    version: "1.0.0",
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
                description: "Search Graylog logs using absolute timestamps (from/to). Use this for debugging errors with specific timestamps.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query using Elasticsearch syntax (e.g., '\"/api/v1/registrations\" AND \"PUT\"')"
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
                        }
                    },
                    required: ["query", "from", "to"]
                }
            },
            {
                name: "search_logs_relative",
                description: "Search Graylog logs using relative time range (e.g., last 15 minutes). Use this for recent log queries.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query using Elasticsearch syntax"
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
                        }
                    },
                    required: ["query"]
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
    // Use nullish coalescing for proper default handling (Bug #5 fix)
    const { query, from, to, streamId } = args;
    const limit = args.limit ?? 50;

    // Validate inputs (Bug #4 fix: type check before trim)
    if (!query || typeof query !== 'string' || !query.trim()) {
        throw new Error("'query' parameter is required and must be a non-empty string");
    }
    validateTimeRange(from, to);

    // Bug #3 fix: validate streamId type
    if (streamId !== undefined && typeof streamId !== 'string') {
        throw new Error("'streamId' must be a string");
    }

    if (limit < 1 || limit > 1000) {
        throw new Error("'limit' must be between 1 and 1000");
    }

    // Build request parameters
    const params = {
        query: query.trim(),
        from: from.trim(),
        to: to.trim(),
        limit,
        fields: 'message,timestamp,source,level'
    };

    if (streamId) {
        params.filter = `streams:${streamId}`;
    }

    // Execute search
    const data = await graylogRequest('/api/search/universal/absolute', params);

    // Format response (Bug #1 fix: filter out malformed messages)
    const result = {
        total_results: data.total_results || 0,
        query: data.built_query,
        time_range: { from, to },
        messages: (data.messages || [])
            .filter(m => m && m.message)
            .map(m => ({
                timestamp: m.message.timestamp,
                message: m.message.message,
                source: m.message.source,
                level: m.message.level
            }))
    };

    return {
        content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
        }]
    };
}

async function searchLogsRelative(args) {
    // Use nullish coalescing for proper default handling (Bug #5 fix)
    const { query, streamId } = args;
    const rangeSeconds = args.rangeSeconds ?? 900;
    const limit = args.limit ?? 50;

    // Validate inputs (Bug #4 fix: type check before trim)
    if (!query || typeof query !== 'string' || !query.trim()) {
        throw new Error("'query' parameter is required and must be a non-empty string");
    }

    // Bug #2 fix: validate rangeSeconds
    if (rangeSeconds < 1 || rangeSeconds > 86400) {
        throw new Error("'rangeSeconds' must be between 1 and 86400 (24 hours)");
    }

    // Bug #3 fix: validate streamId type
    if (streamId !== undefined && typeof streamId !== 'string') {
        throw new Error("'streamId' must be a string");
    }

    if (limit < 1 || limit > 1000) {
        throw new Error("'limit' must be between 1 and 1000");
    }

    // Build request parameters
    const params = {
        query: query.trim(),
        range: rangeSeconds,
        limit,
        fields: 'message,timestamp,source,level'
    };

    if (streamId) {
        params.filter = `streams:${streamId}`;
    }

    // Execute search
    const data = await graylogRequest('/api/search/universal/relative', params);

    // Format response (Bug #1 fix: filter out malformed messages)
    const result = {
        total_results: data.total_results || 0,
        query: data.built_query,
        time_range: `Last ${rangeSeconds} seconds`,
        messages: (data.messages || [])
            .filter(m => m && m.message)
            .map(m => ({
                timestamp: m.message.timestamp,
                message: m.message.message,
                source: m.message.source,
                level: m.message.level
            }))
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
