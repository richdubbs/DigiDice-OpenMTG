/**
 * Hole grammar `TokenDesc` (TokenDef), design 6.3 and CR 111. Owner: WP6.
 *
 *   TokenDesc ::= {PT | color | "colorless" | supertype | type | subtype} ("token" | "tokens") ["named" NAME] ["with" Abilities]
 *              |  PredefinedName ("token" | "tokens")                                                                   (CR 111.10)
 * "1/1 white Soldier creature token", "Treasure token", "2/2 black Zombie creature tokens", "4/4 red Dragon creature token with flying",
 * "1/1 colorless Eldrazi Scion creature token with \"Sacrifice this creature: Add {C}.\"". A word that is none of these fails the phrase.
 * Bare keywords of the `with` list go to `keywords`; keywords with parameters and quoted abilities go to `abilities`.
 */
import type { TokenDef } from '../../types/ability';
import type { Color } from '../../types/mana';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, anyPhraseAt, dedupe, multiAt, phraseAt } from './core';
import type { Tok } from './tok';
import { abilitiesFor, basePt } from './misc';

const W_TOKEN = [P('token'), P('tokens')];
const W_NAMED = P('named');
const W_WITH = P('with');
const W_EVERY_BASIC_LAND_TYPE = P('that is every basic land type'); // cloud std-dsk
/** CR 305.6, 205.3i: the basic land types, in the order of CR 305.6. */
export const BASIC_LAND_TYPES: readonly string[] = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const COMMA = P(',');
const W_BASE_PT_EACH_EQUAL = P('with base power and toughness each equal to'); // r5-fxb
const W_ALL_COLORS = [P('that is all colors'), P("that 's all colors"), P("that's all colors")]; // r5-fxb

interface State {
  colors: Color[];
  colorless: boolean;
  supertypes: string[];
  types: string[];
  subtypes: string[];
  pt?: { power: unknown; toughness: unknown };
}

function plainKeyword(a: unknown): a is { keyword: string } {
  const o = a as Record<string, unknown>;
  return o['kind'] === 'keyword' && Object.keys(o).every((k) => k === 'kind' || k === 'keyword' || k === 'text');
}

/**
 * T55 (CR 111.4, 201.5a): the tokens inside the quotes of a token's ability that go by the token's own name ("Whenever Redwing attacks, surveil 1.",
 * "The Void attacks each combat if able."): the name there is the object that HAS the ability, so it is read as `~` like "this token" (parser/front/selfref.ts
 * leaves a name given by "named" or by the token's description alone: it is not the card's name). The run of tokens that spells the name (a possessive 's
 * joins its word) becomes one SELF token that keeps the name as its text, so the display text of the quoted ability says the name.
 */
export function nameAsSelf(sub: readonly Tok[], name: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < sub.length; i++) {
    let text = '';
    let j = i;
    for (; j < sub.length && text.length < name.length; j++) {
      const t = sub[j]!;
      text += text === '' || (t.kind === 'WORD' && t.text === "'s" && sub[j - 1]!.end === t.start) ? t.text : ` ${t.text}`;
    }
    if (text === name && j > i) {
      out.push({ kind: 'SELF', text: name, norm: '~', start: sub[i]!.start, end: sub[j - 1]!.end });
      i = j - 1;
    } else out.push(sub[i]!);
  }
  return out;
}

/**
 * `TokenDesc`, and with `preset` the description of a token that already has its name (`NamedToken`): the name is part of the result, no "named X" follows,
 * and a quoted ability of the token reads that name as the token itself (`nameAsSelf`).
 */
