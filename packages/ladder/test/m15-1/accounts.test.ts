/**
 * M15-1: what the ladder takes from milestone 14 (design 2, D1, risk 10, 17.1).
 *  - Only src/accounts.ts names @openmtg/accounts, for types only; there is no shim (M14-1 merged first, so no src/accounts-shim.ts and no M15-1b).
 *  - Its eight types are accounts' own, and the shapes the ladder relies on are pinned (a change in milestone 14 fails the typecheck here).
 *  - The two values the ladder copies equal accounts' own: the account id's shape and the deleted player's name.
 *  - ABUSE_REPORT_REASON maps every abuse kind to a reason milestone 14 has (11.2).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as accounts from '@openmtg/accounts/api';
import { ABUSE_REPORT_REASON, ACCOUNT_ID_SHAPE, DELETED_PLAYER_NAME, type AbuseKind } from '@openmtg/ladder';
import type * as L from '../../src/accounts';
import type { Equals } from '../support/types';
import { edges, rel, SRC, tsFiles } from './graph';

// ---- the eight types are accounts' own ----------------------------------------------------------------------------------------------------
const pinTypes: [
  Equals<L.AccountId, accounts.AccountId>, Equals<L.AccountStatus, accounts.AccountStatus>, Equals<L.Standing, accounts.Standing>,
  Equals<L.PrivacySettings, accounts.PrivacySettings>, Equals<L.AccountDirectory, accounts.AccountDirectory>,
  Equals<L.AccountDataHolder, accounts.AccountDataHolder>, Equals<L.PlayerRef, accounts.PlayerRef>, Equals<L.ReportReason, accounts.ReportReason>,
] = [true, true, true, true, true, true, true, true];

// ---- what the ladder relies on (m14 2.4; m15 13.4's port list) --------------------------------------------------------------------------
type Id = L.AccountId;
const pinShapes: [
  Equals<Id, `acc_${string}`>,
  Equals<L.AccountStatus, 'active' | 'suspended' | 'banned' | 'deleting'>,
  Equals<Pick<L.Standing, 'account' | 'status' | 'ranked' | 'listed' | 'createdAt'>, { account: Id; status: L.AccountStatus; ranked: boolean; listed: boolean; createdAt: string }>,
  Equals<Pick<L.PrivacySettings, 'history' | 'leaderboards'>, { history: 'public' | 'private'; leaderboards: boolean }>,
  Equals<L.AccountDirectory['standings'], (ids: readonly Id[]) => Promise<Map<Id, L.Standing>>>,
  Equals<L.AccountDirectory['names'], (ids: readonly Id[]) => Promise<Map<Id, string>>>,
  Equals<L.AccountDirectory['privacy'], (ids: readonly Id[]) => Promise<Map<Id, L.PrivacySettings>>>,
  Equals<L.AccountDirectory['historyVisible'], (id: Id, viewer: Id | null) => Promise<boolean>>,
  Equals<L.AccountDirectory['displayNameAt'], (id: Id, nameAtTheTime: string, viewer?: Id | null) => Promise<string>>,
  Equals<L.AccountDirectory['blockedAmong'], (ids: readonly Id[]) => Promise<[Id, Id][]>>,
  Equals<L.PlayerRef['account'], Id>,
  Equals<keyof L.AccountDataHolder, 'name' | 'exportFor' | 'erase'>,
  Equals<Extract<L.ReportReason, 'collusion' | 'smurf' | 'stalling' | 'other'>, 'collusion' | 'smurf' | 'stalling' | 'other'>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true];

const KINDS: readonly AbuseKind[] = [
  'repeatedPairing', 'oneSided', 'earlyConcessions', 'smurf', 'ratingTransfer', 'sandbagging', 'parkedHigh', 'capStall', 'dodging',
];
const pinKinds: Equals<(typeof KINDS)[number], AbuseKind> = true;

describe('M15-1: the door to milestone 14 (src/accounts.ts)', () => {
  it('only src/accounts.ts names @openmtg/accounts, for types only; nothing names a shim', () => {
    for (const file of tsFiles(SRC)) {
      for (const e of edges(file)) {
        const accountsSpec = e.spec === '@openmtg/accounts' || e.spec.startsWith('@openmtg/accounts/');
        if (accountsSpec) {
          expect(rel(file), `${rel(file)}: ${e.text}`).toBe('accounts.ts');
          expect(e.spec).toBe('@openmtg/accounts/api');
          expect(e.typeOnly, e.text).toBe(true);
        }
        expect(e.spec, `${rel(file)}: ${e.text}`).not.toMatch(/accounts-shim/);
      }
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/from ['"][^'"]*accounts-shim/);
    }
    expect(existsSync(join(SRC, 'accounts-shim.ts'))).toBe(false);
    expect(edges(join(SRC, 'accounts.ts')).map((e) => e.spec)).toEqual(['@openmtg/accounts/api']);
  });

  it('re-exports the eight types as accounts has them, and the shapes the ladder relies on hold (type pins)', () => {
    expect(pinTypes.every(Boolean)).toBe(true);
    expect(pinShapes.every(Boolean)).toBe(true);
  });

  it('the account id shape equals accounts\' ACCOUNT_ID and accepts and refuses the same ids', () => {
    expect(ACCOUNT_ID_SHAPE.source).toBe(accounts.ACCOUNT_ID.source);
    expect(ACCOUNT_ID_SHAPE.flags).toBe(accounts.ACCOUNT_ID.flags);
    const samples = [
      'acc_00000000000000000000000000', 'acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ', 'acc_01HZY3K5V9QW8E2R4T6Y8U0P1M', 'acc_80000000000000000000000000',
      'acc_0000000000000000000000000', 'acc_000000000000000000000000000', 'acc_0000000000000000000000000I', 'acc_0000000000000000000000000u', 'ACC_00000000000000000000000000',
      'del_00000000000000000000000000', '',
    ];
    for (const s of samples) expect(ACCOUNT_ID_SHAPE.test(s), s).toBe(accounts.ACCOUNT_ID.test(s));
    expect(ACCOUNT_ID_SHAPE.test('acc_00000000000000000000000000')).toBe(true);
    expect(ACCOUNT_ID_SHAPE.test('acc_80000000000000000000000000')).toBe(false);
  });

  it('the deleted player\'s name equals accounts\' DELETED_PLAYER_NAME', () => {
    expect(DELETED_PLAYER_NAME).toBe(accounts.DELETED_PLAYER_NAME);
  });
});

describe('M15-1: ABUSE_REPORT_REASON (11.2)', () => {
  it('maps every abuse kind, exactly as 11.2 gives it, to one of milestone 14\'s report reasons', () => {
    expect(pinKinds).toBe(true);
    expect(Object.keys(ABUSE_REPORT_REASON).sort()).toEqual([...KINDS].sort());
    expect(ABUSE_REPORT_REASON).toEqual({
      repeatedPairing: 'collusion', oneSided: 'collusion', earlyConcessions: 'collusion', ratingTransfer: 'collusion',
      smurf: 'smurf', sandbagging: 'smurf', capStall: 'stalling', dodging: 'other', parkedHigh: 'other',
    });
    for (const k of KINDS) expect(accounts.REPORT_REASONS, k).toContain(ABUSE_REPORT_REASON[k]);
    expect(Object.isFrozen(ABUSE_REPORT_REASON)).toBe(true);
  });
});
