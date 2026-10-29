/**
 * addMana (CR 106, 605.3b). Owner: WP13. Adding mana is not an event a replacement effect of this build can modify, so it goes straight to milestone 3's
 * primitive `rules/mana.ts#addMana` (the performer of mana; design 8.5 lists no `addMana` proposal).
 *
 * The source of the mana (CR 106.3) is the spell that produces it, or the source of the ability; every unit records it (`ManaUnit.sourceId`), whether the
 * producer is a spell, an activated or triggered mana ability, or a non-mana ability on the stack. Whether the mana counts as a mana ability being ACTIVATED
 * (CR 605.3b, the `activate` trigger event) is not inferred from the source: only the activation path says so (`manaAdded.viaActivation`, set by
 * `activateManaAbility`; when WP10's spine resolves an activated mana ability through this handler it must mark it too, see the it.todo in
 * test/m5/cards/pipeline.test.ts). A spending restriction that names a choice of its source
 * ("a creature spell of the chosen type", CR 607.2d) is evaluated against `sourceId` by the payment code (rules/sources.ts).
 */
import { EngineBug } from '../../core/errors';
import type { Game } from '../../core/game';
import { addMana, manaText, presetManaType } from '../../rules/mana';
import type { EffectStep } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import { COLORS, type Color, type ManaType } from '../../types/mana';
import type { ExecCtx, StepResult } from '../api';
import { askManual } from '../manual';
import { linkValue, readInfo, resolveObjs, sourceObject } from '../refs';
import { cardCount, logAction, NOTHING, playerName, playersOf, result } from './cards-util';
import { identityManaColors } from '../../statics/commander';

type AddMana = Extract<EffectStep, { op: 'addMana' }>;

const COLOR_BY_NAME: Readonly<Record<string, ManaType>> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };
const MANA_TYPES: readonly ManaType[] = [...COLORS, 'C'];

/** A chosen color as a mana type ("green" or "G"); undefined when nothing usable was chosen (CR 607.5a: the linked ability does nothing). */
function asManaType(v: string | undefined): ManaType | undefined {
  if (v === undefined) return undefined;
  const t = COLOR_BY_NAME[v.toLowerCase()] ?? v.toUpperCase();
  return (MANA_TYPES as readonly string[]).includes(t) ? (t as ManaType) : undefined;
}

function chooseType(g: Game, p: PlayerId, options: readonly ManaType[], why: string): ManaType {
  if (options.length === 1) return options[0]!;
  const preset = presetManaType(g, options); // the type the automatic payer (or the payment decision) chose for this activation
  if (preset !== undefined) return preset;
  return g.choose({ kind: 'chooseColor', player: p, prompt: `Choose the type of mana to add (${why}).`, options: [...options], rules: ['CR 106.1b', 'CR 106.4'] }).color;
}

/** The colors the objects `ref` stands for have (CR 105.2; last known information for one that left, CR 608.2h). Colorless is not a color (CR 105.4). */
function colorsOfObjects(cx: ExecCtx, ref: Parameters<typeof resolveObjs>[1]): Set<ManaType> {
  const out = new Set<ManaType>();
  for (const h of resolveObjs(cx, ref)) for (const c of readInfo(cx, h)?.chars?.colors ?? []) out.add(c);
  return out;
}

/**
 * p2-mana-1, CR 106.7: the types of mana the activated mana abilities of the objects `ref` names could produce now (each ability as if it resolved, its costs
 * ignored): fixed units, "any color" / "any one color" (or their listed types), one type, and the commander's identity. Undefined when one ability's types
 * can't be read that way (chosen elsewhere, those spent, ...); another "could produce" ability adds nothing (CR 106.7): the caller leaves the step to the player.
 */
function couldProduceTypes(cx: ExecCtx, ref: Parameters<typeof resolveObjs>[1]): Set<ManaType> | undefined {
  const out = new Set<ManaType>();
  for (const h of resolveObjs(cx, ref)) {
    for (const a of readInfo(cx, h)?.chars?.abilities ?? []) {
      const def = a.def;
      if (def.kind !== 'activated' || def.isMana !== true) continue;
      for (const st of def.effect.steps) {
        if (st.op !== 'addMana') return undefined;
        if (st.units !== undefined) { for (const u of st.units) for (const t of u) out.add(t); continue; }
        const dy = st.dynamic!;
        if (dy.kind === 'anyColor' || dy.kind === 'anyOneColor') for (const t of dy.from ?? COLORS) out.add(t);
        else if (dy.kind === 'ofType') out.add(dy.type);
        // CR 106.7: an ability that itself produces what something "could produce" defines no type here (Reflecting Pool's rulings: such abilities don't feed each other; Gond Gate is a Gate)
        else if (dy.kind === 'couldProduce') continue;
        else if (dy.kind === 'commanderIdentity') {
          const colors = identityManaColors(cx.g.s, cx.controller);
          if (colors === 'unknown') return undefined;
          for (const t of colors) out.add(t);
        } else return undefined;
      }
    }
  }
  return out;
}

