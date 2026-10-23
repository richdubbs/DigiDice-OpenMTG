/**
 * Scoring the priority actions `legalActions` lists (CR 117.1): playing a land (CR 305), casting a spell (CR 601), activating an ability (CR 602, 606).
 * Mana abilities are never chosen here: the engine's auto-payer activates them while paying (CR 605.3b).
 */
import { faceChars, findAbility, hasKeyword, type AbilityDef, type Chars, type LegalAction, type ObjectId, type TargetSpec } from '@openmtg/engine';
import { availableMana, battlefield, canTapToAttack, castTax, creatures, hand, libraryCount, LIBRARY_MARGIN, multi, safeToDraw, type Ctx } from './context';
import { asksByHand, auraPolarity, modePrograms, possibleDraws, programOf, qty, summarize, usefulSummary } from './intent';
import { actionLife, affordsLife } from './life';
import { bestPick, effectScore, type Timing } from './score';
import { spellAbilityOf } from './source';
import { chooseFrom, estimatePool, type Want } from './targets';
import { cardValue } from './value';
import { isMain, type Window } from './windows';

const PERMANENT = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle'];

type Activated = Extract<AbilityDef, { kind: 'activated' }>;

export function scoreAction(ctx: Ctx, la: LegalAction, w: Window): number {
  const a = la.action;
  if (a.type === 'playLand') return 1000 + landPreference(ctx, a.card, a.face ?? 0);
  // CMP1 (CR 116.2g, 702.139a): put the companion into the hand for {3}: a card more, taken once its other plays are made (the lowest positive score).
  if (a.type === 'special' && a.kind === 'companion') return 1;
  let score = 0;
  let def: Activated | undefined;
  if (a.type === 'cast') score = scoreCast(ctx, a.card, a.face ?? 0, w);
  else if (a.type === 'activate') {
    def = activatedDef(ctx, a.source, a.ability);
    score = def ? scoreActivate(ctx, a.source, def, w) : 0;
  }
  // CR 119.4, 107.4f: a play whose life payment the bot can't spare is not made (at 0 life it would lose before the spell resolved, CR 104.3b).
  if (score > 0 && !affordsLife(ctx, actionLife(ctx, a, def?.cost), score)) return 0;
  return score;
}

// ---- lands ----------------------------------------------------------------------------------------------------------------------

const BASIC_COLOR: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

export function colorsMade(c: Chars): string[] {
  const out = new Set<string>();
  for (const st of c.subtypes) if (BASIC_COLOR[st]) out.add(BASIC_COLOR[st]!);
  for (const ab of c.abilities) {
    const d = ab.def;
    if (d.kind !== 'activated' || !d.isMana) continue;
    for (const s of d.effect.steps) if (s.op === 'addMana') for (const u of s.units ?? [['C']]) for (const t of u) out.add(t);
  }
  return [...out];
}

/** Colored mana symbols of the cards in hand that the bot's lands can't make yet: a land that makes them is played first. */
function landPreference(ctx: Ctx, id: ObjectId, face: number): number {
  const def = ctx.view.defs[ctx.view.objects[id]?.defId ?? ''];
  if (!def) return 0;
  const made = colorsMade(faceChars(def, face));
  const have = new Set(battlefield(ctx, ctx.me, 'Land').flatMap((l) => { const c = ctx.chars(l); return c ? colorsMade(c) : []; }));
  let score = 0;
  for (const h of hand(ctx, ctx.me)) {
    const c = ctx.chars(h);
    if (!c || c.types.includes('Land')) continue;
    for (const sym of c.manaCost ?? []) {
      const colors = sym.kind === 'colored' ? [sym.color] : sym.kind === 'hybrid' ? sym.colors : [];
      if (colors.some((col) => made.includes(col) && !have.has(col))) score += 1;
    }
  }
  return score + made.length * 0.1;
}

// ---- spells ---------------------------------------------------------------------------------------------------------------------

/** Casting text the engine does not enforce: an additional or alternative cost, a higher cost, or a casting restriction (CR 601.2b, 601.2f, 118.9). */
const CASTING_TEXT = /additional cost|rather than pay|cast this spell only|can't be cast|costs? .*\bmore to cast/i;
const CASTING_REASON = /additionalCost|alternativeCost|costMod|castRestrict/i;

