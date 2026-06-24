import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseViewsResult } from '../src/helpers.js';

// The Views Search /execute response shape (Graylog 5.x):
//   { execution: {completed_exceptionally}, errors: [...],
//     results: { <queryId>: { errors: [...], search_types: { <stId>: {messages, total_results} } } } }
function execEnvelope({ messages = [], total = 0, errors = [], queryErrors = [], exceptional = false }) {
    return {
        execution: { done: true, cancelled: false, completed_exceptionally: exceptional },
        errors,
        results: {
            q1: {
                errors: queryErrors,
                search_types: { st1: { type: 'messages', messages, total_results: total } },
            },
        },
    };
}

describe('parseViewsResult', () => {
    it('extracts messages + total in universal-compatible shape', () => {
        const data = execEnvelope({
            messages: [{ message: { source: 'helixa-1', message: 'hi' } }],
            total: 42,
        });
        const out = parseViewsResult(data, 'source:helixa* AND error');
        assert.equal(out.total_results, 42);
        assert.equal(out.built_query, 'source:helixa* AND error');
        assert.equal(out.messages.length, 1);
        assert.equal(out.messages[0].message.source, 'helixa-1'); // formatMessages-ready shape
    });

    it('maps OpenSearch maxClauseCount errors to actionable guidance', () => {
        const data = execEnvelope({
            exceptional: true,
            errors: [{
                type: 'search_type',
                description: 'OpenSearch exception [type=too_many_nested_clauses, reason=Query contains too many nested clauses; maxClauseCount is set to 1024]',
            }],
        });
        assert.throws(
            () => parseViewsResult(data, 'error OR warn'),
            /too broad|maxClauseCount|max_clause_count/i,
        );
    });

    it('surfaces generic query errors', () => {
        const data = execEnvelope({
            exceptional: true,
            queryErrors: [{ type: 'query', description: 'Cannot parse query' }],
        });
        assert.throws(() => parseViewsResult(data, 'bad:('), /Cannot parse query/);
    });

    it('throws a clear error when execution is exceptional with no detail', () => {
        const data = {
            execution: { completed_exceptionally: true },
            errors: [],
            results: { q1: { errors: [], search_types: {} } },
        };
        assert.throws(() => parseViewsResult(data, '*'), /exceptional|no .*detail|too broad/i);
    });
});
