/**
 * M14-3: the scrypt hasher (design 4.1, D5): the PHC round trip and its parameters; rehash detection (old parameters, a new pepper); peppers on and
 * off with their key ids, and the exact construction (scrypt of HMAC-SHA256(pepper, NFKC password)); NFKC (two encodings of "é" verify alike); the
 * comparison injected (opts.equal, a counting fake); the dummy path and every failing verify do the same work as a real verify (call counts, not a
 * stopwatch), and every failure takes as long as the slowest parameter set seen (a fake clock). Strings node:crypto's scrypt would refuse do not
 * parse. Real scrypt runs with ln 10 (1 MiB) or ln 15 at r = 1 (4 MiB) except one hash at the default parameters.
 */
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PasswordHasherOptions, Pepper } from '../../src/crypto/api';
import { buildPasswordHasher, scryptDerive, type Derive } from '../../src/crypto/hasher';
import { createPasswordHasher } from '../../src/crypto/index';
import { formatScryptPhc, parseScryptPhc, SCRYPT_BOUNDS, scryptMemory, SCRYPT_MAXMEM, scryptParamsOk } from '../../src/crypto/phc';
import { fixedRandom } from '../m14-1/support';

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && timingSafeEqual(a, b);
const P1: Pepper = { id: 'k2026a', secret: 'a pepper secret of at least thirty-two characters' };
const P2: Pepper = { id: 'k2026b', secret: 'another pepper secret, also thirty-two characters or more' };
const PW = 'correct horse battery staple';

function options(over: Partial<PasswordHasherOptions> = {}): PasswordHasherOptions {
  return { scrypt: { ln: 10, r: 8, p: 1 }, concurrency: 2, queue: 8, peppers: [], random: fixedRandom('m14-3 hasher'), equal, ...over };
}
const PRIO = { priority: 'normal' as const };

