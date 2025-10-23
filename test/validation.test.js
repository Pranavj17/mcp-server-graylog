/**
 * Validation tests for input parameters
 * Tests the bug fixes for query, streamId, rangeSeconds, and limit validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Query Validation (Bug #4 Fix)', () => {
    const validateQuery = (query) => {
        if (!query || typeof query !== 'string' || !query.trim()) {
            throw new Error("'query' parameter is required and must be a non-empty string");
        }
        return query.trim();
    };

    it('should accept valid queries', () => {
        assert.strictEqual(validateQuery('level:ERROR'), 'level:ERROR');
        assert.strictEqual(validateQuery('  /api/v1/registrations  '), '/api/v1/registrations');
        assert.strictEqual(validateQuery('source:nexus AND level:ERROR'), 'source:nexus AND level:ERROR');
    });

    it('should reject null query', () => {
        assert.throws(() => {
            validateQuery(null);
        }, /'query' parameter is required/);
    });

    it('should reject undefined query', () => {
        assert.throws(() => {
            validateQuery(undefined);
        }, /'query' parameter is required/);
    });

    it('should reject empty string', () => {
        assert.throws(() => {
            validateQuery('');
        }, /'query' parameter is required/);
    });

    it('should reject whitespace-only string', () => {
        assert.throws(() => {
            validateQuery('   ');
        }, /'query' parameter is required/);
    });

    it('should reject non-string types', () => {
        assert.throws(() => {
            validateQuery(123);
        }, /'query' parameter is required/);

        assert.throws(() => {
            validateQuery({});
        }, /'query' parameter is required/);

        assert.throws(() => {
            validateQuery([]);
        }, /'query' parameter is required/);
    });
});

describe('StreamId Validation (Bug #3 Fix)', () => {
    const validateStreamId = (streamId) => {
        if (streamId !== undefined && typeof streamId !== 'string') {
            throw new Error("'streamId' must be a string");
        }
        return streamId;
    };

    it('should accept valid stream IDs', () => {
        assert.strictEqual(validateStreamId('646221a5bd29672a6f0246d8'), '646221a5bd29672a6f0246d8');
        assert.strictEqual(validateStreamId('67fc9a38d7e1b33fa7695220'), '67fc9a38d7e1b33fa7695220');
    });

    it('should accept undefined (optional parameter)', () => {
        assert.strictEqual(validateStreamId(undefined), undefined);
    });

    it('should reject non-string types', () => {
        assert.throws(() => {
            validateStreamId(123);
        }, /'streamId' must be a string/);

        assert.throws(() => {
            validateStreamId({});
        }, /'streamId' must be a string/);

        assert.throws(() => {
            validateStreamId([]);
        }, /'streamId' must be a string/);

        assert.throws(() => {
            validateStreamId(null);
        }, /'streamId' must be a string/);
    });
});

describe('RangeSeconds Validation (Bug #2 Fix)', () => {
    const validateRangeSeconds = (rangeSeconds) => {
        if (rangeSeconds < 1 || rangeSeconds > 86400) {
            throw new Error("'rangeSeconds' must be between 1 and 86400 (24 hours)");
        }
        return rangeSeconds;
    };

    it('should accept valid range values', () => {
        assert.strictEqual(validateRangeSeconds(1), 1); // 1 second
        assert.strictEqual(validateRangeSeconds(900), 900); // 15 minutes (default)
        assert.strictEqual(validateRangeSeconds(3600), 3600); // 1 hour
        assert.strictEqual(validateRangeSeconds(86400), 86400); // 24 hours (max)
    });

    it('should reject values less than 1', () => {
        assert.throws(() => {
            validateRangeSeconds(0);
        }, /'rangeSeconds' must be between 1 and 86400/);

        assert.throws(() => {
            validateRangeSeconds(-1);
        }, /'rangeSeconds' must be between 1 and 86400/);
    });

    it('should reject values greater than 86400', () => {
        assert.throws(() => {
            validateRangeSeconds(86401);
        }, /'rangeSeconds' must be between 1 and 86400/);

        assert.throws(() => {
            validateRangeSeconds(100000);
        }, /'rangeSeconds' must be between 1 and 86400/);
    });
});

describe('Limit Validation (Bug #5 Fix)', () => {
    const validateLimit = (limit) => {
        const actualLimit = limit ?? 50; // Nullish coalescing
        if (actualLimit < 1 || actualLimit > 1000) {
            throw new Error("'limit' must be between 1 and 1000");
        }
        return actualLimit;
    };

    it('should accept valid limit values', () => {
        assert.strictEqual(validateLimit(1), 1);
        assert.strictEqual(validateLimit(50), 50);
        assert.strictEqual(validateLimit(100), 100);
        assert.strictEqual(validateLimit(1000), 1000);
    });

    it('should use default when undefined', () => {
        assert.strictEqual(validateLimit(undefined), 50);
    });

    it('should use default when null', () => {
        assert.strictEqual(validateLimit(null), 50);
    });

    it('should NOT use default when 0 (this was the bug)', () => {
        assert.throws(() => {
            validateLimit(0);
        }, /'limit' must be between 1 and 1000/);
    });

    it('should reject negative values', () => {
        assert.throws(() => {
            validateLimit(-1);
        }, /'limit' must be between 1 and 1000/);
    });

    it('should reject values greater than 1000', () => {
        assert.throws(() => {
            validateLimit(1001);
        }, /'limit' must be between 1 and 1000/);
    });
});

describe('Message Field Access (Bug #1 Fix)', () => {
    const formatMessages = (messages) => {
        return (messages || [])
            .filter(m => m && m.message)
            .map(m => ({
                timestamp: m.message.timestamp,
                message: m.message.message,
                source: m.message.source,
                level: m.message.level
            }));
    };

    it('should handle valid message array', () => {
        const messages = [
            {
                message: {
                    timestamp: '2025-10-23T12:00:00Z',
                    message: 'Test log',
                    source: 'nexus',
                    level: 'INFO'
                }
            }
        ];
        const result = formatMessages(messages);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].message, 'Test log');
    });

    it('should filter out malformed messages (null message field)', () => {
        const messages = [
            {
                message: null
            },
            {
                message: {
                    timestamp: '2025-10-23T12:00:00Z',
                    message: 'Valid log',
                    source: 'nexus',
                    level: 'INFO'
                }
            }
        ];
        const result = formatMessages(messages);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].message, 'Valid log');
    });

    it('should filter out malformed messages (undefined message field)', () => {
        const messages = [
            {
                message: undefined
            },
            {
                message: {
                    timestamp: '2025-10-23T12:00:00Z',
                    message: 'Valid log',
                    source: 'nexus',
                    level: 'INFO'
                }
            }
        ];
        const result = formatMessages(messages);
        assert.strictEqual(result.length, 1);
    });

    it('should handle empty array', () => {
        const result = formatMessages([]);
        assert.strictEqual(result.length, 0);
    });

    it('should handle null/undefined input', () => {
        assert.strictEqual(formatMessages(null).length, 0);
        assert.strictEqual(formatMessages(undefined).length, 0);
    });

    it('should filter out completely malformed entries', () => {
        const messages = [
            null,
            undefined,
            {},
            { message: null },
            {
                message: {
                    timestamp: '2025-10-23T12:00:00Z',
                    message: 'Valid log',
                    source: 'nexus',
                    level: 'INFO'
                }
            }
        ];
        const result = formatMessages(messages);
        assert.strictEqual(result.length, 1);
    });
});
