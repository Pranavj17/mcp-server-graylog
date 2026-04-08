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
    formatMessages
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
    const { from, to, streamId } = args;
    const query = validateQuery(args.query);
    const limit = validateLimit(args.limit);
    validateTimeRange(from, to);
    validateStreamId(streamId);

    // Build request parameters
    const params = {
        query,
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

    // Build request parameters
    const params = {
        query,
        range: rangeSeconds,
        limit,
        fields: 'message,timestamp,source,level'
    };

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
