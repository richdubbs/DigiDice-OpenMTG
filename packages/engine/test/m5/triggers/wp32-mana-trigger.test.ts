/**
 * WP32: triggered mana abilities resolve at once, without the stack (CR 605.1b, 605.4a), through `applyAction` and the interpreter: after an activation at
 * priority, in the middle of a payment, for the player of the event, with "only once each turn" (CR 603.2h), and as delayed triggers (CR 603.7).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type EffectStep, type EventPattern, type GameState, type OracleCard } from '../../../src/index';
import { capabilitiesOf, ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { classifyCard } from '../../../src/model/classify';
import { keywordRegistry } from '../../../src/keywords/registry';
import { mentionsManaActivation } from '../../../src/triggers/forms';
import { drive } from '../announce/support';
import { trig } from './cards';
import { act, activated, answer, find, scenario, stackAbilities, synth } from './helpers';

const tapsLand: EventPattern = { ev: 'activate', source: { types: ['Land'] }, manaAbility: true };
const youTapLand: EventPattern = { ...tapsLand, player: 'you' };
const add = (who: Extract<EffectStep, { op: 'addMana' }>['who'], m: 'G' | 'R'): EffectStep => ({ op: 'addMana', who, units: [[m]] });

/** "Whenever a player taps a land for mana, that player adds an additional {G}." (the player of the event, not the controller) */
const flare = synth({
  name: 'Test Event Flare', cost: '{2}{R}', type: 'Enchantment',
  abilities: [trig('Whenever a player taps a land for mana, that player adds an additional {G}.', [tapsLand], { steps: [add({ ref: 'event', role: 'player' }, 'G')] })],
});
/** "Whenever you tap a land for mana, add {G}. This ability triggers only once each turn." */
const onceFlare = synth({
  name: 'Test Once Flare', cost: '{1}{G}', type: 'Enchantment',
  abilities: [trig('Whenever you tap a land for mana, add {G}. This ability triggers only once each turn.', [youTapLand], { steps: [add({ ref: 'you' }, 'G')] }, { limit: { per: 'turn', max: 1 } })],
});
/** "Until end of turn, whenever you tap a land for mana, add an additional {R}." (a delayed triggered mana ability) */
const surge = synth({
  name: 'Test Mana Surge', cost: '{R}', type: 'Sorcery',
  abilities: [{ kind: 'spell', text: 'Until end of turn, whenever you tap a land for mana, add an additional {R}.', effect: { targets: [], steps: [
    { op: 'delay', when: { at: 'event', event: youTapLand }, duration: { d: 'endOfTurn' }, do: [add({ ref: 'you' }, 'R')] },
  ] } }],
});
/** A sorcery that costs {G}: "You gain 1 life." */
const gainer = synth({ name: 'Test Green Gain', cost: '{G}', type: 'Sorcery', abilities: [{ kind: 'spell', text: 'You gain 1 life.', effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] } }] });

const DEFS: CardDef[] = [flare, onceFlare, surge, gainer];
const pool = (s: GameState, p: 'p1' | 'p2'): string => s.players.find((x) => x.id === p)!.manaPool.map((u) => u.type).sort().join('');
const tap = (s: GameState, player: 'p1' | 'p2', nth = 0, land = 'Forest'): GameState => {
  const ids = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === land && s.objects[id]!.controller === player && !s.objects[id]!.tapped);
  return act(s, { type: 'activate', player, source: ids[nth]!, ability: `r:basic:${land === 'Forest' ? 'G' : 'R'}` });
};

