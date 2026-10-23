/**
 * M14-3: recovery codes (design 4.4): 10 distinct, 80 random bits each, the alphabet and look-alike map of net's join codes, the hash bound to the
 * account id; every unused slot compared with the injected comparison (CryptoDeps.equal, a counting fake), no early exit; device proofs and tokens:
 * 64 hex digits, only their SHA-256 kept (5.1, 8.3); the factories under their fixed names.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LIMITS, CONFIRM_CODE, formatRecoveryCode, isAccountToken, normalizeRecoveryCode, type AccountId,
} from '../../src/api';
import { RECOVERY_ALPHABET, recoveryCodeFromBytes } from '../../src/api/passwords';
import { builtFactories, constantTimeEqual } from '../../src/compose';
import type { CryptoDeps } from '../../src/crypto/api';
import { createCredentialTools, createPasswordHasher } from '../../src/crypto/index';
import { findRecoverySlot, recoveryCodeRows } from '../../src/crypto/recovery';
import { RECOVERY_HASH_PREFIX } from '../../src/crypto/tools';
import { tokenHash } from '../../src/ids';
import { constantRandom, fixedRandom } from '../m14-1/support';

const ALICE = 'acc_01ARYZ6S41TSV4RRFFQ69G5FAV' as AccountId;
const BOB = 'acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ' as AccountId;

function deps(over: Partial<CryptoDeps> = {}): CryptoDeps {
  return { random: fixedRandom('m14-3 codes'), equal: constantTimeEqual, peppers: [], passwordMin: 12, ...over };
}

/** The 80 bits a code stands for (each character 5 bits), as 10 bytes. */
function decode(code: string): number[] {
  let acc = 0n;
  for (const ch of code) acc = (acc << 5n) | BigInt(RECOVERY_ALPHABET.indexOf(ch));
  const out: number[] = [];
  for (let i = 9; i >= 0; i--) out.push(Number((acc >> BigInt(8 * i)) & 0xffn));
  return out;
}

