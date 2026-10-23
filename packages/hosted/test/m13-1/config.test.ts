/** Configuration parsing (design 10.1): defaults, strict refusals, secrets never echoed. */
import { describe, expect, it } from 'vitest';
import { clockFor, CONFIG_VARIABLES, DEFAULT_CLOCKS, describeConfig, GAME_LIMITS, httpsOrigin, parseConfig, type ConfigResult, type HostedConfig } from '@openmtg/hosted';

const ok = (r: ConfigResult): HostedConfig => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.config;
};
const errors = (r: ConfigResult): string[] => (r.ok ? [] : r.errors);
/** 32 random bytes as 64 hex digits, the only form LEDGER_SECRET and METRICS_TOKEN take (a fixed test value). */
const SECRET = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe('M13-1: parseConfig', () => {
  it('has safe defaults: 127.0.0.1, file store, desktop origins only, pods off, vCPUs - 1 workers, the design figures', () => {
    const c = ok(parseConfig({}, { cpus: 8 }));
    expect(c).toMatchObject({
      bind: '127.0.0.1', store: 'file', publicOrigins: [], allowDesktopOrigins: true, trustProxy: null, podsEnabled: false, workers: 7, deckWorkers: 1,
      capacityUnits: 900, capacityQueueMax: 300, capacityWaitMaxMinutes: 20, units: { two: 1, three: 4, four: 5 }, maxConnections: 5000, maxLobby: 400,
      maxListed: 300, outboundBudgetMb: 256, drainMaxMinutes: 250, logLevel: 'info', metricsPort: null, ledgerSecret: null, podThreeAfterSeconds: 90,
    });
    expect(c.retention).toEqual({ logsDays: 90, lobbyDays: 7, voidDays: 90, sessionDays: 30, serverLogDays: 14 });
    expect(c.clocks['1v1']).toEqual(DEFAULT_CLOCKS['1v1']);
    expect(c.formats).toHaveLength(11);
    expect(ok(parseConfig({}, { cpus: 1 })).workers).toBe(1);
    expect(c.drainMaxMinutes * 60_000).toBeGreaterThan(GAME_LIMITS.wallClockPodMs);
  });

  it('reads every variable it lists', () => {
    expect(CONFIG_VARIABLES).toContain('LEDGER_SECRET');
    expect(new Set(CONFIG_VARIABLES).size).toBe(CONFIG_VARIABLES.length);
  });

  it('a production-like environment', () => {
    const c = ok(parseConfig({
      BIND: '0.0.0.0', TRUST_PROXY: '172.18.0.2', PUBLIC_ORIGINS: 'https://play.digidice.net', ALLOW_DESKTOP_ORIGINS: '0', STORE: 'postgres',
      DATABASE_URL: 'postgres://svc:pw@db:5432/openmtg', LEDGER_SECRET: SECRET, METRICS_PORT: '9464', METRICS_TOKEN: SECRET, PODS_ENABLED: 'true',
      HOSTED_FORMATS: 'commander, pauper,commander', WORKERS: '7',
      CLOCK_DEFAULTS: JSON.stringify({ pod: { bankSeconds: 1500, delaySeconds: 5, dropSeconds: 300 }, formats: { vintage: { '1v1': { bankSeconds: 1200, delaySeconds: 10, dropSeconds: 300 } } } }),
    }, { cpus: 8 }));
    expect(c.publicOrigins).toEqual(['https://play.digidice.net']);
    expect(c.formats).toEqual(['commander', 'pauper']);
    expect(c.clocks.pod).toEqual({ bankMs: 1_500_000, delayMs: 5_000, dropMs: 300_000 });
    expect(clockFor(c.clocks, 'vintage', 2)).toEqual({ bankMs: 1_200_000, delayMs: 10_000, dropMs: 300_000 });
    expect(clockFor(c.clocks, 'commander', 4)).toEqual(c.clocks.pod);
    expect(clockFor(c.clocks, 'commander', 2)).toEqual(c.clocks['1v1']);
    const shown = JSON.stringify(describeConfig(c));
    expect(shown).not.toContain(SECRET);
    expect(shown).not.toContain('svc:pw');
    expect(describeConfig(c)).toMatchObject({ databaseUrl: '(set)', ledgerSecret: '(set)', metricsToken: '(set)' });
  });

  it('warns when the gateway binds a public address with no proxy in front', () => {
    const r = parseConfig({ BIND: '0.0.0.0' }, { cpus: 4 });
    expect(r.ok && r.warnings.join()).toMatch(/TRUST_PROXY/);
  });

  it('refuses bad values instead of defaulting (a fixed list)', () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ PORT: '0' }, /PORT/], [{ PORT: '70000' }, /PORT/], [{ PORT: '80a' }, /PORT/], [{ WORKERS: '-1' }, /WORKERS/],
      [{ BIND: 'localhost' }, /BIND/], [{ TRUST_PROXY: '10.0.0.0/8' }, /TRUST_PROXY/], [{ STORE: 'sqlite' }, /STORE/],
      [{ STORE: 'postgres', LEDGER_SECRET: SECRET }, /DATABASE_URL: required/], [{ STORE: 'postgres', DATABASE_URL: 'mysql://x' , LEDGER_SECRET: SECRET }, /DATABASE_URL/],
      [{ STORE: 'postgres', DATABASE_URL: 'postgres://x/y' }, /LEDGER_SECRET: required/], [{ LEDGER_SECRET: 'short' }, /LEDGER_SECRET: 32 random bytes as 64 hex/],
      [{ METRICS_PORT: '9464' }, /METRICS_TOKEN/], [{ METRICS_PORT: '9464', METRICS_TOKEN: 'short' }, /METRICS_TOKEN/],
      [{ METRICS_PORT: '8787', METRICS_TOKEN: SECRET }, /METRICS_PORT: must differ/],
      [{ PUBLIC_ORIGINS: 'http://play.digidice.net' }, /PUBLIC_ORIGINS/], [{ PUBLIC_ORIGINS: 'https://*.digidice.net' }, /PUBLIC_ORIGINS/],
      [{ PUBLIC_ORIGINS: 'https://play.digidice.net/' }, /PUBLIC_ORIGINS/], [{ PUBLIC_ORIGINS: 'https://play.digidice.net/ws' }, /PUBLIC_ORIGINS/],
      [{ PUBLIC_ORIGINS: 'null' }, /PUBLIC_ORIGINS/], [{ ALLOW_DESKTOP_ORIGINS: '0' }, /no browser could connect/], [{ ALLOW_DESKTOP_ORIGINS: 'yes' }, /ALLOW_DESKTOP/],
      [{ PODS_ENABLED: 'on' }, /PODS_ENABLED/], [{ HOSTED_FORMATS: 'standard,historic' }, /historic/], [{ HOSTED_FORMATS: ',' }, /no format/],
      [{ LOG_LEVEL: 'trace' }, /LOG_LEVEL/], [{ CLOCK_DEFAULTS: '{' }, /not JSON/], [{ CLOCK_DEFAULTS: '[]' }, /not a JSON object/],
      [{ CLOCK_DEFAULTS: '{"1v1":{"bankSeconds":5,"delaySeconds":5,"dropSeconds":300}}' }, /bankSeconds/],
      [{ CLOCK_DEFAULTS: '{"1v1":{"bankSeconds":900,"delaySeconds":5}}' }, /exactly/], [{ CLOCK_DEFAULTS: '{"blitz":{}}' }, /unknown key/],
      [{ CLOCK_DEFAULTS: '{"formats":{"historic":{}}}' }, /not a hosted format/], [{ CLOCK_DEFAULTS: 'x'.repeat(5000) }, /4 KB/],
      [{ UNITS_POD3: '9', UNITS_POD4: '5' }, /UNITS/], [{ CAPACITY_UNITS: '3', PODS_ENABLED: 'true' }, /smaller than one 4-player pod/],
      // (M13-10 review) the pods only count when they are offered; a 1v1 game must always fit
      [{ CAPACITY_UNITS: '1', UNITS_1V1: '2', UNITS_POD3: '4' }, /smaller than one 1v1 game/],
    ];
    for (const [env, want] of bad) {
      const e = errors(parseConfig(env, { cpus: 4 }));
      expect(e.join('\n'), JSON.stringify(env)).toMatch(want);
    }
  });

  it('LEDGER_SECRET and METRICS_TOKEN: 32 random bytes as 64 hex digits, nothing else', () => {
    expect(ok(parseConfig({ LEDGER_SECRET: SECRET.toUpperCase() }, { cpus: 4 })).ledgerSecret).toBe(SECRET.toUpperCase());
    const bad = [
      SECRET.slice(1), `${SECRET}0`, `${SECRET.slice(0, 63)}g`, 'correct horse battery staple, a long passphrase of 64 chars......', 'x'.repeat(64),
    ];
    for (const v of bad) {
      expect(errors(parseConfig({ LEDGER_SECRET: v }, { cpus: 4 })).join(), v).toMatch(/LEDGER_SECRET: 32 random bytes as 64 hex digits/);
      expect(errors(parseConfig({ METRICS_PORT: '9464', METRICS_TOKEN: v }, { cpus: 4 })).join(), v).toMatch(/METRICS_TOKEN: 32 random bytes as 64 hex digits/);
    }
    // a token set without a metrics port is still checked (no weak token waiting for a port)
    expect(errors(parseConfig({ METRICS_TOKEN: 'short' }, { cpus: 4 })).join()).toMatch(/METRICS_TOKEN/);
  });

  it('never repeats a secret in an error', () => {
    for (const env of [{ LEDGER_SECRET: 'tooShortSecretValue' }, { STORE: 'postgres', DATABASE_URL: 'mysql://user:tooShortSecretValue@h' }, { METRICS_PORT: '9', METRICS_TOKEN: 'tooShortSecretValue' }]) {
      const e = errors(parseConfig(env, { cpus: 4 }));
      expect(e.length).toBeGreaterThan(0);
      expect(e.join('\n')).not.toContain('tooShortSecretValue');
    }
  });

  it('httpsOrigin: exact origins only', () => {
    expect(httpsOrigin('https://play.digidice.net')).toBe('https://play.digidice.net');
    expect(httpsOrigin('https://play.digidice.net:8443')).toBe('https://play.digidice.net:8443');
    for (const s of ['https://PLAY.digidice.net', 'https://user@play.digidice.net', 'https://play.digidice.net?x', 'https://play.digidice.net#x', 'play.digidice.net', 'https://play.digidice.net:443']) {
      expect(httpsOrigin(s), s).toBeNull();
    }
  });
});
