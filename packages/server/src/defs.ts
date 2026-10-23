/**
 * POST /api/cards/defs { names, stubs? } (docs/design/m8-client.md, "Server API" and "Data flow": game configs embed the definitions, so the engine
 * state is self-contained).
 *
 * Each name is looked up in the local index (Oracle name, face name or loose spelling) and compiled by the game-path compiler with the disk cache
 * (compiled.ts). Names the index does not know, ambiguous face names and cards the compiler rejects are reported in `failed` with the reason, never
 * guessed. `stubs` are the unknown names the player confirmed (WP24): each becomes `stubCardDef(name, 'decklist')`, or the real card when the index has
 * learned the name since. A stub name the index knows but the compiler rejects, or one that is now an ambiguous face name, is reported in `failed`
 * (never a blank stub hiding a card the index knows). Every requested name ends in exactly one of `defs` and `failed`.
 */
import { COMPILER_VERSION, stubCardDef, type CardDef } from '@openmtg/engine';
import type { DefsFailure, DefsResponse } from './api';
import { cardStore, storeError, type CardStore } from './cache';
import { badRequest, type Handler } from './context';

/** Most names per request (a Commander deck plus sideboard and tokens is well below). */
export const MAX_DEF_NAMES = 500;
const MAX_NAME = 300;

function stringList(v: unknown, field: string): string[] | string {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return `${field} must be an array of strings`;
  if (v.some((x: string) => x.trim() === '' || x.length > MAX_NAME)) return `Every entry of ${field} must be a non-empty name of at most ${MAX_NAME} characters`;
  return [...new Set(v as string[])];
}

/** The reason an ambiguous face name cannot be compiled, or null when the name is not a shared face name. */
async function ambiguity(store: CardStore, name: string): Promise<string | null> {
  const { resolved } = await store.db.resolveNames([name]);
  const ambiguous = resolved[0]?.ambiguous;
  return ambiguous?.length ? `"${name}" is a face name of several cards: ${ambiguous.join(', ')}` : null;
}

type Failure = Omit<DefsFailure, 'name'>;

async function compileName(store: CardStore, name: string): Promise<CardDef | Failure> {
  const card = store.db.lookup(name);
  if (!card) {
    const ambiguous = await ambiguity(store, name);
    if (ambiguous) return { code: 'ambiguous', reason: ambiguous };
    const near = store.db.suggest(name);
    return { code: 'unknown', reason: `No card named "${name}" in the local index${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}` };
  }
  try {
    const def = await store.defs.get(card);
    store.automation.record(card, def.automation.level);
    return def;
  } catch (e) {
    return { code: 'rejected', reason: `The compiler rejected ${card.name}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const isFailure = (r: CardDef | Failure): r is Failure => !('faces' in r);

export const compileDefs: Handler<'POST /api/cards/defs'> = async (req, ctx) => {
  const body = req.body as { names?: unknown; stubs?: unknown } | null;
  if (body === null || typeof body !== 'object' || Array.isArray(body) || body.names === undefined) return badRequest('Body must be { "names": string[], "stubs"?: string[] }');
  const names = stringList(body.names, 'names');
  if (typeof names === 'string') return badRequest(names);
  const stubs = stringList(body.stubs, 'stubs');
  if (typeof stubs === 'string') return badRequest(stubs);
  if (names.length + stubs.length > MAX_DEF_NAMES) return badRequest(`At most ${MAX_DEF_NAMES} names per request`);

  const out: DefsResponse = { defs: {}, failed: [], compilerVersion: COMPILER_VERSION };
  if (names.length + stubs.length === 0) return { status: 200, body: out };
  const opened = await cardStore(ctx);
  if (!opened.ok) return storeError(opened);
  const { store } = opened;
  const fail = (name: string, f: Failure): void => {
    if (!out.failed.some((x) => x.name === name)) out.failed.push({ name, code: f.code, reason: f.reason });
  };
  // A game start waits on this answer: the classification build pauses meanwhile (automation.ts `whilePaused`).
  await store.automation.whilePaused(async () => {
    for (const name of names) {
      const r = await compileName(store, name);
      if (isFailure(r)) fail(name, r);
      else out.defs[name] = r;
    }
    for (const name of stubs) {
      if (Object.hasOwn(out.defs, name)) continue;
      // A name the index knows is compiled for real; the compiler's rejection is reported, never hidden behind a blank stub. An ambiguous face name gets no
      // stub either (resolve never offers one): the player picks a full name.
      let r: CardDef | Failure;
      if (store.db.lookup(name)) r = await compileName(store, name);
      else {
        const ambiguous = await ambiguity(store, name);
        r = ambiguous ? { code: 'ambiguous', reason: ambiguous } : stubCardDef(name, 'decklist');
      }
      if (isFailure(r)) fail(name, r);
      else out.defs[name] = r;
    }
  });
  // A name sent in both lists failed as a name and got its confirmed stub: it is answered, not failed.
  out.failed = out.failed.filter((f) => !Object.hasOwn(out.defs, f.name));
  return { status: 200, body: out };
};