/** The types of the units `p` adds, in order; undefined when the amount fails to determine (CR 608.2b) or the engine has to ask the players. */
function produce(cx: ExecCtx, st: AddMana, p: PlayerId): ManaType[] | undefined {
  const g = cx.g;
  if (st.units !== undefined) return st.units.map((options, i) => chooseType(g, p, options, `unit ${i + 1}`));
  const d = st.dynamic!;
  if (d.kind === 'sameAsSpent') {
    // "one mana of any type that was spent to activate this ability" (CR 106.1b): read from the costs paid for the spell or ability.
    if (!cx.stack) {
      askManual(cx, st.span ?? 'Add one mana of any type that was spent to activate this ability.', 'the mana spent is not recorded for an ability that does not use the stack');
      return undefined;
    }
    const spent = [...new Set((cx.stack.costsPaid.manaSpent ?? []).map((u) => u.type))];
    return spent.length === 0 ? [] : [chooseType(g, p, spent, 'a type of mana spent to activate this ability')];
  }
  // FAST5 T48 (CR 105.1, 105.4, 106.4, 608.2h): "For each color among permanents you control, add one mana of that color": one of each color some object has
  if (d.kind === 'eachColorAmong') {
    const have = colorsOfObjects(cx, d.among);
    return COLORS.filter((c) => have.has(c));
  }
  // p2-mana-2, CR 700.5, 106.1: "Choose a color. Add an amount of mana of that color equal to your devotion to that color.": the color first, then the amount
  if (d.kind === 'devotionColor') {
    const t = chooseType(g, p, COLORS, 'a color: you add mana of it equal to your devotion to it');
    const k = cardCount(cx, { q: 'devotion', to: [t as Color], of: d.of });
    return k === undefined ? undefined : Array.from({ length: k }, () => t);
  }
  const n = cardCount(cx, d.count);
  if (n === undefined) return undefined;
  switch (d.kind) {
    // r3-cost (CR 106.1, 106.4): "Add {R} or {G} for each Raccoon you control": each unit one of `from`
    case 'anyColor': return Array.from({ length: n }, (_, i) => chooseType(g, p, d.from ?? COLORS, `mana ${i + 1} of ${n}, ${d.from === undefined ? 'any color' : d.from.map((t) => `{${t}}`).join(' or ')}`));
    case 'anyOneColor': {
      if (n === 0) return [];
      // FAST5 T48 (CR 106.1b): "X {G} or X {W}" limits the one choice to those types
      const t = chooseType(g, p, d.from ?? COLORS, `${n} mana of one color`);
      return Array.from({ length: n }, () => t);
    }
    case 'colorsOf': {
      // FAST5 T48 (CR 106.5): "one mana of any of the exiled cards' colors": no color among them, no mana
      const options = COLORS.filter((c) => colorsOfObjects(cx, d.of).has(c));
      if (options.length === 0) return [];
      return Array.from({ length: n }, (_, i) => chooseType(g, p, options, `mana ${i + 1} of ${n}, a color of those objects`));
    }
    case 'chosen': {
      const t = asManaType(linkValue(cx, d.link)?.values?.[0]);
      // CMD3 (CR 106.1b, 607.2d): "Add {W} or one mana of the chosen color": each unit one of the listed types or the chosen color (only the listed ones
      // when no color was chosen)
      if (d.or !== undefined) {
        const options = [...new Set<ManaType>([...d.or, ...(t === undefined ? [] : [t])])];
        return Array.from({ length: n }, (_, i) => chooseType(g, p, options, `mana ${i + 1} of ${n}`));
      }
      return t === undefined ? [] : Array.from({ length: n }, () => t);
    }
    case 'ofType': return Array.from({ length: n }, () => d.type);
    case 'commanderIdentity': {
      // M11-1, CR 903.4, 702.124c: each unit any color of `p`'s commander's color identity (both partners' combined). CR 903.4f: no commander (any game that
      // is not a Commander game) or a colorless identity: this part of the ability does nothing. An identity the game was not given: by hand (CR 903.4a).
      const colors = identityManaColors(g.s, p);
      if (colors === 'unknown') {
        askManual(cx, st.span ?? "Add mana of a color in your commander's color identity.", "the commander's color identity is not known to the engine");
        return undefined;
      }
      if (colors.length === 0 || n === 0) return [];
      return Array.from({ length: n }, (_, i) => chooseType(g, p, colors, `mana ${i + 1} of ${n}, a color in your commander's color identity`));
    }
    case 'couldProduce': {
      // p2-mana-1, CR 106.7: the types the mana abilities of those objects could produce now (costs ignored); one unknown makes the step manual
      const types = couldProduceTypes(cx, d.among);
      if (types === undefined) {
        askManual(cx, st.span ?? 'Add one mana of a type those permanents could produce.', 'a mana ability of those permanents produces a type the engine can\'t read (CR 106.7)');
        return undefined;
      }
      const options = MANA_TYPES.filter((t) => types.has(t) && (d.colorsOnly !== true || t !== 'C'));
      if (options.length === 0) return []; // CR 106.7: no type can be defined, no mana
      // edh-mana-keywords-1 (CR 106.1, 106.7): "add three mana of that type instead": one choice, every unit the same type
      if (d.oneType === true) {
        if (n === 0) return [];
        const t = chooseType(g, p, options, `${n} mana of one type those permanents could produce`);
        return Array.from({ length: n }, () => t);
      }
      return Array.from({ length: n }, (_, i) => chooseType(g, p, options, `mana ${i + 1} of ${n}, a type those permanents could produce`));
    }
    case 'eventProduced': {
      // T38, CR 106.3, 605.1b: a type the triggering mana ability produced (Mana Flare); the trigger's context records them
      if (cx.event === undefined || cx.event === null) {
        askManual(cx, st.span ?? `Add one mana of any type that ${d.noun} produced.`, 'there is no triggering mana ability to read the produced mana from');
        return undefined;
      }
      const made = [...new Set(cx.event.produced ?? [])];
      if (made.length === 0) {
        g.log('No mana was recorded for the activation that triggered this, so none is added.', { rules: ['CR 106.3', 'CR 605.4a'], level: 'warning' });
        return [];
      }
      return Array.from({ length: n }, (_, i) => chooseType(g, p, made, `mana ${i + 1} of ${n}, a type that ${d.noun} produced`));
    }
  }
}

