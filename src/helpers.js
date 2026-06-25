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
    // v2.0: Pass through all fields from Graylog instead of cherry-picking 4.
    // This enables distributed tracing (trace_id, span_id), pod identification,
    // service correlation, and logger_level filtering.
    return (messages || [])
        .filter(m => m && m.message)
        .map(m => {
            const msg = m.message;
            // Remove Graylog internal fields (start with gl2_) to reduce noise
            const result = {};
            for (const [key, value] of Object.entries(msg)) {
                if (!key.startsWith('gl2_')) {
                    result[key] = value;
                }
            }
            return result;
        });
}

// ============================================================================
// VIEWS SEARCH API (Graylog 5.x) RESULT PARSING
// ============================================================================
//
// The modern /api/views/search execute response nests results under
// results.<queryId>.search_types.<searchTypeId>. It reports backend failures
// in `errors` (top-level or per-query) with `execution.completed_exceptionally`,
// instead of the legacy universal endpoint's cryptic "Missing search type
// result!". We translate the most common one — OpenSearch's boolean
// maxClauseCount limit, hit by broad/unqualified multi-term queries — into
// actionable guidance.

function describeViewsErrors(errors) {
    const descs = errors
        .map(e => (e && (e.description || e.message)) || (typeof e === 'string' ? e : JSON.stringify(e)))
        .filter(Boolean);
    const joined = descs.join(' | ');
    if (/too_many_nested_clauses|maxClauseCount|max_clause_count/i.test(joined)) {
        return (
            'Query too broad for this Graylog/OpenSearch backend — it hit the boolean ' +
            'maxClauseCount limit (commonly 1024). An unqualified multi-term query ' +
            '(e.g. "error OR warn") or a wildcard combined with several terms expands ' +
            'past the limit. Narrow it: qualify terms with a field (logger_level:error, ' +
            'source:helixa-*), avoid combining a wildcard with multiple unqualified ' +
            'terms, or raise indices.query.bool.max_clause_count on the OpenSearch ' +
            'cluster. Raw: ' + joined
        );
    }
    return 'Graylog search error: ' + joined;
}

// Parse a /api/views/search/{id}/execute response into the universal-compatible
// shape the tool handlers expect: { total_results, built_query, messages }.
// `messages` keeps the [{ message: {...} }] shape so formatMessages works
// unchanged. Throws a clear Error on any backend failure.
export function parseViewsResult(execData, queryString) {
    const data = execData || {};
    const topErrors = Array.isArray(data.errors) ? data.errors : [];
    const results = data.results || {};
    const queryResult = Object.values(results)[0] || {};
    const queryErrors = Array.isArray(queryResult.errors) ? queryResult.errors : [];
    const allErrors = [...topErrors, ...queryErrors];
    if (allErrors.length > 0) {
        throw new Error(describeViewsErrors(allErrors));
    }

    const searchTypes = queryResult.search_types || {};
    const searchType = Object.values(searchTypes)[0];
    if (!searchType) {
        if (data.execution && data.execution.completed_exceptionally) {
            throw new Error(
                'Graylog search completed exceptionally with no error detail — the query ' +
                'is likely too broad or malformed. Try narrowing it (qualify terms with a field).'
            );
        }
        throw new Error('Graylog returned no search-type result.');
    }

    return {
        total_results: searchType.total_results || 0,
        built_query: queryString,
        messages: searchType.messages || [],
    };
}

// Default fields that cover most debugging scenarios.
// Users can override via the `fields` parameter on search tools.
export const DEFAULT_FIELDS = [
    'message', 'timestamp', 'source', 'level', 'logger_level',
    'trace_id', 'span_id', 'pod', 'service', 'container_name'
].join(',');