/** A manual ability that changes how the card is cast: casting it would skip a cost or a restriction, silently (never done, ARCHITECTURE). */
export function manualCasting(abilities: readonly AbilityDef[]): boolean {
  return abilities.some((a) => a.kind === 'manual' && a.shape !== 'spell' && (CASTING_TEXT.test(a.text) || CASTING_REASON.test(a.reason)));
}

/**
 * A cast from the hand, or of anything else `legalActions` lists. M11-3 (m11 design 7): a commander cast from the command zone (CR 903.8) is scored like
 * the same card in the hand, with its commander tax as part of the cost: the tax is mana the bot can't spend elsewhere (X, mana kept for a counter),
 * and the same card costs that much more, so it counts against the cast (CR 903.8 adds {2} per earlier cast; the mana value itself does not change,
 * CR 202.3). Whether the bot can pay the whole cost is the engine's to say: it lists only casts it can pay for.
 */
function scoreCast(ctx: Ctx, id: ObjectId, face: number, w: Window): number {
  const def = ctx.view.defs[ctx.view.objects[id]?.defId ?? ''];
  if (!def) return 0;
  const c = faceChars(def, face);
  if (c.types.includes('Land')) return 0;
  const abilities = def.faces[face]?.abilities ?? [];
  if (manualCasting(abilities)) return 0;
  const tax = castTax(ctx, id);
  const sorcery = !c.types.includes('Instant') && !hasKeyword(c, 'flash');
  if (c.types.some((t) => PERMANENT.includes(t))) {
    const score = scorePermanent(ctx, c, abilities, w, sorcery, tax);
    return score > 0 && tax > 0 ? Math.max(1, score - tax) : score;
  }
  const ab = spellAbilityOf(def, face);
  if (!ab || ab.kind === 'manual') return 0; // the whole effect is text to resolve by hand: never cast for it
  const program = programOf(ab);
  const score = scoreProgramWithModes(ctx, program, null, { window: w, sorcery }, Math.min(xFor(ctx, c, tax), drawXCap(ctx, program)));
  return score > 0 && tax > 0 ? Math.max(1, score - tax) : score;
}

/** X for a spell with {X} (CR 107.3): what the bot's mana can pay beyond the rest of the cost (the commander tax included, CR 903.8, 601.2f). */
function xFor(ctx: Ctx, c: Chars, tax = 0): number {
  if (!(c.manaCost ?? []).some((s) => s.kind === 'variable')) return 0;
  return Math.max(0, availableMana(ctx, ctx.me) - c.manaValue - tax);
}

/** The largest X for which an effect that draws X cards (aimed at the bot) leaves the bot more than `LIBRARY_MARGIN` cards (CR 121.4); Infinity otherwise. */
export function drawXCap(ctx: Ctx, program: ReturnType<typeof programOf>): number {
  if (!program) return Infinity;
  const base = possibleDraws(summarize(program, 0));
  const perX = possibleDraws(summarize(program, 1)) - base;
  if (perX <= 0) return Infinity;
  return Math.max(0, Math.floor((libraryCount(ctx, ctx.me) - LIBRARY_MARGIN - 1 - base) / perX));
}

export function scoreProgramWithModes(ctx: Ctx, program: ReturnType<typeof programOf>, sourceId: ObjectId | null, t: Timing, x = 0): number {
  if (!program) return 0;
  const base = summarize(program, x);
  const modes = modePrograms(program);
  if (modes.length === 0) return usefulSummary(base) ? effectScore(ctx, base, sourceId, t) : 0;
  // CR 700.2: score each mode on its own and take the best ones the spell allows.
  const max = program.modes!.max === 'any' ? modes.length : qty(program.modes!.max);
  const scores = modes.map((m) => effectScore(ctx, summarize(m, x), sourceId, t)).sort((a, b) => b - a);
  const min = qty(program.modes!.min);
  const k = Math.max(min, Math.min(max, scores.filter((s) => s > 0).length));
  if (k > scores.length || k === 0) return 0;
  return scores.slice(0, k).reduce((n, s) => n + s, 0);
}

