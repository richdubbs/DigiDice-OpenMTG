/**
 * The runtime's snapshot bytes (`SnapshotRow.state`; design 2.3; package M13-5). gzip of one header line, `{"v":1,"defsHash":...,"defs":[...]}` (the
 * SHA-256 of the definitions' JSON: the checkpoint hash covers only the state), a newline, then the
 * checkpoint's state JSON without defs exactly as it was hashed (`Checkpoint.stateJson`; JSON text never holds a raw newline). The header carries the
 * card definitions the game added while it ran (tokens, CR 111.4: `state.defs` beyond the configuration's), which the configuration cannot give back:
 * without them a state with a token does not replay ("No definition ... for object"). The worker takes them from the state after the step, so when a
 * step goes past its checkpoint they may include a later token's definition; that is harmless (a definition's id is its content's, and the engine keeps
 * an existing one, `Game.addDef`). Bytes without a header line are read as the state alone (no added definitions).
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { CardDef } from '@openmtg/engine';

export const SNAPSHOT_FORMAT = 1;

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export function encodeSnapshot(stateJson: string, addedDefs: readonly CardDef[]): Uint8Array {
  // The definitions are hashed too (review minor 5): the checkpoint hash covers only the state text.
  const defs = JSON.stringify(addedDefs);
  const gz = gzipSync(Buffer.from(`{"v":${SNAPSHOT_FORMAT},"defsHash":"${sha(defs)}","defs":${defs}}\n${stateJson}`, 'utf8'));
  return new Uint8Array(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
}

/** The state text (as hashed) and the added definitions of a snapshot. Throws for bytes that are not a snapshot of a known format. */
export function decodeSnapshot(bytes: Uint8Array): { stateJson: string; defs: CardDef[] } {
  const text = gunzipSync(bytes).toString('utf8');
  const nl = text.indexOf('\n');
  if (nl < 0) return { stateJson: text, defs: [] };
  const header = JSON.parse(text.slice(0, nl)) as { v?: unknown; defsHash?: unknown; defs?: unknown };
  if (header.v !== SNAPSHOT_FORMAT || !Array.isArray(header.defs)) throw new Error('unknown snapshot format');
  if (header.defsHash !== sha(JSON.stringify(header.defs))) throw new Error('snapshot definitions do not match their hash');
  return { stateJson: text.slice(nl + 1), defs: header.defs as CardDef[] };
}