describe('CR 605.4a: a triggered mana ability resolves immediately after the mana ability that triggered it', () => {
  it('"that player adds": the opponent\'s enchantment gives the tapping player the extra mana; nothing is stacked (CR 605.1b)', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Forest'] }, p2: { battlefield: ['Test Event Flare'] } });
    const s = tap(s0, 'p1');
    expect(pool(s, 'p1')).toBe('GG');
    expect(pool(s, 'p2')).toBe('');
    expect(stackAbilities(s)).toEqual([]);
    expect(s.pendingTriggers).toEqual([]);
    // CR 106.3: the extra mana's source is the enchantment; it was not added by activating a mana ability, so it triggers nothing more (one extra {G}, not a loop)
    const units = s.players[0]!.manaPool;
    expect(units.map((u) => s.defs[s.objects[u.sourceId!]!.defId]!.name).sort()).toEqual(['Forest', 'Test Event Flare']);
  });

  it('in the middle of a payment: casting a {G} spell with one Forest leaves the extra {G} floating (the example of CR 605.4a)', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Green Gain'], battlefield: ['Forest', 'Test Event Flare'] } });
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Green Gain', 'hand') }), []);
    expect(s.zones.stack).toHaveLength(1); // only the spell: the triggered mana ability did not use the stack
    expect(pool(s, 'p1')).toBe('G');
  });

  it('the mana can pay for a spell: tap the Forest first ({G}{G}), then cast Grizzly Bears ({1}{G}) from the pool', () => {
    const s0 = scenario(['Forest', 'Grizzly Bears'], { defs: DEFS, p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Test Event Flare'] } });
    const tapped = tap(s0, 'p1');
    const s = drive(act(tapped, { type: 'cast', player: 'p1', card: find(tapped, 'Grizzly Bears', 'hand') }), []);
    expect(s.zones.stack.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Grizzly Bears']);
    expect(pool(s, 'p1')).toBe('');
  });

  it('CR 603.2h: "triggers only once each turn" holds for a triggered mana ability too', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Forest', 'Forest', 'Test Once Flare'] } });
    const s = tap(tap(s0, 'p1'), 'p1');
    expect(pool(s, 'p1')).toBe('GGG');
  });

  it('CR 603.7, 605.1b: a delayed triggered mana ability resolves at once too, for the rest of the turn', () => {
    const s0 = scenario(['Mountain', 'Forest'], { defs: DEFS, p1: { hand: ['Test Mana Surge'], battlefield: ['Mountain', 'Forest', 'Forest'] } });
    const cast = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mana Surge', 'hand') }), []);
    const resolved = act(act(cast, { type: 'pass', player: 'p1' }), { type: 'pass', player: 'p2' });
    expect(resolved.zones.stack).toEqual([]);
    expect(resolved.delayedTriggers).toHaveLength(1);
    const once = tap(resolved, 'p1');
    expect(pool(once, 'p1')).toBe('GR');
    expect(stackAbilities(once)).toEqual([]);
    const twice = tap(once, 'p1');
    expect(pool(twice, 'p1')).toBe('GGRR');
  });

  it('a player who taps a land with no triggered mana ability around gets exactly the land\'s mana', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Forest'] } });
    expect(pool(tap(s0, 'p1'), 'p1')).toBe('G');
  });
});

/** "Whenever a player activates a mana ability of a land, you gain 1 life." Adds no mana: an ordinary triggered ability that uses the stack (CR 605.1b). */
const barbs = synth({
  name: 'Test Barbs', cost: '{2}', type: 'Enchantment',
  abilities: [trig('Whenever a player activates a mana ability of a land, you gain 1 life.', [tapsLand], { steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] })],
});

