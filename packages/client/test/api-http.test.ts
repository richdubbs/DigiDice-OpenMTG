/** The typed API client (packages/server/src/api.ts contract). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiGet, apiPath, apiPost } from '../src/api/http';
import { stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiPath', () => {
  it('fills and encodes path parameters', () => {
    expect(apiPath('GET /api/cards/:name', { name: 'Fire // Ice' })).toBe('/api/cards/Fire%20%2F%2F%20Ice');
    expect(() => apiPath('GET /api/cards/:name')).toThrow(/Missing path parameter name/);
  });

  it('appends defined query parameters in a stable order', () => {
    expect(apiPath('GET /api/cards/search', {}, { q: 'bolt', page: 2, colors: undefined, format: '' })).toBe('/api/cards/search?page=2&q=bolt');
    expect(apiPath('GET /api/status')).toBe('/api/status');
  });
});

describe('apiGet / apiPost', () => {
  it('POSTs JSON and returns the typed answer', async () => {
    const mock = stubFetch(() => ({ status: 200, body: { matches: [] } }));
    expect(await apiPost('POST /api/images/match', { fileNames: ['bolt.jpg'] })).toEqual({ matches: [] });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe('/api/images/match');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ fileNames: ['bolt.jpg'] }));
  });

  it('turns an error answer into ApiRequestError with the server message and TODO list', async () => {
    stubFetch(() => ({ status: 501, body: { error: 'GET /api/cards/search is not implemented yet', todo: ['everything'] } }));
    const err = await apiGet('GET /api/cards/search', { query: { q: 'bolt' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(501);
    expect((err as ApiRequestError).body?.todo).toEqual(['everything']);
    expect((err as ApiRequestError).message).toMatch(/not implemented/);
  });
});
