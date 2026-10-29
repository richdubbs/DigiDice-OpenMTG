/**
 * What every API handler receives. Handlers validate their own input (`body` is untrusted JSON) and return a typed result; `http.ts` turns it into a
 * response. Handlers never write to the socket themselves.
 */
import type { Clock, ScryfallClient } from '@openmtg/cards';
import type { ApiEndpoints, ApiError, EndpointKey } from './api';

export interface ServerContext {
  /** Scryfall cache directory (OPENMTG_CACHE_DIR or <repo>/.cache/scryfall). */
  cacheDir: string;
  /** Directory of compiled-definition caches (design: `.cache/compiled/`). */
  compiledDir: string;
  /** Package version reported by /api/status. */
  version: string;
  /** UPD1: the installed rules packs (OPENMTG_PACKS_DIR, or `packs` next to the card cache: `<repo>/.cache/packs`). Default: that sibling. */
  packsDir?: string;
  /**
   * UPD1: the rules-pack manifest URL (OPENMTG_PACK_URL, read at server start; no default until the project publishes a pack: updates.md). Absent or
   * null: the Update button refreshes the card data only and says the pack part is off.
   */
  packUrl?: string | null;
  /** UPD1: injected I/O of the update (tests: never the real network). */
  updateIo?: UpdateIo;
  /**
   * M13-11: the WebSocket origin of the hosted game server (`wss://host`, or `ws://` on this machine; http.ts `hostedSocketOrigin`), or null/absent when
   * none is configured. GET /api/status reports it and the Content-Security-Policy allows it.
   */
  hostedUrl?: string | null;
  /** The Scryfall API client of set search (sets.ts); tests pass one over a fake fetch. Default: one shared client per card-data folder. */
  scryfall?: ScryfallClient;
  /** The player's library (library/: decks, settings). Default: `library` next to the card cache, `%APPDATA%\OpenMTG\data\library` in the apps. */
  libraryDir?: string;
}

/** The network and clock of POST /api/update; production uses the real ones (Scryfall's client with its rate limits, global fetch, the system clock). */
export interface UpdateIo {
  /** Scryfall client for the bulk refresh (tests pass one over a fake fetch). */
  scryfall?: ScryfallClient;
  /** Clock of the 24 h refresh rule. */
  clock?: Clock;
  /** fetch for the rules-pack manifest and pack (HTTPS only, cards/pack/fetch.ts). */
  packFetch?: typeof fetch;
  now?: () => Date;
  /** Time slice of the summary's compile in milliseconds (default `UPDATE_SLICE_MS`; tests pass 0: a pause after every card). */
  sliceMs?: number;
}

export interface ApiRequest {
  /** Raw query parameters (the last value wins for repeated keys). */
  query: Record<string, string>;
  /** Path parameters, already URL-decoded (`:name`). */
  params: Record<string, string>;
  /** Parsed JSON body of a POST, `undefined` for GET. Untrusted: validate before use. */
  body: unknown;
}

export type ApiResult<K extends EndpointKey> =
  | { status: 200; body: ApiEndpoints[K]['response'] }
  | { status: 400 | 404 | 409 | 500 | 501 | 503; body: ApiError };

export type Handler<K extends EndpointKey> = (req: ApiRequest, ctx: ServerContext) => ApiResult<K> | Promise<ApiResult<K>>;

/** A 400 answer for invalid input. */
export function badRequest(error: string): { status: 400; body: ApiError } {
  return { status: 400, body: { error } };
}

/** The answer of an endpoint that is not implemented yet (C0 stubs; package C1 replaces them). */
export function notImplemented(endpoint: EndpointKey, todo: string[]): { status: 501; body: ApiError } {
  return { status: 501, body: { error: `${endpoint} is not implemented yet`, todo } };
}
