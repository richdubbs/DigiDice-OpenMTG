/**
 * M13-6: the gateway's HTTP server and the metrics listener, with their request handlers called in process (no socket is opened: the owner rule allows one
 * normal-traffic game over a loopback WebSocket and nothing else on the network). `/healthz`, `/readyz`, the paths that are not served, and the upgrade
 * refusals with crafted headers (Origin, the proxy rule, the path, sockets per address) as the `ws` server's `upgrade` event sees them.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_BYTES } from '../../src/api';
import { createGatewayServer, wsSocket } from '../../src/gateway/server';
import { createMetricsServer, PrometheusMetrics } from '../../src/gateway/metrics';
import { METRICS } from '../../src/obs';
import { callRequest as request, callUpgrade as upgrade, makeGateway } from './harness';

describe('M13-6 the gateway\'s HTTP server (design 3.1, 10.2)', () => {
  function make(env: Record<string, string> = {}, ready: () => { ok: boolean; reasons: string[] } = () => ({ ok: true, reasons: [] })) {
    const t = makeGateway({ env });
    const { server, wss } = createGatewayServer({ gateway: t.gateway, ready });
    return { t, server, wss };
  }

  it('/healthz and /readyz answer JSON, uncached; /readyz says why it is not ready; nothing else is served', () => {
    let reasons: string[] = [];
    const { server } = make({}, () => ({ ok: reasons.length === 0, reasons }));
    const health = request(server, { url: '/healthz' });
    expect(health).toMatchObject({ status: 200, body: '{"ok":true}' });
    expect(health.headers).toMatchObject({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    expect(request(server, { url: '/readyz' })).toMatchObject({ status: 200, body: '{"ok":true,"reasons":[]}' });
    reasons = ['store', 'draining'];
    expect(request(server, { url: '/readyz' })).toMatchObject({ status: 503, body: '{"ok":false,"reasons":["store","draining"]}' });
    // no /metrics here (the metrics listener is another server), no files, no other methods
    for (const url of ['/metrics', '/', '/ws', '/healthz?x=1', '/healthz/', '/index.html', '/../etc/passwd']) expect(request(server, { url }), url).toMatchObject({ status: 404 });
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) expect(request(server, { method, url: '/healthz' }), method).toMatchObject({ status: 405 });
    expect(request(server, { method: 'HEAD', url: '/healthz' }).status).toBe(200);
    // no CORS headers anywhere
    for (const a of [health, request(server, { url: '/nope' })]) expect(Object.keys(a.headers).some((h) => h.toLowerCase().startsWith('access-control'))).toBe(false);
  });

  it('a handler that throws destroys that response and nothing else', () => {
    const { server } = make({}, () => {
      throw new Error('the check broke');
    });
    expect(request(server, { url: '/readyz' })).toMatchObject({ destroyed: true });
    expect(request(server, { url: '/healthz' })).toMatchObject({ status: 200 });
  });

  it('the WebSocket server takes frames of at most 256 KB, with no compression and no client list of its own', () => {
    const { wss } = make();
    expect(wss.options).toMatchObject({ maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false, clientTracking: false, noServer: true });
    expect(MAX_FRAME_BYTES).toBe(256 * 1024);
  });

  it('the ws adapter terminates a socket (no closing handshake), closes with a code and a reason, pings, and reports a failed send', () => {
    const calls: string[] = [];
    const ws = {
      send: (_t: string, _o: unknown, cb: (e?: Error) => void) => cb(new Error('not open')),
      close: (c: number, r: string) => calls.push(`close:${c}:${r}`),
      ping: () => calls.push('ping'),
      terminate: () => calls.push('terminate'),
    };
    const socket = wsSocket(ws as never);
    socket.close(4004, 'too far behind');
    socket.ping!();
    socket.terminate!(4004, 'too far behind');
    expect(calls).toEqual(['close:4004:too far behind', 'ping', 'terminate']);
    let failed: Error | undefined;
    socket.send('x', (e) => (failed = e));
    expect(failed?.message).toBe('not open');
  });

  it('the server has bounded header and request times', () => {
    const { server } = make();
    expect(server.headersTimeout).toBe(10_000);
    expect(server.requestTimeout).toBe(15_000);
  });

  it('an upgrade is refused before any WebSocket exists: another path (404), another Origin (403), another peer behind the proxy (403), too many sockets (429)', () => {
    const { t, server } = make({ PUBLIC_ORIGINS: 'https://play.digidice.net', TRUST_PROXY: '10.0.0.2' });
    const good = { origin: 'https://play.digidice.net', 'x-forwarded-for': '198.51.100.7' };
    const status = (o: { written: string; destroyed: boolean }) => /^HTTP\/1\.1 (\d+)/.exec(o.written)?.[1];
    for (const [what, out, code] of [
      ['another path', upgrade(server, { url: '/socket', headers: good, peer: '10.0.0.2' }), '404'],
      ['no origin', upgrade(server, { headers: { 'x-forwarded-for': '198.51.100.7' }, peer: '10.0.0.2' }), '403'],
      ['another origin', upgrade(server, { headers: { ...good, origin: 'https://evil.example' }, peer: '10.0.0.2' }), '403'],
      ['not the proxy', upgrade(server, { headers: good, peer: '10.0.0.9' }), '403'],
      ['no client address', upgrade(server, { headers: { origin: good.origin }, peer: '10.0.0.2' }), '403'],
    ] as const) {
      expect(status(out), what).toBe(code);
      expect(out.written, what).toContain('Connection: close');
      expect(out.destroyed, what).toBe(true);
    }
    // eight sockets of one client are admitted by the gateway (their WebSocket handshakes are not made here), the ninth gets 429
    for (let i = 0; i < 8; i++) expect(t.gateway.upgrade({ peer: '10.0.0.2', origin: good.origin, forwardedFor: '198.51.100.7' }).ok).toBe(true);
    expect(status(upgrade(server, { headers: good, peer: '10.0.0.2' }))).toBe('429');
    expect(t.metrics.values.get(`${METRICS.refusals}{reason="sockets"}`)).toBe(1);
  });

  it('an upgrade that throws destroys its socket; a client error answers 400 and closes', () => {
    const { t, server } = make();
    (t.gateway as unknown as { upgrade: () => never }).upgrade = () => {
      throw new Error('boom');
    };
    expect(upgrade(server, { headers: { origin: 'http://127.0.0.1:5173' } })).toMatchObject({ written: '', destroyed: true });
    const socket = new PassThrough();
    let written = '';
    socket.on('data', (c: Buffer) => (written += c.toString('utf8')));
    server.emit('clientError', new Error('bad request'), socket);
    expect(written).toMatch(/^HTTP\/1\.1 400 Bad Request/);
  });
});

describe('M13-6 the metrics listener (design 10.2, review 9): its own server, a bearer token on every request', () => {
  const token = 'c'.repeat(64);

  it('every request needs the exact token; only GET /metrics answers, in the Prometheus text format', () => {
    const metrics = new PrometheusMetrics();
    metrics.inc(METRICS.refusals, { reason: 'origin' });
    metrics.set(METRICS.connections, 4);
    const server = createMetricsServer(metrics, token);
    const wrong: Record<string, string>[] = [{}, { authorization: token }, { authorization: `Bearer ${'d'.repeat(64)}` }, { authorization: `Bearer ${token}x` }, { authorization: `bearer ${token}` }];
    for (const headers of wrong) {
      expect(request(server, { url: '/metrics', headers }), JSON.stringify(headers)).toMatchObject({ status: 401, body: '' });
    }
    const ok = request(server, { url: '/metrics', headers: { authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers).toMatchObject({ 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
    expect(ok.body).toContain('openmtg_hosted_refusals_total{reason="origin"} 1');
    expect(ok.body).toContain('openmtg_hosted_connections 4');
    // with the token, every other path and method is a 404 (the token opens nothing but /metrics)
    for (const [method, url] of [['GET', '/'], ['GET', '/healthz'], ['GET', '/metrics/x'], ['POST', '/metrics']] as const) {
      expect(request(server, { method, url, headers: { authorization: `Bearer ${token}` } }), `${method} ${url}`).toMatchObject({ status: 404 });
    }
    expect(server.headersTimeout).toBe(10_000);
  });
});
