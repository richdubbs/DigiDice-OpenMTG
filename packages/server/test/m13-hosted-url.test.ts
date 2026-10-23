/**
 * M13-11 (hosted design 12): the hosted game server's address. `hostedSocketOrigin` accepts exactly the forms a player may configure, the
 * Content-Security-Policy gains that one WebSocket origin (and nothing else), and GET /api/status tells the page (`hostedUrl`, only when configured).
 * A server without a hosted address behaves exactly as before. Loopback only, no network.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, contentSecurityPolicy, contextFrom, hostedSocketOrigin, startServer, type RunningServer } from '../src/http';
import type { StatusResponse } from '../src/api';

describe('hostedSocketOrigin', () => {
  it('turns every accepted spelling into the WebSocket origin', () => {
    expect(hostedSocketOrigin('https://play.example.net')).toBe('wss://play.example.net');
    expect(hostedSocketOrigin('https://play.example.net/')).toBe('wss://play.example.net');
    expect(hostedSocketOrigin('wss://play.example.net:8443')).toBe('wss://play.example.net:8443');
    expect(hostedSocketOrigin('https://play.example.net/ws')).toBe('wss://play.example.net');
    expect(hostedSocketOrigin('  http://127.0.0.1:47700  ')).toBe('ws://127.0.0.1:47700');
    expect(hostedSocketOrigin('ws://localhost:47700/')).toBe('ws://localhost:47700');
    expect(hostedSocketOrigin('http://[::1]:47700')).toBe('ws://[::1]:47700');
  });

  it('means none for an empty or missing value', () => {
    expect(hostedSocketOrigin(undefined)).toBeNull();
    expect(hostedSocketOrigin(null)).toBeNull();
    expect(hostedSocketOrigin('')).toBeNull();
    expect(hostedSocketOrigin('   ')).toBeNull();
  });

  it('refuses what cannot be used, with a reason', () => {
    expect(() => hostedSocketOrigin('play.example.net')).toThrow(/Invalid hosted server address/);
    expect(() => hostedSocketOrigin('ftp://play.example.net')).toThrow(/https/);
    expect(() => hostedSocketOrigin('https://user:pw@play.example.net')).toThrow(/without a path, user name or query/);
    expect(() => hostedSocketOrigin('https://play.example.net/lobby')).toThrow(/without a path/);
    expect(() => hostedSocketOrigin('https://play.example.net/?x=1')).toThrow(/without a path/);
    // a server on another machine is encrypted or it is not used
    expect(() => hostedSocketOrigin('http://play.example.net')).toThrow(/https/);
    expect(() => hostedSocketOrigin('ws://192.0.2.7:47700')).toThrow(/unencrypted/);
  });
});

describe('Content-Security-Policy', () => {
  it('is what it was without a hosted server', () => {
    expect(contentSecurityPolicy()).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self';");
  });

  it('adds exactly the hosted WebSocket origin to connect-src', () => {
    const csp = contentSecurityPolicy('wss://play.example.net');
    expect(csp).toContain("connect-src 'self' wss://play.example.net;");
    // every other directive is untouched
    expect(csp.replace(' wss://play.example.net', '')).toBe(CONTENT_SECURITY_POLICY);
  });
});

describe('contextFrom', () => {
  const saved = process.env['OPENMTG_HOSTED_URL'];
  afterEach(() => {
    if (saved === undefined) delete process.env['OPENMTG_HOSTED_URL'];
    else process.env['OPENMTG_HOSTED_URL'] = saved;
  });

  it('reads the option, then OPENMTG_HOSTED_URL; null turns it off', () => {
    delete process.env['OPENMTG_HOSTED_URL'];
    expect(contextFrom({}).hostedUrl).toBeNull();
    process.env['OPENMTG_HOSTED_URL'] = 'https://env.example.net';
    expect(contextFrom({}).hostedUrl).toBe('wss://env.example.net');
    expect(contextFrom({ hostedUrl: 'http://127.0.0.1:1' }).hostedUrl).toBe('ws://127.0.0.1:1');
    expect(contextFrom({ hostedUrl: null }).hostedUrl).toBeNull();
  });

  it('throws on an address that cannot be used', () => {
    process.env['OPENMTG_HOSTED_URL'] = 'http://env.example.net';
    expect(() => contextFrom({})).toThrow(/Invalid hosted server address/);
  });
});

describe('a server with a hosted address', () => {
  let tmp: string;
  let hosted: RunningServer;
  let plain: RunningServer;

  beforeAll(async () => {
    delete process.env['OPENMTG_HOSTED_URL'];
    tmp = mkdtempSync(path.join(tmpdir(), 'openmtg-hosted-url-'));
    const cacheDir = path.join(tmp, 'scryfall');
    mkdirSync(cacheDir);
    hosted = await startServer({ port: 0, clientDist: null, cacheDir, version: '1.2.3', online: false, hostedUrl: 'http://127.0.0.1:47700' });
    plain = await startServer({ port: 0, clientDist: null, cacheDir, version: '1.2.3', online: false });
  });

  afterAll(async () => {
    await hosted.close();
    await plain.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('tells the page in /api/status, and sends the policy with the one extra origin on every answer', async () => {
    const r = await fetch(`${hosted.url}/api/status`);
    expect(((await r.json()) as StatusResponse).hostedUrl).toBe('ws://127.0.0.1:47700');
    expect(r.headers.get('content-security-policy')).toBe(contentSecurityPolicy('ws://127.0.0.1:47700'));
    const missing = await fetch(`${hosted.url}/nothing-here`);
    expect(missing.headers.get('content-security-policy')).toContain("connect-src 'self' ws://127.0.0.1:47700;");
  });

  it('a server without one has no hostedUrl field at all and the old policy', async () => {
    const r = await fetch(`${plain.url}/api/status`);
    expect(Object.keys((await r.json()) as object)).not.toContain('hostedUrl');
    expect(r.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
  });
});
