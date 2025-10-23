# Graylog MCP Server

Simple, focused MCP server for Graylog log searching. Built for debugging production issues with clean, maintainable code.

## Features

- ✅ **Absolute timestamp search** - Search logs by exact time ranges (for debugging specific errors)
- ✅ **Relative timestamp search** - Search logs by relative time (last N seconds)
- ✅ **Stream discovery** - List all available streams/applications
- ✅ **System health check** - Verify Graylog connectivity and status
- ✅ **Input validation** - ISO 8601 timestamp validation, error checking
- ✅ **Clear error messages** - Actionable errors for authentication, network, and API issues
- ✅ **Timeout handling** - 30-second timeouts to prevent hanging

## Requirements

- Node.js 18+

## Installation

```bash
cd graylog-mcp
npm install
```

## Configuration

Add to your MCP client configuration (e.g., Claude Desktop):

**Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "graylog": {
      "command": "node",
      "args": ["/Users/pranav/Documents/graylog-mcp/src/index.js"],
      "env": {
        "BASE_URL": "https://graylog.scripbox.net",
        "API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

## Available Tools

### 1. search_logs_absolute

Search logs using absolute timestamps (from/to). Perfect for debugging errors with specific timestamps.

**Parameters:**
- `query` (required): Search query using Elasticsearch syntax
- `from` (required): Start timestamp (ISO 8601 format)
- `to` (required): End timestamp (ISO 8601 format)
- `streamId` (optional): Stream ID to filter results
- `limit` (optional): Maximum results (default: 50, max: 1000)

**Example:**
```javascript
{
  "query": "\"/api/v1/registrations\" AND \"PUT\"",
  "from": "2025-09-29T17:57:26.568Z",
  "to": "2025-09-30T12:36:20.910Z",
  "streamId": "646221a5bd29672a6f0246d8",
  "limit": 100
}
```

### 2. search_logs_relative

Search logs using relative time range (e.g., last 15 minutes).

**Parameters:**
- `query` (required): Search query using Elasticsearch syntax
- `rangeSeconds` (optional): Time range in seconds (default: 900 = 15 minutes)
- `streamId` (optional): Stream ID to filter results
- `limit` (optional): Maximum results (default: 50)

**Example:**
```javascript
{
  "query": "level:ERROR",
  "rangeSeconds": 3600,
  "limit": 100
}
```

### 3. list_streams

List all available Graylog streams (applications).

**Parameters:** None

**Returns:** List of streams with ID, title, description, and status

### 4. get_system_info

Get Graylog system information and health status.

**Parameters:** None

**Returns:** System version, cluster info, and health status

## Common Query Examples

### Search for errors
```
level:ERROR
```

### Search for specific endpoint
```
"/api/v1/registrations" AND "PUT"
```

### Search for user actions
```
user_id:12345 AND action:login
```

### Search for slow requests
```
duration_ms:>1000
```

### Combine multiple conditions
```
level:ERROR AND source:nexus AND message:*timeout*
```

## Common Stream IDs

| Application | Stream ID |
|-------------|-----------|
| clientmaster | 646221a5bd29672a6f0246d8 |
| nexus | 67fc9a38d7e1b33fa7695220 |
| crm | 67bc3cbed7e1b33fa7e7c6a0 |

Use `list_streams` to discover all available streams.

## Error Messages

The server provides clear, actionable error messages:

- **Authentication failed** - Check API_TOKEN in configuration
- **Invalid query** - Check Elasticsearch query syntax
- **Endpoint not found** - Check BASE_URL in configuration
- **Cannot reach Graylog** - Check network connectivity
- **Invalid timestamp** - Use ISO 8601 format (e.g., '2025-09-29T17:57:26.568Z')

## Troubleshooting

### Server won't start
- Check that BASE_URL and API_TOKEN environment variables are set
- Verify Graylog is accessible from your network

### Authentication errors
- Verify API_TOKEN has read access to Graylog
- Token format: username (token) + password ("token")

### No results returned
- Verify stream ID is correct (use `list_streams`)
- Check timestamp range includes data
- Try simplifying query to `*` to see if any data exists

## Development

### Run in development mode
```bash
npm run dev
```

### Test the server
```bash
npm test
```

### Check syntax
```bash
node --check src/index.js
```

## Architecture

Simple, focused architecture in a single file (404 lines):

- **Configuration & Validation** - Environment variable checking
- **Helper Functions** - ISO 8601 validation, error formatting
- **MCP Server Setup** - Standard MCP protocol implementation
- **Tool Definitions** - 4 tools with clear schemas
- **Tool Implementations** - Clean, validated functions
- **Server Startup** - Validation then connection

**Design principles:**
- Simple and maintainable
- One file, easy to understand
- Clear separation of concerns
- Comprehensive error handling
- Input validation at boundaries
- Consistent response format

## License

MIT

## Version

2.0.0 - Complete rewrite focused on simplicity and reliability