function scorePermanent(ctx: Ctx, c: Chars, abilities: readonly AbilityDef[], w: Window, sorcery: boolean, tax = 0): number {
  // CR 704.5j: a second legendary permanent with the same name would only be put into the graveyard.
  if (c.supertypes.includes('Legendary') && battlefield(ctx, ctx.me).some((id) => ctx.chars(id)?.name === c.name)) return 0;
  const main = isMain(w);
  if (!main && sorcery) return 0;
  if (c.subtypes.includes('Aura')) return scoreAura(ctx, c, abilities, w);
  let score = 0;
  if (c.types.includes('Creature')) {
    // Creatures go down after combat unless they can attack now (haste) or the bot has nothing that could attack anyway.
    const attackers = creatures(ctx, ctx.me).some((id) => canTapToAttack(ctx, id));
    if (w === 'myMain1' && !hasKeyword(c, 'haste') && attackers) return 0;
    if (!main && !(w === 'oppEnd' || w === 'oppAttack')) return 0; // flash creatures: end of turn or as a surprise blocker
    score = 50 + cardValue(c) + c.manaValue * 2;
  } else if (c.types.includes('Planeswalker')) score = 60 + c.manaValue * 2;
  else if (c.subtypes.includes('Equipment')) score = creatures(ctx, ctx.me).length > 0 ? 25 + c.manaValue : 5;
  else score = 20 + c.manaValue;
  if (!c.types.includes('Planeswalker') && !c.subtypes.includes('Equipment')) {
    const etb = etbScore(ctx, c, abilities);
    if (etb === null) return 0;
    score += etb;
  }
  if (reserveForCounter(ctx, c, tax)) return 0;
  return Math.max(0, score);
}

/**
 * "When this enters, ..." (CR 603.6a). `null` when a mandatory harmful trigger could only hit the bot's own things, the entering permanent itself
 * included (its targets are chosen once it is on the battlefield, CR 603.3d): the bot does not cast it now. An optional one ("you may") counts for
 * nothing then: the bot will decline it (answers.ts).
 */
function etbScore(ctx: Ctx, c: Chars, abilities: readonly AbilityDef[]): number | null {
  let n = 0;
  for (const a of abilities) {
    if (a.kind !== 'triggered' || !a.trigger.on.some((e) => e.ev === 'zoneChange' && e.to === 'battlefield' && e.subject?.self === true)) continue;
    const s = summarize(a.effect);
    for (const u of s.uses) {
      const pick = bestPick(ctx, u, null);
      const hitsItself = u.polarity === 'harm' && canTargetItself(u.spec, c);
      if (!pick && !hitsItself) continue; // no legal target: the trigger is removed from the stack (CR 603.3d)
      if (!pick || pick.score <= 0) {
        if (u.polarity === 'harm' && !u.optional) return null;
        continue;
      }
      n += Math.min(10, pick.score);
    }
    n += s.draws * 2 + s.tokens * 2 + s.lifeGain * 0.2;
  }
  return n;
}

/** Whether a target spec of the permanent's own trigger can name the permanent itself (no "another", CR 115.1d; a type it has). */
function canTargetItself(spec: TargetSpec, c: Chars): boolean {
  if (spec.kind === 'anyTarget') return c.types.some((t) => t === 'Creature' || t === 'Planeswalker' || t === 'Battle');
  if (spec.kind !== 'object') return false;
  const f = spec.filter;
  if (f?.other || f?.controller === 'opponent') return false;
  const zone = f?.zone;
  if (zone !== undefined && zone !== 'battlefield' && !(Array.isArray(zone) && zone.includes('battlefield'))) return false;
  return !f?.types || f.types.some((t) => c.types.includes(t as never));
}

/** Holding a counterspell (CR 701.6) while the opponent still has cards: keep its mana open once the bot has a board. `tax`: CR 903.8. */
function reserveForCounter(ctx: Ctx, c: Chars, tax = 0): boolean {
  if (creatures(ctx, ctx.me).length < 2) return false;
  // M12-6 (A10): with several opponents, while any of them still has cards
  if (multi(ctx) ? ctx.opps.every((p) => (ctx.view.zones.hand[p] ?? []).length < 2) : (ctx.view.zones.hand[ctx.opp] ?? []).length < 2) return false;
  let reserve = Infinity;
  for (const h of hand(ctx, ctx.me)) {
    const hc = ctx.chars(h);
    if (!hc) continue;
    const ab = spellAbilityOf(ctx.view.defs[ctx.view.objects[h]?.defId ?? ''], 0);
    const p = programOf(ab);
    if (p && summarize(p).uses.some((u) => u.kind === 'counter')) reserve = Math.min(reserve, hc.manaValue);
  }
  return reserve !== Infinity && availableMana(ctx, ctx.me) - c.manaValue - tax < reserve;
}