describe('M14-3: recovery codes', () => {
  it('10 distinct codes of 16 characters, each 80 random bits (10 bytes of the random source)', () => {
    const draws: Uint8Array[] = [];
    const random = fixedRandom('m14-3 draws');
    const tools = createCredentialTools(deps({ random: (n) => {
      const b = random(n);
      draws.push(b);
      return b;
    } }));
    const codes = tools.newRecoveryCodes();
    expect(codes).toHaveLength(ACCOUNT_LIMITS.recoveryCodes);
    expect(new Set(codes).size).toBe(10);
    expect(draws.map((d) => d.length)).toEqual(new Array(10).fill(10));
    codes.forEach((code, i) => {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
      expect(normalizeRecoveryCode(code)).toBe(code);
      expect(decode(code)).toEqual([...draws[i]!]);
    });
    // the same source gives the same codes (fixed inputs); another gives others
    expect(createCredentialTools(deps({ random: fixedRandom('m14-3 draws') })).newRecoveryCodes()).toEqual(codes);
    expect(createCredentialTools(deps({ random: fixedRandom('another') })).newRecoveryCodes()).not.toEqual(codes);
  });

  it('the alphabet: 5 bits a character, most significant first, as net\'s join codes', () => {
    expect(RECOVERY_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(recoveryCodeFromBytes(new Uint8Array(10))).toBe('0'.repeat(16));
    expect(recoveryCodeFromBytes(new Uint8Array(10).fill(255))).toBe('Z'.repeat(16));
    expect(recoveryCodeFromBytes(Uint8Array.from([0x08, 0x42, 0x10, 0x84, 0x21, 0x08, 0x42, 0x10, 0x84, 0x21]))).toBe('1'.repeat(16));
    expect(() => recoveryCodeFromBytes(new Uint8Array(9))).toThrow(RangeError);
  });

  it('a source that repeats itself: a duplicate is drawn again; one that never changes gives up', () => {
    const seq = fixedRandom('m14-3 dup');
    let calls = 0;
    const first = seq(10);
    // the first two draws are the same 10 bytes, the rest fresh
    const random = (n: number) => (calls++ < 2 ? first.slice() : seq(n));
    const codes = createCredentialTools(deps({ random })).newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(calls).toBe(11);
    expect(() => createCredentialTools(deps({ random: constantRandom(7) })).newRecoveryCodes()).toThrow(/repeating/);
  });

  it('look-alikes, case, spaces and dashes are mapped; anything else is refused', () => {
    expect(normalizeRecoveryCode('7KQ2-M9XD-4TRB-HC8P')).toBe('7KQ2M9XD4TRBHC8P');
    expect(normalizeRecoveryCode(' 7kq2 m9xd\t4trb-hc8p ')).toBe('7KQ2M9XD4TRBHC8P');
    expect(normalizeRecoveryCode('oOiI-lL00-1111-ABCD')).toBe('00111100' + '1111ABCD');
    // the provider confirmation code's 8 characters (3.5)
    expect(normalizeRecoveryCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeRecoveryCode('abcd-efgh')).toMatch(CONFIRM_CODE);
    for (const bad of ['', '7KQ2-M9XD-4TRB-HC8', '7KQ2-M9XD-4TRB-HC8PX', 'U7Q2-M9XD-4TRB-HC8P', '7KQ2_M9XD_4TRB_HC8P', '7KQ2.M9XD.4TRB.HC8P', 'ABCDEFG',
      '7KQ2-M9XD-4TRB-HC8Þ', ' '.repeat(20) + '7KQ2M9XD4TRBHC8P', 42, null]) {
      expect(normalizeRecoveryCode(bad as string), String(bad)).toBeNull();
    }
    expect(formatRecoveryCode('7KQ2M9XD4TRBHC8P')).toBe('7KQ2-M9XD-4TRB-HC8P');
    expect(formatRecoveryCode('7kq2 m9xd 4trb hc8p')).toBe('7KQ2-M9XD-4TRB-HC8P');
    expect(formatRecoveryCode('abcdefgh')).toBe('ABCD-EFGH');
  });

  it('the hash: SHA-256 of "openmtg/recovery/v1\\n" + account + "\\n" + code, bound to the account, the same for a look-alike spelling', () => {
    const tools = createCredentialTools(deps());
    const code = '7KQ2M9XD4TRBHC8P';
    const want = createHash('sha256').update(`openmtg/recovery/v1\n${ALICE}\n${code}`, 'utf8').digest('hex');
    expect(RECOVERY_HASH_PREFIX).toBe('openmtg/recovery/v1\n');
    expect(tools.recoveryCodeHash(ALICE, code)).toBe(want);
    expect(tools.recoveryCodeHash(ALICE, '7kq2-m9xd-4trb-hc8p')).toBe(want);
    expect(tools.recoveryCodeHash(ALICE, '7KQ2-M9XD-4TRB-HCBP')).not.toBe(want);
    expect(tools.recoveryCodeHash(BOB, code)).not.toBe(want);
    expect(want).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every unused slot is compared with the injected comparison, with no early exit; used slots are skipped', () => {
    let calls = 0;
    const tools = createCredentialTools(deps({ equal: (a, b) => (calls++, constantTimeEqual(a, b)) }));
    const codes = tools.newRecoveryCodes();
    const rows = recoveryCodeRows(tools, ALICE, codes, 3, '2026-10-21T00:00:00.000Z');
    expect(rows.map((r) => [r.slot, r.generation, r.usedAt])).toEqual(codes.map((_, i) => [i, 3, null]));
    expect(rows.every((r, i) => r.account === ALICE && r.hash === tools.recoveryCodeHash(ALICE, codes[i]!))).toBe(true);
    for (const target of [0, 4, 9]) {
      calls = 0;
      expect(findRecoverySlot(tools, ALICE, formatRecoveryCode(codes[target]!).toLowerCase(), rows)).toEqual({ slot: target, hash: rows[target]!.hash });
      expect(calls, `slot ${target}`).toBe(10);
    }
    calls = 0;
    expect(findRecoverySlot(tools, ALICE, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', rows)).toBeNull();
    expect(calls).toBe(10);
    // another account's code never matches; a used slot is not compared
    calls = 0;
    expect(findRecoverySlot(tools, BOB, codes[2]!, rows)).toBeNull();
    const spent = rows.map((r, i) => (i < 4 ? { ...r, usedAt: '2026-10-21T01:00:00.000Z' } : r));
    calls = 0;
    expect(findRecoverySlot(tools, ALICE, codes[1]!, spent)).toBeNull();
    expect(calls).toBe(6);
    expect(findRecoverySlot(tools, ALICE, codes[5]!, spent)?.slot).toBe(5);
    // a damaged stored hash is compared like the rest and matches nothing
    const damaged = rows.map((r, i) => (i === 0 ? { ...r, hash: 'not hex' } : r));
    calls = 0;
    expect(findRecoverySlot(tools, ALICE, codes[0]!, damaged)).toBeNull();
    expect(calls).toBe(10);
  });

  it('CredentialTools.equal is the injected comparison itself', () => {
    let calls = 0;
    const tools = createCredentialTools(deps({ equal: (a, b) => (calls++, constantTimeEqual(a, b)) }));
    expect(tools.equal(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(tools.equal(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(tools.equal(Uint8Array.of(1, 2), Uint8Array.of(1))).toBe(false);
    expect(calls).toBe(3);
  });
});

describe('M14-3: device proofs and tokens', () => {
  it('a device proof is 64 lowercase hex digits from 32 random bytes; only its SHA-256 is kept', () => {
    const random = fixedRandom('m14-3 proof');
    const tools = createCredentialTools(deps({ random }));
    const a = tools.newDeviceProof();
    const b = tools.newDeviceProof();
    for (const p of [a, b]) {
      expect(isAccountToken(p.proof)).toBe(true);
      expect(p.hash).toBe(createHash('sha256').update(p.proof, 'utf8').digest('hex'));
      expect(p.hash).toBe(tokenHash(p.proof));
      expect(p.hash).not.toBe(p.proof);
    }
    expect(a.proof).not.toBe(b.proof);
    // the bytes come from the random source
    const again = fixedRandom('m14-3 proof');
    expect(a.proof).toBe(Buffer.from(again(32)).toString('hex'));
  });
});

describe('M14-3: the factories', () => {
  it('fill the stubs under their fixed names', () => {
    const built = builtFactories();
    expect(built.createCredentialTools).toBe(createCredentialTools);
    expect(built.createPasswordHasher).toBe(createPasswordHasher);
    expect(typeof createCredentialTools).toBe('function');
    expect(typeof createPasswordHasher).toBe('function');
  });

  it('refuse unusable dependencies', () => {
    expect(() => createCredentialTools(deps({ passwordMin: 0 }))).toThrow(RangeError);
    // below the blocklist's shortest entries (8, the lowest PASSWORD_MIN the configuration accepts): refused (review of M14-3)
    expect(() => createCredentialTools(deps({ passwordMin: 7 }))).toThrow(RangeError);
    expect(() => createCredentialTools(deps({ passwordMin: 8 }))).not.toThrow();
    expect(() => createCredentialTools(deps({ passwordMin: 128 }))).not.toThrow();
    expect(() => createCredentialTools(deps({ passwordMin: 129 }))).toThrow(RangeError);
    expect(() => createCredentialTools(deps({ passwordMin: 12.5 }))).toThrow(RangeError);
    expect(() => createCredentialTools(deps({ random: undefined as never }))).toThrow(TypeError);
    expect(() => createCredentialTools(deps({ random: () => new Uint8Array(3) })).newDeviceProof()).toThrow(RangeError);
  });
});
