# mcp-server-graylog

[![npm version](https://badge.fury.io/js/mcp-server-graylog.svg)](https://www.npmjs.com/package/mcp-server-graylog)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-54%20passing-brightgreen)](https://github.com/Pranavj17/mcp-server-graylog)

Model Context Protocol (MCP) server for Graylog log searching. Search logs by absolute/relative timestamps, filter by streams, and debug production issues directly from Claude Desktop.

> **Built for production debugging** - Search Graylog logs using exact timestamps, filter by application streams, and get actionable insights for troubleshooting production issues.

## Features

- ✅ **Absolute timestamp search** - Debug specific errors with exact time ranges
- ✅ **Relative timestamp search** - Search recent logs (last N seconds)
- ✅ **Distributed tracing** - Follow a `trace_id` across all services
- ✅ **Surrounding-log context** - See what happened ±N seconds around an error
- ✅ **Composite incident analysis** - One tool call fans out to trace + context + baseline
- ✅ **Field aggregation** - Group counts by service/level/pod/lead_id with bandwidth-efficient projection
- ✅ **Stream discovery** - List all available streams/applications
- ✅ **System health check** - Verify Graylog connectivity
- ✅ **Comprehensive validation** - ISO 8601 timestamps, query syntax, stream IDs
- ✅ **Clear error messages** - Actionable errors for auth, network, and API issues
- ✅ **Timeout handling** - 30-second timeouts prevent hanging
- ✅ **Production-ready** - 54 tests, 9.2/10 code quality score

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Available Tools](#available-tools)
- [Query Examples](#query-examples)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Installation

### Option 1: Use with npx (Recommended)

```bash
# No installation needed - use directly with npx
npx mcp-server-graylog
```

### Option 2: Global Installation

```bash
npm install -g mcp-server-graylog
```

### Option 3: Local Installation

```bash
# Clone the repository
git clone https://github.com/Pranavj17/mcp-server-graylog.git
cd mcp-server-graylog

# Install dependencies
npm install
```

## Configuration

### Claude Desktop Setup

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

#### Using npx (Recommended)

```json
{
  "mcpServers": {
    "graylog": {
      "command": "npx",
      "args": ["-y", "mcp-server-graylog"],
      "env": {
        "BASE_URL": "https://graylog.example.com",
        "API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

#### Using Local Installation

```json
{
  "mcpServers": {
    "graylog": {
      "command": "node",
      "args": ["/path/to/mcp-server-graylog/src/index.js"],
      "env": {
        "BASE_URL": "https://graylog.example.com",
        "API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BASE_URL` | Yes | Graylog server URL (e.g., `https://graylog.example.com`) |
| `API_TOKEN` | Yes | Graylog API token (username for Basic Auth, password is "token") |

### Getting Your Graylog API Token

1. Log in to Graylog web interface
2. Go to **System → Users**
3. Select your user
4. Click **Edit tokens**
5. Create a new token with read permissions
6. Copy the token value

## Available Tools

### 1. search_logs_absolute

Search logs using absolute timestamps (from/to). Perfect for debugging errors with specific timestamps from monitoring tools or error tracking systems.

**Parameters:**
- `query` (required): Search query using Elasticsearch syntax
- `from` (required): Start timestamp in ISO 8601 format
- `to` (required): End timestamp in ISO 8601 format
- `streamId` (optional): Stream ID to filter results
- `limit` (optional): Maximum results (default: 50, max: 1000)

**Example:**
```javascript
{
  "query": "\"/api/v1/registrations\" AND \"PUT\"",
  "from": "2025-10-23T10:00:00.000Z",
  "to": "2025-10-23T11:00:00.000Z",
  "streamId": "646221a5bd29672a6f0246d8",
  "limit": 100
}
```

### 2. search_logs_relative

Search logs using relative time range (e.g., last 15 minutes). Useful for recent log analysis.

**Parameters:**
- `query` (required): Search query using Elasticsearch syntax
- `rangeSeconds` (optional): Time range in seconds (default: 900 = 15 minutes, max: 86400 = 24 hours)
- `streamId` (optional): Stream ID to filter results
- `limit` (optional): Maximum results (default: 50, max: 1000)

**Example:**
```javascript
{
  "query": "level:ERROR",
  "rangeSeconds": 3600,
  "limit": 100
}
```

### 3. trace_request

Trace a request across ALL services using a `trace_id`. Fetches logs from every stream, groups by service/pod, and sorts each service's messages chronologically. Essential for distributed debugging in microservice architectures.

**Parameters:**
- `traceId` (required): The trace ID to follow (e.g., `abbb27610a7fd76be8fb5af17edbe00d`)
- `from` (required): Start timestamp in ISO 8601 format (search window)
- `to` (required): End timestamp in ISO 8601 format (search window)
- `limit` (optional): Maximum results (default: 200, max: 1000)

**Example:**
```javascript
{
  "traceId": "abbb27610a7fd76be8fb5af17edbe00d",
  "from": "2026-05-13T15:38:00.000Z",
  "to":   "2026-05-13T15:48:00.000Z"
}
```

### 4. get_surrounding_logs

Return logs within ±N seconds of a timestamp, optionally filtered by source/pod/stream. Reveals what happened immediately before and after an error.

**Parameters:**
- `timestamp` (required): Center timestamp in ISO 8601 format
- `source` (optional): Source hostname or pod to filter by
- `streamId` (optional): Stream ID filter
- `windowSeconds` (optional): Window on each side (default: 5, max: 300)
- `limit` (optional): Maximum results (default: 100)

**Example:**
```javascript
{
  "timestamp": "2026-05-13T15:43:27.844Z",
  "source": "argus-production-f747f5d4d-x9hpp",
  "windowSeconds": 10
}
```

### 5. analyze_incident

**Composite tool.** One call fans out to three searches and returns an aggregated incident report — saves 2-3 LLM orchestration rounds when investigating a specific trace.

Internally executes:
1. The full trace hop chain (`trace_id:X`)
2. Pod-scoped surrounding logs around the first ERROR/CRITICAL/FATAL hop (filters by `pod:` to avoid multi-tenant noise on shared hosts)
3. A trailing-hour error baseline for the anchor service

**Parameters:**
- `traceId` (required): The trace ID to investigate
- `from` (required): Start timestamp in ISO 8601 format
- `to` (required): End timestamp in ISO 8601 format
- `window` (optional): Surrounding-logs window in seconds (default: 10, max: 300)
- `baselineSeconds` (optional): Trailing window for the baseline lookup (default: 3600, max: 86400)

**Example:**
```javascript
{
  "traceId": "abbb27610a7fd76be8fb5af17edbe00d",
  "from": "2026-05-13T15:38:00.000Z",
  "to":   "2026-05-13T15:48:00.000Z",
  "window": 10,
  "baselineSeconds": 3600
}
```

**Returns** (abridged):
```json
{
  "trace_id": "abbb27610a7fd76be8fb5af17edbe00d",
  "found": true,
  "steps_executed": 4,
  "summary": {
    "hops": 4,
    "services_involved": ["argus"],
    "errors_in_trace": 1,
    "anchor_service": "argus",
    "anchor_pod": "argus-production-f747f5d4d-x9hpp",
    "first_error": { "timestamp": "...", "service": "argus", "message": "nil fund_id ...", "lead_id": "..." },
    "request": { "http_path": "/api/v2/user/graph", "http_method": "POST", "http_status": 200, "duration_ms": 67 },
    "baseline_errors_in_service": 16,
    "baseline_window_seconds": 3600
  },
  "trace_hops": [...],
  "surrounding_logs": [...]
}
```

### 6. aggregate_logs

Count log entries grouped by a field — Graylog's most-used operation, made one-call. Issues a single search with `fields=<group_field>` projected (so only the column you want is downloaded) and aggregates client-side. Replaces Graylog 5.x's removed legacy terms-aggregation endpoint.

**Parameters:**
- `query` (required): Filter (Elasticsearch syntax). Use `*` for all entries.
- `field` (required): Field to group by. Common: `service`, `logger_level`, `pod`, `lead_id`, `http_status`, `container_name`.
- `from`+`to` OR `rangeSeconds` (required, mutually exclusive): time window
- `size` (optional): Top N to return (default 25, max 100). Rest summed into `other`.
- `fetchLimit` (optional): Max messages to aggregate (default 5000, max 10000). When matched exceeds this, `truncated: true` is flagged.
- `streamId` (optional)

**Example:**
```javascript
{
  "query": "logger_level:error",
  "field": "service",
  "rangeSeconds": 1800,
  "size": 10
}
```

**Returns:**
```json
{
  "field": "service",
  "query": "logger_level:error",
  "time_range": "Last 1800 seconds",
  "total_matched": 30,
  "messages_aggregated": 30,
  "truncated": false,
  "unique_groups": 5,
  "top": { "milkyway": 8, "argus": 4, "telex": 4, "advisory": 3, "auth": 1 },
  "other": 0,
  "missing": 10,
  "api_calls": 1
}
```

The `missing` count is messages that matched the query but had no value for the group-by field — useful signal for log-hygiene issues.

### 7. list_streams

List all available Graylog streams (applications). Use this to discover stream IDs for filtering.

**Parameters:** None

**Returns:**
```json
{
  "total": 3,
  "streams": [
    {
      "id": "646221a5bd29672a6f0246d8",
      "title": "application-api",
      "description": "API application logs",
      "disabled": false
    }
  ]
}
```

### 8. get_system_info

Get Graylog system information and health status. Verify connectivity and check server version.

**Parameters:** None

**Returns:**
```json
{
  "version": "5.1.0",
  "codename": "graylog",
  "cluster_id": "abc123",
  "is_processing": true,
  "timezone": "UTC"
}
```

## Query Examples

### Search for Errors

```
level:ERROR
```

### Search for Specific Endpoint

```
"/api/v1/registrations" AND "PUT"
```

### Search for HTTP Status Codes

```
status:500
status:>=400
```

### Search for User Actions

```
user_id:12345 AND action:login
```

### Search for Slow Requests

```
duration_ms:>1000
```

### Search for Exceptions

```
exception:NullPointerException
```

### Combine Multiple Conditions

```
level:ERROR AND source:nexus AND message:*timeout*
```

### Search with Wildcards

```
message:*connection refused*
```

### Search by Field Existence

```
_exists_:error_code
```

## Common Use Cases

### 1. Debug Production Error

When you get an error with a timestamp from your monitoring system:

```
1. Copy error timestamp from your monitoring tool
2. Use search_logs_absolute with ±5 minute window
3. Filter by application stream
4. Find root cause in logs
```

### 2. Monitor Recent Deployments

After deploying:

```
1. Use search_logs_relative with last 15 minutes
2. Search for level:ERROR
3. Verify no new errors introduced
```

### 3. Investigate API Failures

When an API endpoint fails:

```
1. Search for endpoint path: "/api/v1/endpoint"
2. Filter by status codes: status:>=400
3. Check error patterns
```

## Error Messages

The server provides clear, actionable error messages:

| Error | Meaning | Solution |
|-------|---------|----------|
| **Authentication failed** | Invalid API token | Check `API_TOKEN` in configuration |
| **Invalid query** | Elasticsearch syntax error | Check query syntax and parameters |
| **Endpoint not found** | Wrong Graylog URL | Check `BASE_URL` in configuration |
| **Cannot reach Graylog** | Network connectivity issue | Verify Graylog is accessible |
| **Invalid timestamp** | Wrong timestamp format | Use ISO 8601 format (e.g., `2025-10-23T10:00:00.000Z`) |

## Troubleshooting

### Server Won't Start

**Check environment variables:**
```bash
# Verify BASE_URL and API_TOKEN are set in Claude Desktop config
# Check Claude Desktop logs:
# macOS: ~/Library/Logs/Claude/mcp*.log
# Windows: %APPDATA%\Claude\logs\mcp*.log
```

**Verify Graylog accessibility:**
```bash
curl -u "YOUR_API_TOKEN:token" https://graylog.example.com/api/system
```

### Authentication Errors

- Verify API token has read permissions in Graylog
- Token format: Use token value as username, "token" as password
- Check token hasn't expired

### No Results Returned

- Verify stream ID is correct using `list_streams` tool
- Check timestamp range includes data
- Try simplifying query to `*` to see if any data exists
- Verify stream is not disabled

### Integration Tests Failing

```bash
# Set environment variables for integration tests
export INTEGRATION_TESTS=true
export BASE_URL=https://graylog.example.com
export API_TOKEN=your_token_here

# Run integration tests
npm run test:integration
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- Access to a Graylog instance (for integration tests)

### Development Workflow

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run only unit tests
npm run test:unit

# Run integration tests (requires Graylog instance)
INTEGRATION_TESTS=true BASE_URL=https://graylog.example.com API_TOKEN=xxx npm run test:integration

# Check syntax
npm run lint
```

### Project Structure

```
mcp-server-graylog/
├── src/
│   └── index.js           # Main server implementation (429 lines)
├── test/
│   ├── helpers.test.js    # Helper function tests (14 tests)
│   ├── validation.test.js # Input validation tests (24 tests)
│   ├── mcp-protocol.test.js # MCP protocol tests (16 tests)
│   └── integration.test.js  # Integration tests (7 tests)
├── example-config.json    # Claude Desktop config example
├── CONTRIBUTING.md        # Contributing guidelines
├── CHANGELOG.md          # Version history
└── package.json         # npm configuration
```

### Running Tests

```bash
# Run all tests (54 tests)
npm test

# Expected output:
# tests 54
# pass 54
# fail 0
```

## Architecture

**Simple, focused architecture in a single file (429 lines):**

- **Configuration & Validation** - Environment variable checking
- **Helper Functions** - ISO 8601 validation, error formatting
- **MCP Server Setup** - Standard MCP protocol implementation
- **Tool Definitions** - 4 tools with clear schemas
- **Tool Implementations** - Clean, validated functions
- **Server Startup** - Validation then connection

**Design Principles:**
- ✓ Simple and maintainable
- ✓ One file, easy to understand
- ✓ Clear separation of concerns
- ✓ Comprehensive error handling
- ✓ Input validation at boundaries
- ✓ Consistent response format

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Quick Start:**
1. Fork the repository
2. Create a feature branch
3. Add tests for your changes
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

## Security

- Environment variables for sensitive data (never hardcoded)
- Basic authentication properly implemented
- Input validation prevents injection attacks
- Timeout prevents hanging requests
- Error messages don't leak sensitive information

To report security vulnerabilities, please create a private security advisory on GitHub.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [npm package](https://www.npmjs.com/package/mcp-server-graylog)
- [GitHub repository](https://github.com/Pranavj17/mcp-server-graylog)
- [Issue tracker](https://github.com/Pranavj17/mcp-server-graylog/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Graylog Documentation](https://docs.graylog.org)

## Acknowledgments

- Built with [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- Inspired by the MCP community
- Thanks to all contributors!

---

**Made with ❤️ for the Claude Desktop community**

*For questions or support, please open an issue on GitHub*
