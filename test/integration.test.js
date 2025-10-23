/**
 * Integration tests (require running Graylog instance)
 * These tests are skipped by default - set INTEGRATION_TESTS=true to run
 *
 * Usage:
 *   INTEGRATION_TESTS=true BASE_URL=https://graylog.example.com API_TOKEN=xxx npm test
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

const SKIP_INTEGRATION = !process.env.INTEGRATION_TESTS;

if (SKIP_INTEGRATION) {
    console.log('⏭️  Skipping integration tests (set INTEGRATION_TESTS=true to run)');
}

describe('Integration Tests', { skip: SKIP_INTEGRATION }, () => {
    let baseUrl, apiToken;

    before(() => {
        baseUrl = process.env.BASE_URL;
        apiToken = process.env.API_TOKEN;

        if (!baseUrl || !apiToken) {
            throw new Error('BASE_URL and API_TOKEN environment variables required for integration tests');
        }
    });

    describe('Graylog API Connectivity', () => {
        it('should connect to Graylog system endpoint', async () => {
            const response = await fetch(`${baseUrl}/api/system`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${apiToken}:token`).toString('base64')}`
                }
            });

            assert.strictEqual(response.ok, true, 'Should connect successfully');
            const data = await response.json();
            assert.ok(data.version, 'Should return version');
        });

        it('should list streams', async () => {
            const response = await fetch(`${baseUrl}/api/streams`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${apiToken}:token`).toString('base64')}`
                }
            });

            assert.strictEqual(response.ok, true);
            const data = await response.json();
            assert.ok(Array.isArray(data.streams), 'Should return streams array');
        });
    });

    describe('Search Functionality', () => {
        it('should perform absolute timestamp search', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 3600000);

            const params = new URLSearchParams({
                query: '*',
                from: oneHourAgo.toISOString(),
                to: now.toISOString(),
                limit: 10,
                fields: 'message,timestamp,source,level'
            });

            const response = await fetch(`${baseUrl}/api/search/universal/absolute?${params}`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${apiToken}:token`).toString('base64')}`
                }
            });

            assert.strictEqual(response.ok, true);
            const data = await response.json();
            assert.ok(typeof data.total_results === 'number', 'Should return total_results');
            assert.ok(Array.isArray(data.messages), 'Should return messages array');
        });

        it('should perform relative timestamp search', async () => {
            const params = new URLSearchParams({
                query: '*',
                range: 900, // 15 minutes
                limit: 10,
                fields: 'message,timestamp,source,level'
            });

            const response = await fetch(`${baseUrl}/api/search/universal/relative?${params}`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${apiToken}:token`).toString('base64')}`
                }
            });

            assert.strictEqual(response.ok, true);
            const data = await response.json();
            assert.ok(typeof data.total_results === 'number');
        });

        it('should filter by stream ID', async () => {
            // First get a stream ID
            const streamsResponse = await fetch(`${baseUrl}/api/streams`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${apiToken}:token`).toString('base64')}`
                }
            });
            const streamsData = await streamsResponse.json();
            const streams = streamsData.streams.filter(s => !s.is_default);

            if (streams.length === 0) {
                console.log('⏭️  No streams available for filtering test');
                return;
            }

            const streamId = streams[0].id;
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 3600000);

            const params = new URLSearchParams({
                query: '*',
                from: oneHourAgo.toISOString(),
                to: now.toISOString(),
                limit: 10,
                filter: `streams:${streamId}`,
                fields: 'message,timestamp,source,level'
            });

            const response = await fetch(`${baseUrl}/api/search/universal/absolute?${params}`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${apiToken}:token`).toString('base64')}`
                }
            });

            assert.strictEqual(response.ok, true);
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid authentication', async () => {
            const response = await fetch(`${baseUrl}/api/system`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': 'Basic invalid'
                }
            });

            assert.strictEqual(response.status, 401);
        });

        it('should handle invalid query syntax', async () => {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 3600000);

            const params = new URLSearchParams({
                query: 'invalid AND AND syntax',
                from: oneHourAgo.toISOString(),
                to: now.toISOString(),
                fields: 'message'
            });

            const response = await fetch(`${baseUrl}/api/search/universal/absolute?${params}`, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${apiToken}:token`).toString('base64')}`
                }
            });

            // Graylog should return 400 for invalid query
            assert.ok([400, 500].includes(response.status), 'Should return error for invalid query');
        });
    });
});
