// The container's health probe (design 10.2; package M13-14): `node src/obs/probe.mjs healthz|readyz|metrics [--print]`.
//
//   healthz   GET /healthz on the gateway's port: the process and its main event loop answer (the image's HEALTHCHECK).
//   readyz    GET /readyz: storage reachable, every worker answers a ping, not draining (the compose file's healthcheck, `depends_on`).
//   metrics   GET /metrics on METRICS_PORT with `Authorization: Bearer METRICS_TOKEN` (from the environment; the token is never printed).
//
// Exit code 0: the answer was 200. 1: the server answered with another status. 2: no answer (nothing listens, a timeout), or the command line or the
// environment cannot name a target. One line on stderr says which; with `--print` the body of a 200 goes to stdout. Plain JavaScript with no
// dependency, so it runs in the image without the TypeScript loader and starts in a few milliseconds. It reads the same variables as the server
// (`PORT`, `BIND`, `METRICS_PORT`, `METRICS_TOKEN`) and only ever talks to this container's own listeners.
import { isIP } from 'node:net';
import { get as httpGet } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROBE_KINDS = ['healthz', 'readyz', 'metrics'];
/** How long a probe waits for an answer, and the most of a body it reads. */
export const PROBE_TIMEOUT_MS = 3_000;
export const PROBE_BODY_MAX = 4 * 1024 * 1024;

/** The listener's own address: `BIND` when it is one address, else this machine's loopback (a wildcard bind answers there too). */
export function hostOf(env) {
  const bind = (env.BIND ?? '').trim();
  return isIP(bind) !== 0 && bind !== '0.0.0.0' && bind !== '::' ? bind : '127.0.0.1';
}

function portOf(value, dflt) {
  const v = (value ?? '').trim();
  if (v === '') return dflt;
  return /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65_535 ? Number(v) : null;
}

/** What to request for `kind`: `{ host, port, path, headers }`, or `{ problem }` when the environment does not say. */
export function targetOf(kind, env) {
  if (!PROBE_KINDS.includes(kind)) return { problem: `unknown probe ${JSON.stringify(kind)} (${PROBE_KINDS.join(', ')})` };
  const host = hostOf(env);
  if (kind === 'metrics') {
    const port = portOf(env.METRICS_PORT, null);
    const token = (env.METRICS_TOKEN ?? '').trim();
    if (port === null) return { problem: 'METRICS_PORT is not set to a port' };
    if (token === '') return { problem: 'METRICS_TOKEN is not set' };
    return { host, port, path: '/metrics', headers: { Authorization: `Bearer ${token}` } };
  }
  const port = portOf(env.PORT, 8787);
  if (port === null) return { problem: 'PORT is not a port' };
  return { host, port, path: kind === 'healthz' ? '/healthz' : '/readyz', headers: {} };
}

/**
 * Asks the listener `kind` names. Resolves `{ code, status, body, problem }`: code 0 for a 200, 1 for another status, 2 for no answer or a target that
 * cannot be named. `get` is `http.get` (tests pass their own).
 */
export function probe(kind, env, get = httpGet) {
  const target = targetOf(kind, env);
  if (target.problem) return Promise.resolve({ code: 2, status: null, body: '', problem: target.problem });
  return new Promise((done) => {
    let finished = false;
    const finish = (r) => {
      if (finished) return;
      finished = true;
      done(r);
    };
    try {
      const req = get({ host: target.host, port: target.port, path: target.path, headers: target.headers, timeout: PROBE_TIMEOUT_MS, agent: false }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > PROBE_BODY_MAX) {
            res.destroy();
            finish({ code: 2, status: res.statusCode ?? null, body: '', problem: 'the answer is longer than the probe reads' });
          } else chunks.push(c);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          finish({ code: status === 200 ? 0 : 1, status, body: Buffer.concat(chunks).toString('utf8'), problem: null });
        });
        res.on('error', () => finish({ code: 2, status: res.statusCode ?? null, body: '', problem: 'the connection broke' }));
      });
      req.on('timeout', () => {
        req.destroy();
        finish({ code: 2, status: null, body: '', problem: `no answer in ${PROBE_TIMEOUT_MS} ms` });
      });
      req.on('error', (e) => finish({ code: 2, status: null, body: '', problem: `${e.code ?? e.name}: nothing answers on ${target.host}:${target.port}` }));
    } catch (e) {
      finish({ code: 2, status: null, body: '', problem: e instanceof Error ? e.name : 'error' });
    }
  });
}

/** The command line: returns the exit code. */
export async function main(argv, env, io = {}) {
  const out = io.out ?? ((t) => process.stdout.write(t));
  const err = io.err ?? ((t) => process.stderr.write(`${t}\n`));
  const print = argv.includes('--print');
  const words = argv.filter((a) => !a.startsWith('--'));
  if (words.length !== 1 || argv.some((a) => a.startsWith('--') && a !== '--print')) {
    err(`usage: node probe.mjs ${PROBE_KINDS.join('|')} [--print]`);
    return 2;
  }
  const kind = words[0];
  const r = await probe(kind, env, io.get);
  if (r.code === 0) {
    if (print) out(r.body);
    return 0;
  }
  // The body of /healthz and /readyz is small JSON that names no secret; the metrics' answer is not echoed.
  err(r.problem ? `${kind}: ${r.problem}` : `${kind}: HTTP ${r.status}${kind === 'metrics' ? '' : ` ${r.body.slice(0, 200)}`}`);
  return r.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
