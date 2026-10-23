/**
 * The LLM compile tool (design 11, WP26): shared types. The model client is injectable (`LlmClient`): the real one (llm/client.ts) calls the model provider's API,
 * tests use a scripted mock. Nothing here touches the disk or the network.
 */

/** One request to the model: a long, stable, cacheable system prompt and the per-card conversation (design 11.2). */
export interface LlmRequest {
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  /** Which run this is (design 11.3 gate 8: the agreement run is a second, independent call with a fresh context). */
  purpose: 'compile' | 'repair' | 'agreement';
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmReply {
  /** The text of the reply (JSON only, by the prompt's contract). */
  text: string;
  /** The model that answered (a server-side fallback may answer instead of the requested one). */
  model: string;
  usage: LlmUsage;
  /** 'refusal' when the model declined: the reply is not used. */
  stopReason: string;
}

/** The injectable model client. Must not throw for a refusal (stopReason says so); may throw for transport errors. */
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmReply>;
}

/**
 * The gates of design 11.3, in order. A result is rejected at the first failing gate. `manual`: the reply gains nothing over the parser (llm/gain.ts);
 * `truncated`: an empty reply or one cut off at the output limit (no JSON to check).
 */
export type GateName = 'json' | 'truncated' | 'schema' | 'authority' | 'manual' | 'lint' | 'hydrate' | 'render' | 'critical' | 'smoke';

/** The flags of design 11.5. */
export type EntryFlag =
  | 'usesManual'
  | `highRisk:${string}`
  | 'gate:failedOnce'
  | 'twoRuns:disagree'
  | 'templates:disagree'
  | 'lint:warning'
  | 'executability:failed'
  | 'edited';

/** The record of one card in `.cache/compiled/index.json` (design 11.4): which entry belongs to which text, prompt and model. */
export interface CompileIndexEntry {
  oracleId: string;
  textHash: string;
  promptVersion: number;
  model: string;
  /**
   * ABILITY_MODEL_VERSION and the SHA-256 of the ability schema the entry was checked against (design 11.4, 11.8: a bump invalidates the entry; its raw
   * replies are re-validated first). Absent in records written before they were recorded: treated as stale.
   */
  modelVersion?: number;
  schemaHash?: string;
  /** `entry`: a CompiledCardEntry is stored; `failed`: every attempt was rejected by a gate (no entry). */
  status: 'entry' | 'failed';
  /** For status entry: the review state of the stored entry (mirrors the entry file). */
  review?: 'unreviewed' | 'autoverified' | 'reviewed' | 'rejected';
  flags: string[];
  /** For status failed: the gate that rejected the last attempt and its message. */
  failure?: { gate: GateName; message: string };
  /** Capabilities the entry needs that this engine build lacks (design 11.3 gate 4). */
  requiresEngine: string[];
  updatedAt: string;
}
