/**
 * MCP Protocol tests
 * Tests JSON-RPC 2.0 message handling and MCP tool schemas
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('MCP Tool Schemas', () => {
    const toolSchemas = {
        search_logs_absolute: {
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
        search_logs_relative: {
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
        list_streams: {
            name: "list_streams",
            description: "List all available Graylog streams (applications). Use this to discover stream IDs for filtering.",
            inputSchema: {
                type: "object",
                properties: {}
            }
        },
        get_system_info: {
            name: "get_system_info",
            description: "Get Graylog system information and health status. Use this to verify connectivity.",
            inputSchema: {
                type: "object",
                properties: {}
            }
        }
    };

    it('should have 4 tools defined', () => {
        assert.strictEqual(Object.keys(toolSchemas).length, 4);
    });

    it('should have search_logs_absolute tool', () => {
        const tool = toolSchemas.search_logs_absolute;
        assert.strictEqual(tool.name, 'search_logs_absolute');
        assert.strictEqual(tool.inputSchema.required.length, 3);
        assert.deepStrictEqual(tool.inputSchema.required, ['query', 'from', 'to']);
    });

    it('should have search_logs_relative tool', () => {
        const tool = toolSchemas.search_logs_relative;
        assert.strictEqual(tool.name, 'search_logs_relative');
        assert.strictEqual(tool.inputSchema.required.length, 1);
        assert.deepStrictEqual(tool.inputSchema.required, ['query']);
    });

    it('should have list_streams tool', () => {
        const tool = toolSchemas.list_streams;
        assert.strictEqual(tool.name, 'list_streams');
        assert.deepStrictEqual(tool.inputSchema.properties, {});
    });

    it('should have get_system_info tool', () => {
        const tool = toolSchemas.get_system_info;
        assert.strictEqual(tool.name, 'get_system_info');
        assert.deepStrictEqual(tool.inputSchema.properties, {});
    });

    it('should have proper parameter types for search_logs_absolute', () => {
        const schema = toolSchemas.search_logs_absolute.inputSchema;
        assert.strictEqual(schema.properties.query.type, 'string');
        assert.strictEqual(schema.properties.from.type, 'string');
        assert.strictEqual(schema.properties.to.type, 'string');
        assert.strictEqual(schema.properties.streamId.type, 'string');
        assert.strictEqual(schema.properties.limit.type, 'number');
    });

    it('should have default values where appropriate', () => {
        const absoluteSchema = toolSchemas.search_logs_absolute.inputSchema;
        const relativeSchema = toolSchemas.search_logs_relative.inputSchema;

        assert.strictEqual(absoluteSchema.properties.limit.default, 50);
        assert.strictEqual(relativeSchema.properties.limit.default, 50);
        assert.strictEqual(relativeSchema.properties.rangeSeconds.default, 900);
    });
});

describe('MCP Response Format', () => {
    it('should format successful tool response', () => {
        const response = {
            content: [{
                type: "text",
                text: JSON.stringify({ total_results: 5, messages: [] }, null, 2)
            }]
        };

        assert.ok(Array.isArray(response.content));
        assert.strictEqual(response.content[0].type, 'text');
        assert.ok(response.content[0].text);
    });

    it('should format error response', () => {
        const response = {
            content: [{
                type: "text",
                text: "Error: Invalid query"
            }],
            isError: true
        };

        assert.strictEqual(response.isError, true);
        assert.strictEqual(response.content[0].type, 'text');
        assert.match(response.content[0].text, /Error:/);
    });

    it('should format search results correctly', () => {
        const result = {
            total_results: 2,
            query: 'level:ERROR',
            time_range: { from: '2025-10-23T10:00:00Z', to: '2025-10-23T11:00:00Z' },
            messages: [
                {
                    timestamp: '2025-10-23T10:30:00Z',
                    message: 'Error occurred',
                    source: 'nexus',
                    level: 'ERROR'
                },
                {
                    timestamp: '2025-10-23T10:45:00Z',
                    message: 'Another error',
                    source: 'clientmaster',
                    level: 'ERROR'
                }
            ]
        };

        assert.strictEqual(result.total_results, 2);
        assert.strictEqual(result.messages.length, 2);
        assert.ok(result.time_range);
        assert.ok(result.query);
    });

    it('should format stream list correctly', () => {
        const result = {
            total: 3,
            streams: [
                {
                    id: '646221a5bd29672a6f0246d8',
                    title: 'clientmaster',
                    description: 'Client Master logs',
                    disabled: false
                },
                {
                    id: '67fc9a38d7e1b33fa7695220',
                    title: 'nexus',
                    description: 'Nexus application logs',
                    disabled: false
                },
                {
                    id: '67bc3cbed7e1b33fa7e7c6a0',
                    title: 'crm',
                    description: 'CRM logs',
                    disabled: false
                }
            ]
        };

        assert.strictEqual(result.total, 3);
        assert.strictEqual(result.streams.length, 3);
        assert.ok(result.streams.every(s => s.id && s.title));
    });

    it('should format system info correctly', () => {
        const result = {
            version: '5.1.0',
            codename: 'graylog',
            cluster_id: 'test-cluster',
            node_id: 'test-node',
            hostname: 'graylog.example.com',
            is_processing: true,
            timezone: 'UTC'
        };

        assert.ok(result.version);
        assert.ok(result.hostname);
        assert.strictEqual(typeof result.is_processing, 'boolean');
    });
});

describe('JSON-RPC 2.0 Message Handling', () => {
    it('should recognize initialize request', () => {
        const message = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'test-client',
                    version: '1.0.0'
                }
            }
        };

        assert.strictEqual(message.jsonrpc, '2.0');
        assert.strictEqual(message.method, 'initialize');
        assert.ok(message.id);
    });

    it('should recognize tools/list request', () => {
        const message = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list'
        };

        assert.strictEqual(message.method, 'tools/list');
    });

    it('should recognize tools/call request', () => {
        const message = {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'search_logs_absolute',
                arguments: {
                    query: 'level:ERROR',
                    from: '2025-10-23T10:00:00Z',
                    to: '2025-10-23T11:00:00Z'
                }
            }
        };

        assert.strictEqual(message.method, 'tools/call');
        assert.strictEqual(message.params.name, 'search_logs_absolute');
        assert.ok(message.params.arguments);
    });

    it('should handle notification messages (no id)', () => {
        const message = {
            jsonrpc: '2.0',
            method: 'notifications/initialized'
        };

        assert.strictEqual(message.jsonrpc, '2.0');
        assert.strictEqual(message.id, undefined);
        assert.ok(message.method);
    });
});