describe('M14-3: PHC strings', () => {
  it('round trip: format, parse, format gives the same string and the same parts', () => {
    const salt = new Uint8Array(16).map((_, i) => i * 7);
    const hash = new Uint8Array(32).map((_, i) => 255 - i);
    for (const pepper of [null, 'k1', 'Key_2026-x']) {
      const phc = formatScryptPhc({ params: { ln: 17, r: 8, p: 1 }, pepper, salt, hash });
      expect(phc).toMatch(pepper === null ? /^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/ : new RegExp(`^\\$scrypt\\$ln=17,r=8,p=1,k=${pepper}\\$`));
      const back = parseScryptPhc(phc)!;
      expect(back.params).toEqual({ ln: 17, r: 8, p: 1 });
      expect(back.pepper).toBe(pepper);
      expect([...back.salt]).toEqual([...salt]);
      expect([...back.hash]).toEqual([...hash]);
      expect(formatScryptPhc(back)).toBe(phc);
    }
    expect(parseScryptPhc(`$scrypt$ln=16,r=8,p=2$${'A'.repeat(22)}$${'A'.repeat(43)}`)!.params).toEqual({ ln: 16, r: 8, p: 2 });
  });

  it('refuses anything else (null, never a throw)', () => {
    const s = 'A'.repeat(22), h = 'A'.repeat(43);
    const bad: unknown[] = [
      undefined, null, 42, {}, '', `$argon2id$v=19$m=65536,t=3,p=4$${s}$${h}`, `$scrypt$ln=17,r=8,p=1$${s}`, `$scrypt$ln=17,r=8$${s}$${h}`,
      `$scrypt$r=8,ln=17,p=1$${s}$${h}`, `$scrypt$ln=9,r=8,p=1$${s}$${h}`, `$scrypt$ln=21,r=8,p=1$${s}$${h}`, `$scrypt$ln=17,r=0,p=1$${s}$${h}`,
      `$scrypt$ln=17,r=33,p=1$${s}$${h}`, `$scrypt$ln=17,r=8,p=17$${s}$${h}`, `$scrypt$ln=20,r=16,p=1$${s}$${h}`, `$scrypt$ln=017,r=8,p=1$${s}$${h}`,
      `$scrypt$ln=17,r=8,p=1,k=$${s}$${h}`, `$scrypt$ln=17,r=8,p=1,k=a.b$${s}$${h}`, `$scrypt$ln=17,r=8,p=1,x=1$${s}$${h}`,
      `$scrypt$ln=17,r=8,p=1$${s}==$${h}`, `$scrypt$ln=17,r=8,p=1$${'A'.repeat(21)}B$${h}`, `$scrypt$ln=17,r=8,p=1$AAAA$${h}`,
      `$scrypt$ln=17,r=8,p=1$${s}$${h}$`, ` $scrypt$ln=17,r=8,p=1$${s}$${h}`, `$scrypt$ln=17,r=8,p=1$${s}$${h}\n`, `$scrypt$ln=17,r=8,p=1$${s}$${'A'.repeat(300)}`,
      // inside the bounds, but node:crypto's scrypt refuses them (OpenSSL: N < 2^(16 r)); review of M14-3
      `$scrypt$ln=17,r=1,p=1$${s}$${h}`, `$scrypt$ln=16,r=1,p=1$${s}$${h}`, `$scrypt$ln=20,r=1,p=16$${s}$${h}`,
    ];
    for (const x of bad) expect(parseScryptPhc(x), String(x)).toBeNull();
    expect(parseScryptPhc(`$scrypt$ln=15,r=1,p=1$${s}$${h}`)!.params).toEqual({ ln: 15, r: 1, p: 1 });
    expect(parseScryptPhc(`$scrypt$ln=20,r=2,p=1$${s}$${h}`)).toBeNull(); // 256 MiB and more
  });

  it('a string that parses is one node:crypto\'s scrypt accepts; one it refuses is answered "wrong" after the dummy\'s work (review of M14-3)', async () => {
    const input = Buffer.from(PW);
    const salt = new Uint8Array(16).fill(1);
    // OpenSSL's rule at r = 1: ln 15 derives, ln 16 throws
    expect(scryptParamsOk({ ln: 15, r: 1, p: 1 })).toBe(true);
    expect(await scryptDerive(input, salt, { ln: 15, r: 1, p: 1 }, 32)).toHaveLength(32);
    expect(scryptParamsOk({ ln: 16, r: 1, p: 1 })).toBe(false);
    await expect(scryptDerive(input, salt, { ln: 16, r: 1, p: 1 }, 32)).rejects.toThrow(RangeError);
    // such a stored string (corruption, a manual edit) used to make verify reject with node's RangeError, fast
    const hasher = buildPasswordHasher(options());
    const stored = formatScryptPhc({ params: { ln: 17, r: 1, p: 1 }, pepper: null, salt, hash: new Uint8Array(32).fill(2) });
    expect(stored).toMatch(/^\$scrypt\$ln=17,r=1,p=1\$/);
    expect(await hasher.verify(stored, PW, PRIO)).toEqual({ ok: false, needsRehash: false });
  });

  it('bounds: every configurable choice fits node:crypto\'s memory ceiling', () => {
    expect(scryptMemory({ ln: 17, r: 8, p: 1 })).toBeLessThan(SCRYPT_MAXMEM);
    expect(scryptMemory({ ln: 16, r: 8, p: 2 })).toBeLessThan(SCRYPT_MAXMEM);
    expect(scryptMemory({ ln: SCRYPT_BOUNDS.lnMax, r: 8, p: 1 })).toBeGreaterThanOrEqual(SCRYPT_MAXMEM);
  });
});

