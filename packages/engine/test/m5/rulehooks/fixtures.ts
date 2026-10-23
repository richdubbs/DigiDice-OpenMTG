/**
 * Fixtures for the WP16 tests (rule hooks and cost modifiers): cards whose restriction, permission, rule and cost abilities are written as model JSON (what
 * the template parser of W3 produces for their Oracle text; the default compiler of milestone 4 leaves those lines manual). Nothing here is card-specific
 * engine code: a card is an `AbilityDef` list.
 */
import {
  type AbilityDef, type CardDef, type ContinuousEffectRec, type CostModDef, type GameState, type ObjectId, type ObjRef, type PermissionDef,
  type PlayerRef, type RestrictionDef, type RuleAction, type RuleModDef, type StaticAbilityDef,
} from '../../../src/index';
import { compiledDefs } from '../../fixtures';
import { put, synth, tweak } from '../helpers';

export const SELF: ObjRef = { ref: 'self' };
export const ENCHANTED: ObjRef = { ref: 'attachedTo' };
export const YOU: PlayerRef = { ref: 'you' };
export const OPPONENTS: PlayerRef = { ref: 'each', who: 'opponent' };
export const EACH_PLAYER: PlayerRef = { ref: 'each', who: 'player' };

export const cant = (subject: RestrictionDef['subject'], action: RuleAction, extra: Partial<RestrictionDef> = {}): RestrictionDef => ({ s: 'restrict', subject, mode: 'cant', action, ...extra });
export const staticOf = (text: string, effects: StaticAbilityDef['effects'], extra: Partial<StaticAbilityDef> = {}): StaticAbilityDef => ({ kind: 'static', text, effects, ...extra });
/** A spell effect the engine resolves by hand (the tests here never resolve it). */
export const manualSpell = (text: string): AbilityDef => ({ kind: 'manual', shape: 'spell', text, reason: 'test: resolved by hand' });
export const kw = (keyword: string, extra: Record<string, unknown> = {}): AbilityDef => ({ kind: 'keyword', text: keyword, keyword, ...extra }) as AbilityDef;

/** A copy of a compiled fixture card with other face-0 abilities. */
function withAbilities(def: CardDef, abilities: AbilityDef[]): CardDef {
  return { ...def, faces: [{ ...def.faces[0]!, abilities }, ...def.faces.slice(1)] };
}

// ---- The cards of design 15.2 WP16 -----------------------------------------------------------------------------------------------------------------------

/** Design 13.5, verbatim: "Noncreature spells cost {1} more to cast." `caster: any`. */
export const THALIA_COST: CostModDef = { s: 'costMod', applies: { spells: { zone: 'stack', notTypes: ['Creature'] }, caster: 'any' }, change: { kind: 'increase', generic: 1 } };
export const THALIA = synth({
  name: 'Thalia, Guardian of Thraben', cost: '{1}{W}', type: 'Legendary Creature — Human Soldier', pt: ['2', '1'],
  abilities: [kw('first strike', { text: 'First strike' }), staticOf('Noncreature spells cost {1} more to cast.', [THALIA_COST], { zone: ['battlefield'] })],
});

/** "You can't lose the game and your opponents can't win the game." (CR 104.3, 104.2) */
export const PLATINUM_ANGEL = synth({
  name: 'Platinum Angel', cost: '{7}', type: 'Artifact Creature — Angel', pt: ['4', '4'],
  abilities: [kw('flying', { text: 'Flying' }), staticOf("You can't lose the game and your opponents can't win the game.", [cant(YOU, 'lose'), cant(OPPONENTS, 'win')])],
});

/** The real Pacifism, its second line written as the model: "Enchanted creature can't attack or block." (CR 508.1c, 509.1b) */
export const PACIFISM = (() => {
  const real = compiledDefs(['Pacifism'])[0]!;
  return withAbilities(real, [real.faces[0]!.abilities[0]!, staticOf("Enchanted creature can't attack or block.", [cant(ENCHANTED, 'attack'), cant(ENCHANTED, 'block')])]);
})();

/** Arrest-style: "Enchanted creature can't attack or block, and its activated abilities can't be activated." (CR 602.5) */
export const ARREST = (() => {
  const real = compiledDefs(['Pacifism'])[0]!;
  const def = withAbilities(real, [real.faces[0]!.abilities[0]!, staticOf("Enchanted creature can't attack or block, and its activated abilities can't be activated.", [cant(ENCHANTED, 'attack'), cant(ENCHANTED, 'block'), cant(ENCHANTED, 'activate')])]);
  return { ...def, id: 'Test Arrest', name: 'Test Arrest', faces: [{ ...def.faces[0]!, name: 'Test Arrest' }] };
})();

/** Design 13.3: "This artifact doesn't untap during your untap step." plus its mana ability (the upkeep and draw-step triggers are left out: W2 handlers). */
export const MANA_VAULT = synth({
  name: 'Mana Vault', cost: '{1}', type: 'Artifact',
  abilities: [
    staticOf("This artifact doesn't untap during your untap step.", [cant(SELF, 'untapDuringUntapStep')]),
    { kind: 'activated', text: '{T}: Add {C}{C}{C}.', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: YOU, units: [['C'], ['C'], ['C']] }] } } as AbilityDef,
  ],
});