/** An Aura goes on the bot's best creature (a bonus) or the opponent's best (Pacifism-style), CR 303.4. */
function scoreAura(ctx: Ctx, c: Chars, abilities: readonly AbilityDef[], w: Window): number {
  const pol = auraPolarity(abilities);
  if (!pol) return 0;
  const enchant = abilities.find((a) => a.kind === 'keyword' && a.keyword === 'enchant');
  const filter = enchant && enchant.kind === 'keyword' ? enchant.filter : undefined;
  const want: Want = { polarity: pol.polarity, kind: pol.polarity === 'help' ? 'attach' : 'restrict', amount: pol.toughness, power: pol.power };
  const pool = estimatePool(ctx, { id: 'aura', kind: 'object', min: 1, max: 1, text: 'enchant', ...(filter ? { filter } : {}) }, null);
  const pick = chooseFrom(ctx, want, pool, 1, 1);
  if (pick.targets.length === 0 || pick.score <= 0) return 0;
  if (pol.polarity === 'harm') return pick.score >= 3 ? 35 + pick.score : 0;
  return 20 + pick.score + (w === 'myMain1' ? 5 : 0);
}

// ---- abilities ------------------------------------------------------------------------------------------------------------------

/** Cost parts the bot pays without thinking twice: tapping, mana, loyalty, counters on the source (CR 118, 602.2b). */
function cheapCost(def: Activated): boolean {
  return (def.cost.other ?? []).every((p) => p.kind === 'tapUntapped' || (p.kind === 'removeCounters' && p.self === true));
}

/** The activated ability behind a listed activation; a manual ability (resolved only by hand) is not one the bot uses. */
function activatedDef(ctx: Ctx, source: ObjectId, key: string): Activated | undefined {
  try {
    const def = findAbility(ctx.state, source, key)?.def;
    return def?.kind === 'activated' ? def : undefined;
  } catch { return undefined; }
}

function scoreActivate(ctx: Ctx, source: ObjectId, def: Activated, w: Window): number {
  if (def.isMana || !cheapCost(def)) return 0;
  // "Activate only if ..." that the engine can't check: the controller would have to attest it (CR 602.5b); the bot never attests anything.
  if (def.onlyIf && asksByHand(def.onlyIf)) return 0;
  const program = def.effect;
  const s = summarize(program);
  if (s.manual) return 0;
  if (!safeToDraw(ctx, possibleDraws(s))) return 0; // "each player draws", "target player draws": never deck itself (CR 121.4, 704.5b)
  const o = ctx.view.objects[source];
  if (def.isLoyalty || def.cost.loyalty !== undefined) {
    // CR 606: one loyalty ability per turn; the bot prefers the ones that keep the planeswalker alive.
    const now = o?.counters['loyalty'] ?? 0;
    const after = now + (def.cost.loyalty ?? 0);
    const eff = scoreProgramWithModes(ctx, program, source, { window: isMain(w) ? 'myMain2' : w, sorcery: true });
    if (after <= 0 && eff < 30) return 0;
    if (eff <= 0 && (def.cost.loyalty ?? 0) < 0) return 0;
    return 5 + Math.min(eff, 40) + (def.cost.loyalty ?? 0) * 1.5 + (eff > 0 ? 0 : 1);
  }
  if (s.uses.some((u) => u.kind === 'attach')) {
    // Equip (CR 702.6): onto the best creature, once.
    if (!isMain(w) || (o?.attachedTo && creatures(ctx, ctx.me).includes(o.attachedTo))) return 0;
    return effectScore(ctx, s, source, { window: w, sorcery: true });
  }
  const tapsCreature = def.cost.tap === true && ctx.chars(source)?.types.includes('Creature');
  // A creature that taps for its ability can't attack or block: do it at the end of the opponent's turn, or when it kills something.
  const t = { window: w, sorcery: def.sorcerySpeed === true, repeatable: def.cost.tap === true && (def.cost.mana ?? []).length === 0 };
  const score = scoreProgramWithModes(ctx, program, source, t);
  if (tapsCreature && w !== 'oppEnd' && score < 25) return 0;
  return score;
}
