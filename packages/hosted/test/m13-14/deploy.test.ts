/**
 * M13-14: the deployment files say what design 10.1 and 11 ask, read as text (Docker is not needed to run this): the image runs as a non-root user with
 * nothing secret in it; the development stack publishes only the proxy, on 127.0.0.1, runs the server read-only behind it, and takes every secret from
 * the environment; the proxy routes only the WebSocket path; `.env.example` names every setting the server reads and fills in no secret.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG_VARIABLES, SECRET_VARIABLES } from '../../src/config';

const here = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const text = (p: string) => readFile(here(p), 'utf8');

/** The services of the compose file and their own lines (a plain reading of its two-space layout: no YAML parser in the dependencies). */
function services(yml: string): Map<string, string> {
  const body = yml.split(/^services:\s*$/m)[1] ?? '';
  const out = new Map<string, string>();
  for (const part of body.split(/^ {2}(?=[a-z][a-z0-9-]*:\s*$)/m)) {
    const name = /^([a-z][a-z0-9-]*):/.exec(part)?.[1];
    if (name) out.set(name, part);
  }
  return out;
}

describe('M13-14 the image', () => {
  it('Node 24 slim, dependencies from the lockfile without install scripts, non-root, the health check, no secret', async () => {
    const d = await text('Dockerfile');
    expect(d).toMatch(/node:24-[a-z]+-slim/);
    expect(d).toMatch(/npm ci --ignore-scripts/);
    expect(d).toMatch(/^USER node$/m);
    expect(d).toMatch(/^HEALTHCHECK .*probe\.mjs", "healthz"/m);
    expect(d).toMatch(/^CMD \["node", "--import", "tsx", "packages\/hosted\/src\/main\.ts"\]$/m);
    for (const v of [...SECRET_VARIABLES, 'POSTGRES_PASSWORD', 'OPENMTG_SERVICE_PASSWORD']) expect(d, v).not.toMatch(new RegExp(`(ENV|ARG)[^\\n]*\\b${v}\\b`));
    // the card index is mounted, never copied in
    expect(d).not.toMatch(/COPY[^\n]*\.cache/);
    const ignore = await text('Dockerfile.dockerignore');
    for (const p of ['**/node_modules', '**/.cache', '.env', '.git']) expect(ignore, p).toContain(p);
  });
});

describe('M13-14 the development stack', () => {
  it('only Caddy publishes a port, and only on 127.0.0.1', async () => {
    const s = services(await text('docker-compose.dev.yml'));
    expect([...s.keys()].sort()).toEqual(['caddy', 'hosted', 'postgres']);
    for (const [name, body] of s) {
      const ports = /\n {4}ports:\n((?: {6}- .*\n)+)/.exec(body)?.[1] ?? '';
      if (name === 'caddy') expect(ports.trim().split('\n').every((l) => /- "127\.0\.0\.1:/.test(l))).toBe(true);
      else expect(ports, name).toBe('');
      expect(body, name).not.toMatch(/\n {4}expose:/);
    }
  });

  it('the server runs read-only, trusts only the proxy\'s fixed address, and takes every secret from the environment', async () => {
    const yml = await text('docker-compose.dev.yml');
    const hosted = services(yml).get('hosted')!;
    expect(hosted).toMatch(/\n {4}read_only: true/);
    expect(hosted).toMatch(/\n {6}- \/tmp/);
    const proxy = /caddy:[\s\S]*?ipv4_address: (\S+)/.exec(yml)?.[1];
    expect(hosted).toContain(`TRUST_PROXY: ${proxy}`);
    expect(hosted).toMatch(/STORE: postgres/);
    for (const v of ['LEDGER_SECRET', 'METRICS_TOKEN', 'OPENMTG_SERVICE_PASSWORD']) expect(hosted, v).toMatch(new RegExp(`\\$\\{${v}:\\?`));
    expect(services(yml).get('postgres')).toMatch(/POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
    // the server connects as the service role, never as the schema's owner
    expect(hosted).toMatch(/DATABASE_URL: postgres:\/\/openmtg_service:/);
    expect(hosted).not.toMatch(/openmtg_owner/);
  });

  it('the proxy routes the WebSocket path only; the metrics and health listeners stay unrouted', async () => {
    // what Caddy reads: the comments are notes for the reader
    const caddy = (await text('deploy/Caddyfile')).replace(/^\s*#.*$/gm, '');
    const routes = [...caddy.matchAll(/reverse_proxy\s+(\S+)/g)].map((m) => m[1]);
    expect(routes).toEqual(['hosted:8787']);
    expect(caddy).toMatch(/handle \/ws \{\s*reverse_proxy hosted:8787\s*\}/);
    expect(caddy).not.toMatch(/9464|metrics/);
    expect(caddy).toMatch(/tls internal/);
  });

  it('the service role is made by the first start with its password from the environment and no right to change the schema', async () => {
    const init = await text('deploy/postgres-init.sh');
    expect(init).toMatch(/CREATE ROLE openmtg_service LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE/);
    expect(init).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
    expect(init).not.toMatch(/PASSWORD '[^:]/);
  });
});

describe('M13-14 .env.example', () => {
  it('names every setting the server reads, and fills in no secret', async () => {
    const env = await text('.env.example');
    for (const v of CONFIG_VARIABLES) {
      if (v === 'DATABASE_URL') continue;
      expect(env, v).toMatch(new RegExp(`^#? ?${v}=`, 'm'));
    }
    for (const v of [...SECRET_VARIABLES, 'POSTGRES_PASSWORD', 'OPENMTG_SERVICE_PASSWORD']) {
      const set = new RegExp(`^${v}=(.*)$`, 'm').exec(env);
      if (set) expect(set[1], v).toBe('');
    }
    expect(env).toMatch(/openssl rand -hex 32/);
  });
});
