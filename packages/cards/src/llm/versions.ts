/**
 * What an LLM cache entry was checked against (design 11.4, 11.8): ABILITY_MODEL_VERSION and the SHA-256 of the checked-in ability schema. A record
 * made under another model version or schema is stale: its stored entry and raw replies are re-validated offline before the model is asked again.
 */
import { createHash } from 'node:crypto';
import { ABILITY_MODEL_VERSION } from '@openmtg/engine';
import { loadSchemaText } from './prompt';
import type { CompileIndexEntry } from './types';

let schemaHash: string | undefined;

/** SHA-256 of the ability schema of this build (packages/engine/src/model/schema.generated.json, as the prompt sends it). */
export function currentSchemaHash(): string {
  schemaHash ??= createHash('sha256').update(loadSchemaText()).digest('hex');
  return schemaHash;
}

/** Was the record made under another ability model version or schema (or before they were recorded)? */
export function isStale(rec: Pick<CompileIndexEntry, 'modelVersion' | 'schemaHash'>, modelVersion = ABILITY_MODEL_VERSION, schema = currentSchemaHash()): boolean {
  return rec.modelVersion !== modelVersion || rec.schemaHash !== schema;
}
