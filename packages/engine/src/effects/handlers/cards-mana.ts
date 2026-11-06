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
import { loseUnspentMana } from '../../core/steps';
import { addMana, manaText, presetManaType } from '../../rules/mana';
import type { EffectStep } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import { COLORS, type Color, type ManaType } from '../../types/mana';
import type { ExecCtx, StepResult } from '../api';
import type { ObjHandle } from '../../types/state';
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

/** Steps of a mana ability that make no mana and don't change what it can make (pain lands: "~ deals 1 damage to you"): skipped when the types are read. */
const CP_HARMLESS_OPS: readonly string[] = ['damage', 'loseLife'];

/**
 * p2-mana-1, edh-mana-keywords-2 (CR 106.7): the types of mana the activated mana abilities of the objects `ref` names could produce now (each ability as if it
 * resolved, its costs ignored): fixed units, "any color" / "any one color" (or their listed types), one type, the colors among objects, the commander's identity,
 * and what other "could produce" abilities could produce (the Exotic Orchard example: an Orchard makes {U} because of an opponent's Island, so a Reflecting Pool
 * can too; abilities that only name each other make nothing, so the sets are the LEAST fixed point). An ability whose amount is 0 now adds no type (Gaea's
 * Cradle without creatures). Undefined when one ability's types can't be read that way (chosen elsewhere, those spent, a conditional step, ...): the caller
 * leaves the step to the player.
 */
function couldProduceTypes(cx: ExecCtx, ref: Parameters<typeof resolveObjs>[1]): Set<ManaType> | undefined {
  type Dep = { among: ObjHandle[]; colorsOnly: boolean };
  type Node = { types: Set<ManaType>; deps: Dep[] };
  const nodes = new Map<string, Node>();
  const key = (h: ObjHandle): string => `${h.zone}:${h.id}`;
  let unreadable = false;
  const visit = (h: ObjHandle): void => {
    if (nodes.has(key(h))) return;
    const node: Node = { types: new Set(), deps: [] };
    nodes.set(key(h), node);
    const info = readInfo(cx, h);
    const here: ExecCtx = { ...cx, source: h, controller: info?.object.controller ?? cx.controller }; // each ability reads its own "you" and "this" (CR 109.5)
    for (const a of info?.chars?.abilities ?? []) {
      const def = a.def;
      if (def.kind === 'manual' && def.mana === true) { unreadable = true; continue; } // CR 106.7: a mana ability the engine doesn't run still counts; the player decides
      if (def.kind !== 'activated' || def.isMana !== true) continue;
      for (const st of def.effect.steps) {
        if (st.op !== 'addMana') { if (!CP_HARMLESS_OPS.includes(st.op)) unreadable = true; continue; }
        if (st.units !== undefined) { for (const u of st.units) for (const t of u) node.types.add(t); continue; }
        const dy = st.dynamic!;
        if (dy.kind === 'eachColorAmong') { for (const t of colorsOfObjects(here, dy.among)) node.types.add(t); continue; }
        if (dy.kind === 'devotionColor' || dy.kind === 'sameAsSpent' || dy.kind === 'eventProduced') { unreadable = true; continue; }
        const n = cardCount(here, dy.count);
        if (n === undefined) { unreadable = true; continue; }
        if (n === 0) continue; // CR 106.7: a permanent that wouldn't produce any mana now has no type it could produce
        if (dy.kind === 'anyColor' || dy.kind === 'anyOneColor') for (const t of dy.from ?? COLORS) node.types.add(t);
        else if (dy.kind === 'ofType') node.types.add(dy.type);
        else if (dy.kind === 'colorsOf') for (const t of colorsOfObjects(here, dy.of)) node.types.add(t);
        else if (dy.kind === 'chosen') {
          const t = asManaType(linkValue(here, dy.link)?.values?.[0]);
          if (t !== undefined) node.types.add(t);
          for (const o of dy.or ?? []) node.types.add(o);
        } else if (dy.kind === 'couldProduce') {
          const among = resolveObjs(here, dy.among);
          node.deps.push({ among, colorsOnly: dy.colorsOnly === true });
          for (const x of among) visit(x);
        } else if (dy.kind === 'commanderIdentity') {
          const colors = identityManaColors(cx.g.s, here.controller);
          if (colors === 'unknown') unreadable = true;
          else for (const t of colors) node.types.add(t);
        } else unreadable = true;
      }
    }
  };
  const roots = resolveObjs(cx, ref);
  for (const h of roots) visit(h);
  if (unreadable) return undefined;
  // the least fixed point: a "could produce" ability adds what the objects it names could produce (CR 106.7)
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes.values()) {
      for (const d of node.deps) {
        for (const x of d.among) {
          for (const t of nodes.get(key(x))?.types ?? []) {
            if (d.colorsOnly && t === 'C') continue;
            if (!node.types.has(t)) { node.types.add(t); changed = true; }
          }
        }
      }
    }
  }
  const out = new Set<ManaType>();
  for (const h of roots) for (const t of nodes.get(key(h))?.types ?? []) out.add(t);
  return out;
}

/**
 * edh-mana-keywords-3 (CR 106.1, 106.7, 605.3b; cites unverified): the options of each unit of an `addMana` whose types come from the game state alone, read
 * exactly as `produce` will when the ability resolves but without choosing ("Add one mana of any color among legendary creatures you control" (colorsOf), "For
 * each color among permanents you control" (eachColorAmong), "one mana of any type that a land you control could produce" (couldProduce)). rules/mana.ts#computedManaUnits
 * hands it to the automatic payer and the castability check, so a Mox Amber or a Reflecting Pool pays for a spell with no tap by hand first. Undefined: not one of
 * these productions, or one the engine can't read (the player activates it, as before).
 */