// CMD5: a pain land's "This land deals 1 damage to you." is automated now (cloud/cmd5/cmd5-mana.test.ts); a mana ability with another instruction beside the
// mana ("Each opponent gains 1 life.", invented wording) is still one the player activates by hand
const grove = compileCard({ name: 'Test Gift Grove', layout: 'normal', mana_cost: '', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{T}: Add {R} or {G}. Each opponent gains 1 life.', colors: [] } as OracleCard);
const painLand = compileCard({ name: 'Test Ache Grove', layout: 'normal', mana_cost: '', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{T}: Add {R} or {G}. This land deals 1 damage to you.', colors: [] } as OracleCard);

describe('CR 605.1b, 605.4a: a mana ability activated by hand (one the engine does not understand) is still an activation', () => {
  const byHand = (s: GameState): GameState => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Gift Grove', 'battlefield'), ability: 'p:0:1' });
  const s0 = (): GameState => scenario([], { defs: [...DEFS, barbs, grove], p1: { battlefield: ['Test Gift Grove'] }, p2: { battlefield: ['Test Event Flare', 'Test Barbs'] } });

  it('a land with a rider tapped by hand: the triggered mana ability resolves at once (extra {G}) and the stack trigger goes on the stack', () => {
    const asked = byHand(s0());
    expect(asked.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    const s = answer(asked, { kind: 'manualResolve', ops: [{ op: 'mana', player: 'p1', types: ['R'] }, { op: 'life', player: 'p2', delta: 1 }] });
    expect(pool(s, 'p1')).toBe('GR'); // CR 605.4a: never silently skipped
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Barbs']); // CR 603.3: the ordinary trigger waits for priority
    expect(s.log.some((l) => /Test Event Flare's triggered mana ability resolves at once/.test(l.text))).toBe(true);
    // CR 106.3: the land is the source of the mana added by its own ability
    const red = s.players[0]!.manaPool.find((u) => u.type === 'R')!;
    expect(s.defs[s.objects[red.sourceId!]!.defId]!.name).toBe('Test Gift Grove');
  });

  it('the activation counts even when the player adds no mana by hand', () => {
    const s = answer(byHand(s0()), { kind: 'manualResolve', ops: [] });
    expect(pool(s, 'p1')).toBe('G');
  });

  it('CMD5: an automated pain land (run by the mana-ability resolver) is an activation too: the triggered mana ability adds {G} at once, the damage is dealt', () => {
    const s1 = scenario([], { defs: [...DEFS, barbs, painLand], p1: { battlefield: ['Test Ache Grove'] }, p2: { battlefield: ['Test Event Flare', 'Test Barbs'] } });
    const asked = act(s1, { type: 'activate', player: 'p1', source: find(s1, 'Test Ache Grove', 'battlefield'), ability: 'p:0:1' });
    expect(asked.pending).toMatchObject({ kind: 'chooseColor', player: 'p1' });
    const s = answer(asked, { kind: 'chooseColor', color: 'R' });
    expect(pool(s, 'p1')).toBe('GR');
    expect(s.players[0]!.life).toBe(19);
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Barbs']);
  });
});

describe('design 5.2: feature:trigger.mana is advertised (WP32)', () => {
  it('a card whose only ability is a triggered mana ability classifies full', () => {
    expect(ENGINE_CAPABILITIES.has('feature:trigger.mana')).toBe(true);
    expect(classifyCard({ faces: flare.faces.map((f) => ({ abilities: f.abilities })) } as never, ENGINE_CAPABILITIES).level).toBe('full');
  });

  it('the cheap test of triggers/mana-now.ts is complete: no keyword expansion mentions a mana activation (so card definitions and delayed records are all it reads)', () => {
    for (const k of keywordRegistry.all()) expect(mentionsManaActivation(k.expand ?? null), k.name).toBe(false);
    expect(mentionsManaActivation(flare.faces)).toBe(true);
    expect(mentionsManaActivation(gainer.faces)).toBe(false);
  });

  it('CR 605.1b, 605.4a: a MODAL triggered mana ability (no target, triggers from a mana activation, adds mana) is a form the walker names and the build does not advertise', () => {
    const modal = trig('Whenever you activate a mana ability of a land, choose one — Add {R}; or Add {G}.', [youTapLand], {
      modes: { min: 1, max: 1, options: [{ text: 'Add {R}.', program: { targets: [], steps: [add({ ref: 'you' }, 'R')] } }, { text: 'Add {G}.', program: { targets: [], steps: [add({ ref: 'you' }, 'G')] } }] },
    });
    expect(capabilitiesOf(modal)).toContain('feature:trigger.mana.modal');
    expect(ENGINE_CAPABILITIES.has('feature:trigger.mana.modal')).toBe(false);
    expect(classifyCard({ faces: [{ abilities: [modal] }] } as never, ENGINE_CAPABILITIES).level).not.toBe('full');
    // A mode with a target makes it no mana ability (CR 605.1b): an ordinary modal trigger on the stack, which the build runs.
    const targeted = trig('Whenever you activate a mana ability of a land, choose one — Add {R}; or this deals 1 damage to target player.', [youTapLand], {
      modes: { min: 1, max: 1, options: [{ text: 'Add {R}.', program: { targets: [], steps: [add({ ref: 'you' }, 'R')] } }, { text: 'Damage.', program: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }], steps: [] } }] },
    });
    expect(capabilitiesOf(targeted)).not.toContain('feature:trigger.mana.modal');
  });
});

/** A land whose {T} ability is not a mana ability: "{T}: You gain 1 life." (CR 605.1a: it adds no mana) */
const lifeLand = synth({ name: 'Test Life Land', cost: '', type: 'Land', abilities: [activated('{T}: You gain 1 life.', { tap: true }, [], {}, [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }])] });

describe('CR 605.1a, 605.3b: "activates a mana ability" never matches an activation that is not one', () => {
  it('activating a land\'s non-mana {T} ability does not trigger a "mana ability of a land" trigger', () => {
    const s0 = scenario(['Forest'], { defs: [...DEFS, barbs, lifeLand], p1: { battlefield: ['Test Life Land'] }, p2: { battlefield: ['Test Barbs'] } });
    const s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Life Land', 'battlefield'), ability: 'p:0:0' });
    expect(stackAbilities(s).map((a) => a.source)).toEqual(['Test Life Land']);
  });

  it('a land\'s mana ability still triggers it', () => {
    const s0 = scenario(['Forest'], { defs: [...DEFS, barbs], p1: { battlefield: ['Forest'] }, p2: { battlefield: ['Test Barbs'] } });
    expect(stackAbilities(tap(s0, 'p1')).map((a) => a.source)).toEqual(['Test Barbs']);
  });
});
