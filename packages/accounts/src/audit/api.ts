/**
 * The audit writer (design 8.5, 11.3; M14-1). Built by M14-5 in src/audit/* (the factory in src/audit/index.ts).
 */
import type { AccountId, AuditDetails, AuditEvent, AuditKind } from '../api';
import type { AccountsLog } from '../service/api';
import type { AccountStore } from '../store/api';

export interface AuditInput<K extends AuditKind> {
  kind: K; account: AccountId | null; actor: AuditEvent['actor']; actorOs?: string | null; session?: string | null; addressKey?: string | null;
  details: AuditDetails[K];
}
export interface AuditWriter {
  /** An event for the same store call as the change it records (8.5): the tag from the address key under this month's key; details checked. */
  build<K extends AuditKind>(e: AuditInput<K>, at: Date): AuditEvent<K>;
  /** The same, queued and flushed within a second. Never throws, never holds a request up. */
  record<K extends AuditKind>(e: AuditInput<K>, at: Date): void;
  /** A keyed tag of a name key under this month's key, for failed sign-ins on names no account holds (8.5). */
  nameTag(nameKey: string, at: Date): string;
  flush(): Promise<void>;
}

/**
 * `createAuditWriter` of src/audit/index.ts, made by the service core: the month keys come from `random` and live only in memory (D15); queued
 * events go to `store.appendAudit`; what a full queue drops is counted on `log`.
 */
export type CreateAuditWriter = (opts: { store: Pick<AccountStore, 'appendAudit'>; log: AccountsLog; random: (n: number) => Uint8Array }) => AuditWriter;
