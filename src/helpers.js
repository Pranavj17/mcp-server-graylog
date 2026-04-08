/**
 * Shared helper functions for Graylog MCP Server
 * Exported for direct testing — no more copy-pasting into test files.
 */

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function isValidISO8601(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && dateString.includes('T');
}

export function validateTimeRange(from, to) {
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

export function validateQuery(query) {
    // Bug #4 fix: type check before trim
    if (!query || typeof query !== 'string' || !query.trim()) {
        throw new Error("'query' parameter is required and must be a non-empty string");
    }
    return query.trim();
}

export function validateStreamId(streamId) {
    // Bug #3 fix: validate streamId type
    if (streamId !== undefined && typeof streamId !== 'string') {
        throw new Error("'streamId' must be a string");
    }
    return streamId;
}

export function validateRangeSeconds(rangeSeconds) {
    // Bug #2 fix: validate rangeSeconds bounds
    if (rangeSeconds < 1 || rangeSeconds > 86400) {
        throw new Error("'rangeSeconds' must be between 1 and 86400 (24 hours)");
    }
    return rangeSeconds;
}

export function validateLimit(limit) {
    // Bug #5 fix: nullish coalescing respects 0
    const actualLimit = limit ?? 50;
    if (actualLimit < 1 || actualLimit > 1000) {
        throw new Error("'limit' must be between 1 and 1000");
    }
    return actualLimit;
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

export function formatError(error, baseUrl) {
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
        return `Cannot reach Graylog at ${baseUrl}. Check network connectivity.`;
    } else {
        return error.message;
    }
}

export function formatMessages(messages) {
    // Bug #1 fix: filter out malformed messages before accessing nested fields
    return (messages || [])
        .filter(m => m && m.message)
        .map(m => ({
            timestamp: m.message.timestamp,
            message: m.message.message,
            source: m.message.source,
            level: m.message.level
        }));
}