/** "This spell can't be countered." on an instant (CR 101.2, 701.6a): a static ability that functions on the stack. */
export const UNCOUNTERABLE = synth({
  name: 'Test Uncounterable', cost: '{G}', type: 'Instant',
  abilities: [staticOf("This spell can't be countered.", [cant(SELF, 'beCountered')], { zone: ['stack'] }), manualSpell('Do something.')],
});

/** Design 13.5, verbatim: Death-Rattle Oni's self cost reduction (history quantity). */
export const DEATH_RATTLE_ONI = synth({
  name: 'Death-Rattle Oni', cost: '{4}{B}{B}', type: 'Creature — Demon Spirit', pt: ['5', '5'],
  abilities: [
    kw('flash', { text: 'Flash' }),
    staticOf('This spell costs {2} less to cast for each creature that died this turn.', [{
      s: 'costMod', applies: { self: true, caster: 'you' },
      change: { kind: 'reduce', generic: { q: 'math', op: '*', args: [2, { q: 'happenedCount', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }] }, floor: 'zero' },
    }], { zone: ['stack'] }),
  ],
});

/** Design 13.4: Fireball's self cost increase ("{1} more for each target beyond the first"); its damage step is the W2 handler's (WP12). */
export const FIREBALL = synth({
  name: 'Fireball', cost: '{X}{R}', type: 'Sorcery',
  abilities: [
    staticOf('This spell costs {1} more to cast for each target beyond the first.', [{
      s: 'costMod', applies: { self: true, caster: 'you' },
      change: { kind: 'increase', generic: { q: 'math', op: 'max', args: [0, { q: 'math', op: '-', args: [{ q: 'spellTargetCount' }, 1] }] } },
    }], { zone: ['stack'] }),
    {
      kind: 'spell', text: '~ deals X damage divided evenly, rounded down, among any number of targets.',
      effect: { targets: [{ id: 't0', kind: 'anyTarget', min: 0, max: 'any', text: 'any number of targets' }], steps: [{ op: 'damage', source: SELF, to: { ref: 'target', id: 't0' }, amount: { q: 'X' }, divided: 'evenlyRoundDown' }] },
    } as AbilityDef,
  ],
});

/** Affinity for artifacts (CR 702.41a), the keyword the library expands into a self cost reduction of the artifacts its caster controls (the expansion adds "you control"; the filter is what the keyword line says, so the render gate accepts it). */
export const affinityFor = (name: string, cost: string, type: string, pt?: [string, string]): CardDef =>
  synth({ name, cost, type, ...(pt ? { pt } : {}), abilities: [kw('affinity', { text: 'Affinity for artifacts', filter: { types: ['Artifact'] } })] });
export const FROGMITE = affinityFor('Frogmite', '{4}', 'Artifact Creature — Frog', ['2', '2']);
export const THOUGHTCAST = synth({
  name: 'Thoughtcast', cost: '{4}{U}', type: 'Sorcery',
  abilities: [kw('affinity', { text: 'Affinity for artifacts', filter: { types: ['Artifact'] } }), manualSpell('Draw two cards.')],
});

export const ORNITHOPTER = synth({ name: 'Ornithopter', cost: '{0}', type: 'Artifact Creature — Thopter', pt: ['0', '2'], abilities: [kw('flying', { text: 'Flying' })] });
export const VANILLA = (name: string, pt: [string, string] = ['2', '2'], abilities: AbilityDef[] = []): CardDef => synth({ name, cost: '{1}{G}', type: 'Creature — Bear', pt, abilities });
export const SORCERY = (name: string, cost = '{1}{U}'): CardDef => synth({ name, cost, type: 'Sorcery', abilities: [manualSpell('Do something.')] });
export const ENCHANTMENT = (name: string, abilities: AbilityDef[], cost = '{1}'): CardDef => synth({ name, cost, type: 'Enchantment', abilities });

export const permit = (who: PlayerRef, action: PermissionDef['action'], extra: Partial<PermissionDef> = {}): PermissionDef => ({ s: 'permit', who, action, ...extra });
export const ruleMod = (rule: RuleModDef['rule'], extra: Partial<RuleModDef> = {}): RuleModDef => ({ s: 'rule', rule, ...extra });

/** Add a resolved rule effect (what the `effect` step of WP15 stores): its own id, timestamp and duration. */
export function withRuleEffect(s: GameState, effect: ContinuousEffectRec['effect'], opts: { source?: ObjectId; controller?: string; duration?: ContinuousEffectRec['duration'] } = {}): GameState {
  return tweak(s, (t) => {
    const id = `e${t.counters.effect++}`;
    const src = opts.source ? { id: opts.source, zone: t.objects[opts.source]!.zone } : null;
    t.continuousEffects.push({
      id, source: src, sourceName: 'Test Effect', controller: opts.controller ?? 'p1', timestamp: t.counters.timestamp++, startedTurn: t.turn.number,
      duration: opts.duration ?? { d: 'endOfTurn' }, effect,
    });
  });
}

/** Put an Aura (or Equipment) onto the battlefield already attached (after the scenario's setup, so state-based actions don't remove it first). */
export function putAttached(s: GameState, name: string, host: ObjectId, owner = 'p1'): GameState {
  return tweak(s, (t) => {
    const id = put(t, owner, 'battlefield', name);
    t.objects[id]!.attachedTo = host;
  });
}