describe('M14-3: hashing and verifying', () => {
  it('the default parameters (N = 2^17, r = 8, p = 1) hash and verify with real scrypt', async () => {
    const hasher = createPasswordHasher(options({ scrypt: { ln: 17, r: 8, p: 1 } }));
    const phc = await hasher.hash(PW, PRIO);
    expect(phc).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(await hasher.verify(phc, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
  }, 30_000);

  it('a right password verifies, a wrong one does not; salts are random, so two hashes of one password differ', async () => {
    const hasher = buildPasswordHasher(options());
    const a = await hasher.hash(PW, PRIO);
    const b = await hasher.hash(PW, PRIO);
    expect(a).not.toBe(b);
    expect(await hasher.verify(a, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
    expect(await hasher.verify(b, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
    for (const wrong of ['correct horse battery stapl', 'Correct horse battery staple', `${PW} `, '']) {
      expect(await hasher.verify(a, wrong, PRIO), wrong).toEqual({ ok: false, needsRehash: false });
    }
  });

  it('the stored key is scrypt of the NFKC password as UTF-8, or of HMAC-SHA256(pepper, it), with the string\'s salt', async () => {
    const pw = 'ｐａｓｓ phrase é';
    const plain = parseScryptPhc(await buildPasswordHasher(options()).hash(pw, PRIO))!;
    expect(plain.pepper).toBeNull();
    const nfkc = Buffer.from(pw.normalize('NFKC'), 'utf8');
    expect(Buffer.from(plain.hash).equals(scryptSync(nfkc, plain.salt, 32, { N: 1024, r: 8, p: 1 }))).toBe(true);
    const peppered = parseScryptPhc(await buildPasswordHasher(options({ peppers: [P1] })).hash(pw, PRIO))!;
    expect(peppered.pepper).toBe(P1.id);
    const input = createHmac('sha256', P1.secret).update(nfkc).digest();
    expect(Buffer.from(peppered.hash).equals(scryptSync(input, peppered.salt, 32, { N: 1024, r: 8, p: 1 }))).toBe(true);
    expect(plain.salt).toHaveLength(16);
    expect(plain.hash).toHaveLength(32);
  });

  it('NFKC: two encodings of "é" (and full-width letters) verify alike', async () => {
    const hasher = buildPasswordHasher(options());
    const composed = 'café au lait, s’il vous plaît';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const phc = await hasher.hash(composed, PRIO);
    expect(await hasher.verify(phc, decomposed, PRIO)).toEqual({ ok: true, needsRehash: false });
    const wide = await hasher.hash('ＰＡＳＳＷＯＲＤ　ＯＮＥ', PRIO);
    expect(await hasher.verify(wide, 'PASSWORD ONE', PRIO)).toEqual({ ok: true, needsRehash: false });
  });

  it('peppers on and off, with key ids: new hashes use the newest; a hash under an older pepper verifies and asks for a rehash', async () => {
    const off = buildPasswordHasher(options());
    const one = buildPasswordHasher(options({ peppers: [P1] }));
    const two = buildPasswordHasher(options({ peppers: [P1, P2] }));
    const only2 = buildPasswordHasher(options({ peppers: [P2] }));
    const h0 = await off.hash(PW, PRIO);
    const h1 = await one.hash(PW, PRIO);
    const h2 = await two.hash(PW, PRIO);
    expect(h0).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$/);
    expect(h1).toMatch(/^\$scrypt\$ln=10,r=8,p=1,k=k2026a\$/);
    expect(h2).toMatch(/^\$scrypt\$ln=10,r=8,p=1,k=k2026b\$/);
    // off: its own hashes; a peppered hash cannot be checked without its pepper
    expect(await off.verify(h0, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
    expect(await off.verify(h1, PW, PRIO)).toEqual({ ok: false, needsRehash: false });
    // one pepper: an unpeppered hash verifies and asks for a rehash (a pepper was added)
    expect(await one.verify(h0, PW, PRIO)).toEqual({ ok: true, needsRehash: true });
    expect(await one.verify(h1, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
    // two peppers, newest last: the older one still verifies and asks for a rehash (a new pepper)
    expect(await two.verify(h1, PW, PRIO)).toEqual({ ok: true, needsRehash: true });
    expect(await two.verify(h2, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
    // a lost pepper: the password cannot be checked (4.1)
    expect(await only2.verify(h1, PW, PRIO)).toEqual({ ok: false, needsRehash: false });
    // a wrong password never asks for a rehash
    expect(await two.verify(h1, 'not the password at all', PRIO)).toEqual({ ok: false, needsRehash: false });
    // the pepper changes the key: the same salt (the same random source) gives another hash
    const sameSalt = (peppers: Pepper[]) => buildPasswordHasher(options({ peppers, random: fixedRandom('one salt') })).hash(PW, PRIO);
    const [x, y] = [parseScryptPhc(await sameSalt([]))!, parseScryptPhc(await sameSalt([P1]))!];
    expect([...x.salt]).toEqual([...y.salt]);
    expect([...x.hash]).not.toEqual([...y.hash]);
  });

  it('rehash detection: older parameters verify and ask for a rehash; the same parameters do not', async () => {
    const old = buildPasswordHasher(options({ scrypt: { ln: 10, r: 8, p: 1 } }));
    const now = buildPasswordHasher(options({ scrypt: { ln: 11, r: 8, p: 1 } }));
    const otherP = buildPasswordHasher(options({ scrypt: { ln: 10, r: 8, p: 2 } }));
    const h = await old.hash(PW, PRIO);
    expect(await now.verify(h, PW, PRIO)).toEqual({ ok: true, needsRehash: true });
    expect(await otherP.verify(h, PW, PRIO)).toEqual({ ok: true, needsRehash: true });
    expect(await old.verify(h, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
    const fresh = await now.hash(PW, PRIO);
    expect(fresh).toMatch(/^\$scrypt\$ln=11,r=8,p=1\$/);
    expect(await now.verify(fresh, PW, PRIO)).toEqual({ ok: true, needsRehash: false });
    // a valid string with a shorter key than new hashes get (a 16-byte key) still verifies, and asks for a rehash
    const salt = new Uint8Array(16).fill(3);
    const short = formatScryptPhc({
      params: { ln: 11, r: 8, p: 1 }, pepper: null, salt, hash: new Uint8Array(scryptSync(Buffer.from(PW), salt, 16, { N: 2048, r: 8, p: 1 })),
    });
    expect(await now.verify(short, PW, PRIO)).toEqual({ ok: true, needsRehash: true });
  });

  it('hashes only a string of at most 512 UTF-16 units; verify answers anything else "wrong"', async () => {
    const hasher = buildPasswordHasher(options());
    await expect(hasher.hash(undefined as unknown as string, PRIO)).rejects.toThrow(TypeError);
    await expect(hasher.hash('x'.repeat(513), PRIO)).rejects.toThrow(TypeError);
    const long = await hasher.hash('xy'.repeat(256), PRIO);
    expect(await hasher.verify(long, 'xy'.repeat(256), PRIO)).toEqual({ ok: true, needsRehash: false });
    expect(await hasher.verify(long, `${'xy'.repeat(256)}x`, PRIO)).toEqual({ ok: false, needsRehash: false });
    expect(await hasher.verify(long, null as unknown as string, PRIO)).toEqual({ ok: false, needsRehash: false });
  });

  it('refuses unusable options', () => {
    expect(() => buildPasswordHasher(options({ scrypt: { ln: 9, r: 8, p: 1 } }))).toThrow(RangeError);
    expect(() => buildPasswordHasher(options({ scrypt: { ln: 20, r: 8, p: 1 } }))).toThrow(RangeError);
    expect(() => buildPasswordHasher(options({ peppers: [P1, { ...P2, id: P1.id }] }))).toThrow(RangeError);
    expect(() => buildPasswordHasher(options({ peppers: [{ id: 'bad id', secret: P1.secret }] }))).toThrow(RangeError);
    expect(() => buildPasswordHasher(options({ peppers: [{ id: 'k', secret: '' }] }))).toThrow(RangeError);
    expect(() => buildPasswordHasher(options({ concurrency: 0 }))).toThrow(RangeError);
  });
});

describe('M14-3: the same work on every path (counted, not timed)', () => {
  /** A fake key derivation that records its calls, and a comparison that counts its calls. */
  function counting(peppers: Pepper[] = []) {
    const derives: { inputLength: number; params: string; keyLength: number }[] = [];
    let equals = 0;
    const derive: Derive = async (input, salt, params, keyLength) => {
      derives.push({ inputLength: input.length, params: `${params.ln},${params.r},${params.p}`, keyLength });
      return new Uint8Array(keyLength).fill(input[0]! ^ salt[0]!);
    };
    const hasher = buildPasswordHasher(
      options({ peppers, equal: (a, b) => (equals++, equal(a, b)) }),
      { derive },
    );
    return { hasher, derives, equals: () => equals, reset: () => ((derives.length = 0), (equals = 0)) };
  }

  it('verify, dummy, a malformed string and a lost pepper: one derivation with the current parameters and one injected comparison each', async () => {
    for (const peppers of [[], [P1]]) {
      const c = counting(peppers);
      const phc = await c.hasher.hash(PW, PRIO);
      expect(c.equals()).toBe(0); // hashing compares nothing
      c.reset();
      await c.hasher.verify(phc, PW, PRIO);
      const real = { derives: [...c.derives], equals: c.equals() };
      expect(real.equals).toBe(1);
      expect(real.derives).toHaveLength(1);
      // with a pepper the input is HMAC-SHA256's 32 bytes, else the password's UTF-8
      expect(real.derives[0]!.inputLength).toBe(peppers.length > 0 ? 32 : Buffer.byteLength(PW));
      const cases: [string, () => Promise<unknown>][] = [
        ['wrong password', () => c.hasher.verify(phc, `${PW}!`.slice(1), PRIO)],
        ['dummy', () => c.hasher.dummy(PW, PRIO)],
        ['malformed', () => c.hasher.verify('$scrypt$nonsense', PW, PRIO)],
        ['not a string', () => c.hasher.verify(phc, 42 as unknown as string, PRIO)],
        ['too long', () => c.hasher.verify(phc, 'x'.repeat(513), PRIO)],
        ['stored value not a string', () => c.hasher.verify(42 as unknown as string, PW, PRIO)],
        ['lost pepper', () => c.hasher.verify(phc.replace(/\$ln=10,r=8,p=1(,k=[^$]+)?\$/, '$ln=10,r=8,p=1,k=gone$'), PW, PRIO)],
      ];
      for (const [label, run] of cases) {
        c.reset();
        await run();
        expect(c.equals(), `${label} (${peppers.length} peppers)`).toBe(1);
        expect(c.derives, label).toHaveLength(1);
        expect(c.derives[0]!.params, label).toBe('10,8,1');
        expect(c.derives[0]!.keyLength, label).toBe(32);
        const typed = label === 'not a string' || label === 'too long' ? '' : PW; // a password no hash can hold is checked as the empty one
        if (label !== 'wrong password') expect(c.derives[0]!.inputLength, label).toBe(peppers.length > 0 ? 32 : Buffer.byteLength(typed));
      }
    }
  });

  describe('every failure takes as long as the slowest parameter set seen (review of M14-3: after a SCRYPT_LN switch)', () => {
    /** A fake clock: a derivation costs what its parameters cost, a sleep moves the clock on. */
    function clocked(scrypt: { ln: number; r: number; p: number }) {
      const cost: Record<string, number> = { '17,8,1': 470, '16,8,2': 430, '17,8,16': 7_000 };
      let clock = 0;
      const derived: string[] = [];
      const slept: number[] = [];
      const derive: Derive = async (_input, _salt, p, keyLength) => {
        const k = `${p.ln},${p.r},${p.p}`;
        derived.push(k);
        clock += cost[k]!;
        return new Uint8Array(keyLength); // all zero: a stored hash of zeros "matches", any other does not
      };
      const sleep = async (ms: number) => {
        slept.push(ms);
        clock += ms;
      };
      const hasher = buildPasswordHasher(options({ scrypt }), { derive, now: () => clock, sleep });
      const timeOf = async (run: () => Promise<unknown>): Promise<number> => {
        const t0 = clock;
        await run();
        return clock - t0;
      };
      return { hasher, derived, slept, timeOf };
    }
    const stored = (params: { ln: number; r: number; p: number }, fill: number) =>
      formatScryptPhc({ params, pepper: null, salt: new Uint8Array(16).fill(5), hash: new Uint8Array(32).fill(fill) });
    const OLD = { ln: 16, r: 8, p: 2 }, NEW = { ln: 17, r: 8, p: 1 };

    it('a string with faster old parameters fails in the dummy\'s time, though the derivations differ', async () => {
      const c = clocked(NEW);
      expect(await c.timeOf(() => c.hasher.dummy(PW, PRIO))).toBe(470);
      expect(await c.timeOf(() => c.hasher.verify(stored(OLD, 9), PW, PRIO))).toBe(470); // 430 of scrypt, 40 of waiting
      expect(await c.timeOf(() => c.hasher.dummy(PW, PRIO))).toBe(470);
      expect(await c.timeOf(() => c.hasher.verify(stored(NEW, 9), PW, PRIO))).toBe(470);
      // the work itself differs: verify derives with the string's parameters, the dummy with the current ones (the timer closes the gap)
      expect(c.derived).toEqual(['17,8,1', '16,8,2', '17,8,1', '17,8,1']);
      expect(c.slept).toEqual([40]);
      // a right password is never padded (and asks for a rehash)
      expect(await c.timeOf(async () => expect(await c.hasher.verify(stored(OLD, 0), PW, PRIO)).toEqual({ ok: true, needsRehash: true }))).toBe(430);
    });

    it('with slower old parameters, the dummy and current strings wait for them once one was seen', async () => {
      const c = clocked(OLD);
      // nothing measured for the old parameters yet: the first failure on such a string shows them (one sample after a start)
      expect(await c.timeOf(() => c.hasher.dummy(PW, PRIO))).toBe(430);
      expect(await c.timeOf(() => c.hasher.verify(stored(NEW, 9), PW, PRIO))).toBe(470);
      expect(await c.timeOf(() => c.hasher.dummy(PW, PRIO))).toBe(470);
      expect(await c.timeOf(() => c.hasher.verify(stored(OLD, 9), PW, PRIO))).toBe(470);
      expect(await c.timeOf(() => c.hasher.verify('$scrypt$nonsense', PW, PRIO))).toBe(470);
      expect(await c.timeOf(() => c.hasher.verify(stored(NEW, 9), 42 as unknown as string, PRIO))).toBe(470);
      expect(await c.timeOf(async () => expect(await c.hasher.verify(stored(OLD, 0), PW, PRIO)).toEqual({ ok: true, needsRehash: false }))).toBe(430);
    });

    it('one costly string cannot slow every failure down past twice the current parameters\' time', async () => {
      const c = clocked(NEW);
      await c.hasher.dummy(PW, PRIO);
      expect(await c.timeOf(() => c.hasher.verify(stored({ ln: 17, r: 8, p: 16 }, 9), PW, PRIO))).toBe(7_000);
      expect(await c.timeOf(() => c.hasher.dummy(PW, PRIO))).toBe(2 * 470);
    });
  });

  it('dummy answers nothing and never matches; verify uses the injected comparison for its answer', async () => {
    const c = counting();
    expect(await c.hasher.dummy(PW, PRIO)).toBeUndefined();
    // a comparison that always says "equal" makes a wrong password pass: verify's answer is the injected comparison's
    const always = buildPasswordHasher(options({ equal: () => true }));
    const phc = await always.hash(PW, PRIO);
    expect((await always.verify(phc, 'anything else entirely', PRIO)).ok).toBe(true);
  });
});