/**
 * FAST5 MX6 (`OP_FORMS`): "Until end of combat, you don't lose this mana as steps and phases end" (`keep: 'endOfCombat'`, firebending CR 702.189a): the units
 * carry the mark and core/steps.ts#endOfStepCleanup keeps them through the end of each combat step but the last (CR 500.5, 106.4).
 */
export const OP_FORMS: readonly string[] = ['op:addMana.couldProduce.oneType' /* edh-mana-keywords-1 */, 'op:addMana.keepEndOfCombat', 'op:addMana.keepEndOfTurn' /* std-mkm: until end of turn (CR 514.2, 500.5) */, 'op:addMana.chosenOr' /* CMD3: "Add {W} or one mana of the chosen color" */];

/** CR 106.3-106.4: the player adds the mana to their mana pool. With a `ManaRestriction` it can be spent only as it says (CR 106.6, enforced by payment). */
export function addManaHandler(cx: ExecCtx, st: AddMana): StepResult {
  if ((st.units === undefined) === (st.dynamic === undefined)) throw new EngineBug('addMana needs exactly one of `units` and `dynamic` (design 3.2)');
  const g = cx.g;
  const sourceChars = readInfo(cx, cx.source)?.chars ?? null;
  const snow = sourceChars?.supertypes.includes('Snow') === true; // CR 107.4h: mana from a snow source is snow mana
  const source = sourceObject(cx); // CR 106.3: the spell, or the source of the ability; its id survives a sacrifice as a cost (Lotus Petal)
  let total = 0;
  for (const p of playersOf(cx, st.who)) {
    const types = produce(cx, st, p);
    if (types === undefined) return total > 0 ? result(total) : NOTHING;
    if (types.length === 0) continue;
    // std-copy-3 (CR 106.6, 603.2): "When that mana is spent to cast ...": the units carry the trigger, controlled by this ability's controller
    const whenSpent = st.whenSpent && source ? { whenSpent: { ...structuredClone(st.whenSpent), controller: cx.controller, sourceId: source.id } } : {};
    addMana(g, p, types, source, snow, st.restriction, { ...(st.keep ? { keep: st.keep } : {}), ...(st.rider ? { rider: st.rider } : {}), ...whenSpent }); // std-mana-1: `rider`; std-copy-3: `whenSpent`
    total += types.length;
    // std-mana-12 (CR 106.1, 608.2c): "that color" of a later instruction is the color of the one mana of one color added (none for colorless or several mana)
    if (st.link !== undefined && types.length === 1 && types[0] !== 'C') cx.choices?.set(st.link, { values: [types[0]!] });
    const kept = st.keep === 'endOfCombat' ? ' (it lasts until end of combat)' : st.keep === 'endOfTurn' ? ' (it lasts until end of turn)' : '';
    logAction(cx, `${playerName(g, p)} adds ${manaText(types)}${st.restriction ? ' (restricted)' : ''}${kept}.`, ['CR 106.3', 'CR 106.4', ...(st.restriction ? ['CR 106.6'] : []), ...(st.keep === 'endOfCombat' ? ['CR 702.189a', 'CR 500.5'] : st.keep === 'endOfTurn' ? ['CR 500.5', 'CR 514.2'] : [])]);
  }
  return result(total);
}