function describeToken(ctx: HoleCtx, pos: number, preset?: string): Alt[] {
  const out: Alt[] = [];

  const finish = (p: number, st: State, predefined?: string): void => {
    const tk = W_TOKEN.map((w) => phraseAt(ctx, p, w)).find((e) => e >= 0);
    if (tk === undefined) return;
    let base: TokenDef;
    if (predefined !== undefined) base = { predefined };
    else {
      if (st.types.length === 0) return; // a token with only a subtype name is not described well enough to build
      base = {
        ...(preset !== undefined ? { name: preset } : {}),
        ...(st.colorless ? { colors: [] } : st.colors.length > 0 ? { colors: st.colors } : {}),
        ...(st.supertypes.length > 0 ? { supertypes: st.supertypes } : {}),
        types: st.types,
        ...(st.subtypes.length > 0 ? { subtypes: st.subtypes } : {}),
        ...(st.pt ? { power: st.pt.power as never, toughness: st.pt.toughness as never } : {}),
      };
    }
    out.push({ end: tk, value: base });
    // r5-fxb (CR 111.4, 608.2h): "a green Fungus Dinosaur creature token with base power and toughness each equal to the total power of those creatures": a
    // token described without a power and toughness, then one computed number for both (evaluated as the token is created, effects/handlers/tokens-create.ts)
    const eq = predefined === undefined && preset === undefined && st.pt === undefined && st.types.includes('Creature') ? phraseAt(ctx, tk, W_BASE_PT_EACH_EQUAL) : -1;
    if (eq >= 0) for (const q of ctx.call('Qty', eq)) if (typeof q.value !== 'number') out.push({ end: q.end, value: { ...base, power: q.value as never, toughness: q.value as never }, ...(q.weak ? { weak: q.weak } : {}) });
    // named X
    const nm = phraseAt(ctx, tk, W_NAMED);
    const named: { end: number; token: TokenDef; weak?: number }[] = [{ end: tk, token: base }];
    if (nm >= 0 && predefined === undefined && preset === undefined) for (const n of ctx.call('Name', nm)) { const t = { ...base, name: n.value as string }; out.push({ end: n.end, value: t, weak: n.weak ?? 1 }); named.push({ end: n.end, token: t, weak: n.weak ?? 1 }); }
    // cloud std-dsk (CR 111.4, 205.3i, 305.6): "a tapped colorless land token named Everywhere that is every basic land type": the land token has the five basic
    // land types (and so their mana abilities, CR 305.6); only a named land token with no other subtype
    for (const nmd of named) {
      const e = nmd.token.name !== undefined && nmd.token.types?.length === 1 && nmd.token.types[0] === 'Land' && nmd.token.subtypes === undefined ? phraseAt(ctx, nmd.end, W_EVERY_BASIC_LAND_TYPE) : -1;
      if (e >= 0) out.push({ end: e, value: { ...nmd.token, subtypes: [...BASIC_LAND_TYPES] }, ...(nmd.weak ? { weak: nmd.weak } : {}) });
    }
    // (r5-mech's reading of "... named Reliquary Dragon that's all colors" is r5-fxb's general one below since merge wave 8: CR 105.2, 111.4)
    // with <abilities>
    for (const nmd of named) {
      const w = phraseAt(ctx, nmd.end, W_WITH);
      if (w < 0 || predefined !== undefined) continue;
      const own = nmd.token.name;
      for (const ab of own !== undefined && predefined === undefined ? abilitiesFor(ctx, w, own, nameAsSelf) : ctx.call('Abilities', w)) {
        const items = ab.value as unknown[];
        const keywords = items.filter(plainKeyword).map((a) => a.keyword);
        const rest = items.filter((a) => !plainKeyword(a));
        const t: TokenDef = { ...nmd.token, ...(keywords.length > 0 ? { keywords } : {}), ...(rest.length > 0 ? { abilities: rest as never } : {}) };
        out.push({ end: ab.end, value: t, ...(nmd.weak ? { weak: nmd.weak } : {}) });
        // std-hob (CR 111.4): the name may also follow plain keywords, "a 3/1 colorless Wall artifact creature token with defender named Stone Boulder", "a 1/2 blue
        // Bird creature token with flying named Storm Crow". Only after keywords alone: a quoted ability that calls the token by its name must know the name first
        // (nameAsSelf), so "with \"...\" named X" stays unread
        const after = phraseAt(ctx, ab.end, W_NAMED);
        if (after >= 0 && own === undefined && rest.length === 0 && keywords.length > 0) {
          for (const n of ctx.call('Name', after)) out.push({ end: n.end, value: { ...t, name: n.value as string }, weak: n.weak ?? 1 });
        }
      }
    }
  };

  const walk = (p: number, st: State, depth: number): void => {
    if (depth > 12) return;
    // predefined: "Treasure token" with nothing before it
    if (depth === 0) for (const pd of multiAt(ctx, p, ctx.vocab.predefined)) if (!pd.entry.plural) finish(pd.end, st, pd.entry.name);
    finish(p, st);
    const t = ctx.toks[p];
    if (t === undefined) return;
    for (const b of basePt(ctx, p)) if (st.pt === undefined) walk(b.end, { ...st, pt: { power: b.power, toughness: b.toughness } }, depth + 1);
    if (t.kind !== 'WORD') return;
    const c = ctx.vocab.colors.get(t.norm);
    if (c !== undefined && !st.colors.includes(c) && !st.colorless) {
      const next = { ...st, colors: [...st.colors, c] };
      walk(p + 1, next, depth + 1);
      const and = phraseAt(ctx, p + 1, P('and'));
      if (and >= 0) walk(and, next, depth + 1);
    }
    if (t.norm === 'colorless' && st.colors.length === 0) walk(p + 1, { ...st, colorless: true }, depth + 1);
    const su = ctx.vocab.supertypes.get(t.norm);
    if (su !== undefined) walk(p + 1, { ...st, supertypes: [...st.supertypes, su.name] }, depth + 1);
    const ty = ctx.vocab.types.get(t.norm);
    if (ty !== undefined && !ty.plural && !st.types.includes(ty.name)) walk(p + 1, { ...st, types: [...st.types, ty.name] }, depth + 1);
    for (const s of multiAt(ctx, p, ctx.vocab.subtypes)) if (!s.entry.plural) walk(s.end, { ...st, subtypes: [...st.subtypes, s.entry.name] }, depth + 1);
    const pd = ctx.vocab.predefined.get(t.norm);
    if (pd !== undefined && !pd.plural && depth > 0 && !st.subtypes.includes(pd.name)) walk(p + 1, { ...st, subtypes: [...st.subtypes, pd.name] }, depth + 1);
  };
  walk(pos, { colors: [], colorless: false, supertypes: [], types: [], subtypes: [] }, 0);
  // r5-fxb (CR 105.2, 111.4): "a 2/2 Elemental creature token that's all colors", also after its abilities or its name ("... with trample that's all colors"):
  // a token described with no color of its own is white, blue, black, red and green
  for (const a of [...out]) {
    const tk = a.value as TokenDef;
    if (tk.predefined !== undefined || tk.colors !== undefined) continue;
    const e = anyPhraseAt(ctx, a.end, W_ALL_COLORS);
    if (e >= 0) out.push({ ...a, end: e, value: { ...tk, colors: ['W', 'U', 'B', 'R', 'G'] } });
  }
  return dedupe(out);
}

