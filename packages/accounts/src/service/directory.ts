/**
 * M14-5: AccountDirectory, the read-only lookups for hosted's tables and matchmaking and for the ladder (design 2.3, 2.4, 6.7, 7.2, 9.1). Its calls
 * take no time, so they read the service's clock (ServiceDeps.now, the system clock by default). Ids that are not account ids are ignored (or
 * answered as for an unknown account); nothing here throws for a caller's input.
 *
 * - `standing`: standingOf over the account's sanctions (D23); null for an erased or unknown id.
 * - `names`: current display names of active accounts only.
 * - `blockedAmong`: each pair among the ids with a block in either direction, once, the smaller id first.
 * - `silenced(muter, speaker)`: the muter muted or blocked the speaker, or the speaker blocked the muter (a block is per pair: no chat between them
 *   either way, 9.1).
 * - `displayNameAt` (6.7): to the account itself the name at the time, unless that name was redacted by a forced rename (then its current name); to
 *   anyone else, and with no viewer, the current name; an erased or unknown id, DELETED_PLAYER_NAME.
 * - `historyVisible` (7.3): the account itself, or anyone while it is active and its history is public; false for an erased or unknown id.
 */
import {
  DELETED_PLAYER_NAME, isAccountId, standingOf, type AccountDirectory, type AccountId, type PrivacySettings, type Standing,
} from '../api';
import { iso, statusOf, type Core } from './context';

const idsOf = (ids: readonly AccountId[]): AccountId[] => (Array.isArray(ids) ? [...new Set(ids.filter((x) => isAccountId(x)))] : []);

export function createDirectory(core: Core): AccountDirectory {
  async function standings(ids: readonly AccountId[]): Promise<Map<AccountId, Standing>> {
    const list = idsOf(ids);
    const out = new Map<AccountId, Standing>();
    if (list.length === 0) return out;
    const now = iso(core.clock());
    const [accounts, sanctions] = await Promise.all([core.store.accounts(list), core.store.runningSanctions(list, now)]);
    for (const id of list) {
      const a = accounts.get(id);
      if (a !== undefined) out.set(id, standingOf(a, sanctions.get(id) ?? [], now));
    }
    return out;
  }

  return {
    async standing(id) {
      if (!isAccountId(id)) return null;
      return (await standings([id])).get(id) ?? null;
    },
    standings,
    async names(ids) {
      const s = await standings(ids);
      const accounts = await core.store.accounts([...s.keys()]);
      const out = new Map<AccountId, string>();
      for (const [id, st] of s) {
        const a = accounts.get(id);
        if (a !== undefined && st.status === 'active') out.set(id, a.name);
      }
      return out;
    },
    async blockedAmong(ids) {
      const list = idsOf(ids);
      if (list.length < 2) return [];
      const rows = await core.store.relationsAmong(list);
      const seen = new Set<string>();
      const out: [AccountId, AccountId][] = [];
      for (const r of rows) {
        if (r.kind !== 'block') continue;
        const pair: [AccountId, AccountId] = r.account < r.other ? [r.account, r.other] : [r.other, r.account];
        const k = `${pair[0]}|${pair[1]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(pair);
      }
      out.sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
      return out;
    },
    async silenced(muter, speaker) {
      if (!isAccountId(muter) || !isAccountId(speaker) || muter === speaker) return false;
      const rows = await core.store.relationsAmong([muter, speaker]);
      return rows.some((r) => (r.account === muter && r.other === speaker) || (r.account === speaker && r.other === muter && r.kind === 'block'));
    },
    async privacy(ids) {
      const list = idsOf(ids);
      const out = new Map<AccountId, PrivacySettings>();
      if (list.length === 0) return out;
      const accounts = await core.store.accounts(list);
      for (const [id, a] of accounts) out.set(id, { history: a.privacy.history, leaderboards: a.privacy.leaderboards, guestsAtMyTables: a.privacy.guestsAtMyTables });
      return out;
    },
    async displayNameAt(id, nameAtTheTime, viewer) {
      if (!isAccountId(id)) return DELETED_PLAYER_NAME;
      const a = await core.store.account(id);
      if (a === null) return DELETED_PLAYER_NAME;
      if (viewer !== id) return a.name;
      if (typeof nameAtTheTime !== 'string') return a.name;
      const history = await core.store.nameHistory(id);
      return history.some((h) => h.name === nameAtTheTime && h.redacted) ? a.name : nameAtTheTime;
    },
    async historyVisible(id, viewer) {
      if (!isAccountId(id)) return false;
      const a = await core.store.account(id);
      if (a === null) return false;
      if (viewer === id) return true;
      if (a.privacy.history !== 'public') return false;
      return (await statusOf(core, a, core.clock())) === 'active';
    },
  };
}