export function plannedProduction(cx: ExecCtx, st: AddMana): { units: ManaType[][]; oneType: boolean } | undefined {
  const d = st.dynamic;
  if (d === undefined) return undefined;
  if (d.kind === 'eachColorAmong') {
    const have = colorsOfObjects(cx, d.among);
    return { units: COLORS.filter((c) => have.has(c)).map((c) => [c]), oneType: false };
  }
  if (d.kind !== 'colorsOf' && d.kind !== 'couldProduce') return undefined;
  const n = cardCount(cx, d.count);
  if (n === undefined) return undefined;
  const options = d.kind === 'colorsOf'
    ? COLORS.filter((c) => colorsOfObjects(cx, d.of).has(c))
    : (() => { const types = couldProduceTypes(cx, d.among); return types === undefined ? undefined : MANA_TYPES.filter((t) => types.has(t) && (d.colorsOnly !== true || t !== 'C')); })();
  if (options === undefined) return undefined;
  if (options.length === 0 || n <= 0) return { units: [], oneType: false };
  return { units: Array.from({ length: n }, () => [...options]), oneType: d.kind === 'couldProduce' && d.oneType === true };
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
    case 'anyColor': {
      // edh-mana-keywords-3 (CR 105.1, 105.4, 106.1): "two mana of different colors": each unit a color none of the earlier units is
      if (d.distinct === true) {
        const left: ManaType[] = [...(d.from ?? COLORS)];
        const out: ManaType[] = [];
        for (let i = 0; i < n && left.length > 0; i++) {
          const t = chooseType(g, p, left, `mana ${i + 1} of ${n}, a color different from the other mana`);
          out.push(t);
          left.splice(left.indexOf(t), 1);
        }
        return out;
      }
      return Array.from({ length: n }, (_, i) => chooseType(g, p, d.from ?? COLORS, `mana ${i + 1} of ${n}, ${d.from === undefined ? 'any color' : d.from.map((t) => `{${t}}`).join(' or ')}`));
    }
    case 'anyOneColor': {
      if (n === 0) return [];
      // FAST5 T48 (CR 106.1b): "X {G} or X {W}" limits the one choice to those types
      const t = chooseType(g, p, d.from ?? COLORS, `${n} mana of one color`);
      const first = Array.from({ length: n }, () => t);
      if (d.otherGroup === undefined) return first;
      // edh-d-22 (CR 106.1b, 106.4; Open the Omenpaths): "... and two mana of any other color": one more color, not the first group's
      const m = cardCount(cx, d.otherGroup);
      if (m === undefined) return undefined;
      if (m === 0) return first;
      const t2 = chooseType(g, p, (d.from ?? COLORS).filter((c) => c !== t), `${m} mana of one color other than {${t}}`);
      return [...first, ...Array.from({ length: m }, () => t2)];
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
      // edh-mana-keywords-1 (CR 106.1b, 106.7): "add three mana of that type instead": one choice, every unit the same type
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
export const OP_FORMS: readonly string[] = ['op:addMana.couldProduce.oneType' /* edh-mana-keywords-1 */, 'op:addMana.keepEndOfCombat', 'op:addMana.keepEndOfTurn' /* std-mkm: until end of turn (CR 514.2, 500.5) */, 'op:addMana.chosenOr' /* CMD3: "Add {W} or one mana of the chosen color" */, 'op:addMana.playerOfChoice' /* edh-misc-6 */];

/** CR 106.3-106.4: the player adds the mana to their mana pool. With a `ManaRestriction` it can be spent only as it says (CR 106.6, enforced by payment). */
export function addManaHandler(cx: ExecCtx, st: AddMana): StepResult {
  if ((st.units === undefined) === (st.dynamic === undefined)) throw new EngineBug('addMana needs exactly one of `units` and `dynamic` (design 3.2)');
  const g = cx.g;
  const sourceChars = readInfo(cx, cx.source)?.chars ?? null;
  const snow = sourceChars?.supertypes.includes('Snow') === true; // CR 107.4h: mana from a snow source is snow mana
  const source = sourceObject(cx); // CR 106.3: the spell, or the source of the ability; its id survives a sacrifice as a cost (Lotus Petal)
  let total = 0;
  // edh-misc-6 (CR 106.4, 608.2d): "a player of your choice adds {C}" (Victory Chimes): `who` picks any player as the step resolves and that player adds the mana
  const receivers = st.ofYourChoice === true ? playersOf(cx, st.who).map((chooser) => {
    const all = g.apnap();
    return all.length === 1 ? all[0]! : g.choose({ kind: 'chooseOption', player: chooser, prompt: 'Choose a player to add the mana.', min: 1, max: 1, options: all.map((id) => ({ id, label: g.player(id).name })), rules: ['CR 106.4', 'CR 608.2d'] }).ids[0]!;
  }) : playersOf(cx, st.who);
  for (const p of receivers) {
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

/**
 * edh-c-85 (CR 106.4, 500.5, 614.1; Mana Short): "that player loses all unspent mana": each player `who` names loses every unit in their pool now (core/steps.ts#loseUnspentMana).
 * The result counts the units lost.
 */
export function emptyManaPoolHandler(cx: ExecCtx, st: Extract<EffectStep, { op: 'emptyManaPool' }>): StepResult {
  let total = 0;
  for (const p of playersOf(cx, st.who)) {
    const n = loseUnspentMana(cx.g, p);
    if (n > 0) logAction(cx, `${playerName(cx.g, p)} loses all unspent mana.`, ['CR 106.4']);
    total += n;
  }
  return total > 0 ? result(total) : NOTHING;
}
