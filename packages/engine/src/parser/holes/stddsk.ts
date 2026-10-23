/**
 * Cloud std-dsk (the Duskmourn slice of the Standard backlog): small hole grammars of its templates (parser/templates/zz-cloud/std-dsk.json).
 *
 * `ListedCounterKind`: one counter kind of a list of kinds to choose from, "put a flying, lifelink, or +1/+1 counter on it" (CR 122.1, 122.1b, 608.2d: the
 * controller chooses one kind as the ability resolves): a signed pair ("+1/+1") or a LISTED counter kind or keyword counter of one or two words ("lifelink",
 * "first strike"). Unlike `CounterKind` it needs no "counter" right after it (the kinds of a list share one noun), and it never reads an arbitrary word
 * (guard G2: an unlisted word yields no parse, where `CounterKind` accepts it as a weak kind). Value: the kind (string).
 */
import type { Alt, HoleFn } from './core';
import { isSignedPair } from './tok';

export const listedCounterKind: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t === undefined) return [];
  const out: Alt[] = [];
  const listed = (w: string): boolean => ctx.vocab.counterKinds.has(w) || ctx.vocab.keywords.has(w);
  if (isSignedPair(t)) out.push({ end: pos + 1, value: t.norm });
  if (t.kind === 'WORD' && listed(t.norm)) out.push({ end: pos + 1, value: t.norm });
  const t2 = ctx.toks[pos + 1];
  if (t.kind === 'WORD' && t2?.kind === 'WORD' && listed(`${t.norm} ${t2.norm}`)) out.push({ end: pos + 2, value: `${t.norm} ${t2.norm}` });
  return out;
};

/**
 * `NotSameNameCard`: the description of a card that "doesn't have the same name as" an object of a described set ("a Room card that doesn't have the same name as a
 * Room you control", CR 201.2), and nothing else: the `Filter` readings whose filter carries that negated name comparison (parser/holes/filter.ts#notSameNameAs).
 * A search template reads it after "for a" without competing with its ordinary "for a <Filter> card" form. Value: the filter.
 */
export const notSameNameCard: HoleFn = (ctx, pos) =>
  ctx.call('Filter', pos)
    .filter((a) => {
      const f = a.value as { not?: { sharesWith?: { with?: { ref?: string }; quality?: string } }; zone?: unknown } | null;
      return f?.not?.sharesWith?.quality === 'name' && f.not.sharesWith.with?.ref === 'each' && f.zone === undefined;
    })
    // the zone of the card is the template's ("search your library for"), so the hole's "no zone stated" note does not apply; every other note stays
    .map((a) => ({ ...a, ...(a.flags ? { flags: a.flags.filter((x) => x !== 'zone-unstated') } : {}) }));