export const tokenDesc: HoleFn = (ctx, pos) => describeToken(ctx, pos);

/**
 * T55 (CR 111.4, 111.10): `NamedToken ::= Name "," ("a" | "an") TokenDesc`: "Mowu, a legendary 3/3 green Dog creature token", "The Void, a legendary 5/5 black
 * Horror Villain creature token with flying, indestructible, and \"The Void attacks each combat if able.\"". One token (the article), whose NAME is the first
 * words (a characteristic of the token, never a reference to the card that creates it, CR 201.2, 111.4). Value: the `TokenDef` with `name`.
 */
export const namedToken: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const n of ctx.call('Name', pos)) {
    if (typeof n.value !== 'string') continue;
    for (const named of [{ end: n.end, value: n.value }, ...epithet(ctx, n.end, n.value)]) {
      const comma = phraseAt(ctx, named.end, COMMA);
      if (comma < 0) continue;
      const art = anyPhraseAt(ctx, comma, [P('a'), P('an')]);
      if (art < 0) continue;
      for (const d of describeToken(ctx, art, named.value)) out.push({ ...d, weak: n.weak ?? 1 });
    }
  }
  return dedupe(out);
};

/**
 * std-rx1 (CR 111.4, 201.2): a token's given name with an epithet, "Primo, the Indivisible, a legendary 0/0 green and blue Fractal creature token" (Zimone,
 * All-Questioning): the name, a comma, "the" and a run of capitalized words. Read only here, where ", a|an <token>" must follow, never for "named ...".
 */
function epithet(ctx: HoleCtx, end: number, name: string): { end: number; value: string }[] {
  if (ctx.toks[end]?.norm !== ',' || ctx.toks[end + 1]?.text !== 'the') return [];
  let p = end + 2;
  let words = '';
  while (ctx.toks[p]?.kind === 'WORD' && /^[A-Z]/.test(ctx.toks[p]!.text)) words = `${words} ${ctx.toks[p++]!.text}`;
  return words === '' ? [] : [{ end: p, value: `${name}, the${words}` }];
}

export type { HoleCtx };
