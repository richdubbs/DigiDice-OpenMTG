/**
 * WP2 review fixes: the gate's equivalence table is one documented inventory (render/equivalence.ts#EQUIVALENCE_FAMILIES), not 190 unreviewed `alt(...)`
 * call sites (design 6.8 G6, D14: the gate is never loosened to reduce false rejects). Each family has its reason and one example here: every reading is
 * accepted by the gate, and a near miss is not. The number of call sites per file is a ratchet: a new group needs a line in the table (and so a review).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep, EventPattern, KeywordAbilityDef, ManaRestriction, PlayerRef, Quantity, StaticEffect, TargetSpec } from '../../../src/types/ability';
import { ALT_SITES, EQUIVALENCE_FAMILIES } from '../../../src/render/equivalence';
import { renderGateKeywordLine } from '../../../src/render/gate';
import type { OracleCard } from '../../../src/types/card';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { accepts, bound, draw, effectStep, objTarget, playerTarget, rejects, self, spell, statics, t, trig, you } from './build';
import rx31Golden from '../golden/cards/cloud-std-rx31-review.json';

const creature = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const unknown = { selfNames: ['Test Card'] };
const enters: EventPattern = { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' };
const dies: EventPattern = { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' };
const gain = (n: number): EffectStep => ({ op: 'gainLife', who: you, amount: n });
const grow: StaticEffect = { s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] };
const pump: StaticEffect = { s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 1, toughness: 1 }] };

// FAST3 T12: the quantities and the conditional static ability of its families
const t12Static = (condition: unknown, effects: StaticEffect[]): AbilityDef => ({ kind: 'static', text: '', condition, effects } as unknown as AbilityDef);
const T12_SWAMPS: Quantity = { q: 'count', of: { ref: 'each', filter: { subtypes: ['Swamp'], controller: 'opponent' } } };
const T12_DEAD: Quantity = { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', isCard: true } } };
const T12_OTHERS: Quantity = { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you', attachedToSource: false } } };
const T12_CHARGE: Quantity = { q: 'counters', on: { ref: 'self' }, kind: 'charge' };
const T12_DOMAIN: Quantity = {
  q: 'math', op: '+',
  args: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((b): Quantity => ({ q: 'math', op: 'min', args: [1, { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you', subtypes: [b] } } }] })),
};

// FAST5 T52: the card types among the cards in your graveyard (delirium, CR 205.2a)
const T52_TYPES = { q: 'distinct', what: 'cardTypes', among: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', isCard: true } } } as unknown as Quantity;

interface Example {
  def: AbilityDef;
  ctx?: { selfNames: string[]; selfTypes?: string[] };
  /** Wordings that are the same thing in the model. */
  readings: string[];
  /** Wordings that are not. */
  near: string[];
  /** FAST2 T7: a keyword line gated as a whole (render/gate.ts#renderGateKeywordLine) instead of `def` alone. */
  line?: KeywordAbilityDef[];
}

// std-hob: the steps of a search that finds two cards, puts one onto the battlefield tapped and the other into the hand (eff.stdhob.search.reveal.oneTapped.otherHand)
const STD_HOB_SEARCH: EffectStep[] = [
  { op: 'search', who: you, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, min: 0, max: 2, reveal: true, as: 'search' } as EffectStep,
  { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: bound('search'), zone: 'library' } }, min: 1, max: 1, as: 'kept' } as EffectStep,
  { op: 'move', what: bound('kept'), to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
  { op: 'move', what: { ref: 'each', filter: { is: bound('search'), not: { is: bound('kept') }, zone: 'library' } }, to: { zone: 'hand' } } as EffectStep,
  { op: 'shuffle', who: you } as EffectStep,
];

const EXAMPLES: Record<string, Example> = {
  anaphora: {
    def: spell([{ op: 'tap', what: t('c') }, { op: 'untap', what: t('c') }], [objTarget('c')]),
    readings: ['Tap target creature. Untap it.', 'Tap target creature. Untap that creature.'],
    near: ['Tap target creature. Untap that land.'],
  },
  joiner: {
    def: spell([draw(), gain(1)]),
    readings: ['Draw a card. Gain 1 life.', 'Draw a card and gain 1 life.', 'Draw a card, then gain 1 life.'],
    near: ['Draw a card or gain 1 life.'],
  },
  'imperative-or-you': {
    def: spell([draw()]),
    readings: ['Draw a card.', 'You draw a card.'],
    near: ['Target player draws a card.'],
  },
  quantifier: {
    def: spell([{ op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'] } } }]),
    readings: ['Destroy all creatures.', 'Destroy each creature.'],
    near: ['Destroy a creature.'],
  },
  'subject-quantifier': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }]),
    readings: ['Creatures you control get +1/+1.', 'All creatures you control get +1/+1.', 'Each creature you control gets +1/+1.'],
    near: ['Creatures your opponents control get +1/+1.'],
  },
  'unless-pays': {
    def: spell([{ op: 'pay', who: { ref: 'controllerOf', object: t('s') }, cost: { mana: [{ kind: 'generic', amount: 3 }] }, else: [{ op: 'counter', what: t('s') }] }], [{ id: 's', kind: 'spell', min: 1, max: 1, text: '' }]),
    readings: ['Counter target spell unless its controller pays {3}.'],
    near: ['Counter target spell unless you pay {3}.'],
  },
  'owner-zone': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [objTarget('c')]),
    readings: ["Return target creature to its owner's hand.", 'Return target creature to your hand.'],
    near: ["Return target creature to an opponent's hand."],
  },
  'from-or-in': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } }], [objTarget('c', { zone: 'graveyard' })]),
    readings: ['Exile target card from a graveyard.', 'Exile target card in a graveyard.'],
    near: ['Exile target card from a hand.'],
  },
  'put-or-return': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [objTarget('c', { zone: 'graveyard', owner: 'you', types: ['Creature'] })]),
    readings: ['Return target creature card from your graveyard to your hand.', 'Put target creature card from your graveyard into your hand.'],
    near: ['Exile target creature card from your graveyard.'],
  },
  duration: {
    def: spell([{ op: 'effect', effects: [pump], duration: { d: 'endOfTurn' } }], [objTarget('c')]),
    readings: ['Target creature gets +1/+1 until end of turn.', 'Until end of turn, target creature gets +1/+1.', 'Target creature gets +1/+1 this turn.'],
    near: ['Target creature gets +1/+1 until your next turn.'],
  },
  'while-source': {
    def: spell([{ op: 'effect', effects: [pump], duration: { d: 'whileSource', as: 'tapped' } }], [objTarget('c')]),
    readings: ['Target creature gets +1/+1 for as long as Test Card remains tapped.', 'Target creature gets +1/+1 for as long as Test Card is tapped.'],
    near: ['Target creature gets +1/+1 for as long as Test Card is untapped.'],
  },
  'when-or-whenever': {
    def: trig([enters], [draw()]),
    ctx: creature,
    readings: ['When this creature enters, draw a card.', 'Whenever this creature enters, draw a card.'],
    near: ['At the beginning of your upkeep, draw a card.'],
  },
  // FAST5X E3 (CR 603.2, 603.6a, 702.171b)
  'enters-and-whenever': {
    def: trig([enters, { ev: 'attacks', attacker: { self: true, saddled: true } }], [draw()]),
    ctx: creature,
    readings: ['When this creature enters and whenever it attacks while saddled, draw a card.', 'Whenever this creature enters or attacks while saddled, draw a card.'],
    near: ['When this creature enters and whenever it blocks while saddled, draw a card.', 'When this creature enters and whenever it attacks, draw a card.'],
  },
  // FAST5X E8 (CR 603.2, 709.5i): eerie
  'and-whenever-fully-unlock': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Enchantment'], controller: 'you' }, to: 'battlefield' }, { ev: 'becomes', what: 'fullyUnlocked', object: { subtypes: ['Room'] } }], [draw()]),
    ctx: creature,
    readings: ['Whenever an enchantment you control enters and whenever you fully unlock a Room, draw a card.', 'Whenever an enchantment you control enters or you fully unlock a Room, draw a card.'],
    near: ['Whenever an enchantment you control enters and whenever you unlock a Room, draw a card.', 'Whenever an enchantment you control enters and whenever you fully unlock a door, draw a card.'],
  },
  // FAST5 T62 (CR 603.2, 603.10a, 701.21a)
  'enters-and-sacrificed': {
    def: trig([enters, { ev: 'action', verb: 'sacrifice', actor: 'you', object: { self: true } }], [draw()]),
    ctx: creature,
    readings: ['When this creature enters and when you sacrifice it, draw a card.', 'Whenever this creature enters or you sacrifice this creature, draw a card.'],
    near: ['When this creature enters and when an opponent sacrifices it, draw a card.', 'When this creature enters and when you sacrifice a creature, draw a card.', 'When this creature enters and when you discard it, draw a card.'],
  },
  // FAST5 T62 (CR 603.2, 701.40a)
  'and-whenever-face-up': {
    def: trig([{ ev: 'zoneChange', subject: { subtypes: ['Detective'], controller: 'you', other: true }, to: 'battlefield' }, { ev: 'becomes', what: 'turnedFaceUp', object: { subtypes: ['Detective'], controller: 'you' } }], [draw()]),
    ctx: creature,
    readings: ['Whenever another Detective you control enters and whenever a Detective you control is turned face up, draw a card.', 'Whenever another Detective you control enters or a Detective you control is turned face up, draw a card.'],
    near: ['Whenever another Detective you control enters and whenever a Detective you control is turned face down, draw a card.', 'Whenever another Detective you control enters and whenever a Wizard you control is turned face up, draw a card.'],
  },
  // FAST5 T62 (CR 603.4)
  'at-least-count': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { subtypes: ['Forest'], controller: 'you' }, to: 'battlefield' }] },
      interveningIf: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you', other: true } }, atLeast: 5 }, effect: { targets: [], steps: [draw(1)] } } as AbilityDef,
    ctx: creature,
    readings: ['Whenever a Forest you control enters, if you control five or more other Forests, draw a card.', 'Whenever a Forest you control enters, if you control at least five other Forests, draw a card.'],
    near: ['Whenever a Forest you control enters, if you control at least six other Forests, draw a card.', 'Whenever a Forest you control enters, if you control at least five Forests, draw a card.'],
  },
  // FAST5 T62 (CR 601.2i, 603.4)
  'cast-at-least-one': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'step', step: 'beginCombat', whose: 'you' }] },
      interveningIf: { cond: 'happened', event: { ev: 'cast', player: 'you', spell: { types: ['Creature'] } }, scope: 'turn', times: { op: '>=', value: 1 } }, effect: { targets: [], steps: [draw(1)] } } as AbilityDef,
    ctx: creature,
    readings: ["At the beginning of combat on your turn, if you've cast a creature spell this turn, draw a card.", "At the beginning of combat on your turn, if you've cast one or more creature spells this turn, draw a card."],
    near: ["At the beginning of combat on your turn, if you've cast two or more creature spells this turn, draw a card.", "At the beginning of combat on your turn, if you've cast a land spell this turn, draw a card."],
  },
  'cast-both': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'step', step: 'beginCombat', whose: 'you' }] },
      interveningIf: { cond: 'all', of: [
        { cond: 'happened', event: { ev: 'cast', player: 'you', spell: { types: ['Creature'] } }, scope: 'turn', times: { op: '>=', value: 1 } },
        { cond: 'happened', event: { ev: 'cast', player: 'you', spell: { notTypes: ['Creature'] } }, scope: 'turn', times: { op: '>=', value: 1 } },
      ] }, effect: { targets: [], steps: [draw(1)] } } as AbilityDef,
    ctx: creature,
    readings: ["At the beginning of combat on your turn, if you've cast both a creature spell and a noncreature spell this turn, draw a card.", "At the beginning of combat on your turn, if you've cast a creature spell this turn and you've cast a noncreature spell this turn, draw a card."],
    near: ["At the beginning of combat on your turn, if you've cast both a creature spell and a noncreature spell last turn, draw a card.", "At the beginning of combat on your turn, if you've cast both a creature spell and a land spell this turn, draw a card."],
  },
  // FAST5 T62 (CR 205.1b, 613.1d)
  // FAST5X E3: a quoted ability ends the sentence inside its quotes
  'quote-ends-sentence': {
    def: spell([
      { op: 'createToken', who: you, count: 1, token: { colors: [], types: ['Creature'], subtypes: ['Pilot'], power: 1, toughness: 1, abilities: [{ kind: 'static', text: '', effects: [{ s: 'rule', rule: 'crewSaddlePowerBonus', value: 2 }] }] } } as EffectStep,
      draw(),
    ]),
    readings: [
      'Create a 1/1 colorless Pilot creature token with "This token saddles Mounts and crews Vehicles as though its power were 2 greater." Draw a card.',
      'Create a 1/1 colorless Pilot creature token with "This token saddles Mounts and crews Vehicles as though its power were 2 greater." Then draw a card.',
    ],
    near: ['Create a 1/1 colorless Pilot creature token with "This token saddles Mounts and crews Vehicles as though its power were 2 greater." Draw two cards.'],
  },
  'dies-wording': {
    def: trig([dies], [draw()]),
    ctx: unknown,
    readings: ['When Test Card dies, draw a card.', 'When Test Card is put into a graveyard from the battlefield, draw a card.'],
    near: ['When Test Card is exiled, draw a card.'],
  },
  'attached-word': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: 1, toughness: 0 }] }]),
    ctx: unknown,
    readings: ['Enchanted creature gets +1/+0.', 'Equipped creature gets +1/+0.'],
    near: ['Attached creature gets +1/+0.'],
  },
  'self-or-another': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }], [draw()]),
    ctx: creature,
    readings: ['Whenever a creature enters, draw a card.', 'Whenever Test Card or another creature enters, draw a card.'],
    near: ['Whenever another creature enters, draw a card.'],
  },
  comparison: {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'compare', left: { q: 'life', of: you }, op: '>=', right: 10 } } as AbilityDef,
    ctx: creature,
    readings: ['As long as you have 10 or more life, Test Card gets +1/+1.', 'As long as your life total is 10 or more, Test Card gets +1/+1.'],
    near: ['As long as you have 10 or fewer life, Test Card gets +1/+1.'],
  },
  shuffle: {
    def: spell([{ op: 'shuffle', who: you }]),
    readings: ['Shuffle.', 'Shuffle your library.'],
    near: ['Shuffle your graveyard.'],
  },
  'type-list': {
    def: spell([{ op: 'destroy', what: t('c') }], [objTarget('c', { types: ['Artifact', 'Creature', 'Enchantment'] })]),
    readings: ['Destroy target artifact, creature, or enchantment.'],
    near: ['Destroy target artifact, creature, and enchantment.'],
  },
  restriction: {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'attack', when: { cond: 'turnOf', whose: 'you' } }]),
    ctx: creature,
    readings: ["Test Card can't attack unless it's your turn.", "Test Card can attack only if it's your turn."],
    near: ["Test Card can't attack only if it's your turn."],
  },
  'condition-position': {
    def: { kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }], condition: { cond: 'turnOf', whose: 'you' } } as AbilityDef,
    ctx: creature,
    readings: ["As long as it's your turn, Test Card gets +1/+1.", "Test Card gets +1/+1 as long as it's your turn."],
    near: ["Test Card gets +1/+1 unless it's your turn."],
  },
  'token-count': {
    def: spell([{ op: 'createToken', who: you, token: { power: 1, toughness: 1, colors: ['W'], types: ['Creature'], subtypes: ['Soldier'] }, count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } as EffectStep]),
    readings: [
      'Create a 1/1 white Soldier creature token for each creature you control.',
      'Create X 1/1 white Soldier creature tokens, where X is the number of creatures you control.',
      'Create a number of 1/1 white Soldier creature tokens equal to the number of creatures you control.',
    ],
    near: ['Create a 1/1 white Soldier creature token for each creature.'],
  },
  'end-of-combat': {
    def: spell([{ op: 'delay', when: { at: 'endOfCombat' }, do: [draw()] } as EffectStep]),
    readings: ['Draw a card at end of combat.', 'Draw a card at the end of combat.', 'At end of combat, draw a card.'],
    near: ['Draw a card at the beginning of combat.'],
  },
  'activation-limits': {
    def: { kind: 'activated', text: '', cost: { tap: true }, sorcerySpeed: true, limit: { per: 'turn', max: 1 }, effect: { targets: [], steps: [draw()] } },
    readings: ['{T}: Draw a card. Activate only as a sorcery and only once each turn.', '{T}: Draw a card. Activate only as a sorcery. Activate only once each turn.'],
    near: ['{T}: Draw a card. Activate only as a sorcery or once each turn.'],
  },
  'self-replacement': {
    def: spell([{ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [draw(2)], else: [draw()] } as EffectStep]),
    readings: ["If it's your turn, draw two cards. Otherwise, draw a card.", "Draw a card. If it's your turn, draw two cards instead."],
    near: ["Draw two cards. If it's your turn, draw a card instead.", "Draw a card. If it's your turn, draw two cards."],
  },
  // T3 (push wave)
  'filter-mana': {
    def: { kind: 'activated', text: '', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, units: [['W', 'B'], ['W', 'B']] }] } } as AbilityDef,
    readings: ['{T}: Add {W}{W}, {W}{B}, or {B}{B}.', '{T}: Add {W} or {B}, then {W} or {B}.'],
    near: ['{T}: Add {W}{W} or {B}{B}.'],
  },
  'blocks-or-blocked-by': {
    def: trig([{ ev: 'blocks', blocker: { self: true }, attacker: { types: ['Creature'], colors: ['W'] } }, { ev: 'becomesBlocked', attacker: { self: true }, by: { types: ['Creature'], colors: ['W'] } }], [draw()]),
    ctx: creature,
    readings: ['Whenever ~ blocks or becomes blocked by a white creature, draw a card.', 'Whenever ~ blocks a white creature or becomes blocked by a white creature, draw a card.'],
    near: ['Whenever ~ blocks or becomes blocked by a black creature, draw a card.'],
  },
  // FAST1 T4
  'you-attack': {
    def: trig([{ ev: 'attacks', attacker: { controller: 'you', types: ['Creature'] }, count: { op: '>=', value: 3 } }], [draw()], { batch: true }),
    ctx: creature,
    readings: ['Whenever you attack with three or more creatures, draw a card.', 'Whenever three or more creatures you control attack, draw a card.'],
    near: ['Whenever you attack with two or more creatures, draw a card.', 'Whenever an opponent attacks with three or more creatures, draw a card.'],
  },
  'cycle-or-discard': {
    def: trig([{ ev: 'action', verb: 'discard', actor: 'you' }], [draw()]),
    ctx: creature,
    readings: ['Whenever you discard a card, draw a card.', 'Whenever you cycle or discard a card, draw a card.'],
    near: ['Whenever you cycle a card, draw a card.', 'Whenever an opponent cycles or discards a card, draw a card.'],
  },
  'tapped-for-mana': {
    def: trig([{ ev: 'activate', source: { types: ['Land'] }, manaAbility: true }], [gain(1)]),
    readings: ['Whenever a player taps a land for mana, gain 1 life.', 'Whenever a land is tapped for mana, gain 1 life.'],
    near: ['Whenever a player taps a creature for mana, gain 1 life.', 'Whenever you tap a land for mana, gain 1 life.'],
  },
  historic: {
    def: trig([{ ev: 'cast', player: 'you', spell: { anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] } }], [draw()]),
    readings: ['Whenever you cast a historic spell, draw a card.', 'Whenever you cast an artifact, legendary, or Saga spell, draw a card.'],
    near: ['Whenever you cast a legendary spell, draw a card.', 'Whenever you cast a historic creature spell, draw a card.'],
  },
  'first-main-phase': {
    def: trig([{ ev: 'step', step: 'main1', whose: 'you' }], [draw()]),
    readings: ['At the beginning of your precombat main phase, draw a card.', 'At the beginning of your first main phase, draw a card.'],
    near: ['At the beginning of your second main phase, draw a card.', 'At the beginning of your postcombat main phase, draw a card.'],
  },
  'additional-mana': {
    def: trig([{ ev: 'activate', player: 'you', source: { types: ['Land'] }, manaAbility: true }], [{ op: 'addMana', who: you, units: [['G']] }]),
    readings: ['Whenever you tap a land for mana, add {G}.', 'Whenever you tap a land for mana, add an additional {G}.'],
    near: ['Whenever you tap a land for mana, add an additional {G}{G}.', 'Whenever you tap a land for mana, add another {G}.'],
  },
  'self-from-graveyard': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 2 }] }, zone: ['graveyard'], effect: { targets: [], steps: [{ op: 'move', what: { ref: 'self' }, to: { zone: 'hand' } }] } } as AbilityDef,
    ctx: creature,
    readings: ['{2}: Return ~ from your graveyard to your hand.', '{2}: Return ~ to your hand.'],
    near: ['{2}: Return ~ from your graveyard to the battlefield.', '{2}: Return ~ from exile to your hand.'],
  },
  'step-of-player': {
    def: trig([{ ev: 'step', step: 'upkeep', whose: { ref: 'controllerOf', object: { ref: 'attachedTo' } } }], [{ op: 'loseLife', who: { ref: 'event', role: 'player' }, amount: 1 }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ["At the beginning of the upkeep of enchanted creature's controller, that player loses 1 life.", "At the beginning of enchanted creature's controller's upkeep, that player loses 1 life."],
    near: ["At the beginning of the upkeep of enchanted creature's owner, that player loses 1 life.", "At the beginning of the end step of enchanted creature's controller, that player loses 1 life."],
  },
  // std-rn
  'activation-any-step': {
    def: { kind: 'activated', text: '', cost: { tap: true }, effect: { targets: [], steps: [draw()] }, onlyIf: { cond: 'turnOf', whose: 'any', step: 'endCombat' } } as unknown as AbilityDef,
    readings: ['{T}: Draw a card. Activate only during the end of combat step.', '{T}: Draw a card. Activate only during end of combat.'],
    near: ['{T}: Draw a card. Activate only during the end step.', '{T}: Draw a card. Activate only during combat.'],
  },
  'no-more-than': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }] }, limit: { per: 'turn', max: 2 }, effect: { targets: [], steps: [draw()] } } as AbilityDef,
    readings: ['{1}: Draw a card. Activate only twice each turn.', '{1}: Draw a card. Activate no more than twice each turn.'],
    near: ['{1}: Draw a card. Activate no more than three times each turn.', '{1}: Draw a card. Activate only once each turn.'],
  },
  'cost-duration': {
    def: spell([{ op: 'effect', effects: [{ s: 'costMod', applies: { spells: { types: ['Creature'] }, caster: 'you' }, change: { kind: 'reduce', generic: 1 } }], duration: { d: 'endOfTurn' } }]),
    readings: ['Creature spells you cast this turn cost {1} less to cast.', 'Until end of turn, creature spells you cast cost {1} less to cast.'],
    near: ['Creature spells you cast cost {1} less to cast.'],
  },
  // FAST1 T5
  'during-turn': {
    def: { ...statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'first strike', text: 'First strike' }] }] }]), condition: { cond: 'turnOf', whose: 'you' } } as AbilityDef,
    ctx: creature,
    readings: ['During your turn, ~ has first strike.', "As long as it's your turn, ~ has first strike.", "~ has first strike as long as it's your turn.", '~ has first strike during your turn.'],
    near: ["During your opponent's turn, ~ has first strike.", 'During your turn, ~ has double strike.'],
  },
  'shared-subject': {
    def: statics([grow, { s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block' }]),
    ctx: creature,
    readings: ["~ gets +1/+1 and can't block.", "~ gets +1/+1. It can't block."],
    near: ["~ gets +1/+1 and can't attack.", "~ gets +1/+1 and can't be blocked."],
  },
  'except-by': {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlockedBy', other: { not: { subtypes: ['Wall'] } } }]),
    ctx: creature,
    readings: ["~ can't be blocked except by Walls."],
    near: ["~ can't be blocked by Walls.", "~ can't be blocked except by Golems."],
  },
  'cost-condition': {
    def: { ...statics([{ s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', generic: 2, floor: 'zero' } }]), zone: ['stack'], condition: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Wizard'], controller: 'you' } } } } as AbilityDef,
    readings: ['~ costs {2} less to cast if you control a Wizard.', 'As long as you control a Wizard, ~ costs {2} less to cast.'],
    near: ['~ costs {2} less to cast if you control a Golem.', '~ costs {2} less to cast unless you control a Wizard.'],
  },
  // FAST1 T6
  'sacrifice-choice': {
    def: spell([{ op: 'sacrificeChoice', who: { ref: 'each', who: 'opponent' }, filter: { types: ['Creature'] }, count: 1 } as EffectStep]),
    readings: ['Each opponent sacrifices a creature.', 'Each opponent sacrifices a creature of their choice.'],
    near: ['Each opponent sacrifices a creature of your choice.', 'Each opponent sacrifices an artifact of their choice.'],
  },
  'tapped-token': {
    def: spell([{ op: 'createToken', who: you, count: 1, token: { predefined: 'Treasure' }, tapped: true } as EffectStep]),
    readings: ['Create a tapped Treasure token.', "Create a Treasure token that's tapped."],
    near: ['Create a Treasure token.', 'Create a tapped Clue token.'],
  },
  'discard-hand': {
    def: spell([{ op: 'discard', who: you, count: 'hand' } as EffectStep]),
    readings: ['Discard your hand.', 'Discard all the cards in your hand.'],
    near: ['Discard a card.', 'Discard all the cards in your graveyard.'],
  },
  'that-many-discarded': {
    def: spell([{ op: 'discard', who: you, count: 'hand', as: 'd' } as EffectStep, { op: 'draw', who: you, count: { q: 'resultCount', step: 'd' } } as EffectStep]),
    readings: ['Discard your hand, then draw that many cards.', 'Discard all the cards in your hand, then draw that many cards.'],
    near: ['Discard your hand, then draw seven cards.', 'Discard your hand, then draw that many cards plus one.'],
  },
  'zone-then-with': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [objTarget('c', { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true, manaValue: { op: '<=', value: 2 } })]),
    readings: ['Return target creature card with mana value 2 or less from your graveyard to your hand.', 'Return target creature card from your graveyard with mana value 2 or less to your hand.'],
    near: ['Return target creature card with mana value 3 or less from your graveyard to your hand.', 'Return target creature card from your graveyard to your hand.'],
  },
  // FAST2 T7
  'mana-for-each': {
    def: { kind: 'activated', text: '', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, dynamic: { kind: 'ofType', type: 'G', count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['{T}: Add {G} for each creature you control.', '{T}: Add an amount of {G} equal to the number of creatures you control.'],
    near: ['{T}: Add {G} for each creature.', '{T}: Add {G}{G} for each creature you control.'],
  },
  'protection-pair': {
    def: { kind: 'keyword', keyword: 'protection', quality: 'color:B', text: '' } as AbilityDef,
    line: [{ kind: 'keyword', keyword: 'protection', quality: 'color:B', text: '' }, { kind: 'keyword', keyword: 'protection', quality: 'color:R', text: '' }],
    readings: ['Protection from black and from red', 'Protection from black, protection from red'],
    near: ['Protection from black and red', 'Protection from black and from green'],
  },
  'not-a-type': {
    def: { ...statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { remove: ['Creature'] } }] }]), condition: { cond: 'compare', left: { q: 'devotion', to: ['R'], of: you }, op: '<', right: 5 } } as AbilityDef,
    ctx: creature,
    readings: ["As long as your devotion to red is less than five, ~ isn't a creature.", 'As long as your devotion to red is less than five, ~ is not a creature.'],
    near: ["As long as your devotion to red is less than five, ~ isn't a land.", 'As long as your devotion to red is less than five, ~ is a creature.'],
  },
  'on-the-battlefield': {
    def: statics([{ s: 'continuous', cda: true, affects: { ref: 'self' }, mods: [{ layer: '7a', power: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Cleric'] } } }, toughness: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Cleric'] } } } }] } as StaticEffect]),
    ctx: creature,
    readings: ["~'s power and toughness are each equal to the number of Clerics.", "~'s power and toughness are each equal to the number of Clerics on the battlefield."],
    near: ["~'s power and toughness are each equal to the number of Clerics you control on the battlefield.", "~'s power and toughness are each equal to the number of Clerics in your graveyard."],
  },
  'spells-pair': {
    def: statics([{ s: 'costMod', applies: { spells: { anyOf: [{ colors: ['R'] }, { colors: ['W'] }] }, caster: 'you' }, change: { kind: 'reduce', generic: 1, floor: 'zero' } }]),
    ctx: creature,
    readings: ['Red spells and white spells you cast cost {1} less to cast.'],
    near: ['Red spells you cast cost {1} less to cast.', 'Red spells and blue spells you cast cost {1} less to cast.'],
  },
  'activated-abilities-of': {
    def: statics([{ s: 'restrict', subject: { ref: 'each', filter: { types: ['Artifact'] } }, mode: 'cant', action: 'activate' }]),
    ctx: creature,
    readings: ["Activated abilities of artifacts can't be activated."],
    near: ["Activated abilities of creatures can't be activated.", "Activated abilities of artifacts you control can't be activated."],
  },
  'token-rider': {
    def: spell([{ op: 'createToken', who: you, count: 2, token: { colors: [], types: ['Creature'], subtypes: ['Eldrazi', 'Spawn'], power: 0, toughness: 1, abilities: [{ kind: 'activated', text: '', cost: { other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, units: [['C']] }] } }] } } as EffectStep]),
    readings: ['Create two 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this creature: Add {C}."', 'Create two 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this creature: Add {C}."'],
    near: ['Create two 0/1 colorless Eldrazi Spawn creature tokens. It has "Sacrifice this creature: Add {C}."', 'Create two 0/1 colorless Eldrazi Spawn creature tokens.'],
  },
  'effect-first': {
    def: { ...statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'first strike', text: 'First strike' }] }] }]), condition: { cond: 'matches', object: { ref: 'self' }, filter: { attacking: true } } } as AbilityDef,
    ctx: creature,
    readings: ["~ has first strike as long as it's attacking.", 'As long as ~ is attacking, it has first strike.', '~ has first strike as long as ~ is attacking.'],
    near: ["~ has first strike as long as it's blocking.", "~ has double strike as long as it's attacking."],
  },
  // FAST2 T8
  'damage-recipients': {
    def: spell([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', filter: { types: ['Creature'] } }, amount: 2, also: [{ to: { ref: 'each', who: 'player' }, amount: 2 }] } as EffectStep]),
    readings: ['Test Card deals 2 damage to each creature and each player.', 'Test Card deals 2 damage to each creature and 2 damage to each player.'],
    near: ['Test Card deals 2 damage to each creature and 3 damage to each player.', 'Test Card deals 2 damage to each creature.'],
  },
  'damage-order': {
    def: spell([{ op: 'damage', source: { ref: 'self' }, to: t('c'), amount: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } } as EffectStep], [objTarget('c')]),
    readings: ['Test Card deals damage equal to the number of lands you control to target creature.', 'Test Card deals damage to target creature equal to the number of lands you control.'],
    near: ['Test Card deals damage to target creature equal to the number of creatures you control.', 'Test Card deals damage to target player equal to the number of lands you control.'],
  },
  'counters-each-of': {
    def: spell([{ op: 'putCounters', on: t('c'), kind: '+1/+1', count: 1 } as EffectStep], [objTarget('c', { types: ['Creature'] }, { min: 0, max: 2 })]),
    readings: ['Put a +1/+1 counter on up to two target creatures.', 'Put a +1/+1 counter on each of up to two target creatures.'],
    near: ['Put a +1/+1 counter on each of up to three target creatures.', 'Put two +1/+1 counters on each of up to two target creatures.'],
  },
  'that-many-event': {
    def: trig([{ ev: 'life', change: 'gain', player: 'you' } as EventPattern], [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: { q: 'eventAmount' } } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['Whenever you gain life, put that many +1/+1 counters on Test Card.', 'Whenever you gain life, put a number of +1/+1 counters equal to that much on Test Card.'],
    near: ['Whenever you gain life, put that many -1/-1 counters on Test Card.', 'Whenever you gain life, put two +1/+1 counters on Test Card.'],
  },
  'additional-card': {
    def: trig([{ ev: 'step', step: 'draw' } as EventPattern], [draw(1, { ref: 'event', role: 'player' })]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ["At the beginning of each player's draw step, that player draws a card.", "At the beginning of each player's draw step, that player draws an additional card."],
    near: ["At the beginning of each player's draw step, that player draws two additional cards.", "At the beginning of each player's draw step, you draw an additional card."],
  },
  'per-object-amount': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'math', op: '*', args: [2, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }] } } as EffectStep]),
    readings: ['You gain 2 life for each creature you control.', 'You gain life equal to twice the number of creatures you control.'],
    near: ['You gain 3 life for each creature you control.', 'You gain 2 life for each land you control.'],
  },
  'named-player': {
    def: spell([{ op: 'destroy', what: t('c') }, { op: 'loseLife', who: { ref: 'controllerOf', object: t('c') }, amount: 3 } as EffectStep], [objTarget('c', { types: ['Creature'], controller: 'opponent' })]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Sorcery'] },
    readings: ['Destroy target creature an opponent controls. That player loses 3 life.', 'Destroy target creature an opponent controls. Its controller loses 3 life.'],
    near: ['Destroy target creature an opponent controls. You lose 3 life.', 'Destroy target creature an opponent controls. That player loses 2 life.'],
  },
  'singular-they': {
    def: trig([{ ev: 'draw', player: 'opponent' } as EventPattern], [{ op: 'loseLife', who: { ref: 'event', role: 'player' }, amount: 2 } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['Whenever an opponent draws a card, that player loses 2 life.', 'Whenever an opponent draws a card, they lose 2 life.'],
    near: ['Whenever an opponent draws a card, they lose 3 life.', 'Whenever an opponent draws a card, they loses 2 life.'],
  },
  'you-attacked': {
    def: trig([{ ev: 'step', step: 'end', whose: 'you' } as EventPattern], [draw()], { interveningIf: { cond: 'happened', event: { ev: 'attacks', attacker: { controller: 'you' } }, scope: 'turn' } }),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['At the beginning of your end step, if you attacked this turn, draw a card.', 'At the beginning of your end step, if a permanent you control attacked this turn, draw a card.'],
    near: ['At the beginning of your end step, if you attacked this combat, draw a card.', 'At the beginning of your end step, if an opponent attacked this turn, draw a card.'],
  },
  'entering-condition': {
    def: {
      kind: 'static', text: '', zone: ['stack', 'battlefield'], condition: { cond: 'happened', event: { ev: 'attacks', attacker: { controller: 'you' } }, scope: 'turn' },
      effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 2 }] } } as StaticEffect],
    } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['Test Card enters with two +1/+1 counters on it if you attacked this turn.', 'If you attacked this turn, Test Card enters with two +1/+1 counters on it.'],
    near: ['Test Card enters with two +1/+1 counters on it unless you attacked this turn.', 'Test Card enters with three +1/+1 counters on it if you attacked this turn.'],
  },
  'then-if': {
    def: spell([draw(), { op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } }, then: [draw(2)] } as EffectStep]),
    readings: ['Draw a card. If you control an Elf, draw two cards.', 'Draw a card. Then if you control an Elf, draw two cards.'],
    near: ['Draw a card. Then if you control an Elf, draw three cards.', 'Draw a card. Then if you control a Goblin, draw two cards.'],
  },
  // FAST2 T9
  'each-targets': {
    def: spell([{ op: 'effect', effects: [pump], duration: { d: 'endOfTurn' } } as EffectStep], [objTarget('c', { types: ['Creature'] }, { min: 2, max: 2 })]),
    readings: ['Two target creatures get +1/+1 until end of turn.', 'Two target creatures each get +1/+1 until end of turn.'],
    near: ['Two target creatures each get +2/+2 until end of turn.', 'Each creature gets +1/+1 until end of turn.'],
  },
  'becomes-with': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] }, subtypes: { set: ['Bird'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'flying', text: 'flying' }] }, { layer: '7b', power: 2, toughness: 2 }] }] } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['~ becomes a 2/2 Bird artifact creature with flying until end of turn.', '~ becomes a 2/2 Bird artifact creature and gains flying until end of turn.'],
    near: ['~ becomes a 2/2 Bird artifact creature with vigilance until end of turn.', '~ becomes a 2/2 Bird artifact creature until end of turn.'],
  },
  'all-graveyards': {
    def: statics([{ s: 'continuous', cda: true, affects: { ref: 'self' }, mods: [{ layer: '7a', power: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', isCard: true } } }, toughness: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', isCard: true } } } }] }]),
    ctx: creature,
    readings: ["~'s power and toughness are each equal to the number of creature cards in all graveyards.", "~'s power and toughness are each equal to the number of creature cards in a graveyard."],
    near: ["~'s power and toughness are each equal to the number of creature cards in your graveyard.", "~'s power and toughness are each equal to the number of land cards in all graveyards."],
  },
  'defender-waiver-duration': {
    def: spell([{ op: 'effect', effects: [{ s: 'permit', who: you, action: 'attackAsThoughNoDefender' }], duration: { d: 'endOfTurn' } } as EffectStep]),
    ctx: creature,
    readings: ["~ can attack this turn as though it didn't have defender.", "~ can attack as though it didn't have defender this turn."],
    near: ["~ can block this turn as though it didn't have defender.", "~ can attack this turn as though it had defender."],
  },
  'shared-subject-resolved': {
    def: spell([{ op: 'effect', effects: [grow, { s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked' }], duration: { d: 'endOfTurn' } } as EffectStep]),
    ctx: creature,
    readings: ["~ gets +1/+1 until end of turn and can't be blocked this turn.", "~ gets +1/+1 until end of turn. It can't be blocked this turn."],
    near: ["~ gets +1/+1 until end of turn and can't block this turn.", "~ gets +1/+1 until end of turn and can't be blocked."],
  },
  // FAST2 T10
  'shuffle-then-top': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { types: ['Enchantment'] }, max: 1, reveal: true, as: 'found' } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'found' }, to: { zone: 'library', position: 'top' } } as EffectStep,
    ]),
    readings: ['Search your library for an enchantment card, reveal it, then shuffle and put that card on top.', 'Search your library for an enchantment card, reveal it, then shuffle, then put that card on top of your library.'],
    near: ['Search your library for an enchantment card, reveal it, then shuffle and put that card on the bottom.', 'Search your library for an enchantment card, reveal it, then shuffle and put it into your hand.'],
  },
  'pay-for-each': {
    def: spell([{ op: 'pay', who: { ref: 'controllerOf', object: t('t0') }, cost: { mana: [{ kind: 'generic', amount: 1 }] }, times: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } }, else: [{ op: 'counter', what: t('t0') }] } as EffectStep], [{ id: 't0', kind: 'spell', min: 1, max: 1, text: '' }]),
    readings: ['Counter target spell unless its controller pays {1} for each artifact you control.', 'Counter target spell unless its controller pays {1} the number of artifacts you control times.'],
    near: ['Counter target spell unless its controller pays {1} for each creature you control.', 'Counter target spell unless its controller pays {2} for each artifact you control.'],
  },
  'and-or-types': {
    def: spell([{ op: 'move', what: t('t0'), to: { zone: 'hand' } } as EffectStep], [{ id: 't0', kind: 'object', min: 0, max: 2, text: '', filter: { types: ['Instant', 'Sorcery'], zone: 'graveyard', owner: 'you', isCard: true } }]),
    readings: ['Return up to two target instant and/or sorcery cards from your graveyard to your hand.', 'Return up to two target instant or sorcery cards from your graveyard to your hand.'],
    near: ['Return up to two target instant and sorcery cards from your graveyard to your hand.', 'Return up to two target instant and/or creature cards from your graveyard to your hand.'],
  },
  'unless-its-controller': {
    def: trig([{ ev: 'becomes', what: 'targeted', object: { self: true }, by: { controller: 'opponent' } } as EventPattern],
      [{ op: 'pay', who: { ref: 'controllerOf', object: { ref: 'event', role: 'spell' } }, cost: { mana: [{ kind: 'generic', amount: 2 }] }, else: [{ op: 'counter', what: { ref: 'event', role: 'spell' } }] } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.'],
    near: ['Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {3}.', 'Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless you pay {2}.'],
  },
  'player-exiles-top': {
    def: spell([{ op: 'move', what: { ref: 'topCards', player: t('t0'), count: 1 }, to: { zone: 'exile' } } as EffectStep], [{ id: 't0', kind: 'player', min: 1, max: 1, text: '', players: { who: 'opponent' } }]),
    readings: ['Target opponent exiles the top card of their library.', "Exile the top card of target opponent's library."],
    near: ['Target opponent exiles the top two cards of their library.', 'Target opponent exiles the top card of your library.'],
  },
  'put-back': {
    def: spell([
      { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 4 }, as: 'seen' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'seen' }, to: { zone: 'library', position: 'top', order: 'chosen' } } as EffectStep,
    ]),
    readings: ['Look at the top four cards of your library, then put them back in any order.', 'Look at the top four cards of your library, then put them on top of your library in any order.'],
    near: ['Look at the top four cards of your library, then put them back in a random order.', 'Look at the top four cards of your library, then put them on the bottom of your library in any order.'],
  },
  // M6-5
  'unless-cast-history': {
    def: trig([{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' } as EventPattern], [{ op: 'if', cond: { cond: 'not', of: { cond: 'wasCast', via: 'escape' } }, then: [{ op: 'sacrifice', what: { ref: 'self' } }] } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['When Test Card enters, sacrifice it unless it escaped.', "When Test Card enters, sacrifice it if it didn't escape."],
    near: ['When Test Card enters, sacrifice it if it escaped.', 'When Test Card enters, exile it unless it escaped.'],
  },
  'escapes-with': {
    def: {
      kind: 'static', text: '', zone: ['stack', 'battlefield'], condition: { cond: 'wasCast', via: 'escape' },
      effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 2 }] } } as StaticEffect],
    } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['Test Card escapes with two +1/+1 counters on it.', 'If Test Card escaped, it enters with two +1/+1 counters on it.'],
    near: ['Test Card escapes with three +1/+1 counters on it.', 'Test Card enters with two +1/+1 counters on it.'],
  },
  'instead-same-damage': {
    def: spell([{
      op: 'if', cond: { cond: 'wasCast', kicked: true },
      then: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 4 }],
      else: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2 }],
    } as EffectStep], [{ id: 't0', kind: 'anyTarget', min: 1, max: 1 } as never]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Instant'] },
    readings: ['Test Card deals 2 damage to any target. If Test Card was kicked, it deals 4 damage instead.', 'Test Card deals 2 damage to any target. If Test Card was kicked, Test Card deals 4 damage instead.'],
    near: ['Test Card deals 2 damage to any target. If Test Card was kicked, it deals 3 damage instead.', 'Test Card deals 2 damage to any target. If Test Card was kicked, it deals 4 damage to you instead.'],
  },
  // FAST3 T11
  'other-turns': {
    def: { ...statics([{ s: 'costMod', applies: { spells: { stackKind: 'spell', zone: 'stack' }, caster: 'you' }, change: { kind: 'reduce', generic: 2, floor: 'zero' } }]), condition: { cond: 'not', of: { cond: 'turnOf', whose: 'you' } } } as AbilityDef,
    ctx: creature,
    readings: ['During turns other than yours, spells you cast cost {2} less to cast.', "As long as it's not your turn, spells you cast cost {2} less to cast."],
    near: ['During your turn, spells you cast cost {2} less to cast.', 'During turns other than yours, spells you cast cost {2} more to cast.'],
  },
  'second-spell': {
    def: { ...statics([{ s: 'costMod', applies: { spells: {}, caster: 'you' }, change: { kind: 'reduce', generic: 3, floor: 'zero' } }]), condition: { cond: 'compare', left: { q: 'spellsCastThisTurn' }, op: '==', right: 1 } } as AbilityDef,
    ctx: creature,
    readings: ['The second spell you cast each turn costs {3} less to cast.'],
    near: ['The third spell you cast each turn costs {3} less to cast.', 'The second spell you cast each turn costs {3} more to cast.', 'The second spell you cast each turn costs {2} less to cast.'],
  },
  'mana-where-x': {
    def: { kind: 'activated', text: '', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, dynamic: { kind: 'anyOneColor', count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Golem'] } } } } } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['{T}: Add X mana of any one color, where X is the number of Golems.', '{T}: Add X mana of any one color, where X is the number of Golems on the battlefield.'],
    near: ['{T}: Add X mana of any color, where X is the number of Golems.', '{T}: Add X mana of any one color, where X is the number of Golems you control.'],
  },
  'each-type-list': {
    def: { ...statics([{ s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', generic: { q: 'math', op: '*', args: [1, { q: 'count', of: { ref: 'each', filter: { types: ['Instant', 'Sorcery'], zone: 'graveyard', owner: 'you', isCard: true } } }] }, floor: 'zero' } }]), zone: ['stack'] } as AbilityDef,
    ctx: creature,
    readings: ['~ costs {1} less to cast for each instant and sorcery card in your graveyard.', '~ costs {1} less to cast for each instant or sorcery card in your graveyard.'],
    near: ["~ costs {1} less to cast for each instant and sorcery card in an opponent's graveyard.", '~ costs {1} less to cast for each instant and creature card in your graveyard.'],
  },
  // M6-1: the replacement shapes of zz-m6/replace.json
  'replaced-amount': {
    def: statics([{ s: 'replace', replaces: { ev: 'counters', change: 'put', kind: '+1/+1', on: { types: ['Creature'], controller: 'you' } }, body: { b: 'modify', count: { add: 1 } } }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: [
      'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
      'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on that creature instead.',
    ],
    near: [
      'If one or more +1/+1 counters would be put on a creature you control, that many plus two +1/+1 counters are put on it instead.',
      'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.',
    ],
  },
  'plural-enter': {
    def: statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, to: 'battlefield' }, body: { b: 'enters', tapped: true } }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['Creatures your opponents control enter tapped.'],
    near: ['Creatures you control enter tapped.', 'Creatures your opponents control enter untapped.'],
  },
  // FAST3 T13
  'base-pt-each-equal': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] } }, { layer: '7b', power: { q: 'stat', stat: 'manaValue', of: t('c') }, toughness: { q: 'stat', stat: 'manaValue', of: t('c') } }] }] } as EffectStep], [objTarget('c', { types: ['Artifact'], notTypes: ['Creature'] })]),
    readings: ['Target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value until end of turn.', 'Target noncreature artifact becomes an artifact creature with base power and base toughness each equal to its mana value until end of turn.'],
    near: ['Target noncreature artifact becomes an artifact creature with power and toughness each equal to its power until end of turn.', 'Target noncreature artifact becomes an artifact creature with power equal to its mana value until end of turn.'],
  },
  // FAST3 T12
  'planeswalker-type': {
    def: t12Static({ cond: 'exists', of: { ref: 'each', filter: { types: ['Planeswalker'], subtypes: ['Garruk'], controller: 'you' } } }, [grow]),
    ctx: creature,
    readings: ['~ gets +1/+1 as long as you control a Garruk planeswalker.', '~ gets +1/+1 as long as you control a Garruk.'],
    near: ['~ gets +1/+1 as long as you control a Garruk creature.', '~ gets +1/+1 as long as you control a Liliana planeswalker.'],
  },
  // std-rx18: "creatures without flying your opponents control" (Stoneshock Giant)
  'without-keyword-controller-order': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], notKeyword: 'flying', controller: 'opponent' } }, mods: [{ layer: '7c', power: -1, toughness: 0 }] }]),
    ctx: creature,
    readings: ['Creatures without flying your opponents control get -1/-0.', 'Creatures your opponents control without flying get -1/-0.'],
    near: ['Creatures without flying you control get -1/-0.', 'Creatures with flying your opponents control get -1/-0.'],
  },
  // std-rx18: "Enchanted creature loses all abilities and can't attack or block" (Observed Stasis)
  'loses-all-then-cants': {
    def: statics([
      { s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 6, removeAll: true }] },
      { s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'attack' },
      { s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'block' },
    ]),
    ctx: creature,
    readings: ["Enchanted creature loses all abilities and can't attack or block.", "Enchanted creature loses all abilities. Enchanted creature can't attack. Enchanted creature can't block."],
    near: ["Enchanted creature loses all abilities and can't attack.", "Enchanted creature loses flying and can't attack or block."],
  },
  'keyword-controller-order': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], keyword: 'flying', controller: 'opponent' } }, mods: [{ layer: '7c', power: -1, toughness: 0 }] }]),
    ctx: creature,
    readings: ['Creatures with flying your opponents control get -1/-0.', 'Creatures your opponents control with flying get -1/-0.'],
    near: ['Creatures with flying you control get -1/-0.', 'Creatures without flying your opponents control get -1/-0.'],
  },
  'for-each-opponents': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: T12_SWAMPS, toughness: T12_SWAMPS }] }]),
    ctx: creature,
    readings: ['~ gets +1/+1 for each Swamp your opponents control.', '~ gets +1/+1 for each Swamp an opponent controls.'],
    near: ['~ gets +1/+1 for each Swamp you control.', '~ gets +1/+1 for each Island your opponents control.'],
  },
  // MX3: "you don't control a Ring-bearer" (Dúnedain Rangers) is "you control no Ring-bearers"
  'dont-control-a': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Land'], controller: 'you' }, to: 'battlefield' }], [draw()], { interveningIf: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Island'], controller: 'you' } } } } }),
    ctx: creature,
    readings: ['Whenever a land you control enters, if you control no Islands, draw a card.', 'Whenever a land you control enters, if you don\x27t control an Island, draw a card.'],
    near: ['Whenever a land you control enters, if you don\x27t control two Islands, draw a card.', 'Whenever a land you control enters, if an opponent doesn\x27t control an Island, draw a card.'],
  },
  hellbent: {
    def: t12Static({ cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: you }, op: '==', right: 0 }, [grow]),
    ctx: creature,
    readings: ['~ gets +1/+1 as long as you have no cards in hand.', '~ gets +1/+1 as long as exactly zero cards are in your hand.'],
    near: ['~ gets +1/+1 as long as you have no cards in your graveyard.', '~ gets +1/+1 as long as you have one card in hand.'],
  },
  'any-player-controls': {
    def: t12Static({ cond: 'exists', of: { ref: 'each', filter: { colors: ['B'] } } }, [grow]),
    ctx: creature,
    readings: ['~ gets +1/+1 as long as any player controls a black permanent.', '~ gets +1/+1 as long as there is a black permanent on the battlefield.'],
    near: ['~ gets +1/+1 as long as you control a black permanent.', '~ gets +1/+1 as long as any player controls a white permanent.'],
  },
  'drawn-this-turn': {
    def: t12Static({ cond: 'compare', left: { q: 'cardsDrawnThisTurn' }, op: '>=', right: 2 }, [grow]),
    ctx: creature,
    readings: ["As long as you've drawn two or more cards this turn, ~ gets +1/+1.", "As long as the number of cards you've drawn this turn is two or greater, ~ gets +1/+1."],
    near: ["As long as you've drawn three or more cards this turn, ~ gets +1/+1.", "As long as you've cast two or more spells this turn, ~ gets +1/+1."],
  },
  'abilities-lost-order': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 6, removeAll: true }, { layer: '7c', power: -3, toughness: 0 }] }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ['Enchanted creature gets -3/-0 and loses all abilities.', 'Enchanted creature loses all abilities and gets -3/-0.'],
    near: ['Enchanted creature gets -3/-0 and loses flying.', 'Enchanted creature gets -3/-0.'],
  },
  'toughness-plus': {
    def: statics([{ s: 'continuous', cda: true, affects: { ref: 'self' }, mods: [{ layer: '7a', power: T12_DEAD, toughness: { q: 'math', op: '+', args: [T12_DEAD, 1] } }] }]),
    ctx: creature,
    readings: [
      "~'s power is equal to the number of creature cards in all graveyards and its toughness is equal to that number plus 1.",
      "~'s power is equal to the number of creature cards in all graveyards and its toughness is equal to the number of creature cards in all graveyards plus 1.",
    ],
    near: [
      "~'s power is equal to the number of creature cards in all graveyards and its toughness is equal to that number plus 2.",
      "~'s power is equal to the number of creature cards in all graveyards and its toughness is equal to that number.",
    ],
  },
  'cant-block-it': {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlockedBy', other: { types: ['Creature'], power: { op: '<', value: { q: 'stat', stat: 'power', of: { ref: 'self' } } } } }]),
    ctx: creature,
    readings: ["Creatures with power less than ~'s power can't block it.", "~ can't be blocked by creatures with power less than ~'s power."],
    near: ["Creatures with power greater than ~'s power can't block it.", "Creatures with power less than ~'s power can block it."],
  },
  domain: {
    def: statics([{ s: 'continuous', cda: true, affects: { ref: 'self' }, mods: [{ layer: '7a', power: T12_DOMAIN, toughness: T12_DOMAIN }] }]),
    ctx: creature,
    readings: ["~'s power and toughness are each equal to the number of basic land types among lands you control."],
    near: ["~'s power and toughness are each equal to the number of land types among lands you control.", "~'s power and toughness are each equal to the number of basic land types among lands an opponent controls."],
  },
  'other-than-enchanted': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: T12_OTHERS, toughness: T12_OTHERS }] }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ['Enchanted creature gets +1/+1 for each other creature you control.', 'Enchanted creature gets +X/+X, where X is the number of other creatures you control.'],
    near: ['Enchanted creature gets +1/+1 for each creature you control.', 'Enchanted creature gets +1/+1 for each other creature an opponent controls.'],
  },
  'counters-for-each': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: T12_CHARGE, toughness: T12_CHARGE }] }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] },
    readings: ['Equipped creature gets +1/+1 for each charge counter on ~.', 'Equipped creature gets +X/+X, where X is the number of charge counters on ~.'],
    near: ['Equipped creature gets +1/+1 for each time counter on ~.', 'Equipped creature gets +2/+2 for each charge counter on ~.'],
  },
  // M6-4 (render/evt.ts)
  'transforms-into-self': {
    def: trig([{ ev: 'becomes', what: 'transformed', object: { self: true } } as EventPattern], [gain(3)]),
    ctx: creature,
    readings: ['Whenever Test Card transforms, you gain 3 life.', 'Whenever Test Card transforms into Test Card, you gain 3 life.'],
    near: ['Whenever Test Card transforms into a creature, you gain 3 life.', 'Whenever Test Card becomes tapped, you gain 3 life.'],
  },
  // FAST3 T18
  'same-name': {
    def: spell([{
      op: 'effect', duration: { d: 'endOfTurn' },
      effects: [{ s: 'continuous', affects: { ref: 'union', of: [t('c'), { ref: 'each', filter: { types: ['Creature'], other: true, sharesWith: { with: t('c'), quality: 'name' } } }] }, mods: [{ layer: '7c', power: -1, toughness: -1 }] }],
    } as EffectStep], [objTarget('c', { types: ['Creature'] })]),
    readings: [
      'Target creature and all other creatures with the same name as that creature get -1/-1 until end of turn.',
      'Target creature and all other creatures that share a name with that creature get -1/-1 until end of turn.',
    ],
    near: ['Target creature and all other creatures with the same color as that creature get -1/-1 until end of turn.', 'Target creature and all other creatures with the same name as that creature get -2/-2 until end of turn.'],
  },
  'sacrificed-noun': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'toughness', of: { ref: 'costSacrificed' } } } as EffectStep]),
    readings: ["You gain life equal to the sacrificed creature's toughness.", "You gain life equal to the sacrificed artifact's toughness."],
    near: ["You gain life equal to the exiled creature's toughness.", "You gain life equal to the sacrificed creature's power."],
  },
  // M6-12 (render/stat.ts: the trigger-doubling sentence of zz-m6/triggers.json)
  'entering-the-battlefield': {
    def: statics([{ s: 'triggerMod', cause: { ev: 'zoneChange', subject: { types: ['Artifact', 'Creature'] }, to: 'battlefield' }, abilitiesOf: { controller: 'you' }, additional: 1 }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: [
      'If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
      'If an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
    ],
    near: [
      'If an artifact or creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
      'If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers two additional times.',
    ],
  },
  // M6-10 (render/stat.ts, render/evt.ts: the acceptance cards' shapes of zz-m6/gate.json)
  'enter-copy-of-controlled': {
    def: statics([{ s: 'replace', replaces: enters, body: { b: 'enters', copy: { of: { types: ['Creature'], controller: 'you' }, optional: true } } }]),
    ctx: creature,
    readings: ['You may have Test Card enter as a copy of a creature you control.', 'You may have Test Card enter as a copy of any creature you control on the battlefield.'],
    near: ['You may have Test Card enter as a copy of a creature an opponent controls.', 'You may have Test Card enter as a copy of a creature.'],
  },
  'replaced-damage-recipient': {
    def: statics([{ s: 'replace', replaces: { ev: 'damage', source: { colors: ['R'] }, recipient: { player: 'any' } }, body: { b: 'modify', amount: { add: 1 } } }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: [
      'If a red source would deal damage to a player, it deals that much damage plus 1 to that player instead.',
      'If a red permanent would deal damage to a player, it deals 1 more damage instead.',
    ],
    near: ['If a red source would deal damage to a player, it deals that much damage plus 2 to that player instead.', 'If a red source would deal damage to a player, it deals that much damage plus 1 to that creature instead.'],
  },
  'empty-library-win': {
    def: statics([{
      s: 'replace', replaces: { ev: 'draw', player: 'you' }, condition: { cond: 'compare', left: { q: 'zoneSize', zone: 'library', of: { ref: 'you' } }, op: '==', right: 0 },
      body: { b: 'instead', do: [{ op: 'winGame', who: you } as EffectStep] },
    } as StaticEffect]),
    ctx: creature,
    readings: ['If you would draw a card while your library has no cards in it, you win the game instead.', 'If you would draw a card and exactly 0 cards are in your library, win the game instead.'],
    near: ['If you would draw a card while your graveyard has no cards in it, you win the game instead.', 'If you would draw a card while your library has no cards in it, you lose the game instead.'],
  },
  'other-land-types': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Land'] } }, mods: [{ layer: 4, subtypes: { add: ['Swamp'] } }] }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Land'] },
    readings: ['Each land is a Swamp in addition to its other land types.', 'Each land is a Swamp in addition to its other types.'],
    near: ['Each land is a Swamp.', 'Each land is an Island in addition to its other land types.'],
  },
  'redirect-all-damage': {
    def: statics([{ s: 'replace', replaces: { ev: 'damage', recipient: { player: 'you' } }, body: { b: 'redirect', to: { ref: 'attachedTo' } } }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ['All damage that would be dealt to you is dealt to enchanted creature instead.', 'If you would be dealt damage, enchanted creature is dealt that damage instead.'],
    near: ['All damage that would be dealt to you is dealt to target creature instead.', 'All damage that would be dealt to enchanted creature is dealt to you instead.'],
  },
  // M6-2 (render/copy-except.ts)
  'copy-exception': {
    def: spell([{ op: 'copy', what: t('c'), result: 'token', who: you, except: [{ layer: '7b', power: 1, toughness: 1 }] } as EffectStep], [objTarget('c')]),
    readings: ["Create a token that's a copy of target creature, except it's 1/1.", "Create a token that's a copy of target creature, except it has base power and toughness 1/1."],
    near: ["Create a token that's a copy of target creature, except it's 2/2.", "Create a token that's a copy of target creature, except it has base power 1."],
  },
  // FAST3 T15
  'players-plural': {
    def: statics([{ s: 'restrict', subject: { ref: 'each', who: 'opponent' }, mode: 'cant', action: 'gainLife' }]),
    ctx: unknown,
    readings: ["Your opponents can't gain life.", "Each opponent can't gain life."],
    near: ["Players can't gain life.", "Your opponents can't lose life."],
  },
  'players-plural-cants': {
    def: statics([
      { s: 'restrict', subject: { ref: 'each', who: 'player' }, mode: 'cant', action: 'draw' },
      { s: 'restrict', subject: { ref: 'each', who: 'player' }, mode: 'cant', action: 'gainLife' },
    ]),
    ctx: unknown,
    readings: ["Players can't draw cards or gain life.", "Each player can't draw cards or gain life."],
    near: ["Your opponents can't draw cards or gain life.", "Players can't draw cards or lose life.", "Players can't draw cards."],
  },
  'player-hexproof': {
    def: statics([{ s: 'restrict', subject: you, mode: 'cant', action: 'beTargeted', other: { controller: 'opponent' } }]),
    ctx: unknown,
    readings: ['You have hexproof.'],
    near: ['You have shroud.', 'Creatures you control have hexproof.'],
  },
  'restriction-during-your-turn': {
    def: statics([{ s: 'restrict', subject: { ref: 'each', who: 'opponent' }, mode: 'cant', action: 'cast', when: { cond: 'turnOf', whose: 'you' } }]),
    ctx: unknown,
    readings: ["Your opponents can't cast spells during your turn.", "As long as it's your turn, each opponent can't cast spells."],
    near: ["Your opponents can't cast spells during combat.", "Your opponents can't cast spells during their turn."],
  },
  'enters-tapped-no-untap': {
    def: statics([{ s: 'replace', replaces: enters, body: { b: 'enters', tapped: true } }, { s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'untapDuringUntapStep' }]),
    ctx: creature,
    readings: ["~ enters tapped and doesn't untap during your untap step.", "~ enters tapped. It doesn't untap during your untap step."],
    near: ["~ enters tapped and doesn't untap during your upkeep.", "~ enters tapped and untaps during your untap step."],
  },
  'flash-this-turn': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'permit', who: you, action: 'haveFlash', of: { types: ['Creature'], stackKind: 'spell', zone: 'stack' } }] }]),
    readings: ['You may cast creature spells this turn as though they had flash.', 'You may cast creature spells as though they had flash this turn.'],
    near: ['You may cast creature spells this turn as though they had haste.', 'You may cast artifact spells this turn as though they had flash.'],
  },
  'any-player-life': {
    def: statics([{
      s: 'replace', replaces: enters,
      body: { b: 'enters', tapped: true, tappedUnless: { cond: 'any', of: [
        { cond: 'compare', left: { q: 'life', of: { ref: 'each', who: 'opponent' } }, op: '<=', right: 13 },
        { cond: 'compare', left: { q: 'life', of: you }, op: '<=', right: 13 },
      ] } },
    }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Land'] },
    readings: ['~ enters tapped unless a player has 13 or less life.', '~ enters tapped unless each opponent has 13 or less life or you have 13 or less life.'],
    near: ['~ enters tapped unless a player has 12 or less life.', '~ enters tapped unless an opponent has 13 or less life.'],
  },
  'cast-from-hand': {
    def: { kind: 'static', text: '', condition: { cond: 'wasCast', from: 'hand' }, effects: [{ s: 'replace', replaces: enters, body: { b: 'enters', counters: [{ kind: 'divinity', count: 1 }] } }] } as AbilityDef,
    ctx: creature,
    readings: ['~ enters with a divinity counter on it if you cast it from your hand.', '~ enters with a divinity counter on it if ~ was cast from your hand.'],
    near: ['~ enters with a divinity counter on it if you cast it from your graveyard.', '~ enters with a divinity counter on it if an opponent cast it from your hand.'],
  },
  // FAST3 T16 (render/stat.ts)
  'greater-power': {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlockedBy', other: { types: ['Creature'], power: { op: '>', value: { q: 'stat', stat: 'power', of: { ref: 'self' } } } } }]),
    ctx: creature,
    readings: ["~ can't be blocked by creatures with greater power.", "~ can't be blocked by creatures with power greater than ~'s power."],
    near: ["~ can't be blocked by creatures with greater toughness.", "~ can't be blocked by creatures with lesser power."],
  },
  'color-spells-or-sources': {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beTargeted', other: { colors: ['B'] } }]),
    ctx: creature,
    readings: ["~ can't be the target of black spells or abilities from black sources."],
    near: ["~ can't be the target of black spells or abilities from white sources.", "~ can't be the target of black spells."],
  },
  'two-groups-cant': {
    def: statics([
      { s: 'restrict', subject: { ref: 'each', filter: { colors: ['W'], types: ['Creature'] } }, mode: 'cant', action: 'block' },
      { s: 'restrict', subject: { ref: 'each', filter: { colors: ['U'], types: ['Creature'] } }, mode: 'cant', action: 'block' },
    ]),
    readings: ["White creatures and blue creatures can't block.", "White creatures can't block. Blue creatures can't block."],
    near: ["White creatures and blue creatures can't attack.", "White creatures and green creatures can't block."],
  },
  'cant-unless-pair': {
    def: statics((['attack', 'block'] as const).map((action): StaticEffect => ({ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action, when: { cond: 'exists', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } }, atLeast: 3 } }))),
    ctx: creature,
    readings: ["~ can't attack or block unless you control three or more lands."],
    near: ["~ can't attack or block unless you control four or more lands.", "~ can't attack or block as long as you control three or more lands."],
  },
  'except-duration-inside': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'restrict', subject: t('c'), mode: 'cant', action: 'beBlockedBy', other: { not: { types: ['Creature'], keyword: 'flying' } } }] } as EffectStep], [objTarget('c')]),
    readings: ["Target creature can't be blocked this turn except by creatures with flying.", "Target creature can't be blocked except by creatures with flying this turn."],
    near: ["Target creature can't be blocked this turn except by creatures with reach.", "Target creature can't be blocked this turn by creatures with flying."],
  },
  'lasting-cants': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'restrict', subject: t('c'), mode: 'cant', action: 'attack' }, { s: 'restrict', subject: t('c'), mode: 'cant', action: 'block' }] } as EffectStep], [objTarget('c')]),
    readings: ["Target creature can't attack or block this turn."],
    near: ["Target creature can't attack or block.", "Target creature can't attack this turn."],
  },
  // FAST3 T17
  'total-of-set': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, sum: true } } as EffectStep]),
    readings: ['You gain life equal to the total power of creatures you control.', 'You gain life equal to the total power of all creatures you control.'],
    near: ['You gain life equal to the total power of creatures your opponents control.', 'You gain life equal to the total toughness of creatures you control.'],
  },
  'opponents-you-have': {
    def: spell([{ op: 'createToken', who: you, count: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' } }, token: { predefined: 'Food' } } as EffectStep]),
    readings: ['Create a number of Food tokens equal to the number of opponents you have.', 'Create a number of Food tokens equal to the number of opponents.'],
    near: ['Create a number of Food tokens equal to the number of players you have.', 'Create a number of Food tokens equal to the number of opponents target player has.'],
  },
  'reveal-that-card': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { types: ['Creature'] }, max: 1, reveal: true, as: 'found' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'found' }, to: { zone: 'hand' } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
    ]),
    readings: ['Search your library for a creature card, reveal that card, put it into your hand, then shuffle.', 'Search your library for a creature card, reveal it, put it into your hand, then shuffle.'],
    near: ['Search your library for a creature card, reveal those cards, put it into your hand, then shuffle.', 'Search your library for a creature card, put it into your hand, then shuffle.'],
  },
  // FAST4 T20 (render/fold.ts, render/steps-zones.ts)
  'tap-and-counters-on-it': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Land'], controller: 'you' }, to: 'battlefield' }], [
      { op: 'tap', what: t('c') } as EffectStep,
      { op: 'putCounters', on: t('c'), kind: 'stun', count: 1 } as EffectStep,
    ], {}, [objTarget('c', { types: ['Creature'], controller: 'opponent' })]),
    readings: [
      'Whenever a land you control enters, tap target creature an opponent controls and put a stun counter on it.',
      'Whenever a land you control enters, tap target creature an opponent controls. Put a stun counter on that creature.',
      // FAST5 T76 (model/focus.ts): the object the instruction right before worked on is "it", though the trigger's land is another candidate
      'Whenever a land you control enters, tap target creature an opponent controls. Put a stun counter on it.',
    ],
    near: [
      'Whenever a land you control enters, tap target creature an opponent controls and put two stun counters on it.',
    ],
  },
  // FAST5 T76 (render/refs.ts, model/focus.ts#grantedGroup)
  'granted-group-them': {
    def: spell([
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 2, toughness: 0 }] }] } as EffectStep,
      { op: 'untap', what: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } as EffectStep,
    ], []),
    readings: [
      'Creatures you control get +2/+0 until end of turn. Untap all creatures you control.',
      'Creatures you control get +2/+0 until end of turn. Untap them.',
      'Creatures you control get +2/+0 until end of turn. Untap those creatures.',
    ],
    near: [
      'Creatures you control get +2/+0 until end of turn. Untap it.',
      'Creatures you control get +2/+0 until end of turn. Untap those lands.',
    ],
  },
  'untap-up-to-chosen': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Land'] } }, min: 0, max: 2, as: 'u' } as EffectStep,
      { op: 'untap', what: { ref: 'bound', name: 'u' } } as EffectStep,
    ]),
    readings: ['Untap up to two lands.', 'Choose up to two lands. Untap them.'],
    near: ['Untap up to three lands.', 'Untap up to two target lands.'],
  },
  'you-and-player-each-draw': {
    def: spell([draw(3), draw(3, t('p') as PlayerRef)], [playerTarget('p')]),
    readings: ['You and target player each draw three cards.', 'Draw three cards. Target player draws three cards.'],
    near: ['You and target player each draw two cards.', 'Each player draws three cards.'],
  },
  'phases-out-subject': {
    def: spell([{ op: 'phaseOut', what: t('c') } as EffectStep], [objTarget('c')]),
    readings: ['Target creature phases out.', 'Phase out target creature.'],
    near: ['Target creature phases in.', 'Target creature phase out.'],
  },
  'and-or-descriptions': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { anyOf: [{ supertypes: ['Basic'], types: ['Land'] }, { subtypes: ['Gate'] }] }, min: 0, max: 2, as: 'found' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'found' }, to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
    ]),
    readings: ['Search your library for up to two basic land cards and/or Gate cards, put them onto the battlefield tapped, then shuffle.', 'Search your library for up to two basic land cards or Gate cards, put them onto the battlefield tapped, then shuffle.'],
    near: ['Search your library for basic land cards and/or Gate cards, put them onto the battlefield tapped, then shuffle.', 'Search your library for up to two basic land cards and Gate cards, put them onto the battlefield tapped, then shuffle.'],
  },
  // FAST4 T22
  // CLOUD std-fra: the number of cards in a zone as the computed number of counters
  // CLOUD std-fra: the choice and the effect on what it chose, as one sentence or as two
  'choice-own-sentence': {
    def: spell([
      { op: 'chooseValue', who: you, what: 'creatureType', as: 'chosenCreatureType', link: 'chosenCreatureType' } as EffectStep,
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you', chosen: { link: 'chosenCreatureType', quality: 'creatureType' } } }, mods: [{ layer: '7c', power: 1, toughness: 0 }] }] } as EffectStep,
    ]),
    readings: [
      'Choose a creature type. Creatures you control of the chosen type get +1/+0 until end of turn.',
      'Creatures you control of the creature type of your choice get +1/+0 until end of turn.',
    ],
    near: ['Choose a creature type. Creatures you control of the chosen type get +2/+0 until end of turn.', 'Choose a land type. Creatures you control of the chosen type get +1/+0 until end of turn.'],
  },
  'counters-where-x-zone': {
    def: spell([{ op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: '+1/+1', count: { q: 'zoneSize', zone: 'hand', of: you } } as EffectStep]),
    readings: ['Put X +1/+1 counters on each creature you control, where X is the number of cards in your hand.'],
    near: ['Put X +1/+1 counters on each creature you control, where X is the number of cards in your graveyard.', 'Put X +1/+1 counters on each creature you control.'],
  },
  'counter-count': {
    def: spell([{ op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: '+1/+1', count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } } } as EffectStep]),
    readings: [
      'Put X +1/+1 counters on each creature you control, where X is the number of Elves you control.',
      'Put a +1/+1 counter on each creature you control for each Elf you control.',
      'Put a number of +1/+1 counters equal to the number of Elves you control on each creature you control.',
    ],
    near: ['Put X +1/+1 counters on each creature you control, where X is the number of Goblins you control.', 'Put X +1/+1 counters on each creature you control.'],
  },
  'double-pt': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: { q: 'stat', stat: 'power', of: t('c') }, toughness: 0 }] }] } as EffectStep], [objTarget('c')]),
    readings: ["Double target creature's power until end of turn.", 'Target creature gets +X/+0 until end of turn, where X is its power.'],
    near: ["Double target creature's toughness until end of turn.", "Double target creature's power."],
  },
  // FAST5 T41
  'type-loss-order': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 4, subtypes: { removeAll: 'creature' } }, { layer: '7c', power: 3, toughness: -3 }] }] } as EffectStep], [objTarget('c')]),
    readings: ['Target creature gets +3/-3 and loses all creature types until end of turn.', 'Target creature loses all creature types and gets +3/-3 until end of turn.'],
    near: ['Target creature gets +3/-3 and loses all land types until end of turn.', 'Target creature gets +3/-3 and loses all creature types.', 'Target creature gets +3/-3 or loses all creature types until end of turn.'],
  },
  // FAST5 T57
  'enters-tapped-then-choose': {
    def: statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', tapped: true, choose: [{ what: 'color', link: 'color' }] } }]),
    readings: ['~ enters tapped. As it enters, choose a color.', 'As ~ enters, choose a color. ~ enters tapped.'],
    near: ['~ enters tapped. As it enters, choose two colors.', '~ enters. As it enters, choose a color.', '~ enters tapped unless you choose a color.'],
  },
  'identity-then-lose-others': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, subtypes: { set: ['Frog'] } }, { layer: 6, removeAll: true, add: [{ kind: 'keyword', keyword: 'defender' } as unknown as AbilityDef] }, { layer: '7b', power: 1, toughness: 1 }] }]),
    readings: ['Enchanted creature is a Frog with base power and toughness 1/1. It has defender and loses all other abilities.'],
    near: ['Enchanted creature is a Frog with base power and toughness 1/1. It has defender and loses all abilities.', 'Enchanted creature is a Frog with base power and toughness 2/2. It has defender and loses all other abilities.', 'Enchanted creature is a Frog with base power and toughness 1/1. It has reach and loses all other abilities.'],
  },
  'colors-after-nouns': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } }], [objTarget('c', { types: ['Creature', 'Planeswalker'], colors: ['G', 'U'] })]),
    readings: ["Exile target creature or planeswalker that's green or blue.", 'Exile target green or blue creature or planeswalker.'],
    near: ["Exile target creature or planeswalker that's green.", "Exile target creature or planeswalker that's green and blue.", "Exile target creature that's green or blue."],
  },
  'pump-pair-duration': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [
      { s: 'continuous', affects: t('a'), mods: [{ layer: '7c', power: 1, toughness: 1 }] },
      { s: 'continuous', affects: t('b'), mods: [{ layer: '7c', power: -1, toughness: -1 }] },
    ] } as EffectStep], [objTarget('a', { types: ['Creature'], controller: 'you' }), objTarget('b', { types: ['Creature'], controller: 'opponent' })]),
    readings: ['Until end of turn, target creature you control gets +1/+1 and target creature an opponent controls gets -1/-1.', 'Target creature you control gets +1/+1 until end of turn and target creature an opponent controls gets -1/-1 until end of turn.'],
    near: ['Until end of turn, target creature you control gets +1/+1 and target creature an opponent controls gets -2/-2.', 'Until end of turn, target creature you control gets +1/+1 or target creature an opponent controls gets -1/-1.', 'Target creature you control gets +1/+1 and target creature an opponent controls gets -1/-1.'],
  },
  'character-pronoun': {
    def: trig([{ ev: 'attacks', attacker: { self: true } } as EventPattern], [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Legendary', 'Creature', 'Human'] },
    readings: ['Whenever Test Card attacks, he gets +1/+1 until end of turn.', 'Whenever Test Card attacks, she gets +1/+1 until end of turn.', 'Whenever Test Card attacks, it gets +1/+1 until end of turn.'],
    near: ['Whenever Test Card attacks, he gets +2/+1 until end of turn.', 'Whenever Test Card attacks, they get +1/+1 until end of turn.'],
  },
  // FAST5X E24: the object itself, moved or entering, also by its name ("her owner's", "on her" of a character card read as "~")
  'self-by-name': {
    def: trig([{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' } as EventPattern], [{ op: 'move', what: { ref: 'self' }, to: { zone: 'battlefield', controller: 'owner', counters: [{ kind: '+1/+1', count: 1 }] } } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Legendary', 'Creature', 'Human'] },
    readings: ["When Test Card dies, return Test Card to the battlefield under Test Card's owner's control with a +1/+1 counter on Test Card.", "When Test Card dies, return Test Card to the battlefield under its owner's control with a +1/+1 counter on it."],
    near: ["When Test Card dies, return Test Card to the battlefield under Test Card's owner's control with a +1/+1 counter on target creature.", "When Test Card dies, return Test Card to the battlefield under your control with two +1/+1 counters on Test Card."],
  },
  'for-each-type-list': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Aura', 'Equipment'], attachedToObject: { ref: 'self' } } } }, toughness: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Aura', 'Equipment'], attachedToObject: { ref: 'self' } } } } }] }]),
    ctx: creature,
    readings: ['Test Card gets +1/+1 for each Aura and Equipment attached to it.', 'Test Card gets +1/+1 for each Aura or Equipment attached to it.'],
    near: ['Test Card gets +1/+1 for each Aura and Equipment you control.', 'Test Card gets +1/+1 for each Aura attached to it.'],
  },
  // FAST4 T24
  'reveal-in-hand': {
    def: { kind: 'activated', text: '', cost: { other: [{ kind: 'reveal', zone: 'hand', count: 1, filter: { colors: ['W'] } }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 1 }] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['Reveal a white card from your hand: You gain 1 life.', 'Reveal a white card in your hand: You gain 1 life.'],
    near: ['Reveal a white card in your graveyard: You gain 1 life.', 'Reveal a blue card in your hand: You gain 1 life.'],
  },
  // FAST4 T25
  'counters-control-order': {
    def: spell([
      { op: 'move', what: t('c'), to: { zone: 'exile' }, as: 'moved' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'moved' }, to: { zone: 'battlefield', controller: 'owner', counters: [{ kind: '+1/+1', count: 1 }] } } as EffectStep,
    ], [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    readings: [
      "Exile target creature you control, then return that card to the battlefield under its owner's control with a +1/+1 counter on it.",
      "Exile target creature you control, then return that card to the battlefield with a +1/+1 counter on it under its owner's control.",
    ],
    near: ["Exile target creature you control, then return that card to the battlefield under your control with a +1/+1 counter on it.", "Exile target creature you control, then return that card to the battlefield under its owner's control."],
  },
  'opponents-they-control': {
    def: spell([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', who: 'opponent' }, amount: 1, also: [{ to: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } }, amount: 1 }] } as EffectStep]),
    ctx: unknown,
    readings: ['Test Card deals 1 damage to each opponent and each creature they control.', 'Test Card deals 1 damage to each opponent and each creature your opponents control.'],
    near: ['Test Card deals 1 damage to each opponent and each creature you control.', 'Test Card deals 1 damage to each opponent and each creature.'],
  },
  'damage-each-of': {
    def: spell([{ op: 'damage', source: { ref: 'self' }, to: t('c'), amount: 2 } as EffectStep], [{ id: 'c', kind: 'anyTarget', min: 0, max: 3, text: '' }]),
    ctx: unknown,
    readings: ['Test Card deals 2 damage to each of up to three targets.', 'Test Card deals 2 damage to up to three targets.'],
    near: ['Test Card deals 2 damage divided as you choose among up to three targets.', 'Test Card deals 2 damage to each of up to two targets.'],
  },
  'owner-of-object': {
    def: spell([
      { op: 'chooseValue', who: { ref: 'ownerOf', object: t('c') }, what: 'option', options: ['top', 'bottom'], as: 'libraryEnd', link: 'libraryEnd' } as EffectStep,
      { op: 'if', cond: { cond: 'chosen', link: 'libraryEnd', equals: 'top' }, then: [{ op: 'move', what: t('c'), to: { zone: 'library', position: 'top' } }] } as EffectStep,
      { op: 'if', cond: { cond: 'chosen', link: 'libraryEnd', equals: 'bottom' }, then: [{ op: 'move', what: t('c'), to: { zone: 'library', position: 'bottom' } }] } as EffectStep,
    ], [objTarget('c')]),
    readings: [
      "Target creature's owner puts it on their choice of the top or bottom of their library.",
      'The owner of target creature puts it on their choice of the top or bottom of their library.',
    ],
    near: ["Target creature's controller puts it on their choice of the top or bottom of their library.", "Target creature's owner puts it on the top of their library."],
  },
  // FAST4 T26
  'life-gained-tense': {
    def: spell([{ op: 'draw', who: you, count: 1, guard: { cond: 'compare', left: { q: 'lifeGainedThisTurn' }, op: '>=', right: 3 } } as EffectStep, { op: 'mill', who: { ref: 'each', who: 'opponent' }, count: { q: 'lifeGainedThisTurn' } } as EffectStep]),
    readings: [
      "Draw a card if you've gained 3 or more life this turn. Each opponent mills X cards, where X is the amount of life you've gained this turn.",
      'Draw a card if you gained 3 or more life this turn. Each opponent mills X cards, where X is the amount of life you gained this turn.',
    ],
    near: ["Draw a card if you've gained 3 or more life this game. Each opponent mills X cards, where X is the amount of life you gained this turn.", 'Draw a card if you gained 3 or more life this turn. Each opponent mills X cards, where X is the amount of life you lost this turn.'],
  },
  'stat-was': {
    def: spell([{ op: 'destroy', what: t('c') }, { op: 'if', cond: { cond: 'compare', left: { q: 'stat', stat: 'manaValue', of: t('c') }, op: '<=', right: 2 }, then: [{ op: 'createToken', who: you, count: 1, token: { predefined: 'Food' } }] } as EffectStep], [objTarget('c')]),
    readings: ['Destroy target creature. If its mana value was 2 or less, create a Food token.', 'Destroy target creature. If its mana value is 2 or less, create a Food token.'],
    near: ['Destroy target creature. If its mana value was 2 or greater, create a Food token.', 'Destroy target creature. If its power was 2 or less, create a Food token.'],
  },
  'differently-named': {
    def: spell([{ op: 'draw', who: you, count: { q: 'distinct', what: 'names', among: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } } as EffectStep]),
    readings: ['Draw X cards, where X is the number of differently named lands you control.', 'Draw cards equal to the number of different names among lands you control.'],
    near: ['Draw X cards, where X is the number of differently named creatures you control.', 'Draw X cards, where X is the number of lands you control.'],
  },
  'discarded-this-way': {
    def: spell([{ op: 'discard', who: you, count: 'hand', as: 'd' } as EffectStep, { op: 'draw', who: you, count: { q: 'resultCount', step: 'd' } } as EffectStep, { op: 'draw', who: you, count: { q: 'math', op: '+', args: [{ q: 'resultCount', step: 'd' }, 1] } } as EffectStep]),
    readings: [
      'Discard your hand, then draw cards equal to the number of cards discarded this way. Draw that many cards plus one.',
      'Discard your hand, then draw that many cards. Draw that many cards plus one.',
    ],
    near: ['Discard your hand, then draw cards equal to the number of cards discarded this turn. Draw that many cards plus one.', 'Discard your hand, then draw that many cards. Draw that many cards plus two.'],
  },
  'draw-where-x': {
    def: spell([{ op: 'createToken', who: you, count: 1, token: { colors: ['G'], types: ['Creature'], subtypes: ['Fractal'], power: 0, toughness: 0 }, as: 'tok' } as EffectStep, { op: 'putCounters', on: bound('tok'), kind: '+1/+1', count: { q: 'cardsDrawnThisTurn' } } as EffectStep]),
    readings: [
      "Create a 0/0 green Fractal creature token and put X +1/+1 counters on it, where X is the number of cards you've drawn this turn.",
      "Create a 0/0 green Fractal creature token. Put a number of +1/+1 counters equal to the number of cards you've drawn this turn on it.",
    ],
    near: ["Create a 0/0 green Fractal creature token and put X +1/+1 counters on it, where X is the number of spells you've cast this turn.", "Create a 0/0 green Fractal creature token and put X -1/-1 counters on it, where X is the number of cards you've drawn this turn."],
  },
  'tapped-computed-count': {
    def: trig([dies], [{ op: 'createToken', who: you, count: { q: 'stat', stat: 'power', of: { ref: 'event', role: 'subject' } }, token: { predefined: 'Treasure' }, tapped: true } as EffectStep]),
    ctx: creature,
    readings: ['When Test Card dies, create a number of tapped Treasure tokens equal to its power.', 'When Test Card dies, create X Treasure tokens that are tapped, where X is its power.'],
    near: ['When Test Card dies, create a number of Treasure tokens equal to its power.', 'When Test Card dies, create a number of tapped Treasure tokens equal to its toughness.'],
  },
  'owner-exiles-top-serial': {
    def: spell([
      { op: 'discard', who: { ref: 'each', who: 'opponent' }, count: 1 } as EffectStep,
      { op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: 2 } as EffectStep,
      { op: 'move', what: { ref: 'topCards', player: { ref: 'each', who: 'opponent' }, count: 3 }, to: { zone: 'exile' } } as EffectStep,
    ]),
    readings: ['Each opponent discards a card, loses 2 life, and exiles the top three cards of their library.', 'Each opponent discards a card and loses 2 life. Exile the top three cards of each opponent\'s library.'],
    near: ['Each opponent discards a card, loses 2 life, and exiles the top three cards of your library.', 'Each opponent discards a card, loses 3 life, and exiles the top three cards of their library.'],
  },
  'drain-where-x': {
    def: spell([
      { op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Bat'], controller: 'you' } } } } as EffectStep,
      { op: 'gainLife', who: you, amount: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Bat'], controller: 'you' } } } } as EffectStep,
    ]),
    readings: ['Each opponent loses X life and you gain X life, where X is the number of Bats you control.'],
    near: ['Each opponent loses X life and you gain X life, where X is the number of Rats you control.', 'Each opponent loses X life and you lose X life, where X is the number of Bats you control.'],
  },
  // FAST4 T30
  'any-other-target': {
    def: spell([{ op: 'damage', source: { ref: 'self' }, to: t('a'), amount: 3, also: [{ to: t('b'), amount: 1 }] } as EffectStep], [
      { id: 'a', kind: 'anyTarget', min: 1, max: 1, text: '' },
      { id: 'b', kind: 'anyTarget', min: 1, max: 1, text: '', distinctFrom: ['a'] },
    ]),
    readings: ['Test Card deals 3 damage to any target and 1 damage to any other target.', 'Test Card deals 3 damage to any target and 1 damage to another target.'],
    near: ['Test Card deals 3 damage to any target and 1 damage to any target.', 'Test Card deals 3 damage to any target and 1 damage to any other target player.'],
  },
  'half-of-own': {
    def: spell([
      { op: 'loseLife', who: t('p'), amount: { q: 'math', op: 'ceilDiv', args: [{ q: 'life', of: t('p') }, 2] } } as EffectStep,
      { op: 'mill', who: t('p'), count: { q: 'math', op: 'ceilDiv', args: [{ q: 'zoneSize', zone: 'library', of: t('p') }, 2] } } as EffectStep,
    ], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '', players: { who: 'opponent' } }]),
    readings: ['Target opponent loses half their life, rounded up, and mills half their library, rounded up.', 'Target opponent loses life equal to half their life total, rounded up, and mills half their library, rounded up.'],
    near: ['Target opponent loses half their life, rounded down, and mills half their library, rounded up.', 'Target opponent loses half your life, rounded up, and mills half their library, rounded up.'],
  },
  'additional-counters': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you, counters: [{ kind: '+1/+1', count: 2 }] } } as EffectStep], [objTarget('c', { types: ['Creature'], zone: 'graveyard', owner: 'you' })]),
    readings: ['Return target creature card from your graveyard to the battlefield with two additional +1/+1 counters on it.', 'Return target creature card from your graveyard to the battlefield with two +1/+1 counters on it.'],
    near: ['Return target creature card from your graveyard to the battlefield with three additional +1/+1 counters on it.', 'Return target creature card from your graveyard to the battlefield with two additional -1/-1 counters on it.'],
  },
  'each-draw-mill-among': {
    def: spell([
      { op: 'draw', who: you, count: 1 } as EffectStep,
      { op: 'draw', who: t('p'), count: 1 } as EffectStep,
      { op: 'mill', who: you, count: 3, as: 'm' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: bound('m'), zone: 'any' } }, min: 0, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' } } as EffectStep,
    ], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '', players: { who: 'opponent' } }]),
    readings: ['You and target opponent each draw a card. Mill three cards, then put up to one creature card from among them into your hand.'],
    near: ['You and target opponent each draw two cards. Mill three cards, then put up to one creature card from among them into your hand.', 'You and target opponent each draw a card. Mill three cards, then put up to one land card from among them into your hand.'],
  },
  // FAST4 T23
  'hand-size-have': {
    def: trig([{ ev: 'step', step: 'upkeep', whose: 'opponent' }], [draw()], { interveningIf: { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'event', role: 'player' } }, op: '<=', right: 2 } }),
    ctx: creature,
    readings: ["At the beginning of each opponent's upkeep, if that player has two or fewer cards in hand, draw a card.", "At the beginning of each opponent's upkeep, if two or fewer cards are in that player's hand, draw a card."],
    near: ["At the beginning of each opponent's upkeep, if that player has two or more cards in hand, draw a card.", "At the beginning of each opponent's upkeep, if you have two or fewer cards in hand, draw a card."],
  },
  'one-or-more-exists': {
    def: trig([{ ev: 'step', step: 'beginCombat', whose: 'you' }], [draw()], { interveningIf: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Egg'], controller: 'you' } }, atLeast: 1 } }),
    ctx: creature,
    readings: ['At the beginning of combat on your turn, if you control one or more Eggs, draw a card.', 'At the beginning of combat on your turn, if you control an Egg, draw a card.'],
    near: ['At the beginning of combat on your turn, if you control two or more Eggs, draw a card.', 'At the beginning of combat on your turn, if an opponent controls one or more Eggs, draw a card.'],
  },
  'subjects-one-predicate': {
    def: trig([enters, { ev: 'zoneChange', subject: { other: true, token: false, subtypes: ['Cat'], controller: 'you' }, to: 'battlefield' }], [draw()]),
    ctx: creature,
    readings: ['Whenever Test Card or another nontoken Cat you control enters, draw a card.', 'Whenever Test Card enters or another nontoken Cat you control enters, draw a card.'],
    near: ['Whenever Test Card or another Cat you control enters, draw a card.', 'Whenever Test Card or another nontoken Cat you control dies, draw a card.'],
  },
  'duration-each-change': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7b', power: 5, toughness: 3 }, { layer: 6, add: [{ kind: 'keyword', keyword: 'trample' }] }] }] } as EffectStep], [objTarget('c')]),
    readings: ['Target creature has base power and toughness 5/3 until end of turn and gains trample until end of turn.', 'Target creature has base power and toughness 5/3 and gains trample until end of turn.'],
    near: ['Target creature has base power and toughness 5/3 until end of turn and gains trample.', 'Target creature has base power and toughness 3/5 until end of turn and gains trample until end of turn.'],
  },
  // FAST4 T29
  'supertype-adjective': {
    def: { ...statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'hexproof', text: 'Hexproof' }] }] }]), condition: { cond: 'matches', object: { ref: 'attachedTo' }, filter: { supertypes: ['Legendary'] } } } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] },
    readings: ['As long as equipped creature is legendary, it has hexproof.', 'As long as equipped creature is a legendary permanent, it has hexproof.'],
    near: ['As long as equipped creature is snow, it has hexproof.', 'As long as equipped creature is legendary, it has shroud.'],
  },
  'either-exists': {
    def: { ...statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'indestructible', text: 'Indestructible' }] }] }]), condition: { cond: 'exists', of: { ref: 'each', filter: { controller: 'you', anyOf: [{ allTypes: ['Artifact', 'Creature'] }, { subtypes: ['Plan'] }] } } } } as AbilityDef,
    ctx: creature,
    readings: ['As long as you control an artifact creature or a Plan, ~ has indestructible.'],
    near: ['As long as you control an artifact creature and a Plan, ~ has indestructible.', 'As long as an opponent controls an artifact creature or a Plan, ~ has indestructible.'],
  },
  'sum-for-each': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'math', op: '*', args: [1, { q: 'math', op: '+', args: [{ q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true } } }] }] }, toughness: { q: 'math', op: '*', args: [1, { q: 'math', op: '+', args: [{ q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true } } }] }] } }] } as StaticEffect]),
    ctx: creature,
    readings: ['~ gets +1/+1 for each creature you control and each creature card in your graveyard.', '~ gets +1/+1 for each creature card in your graveyard and each creature you control.'],
    near: ['~ gets +1/+1 for each creature you control or each creature card in your graveyard.', '~ gets +1/+1 for each creature you control and each land card in your graveyard.'],
  },
  'grant-then-pump': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 2, toughness: 2 }, { layer: 6, add: [{ kind: 'keyword', keyword: 'vigilance', text: 'Vigilance' }] }] }] } as EffectStep], [objTarget('c')]),
    readings: ['Target creature gains vigilance and gets +2/+2 until end of turn.', 'Target creature gets +2/+2 and gains vigilance until end of turn.'],
    near: ['Target creature gains vigilance and gets +2/+2.', 'Target creature loses vigilance and gets +2/+2 until end of turn.'],
  },
  'type-add-last': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, subtypes: { add: ['Samurai'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'Trample' }] }, { layer: '7c', power: 2, toughness: 2 }] } as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] },
    readings: ['Equipped creature gets +2/+2, has trample, and is a Samurai in addition to its other types.', 'Equipped creature is a Samurai in addition to its other types, gets +2/+2, and has trample.'],
    near: ['Equipped creature gets +2/+2, has trample, and is a Samurai.', 'Equipped creature gets +2/+2, has trample, and is a Ninja in addition to its other types.'],
  },
  'quoted-grant-then-change': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, subtypes: { add: ['Rogue'] } }, { layer: 6, add: [{ kind: 'static', text: '', effects: [{ s: 'rule', rule: 'handSizeNoLimit', player: you }] }] }, { layer: '7c', power: 1, toughness: 1 }] } as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] },
    readings: [
      'Equipped creature gets +1/+1, has "You have no maximum hand size," and is a Rogue in addition to its other types.',
      'Equipped creature gets +1/+1, has "You have no maximum hand size", and is a Rogue in addition to its other types.',
      'Equipped creature gets +1/+1, has "You have no maximum hand size.", and is a Rogue in addition to its other types.',
    ],
    near: [
      'Equipped creature gets +1/+1, has "You have no maximum hand size," and is a Rogue.',
      'Equipped creature gets +1/+1, has "You have no minimum hand size," and is a Rogue in addition to its other types.',
    ],
  },
  'base-pt-x-over-x': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7b', power: { q: 'life', of: you }, toughness: { q: 'life', of: you } }] } as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: [
      'Creatures you control have base power and base toughness each equal to your life total.',
      'Creatures you control have base power and toughness each equal to your life total.',
      'Creatures you control have base power and toughness X/X, where X is your life total.',
    ],
    near: ['Creatures you control have base power and toughness each equal to the life total of target player.', 'Creatures you control have base power equal to your life total.'],
  },
  'all-hands': {
    def: statics([{ s: 'continuous', cda: true, affects: { ref: 'self' }, mods: [{ layer: '7a', power: { q: 'count', of: { ref: 'each', filter: { zone: 'hand' } } }, toughness: { q: 'count', of: { ref: 'each', filter: { zone: 'hand' } } } }] } as StaticEffect]),
    ctx: creature,
    readings: ["~'s power and toughness are each equal to the total number of cards in all players' hands.", "~'s power and toughness are each equal to the number of cards in all players' hands."],
    near: ["~'s power and toughness are each equal to the number of cards in your hand.", "~'s power and toughness are each equal to the total number of cards in all players' graveyards."],
  },
  'shared-subject-grant': {
    def: statics([{ s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'beBlocked' }, { s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'shroud', text: 'Shroud' }] }] }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] },
    readings: ["Equipped creature can't be blocked and has shroud.", "Equipped creature can't be blocked. It has shroud."],
    near: ["Equipped creature can't block and has shroud.", "Equipped creature can't be blocked and has hexproof."],
  },
  // FAST4 T27
  'gain-or-lose-life': {
    def: trig([{ ev: 'life', change: 'gain', player: 'you' }, { ev: 'life', change: 'loss', player: 'you' }], [draw()]),
    ctx: creature,
    readings: ['Whenever you gain or lose life, draw a card.', 'Whenever you gain life or lose life, draw a card.'],
    near: ['Whenever you gain or lose 1 life, draw a card.', 'Whenever you lose or gain life, draw a card.'],
  },
  'and-or-one': {
    def: trig([{ ev: 'zoneChange', subject: { other: true, controller: 'you', anyOf: [{ subtypes: ['Villain'] }, { types: ['Artifact'] }] }, to: 'battlefield' }], [draw()]),
    ctx: creature,
    readings: ['Whenever another Villain and/or artifact you control enters, draw a card.', 'Whenever another Villain or artifact you control enters, draw a card.'],
    near: ['Whenever another Villain and artifact you control enters, draw a card.', 'Whenever another Villain and/or creature you control enters, draw a card.'],
  },
  'one-article-subtypes': {
    def: trig([{ ev: 'attacks', attacker: { subtypes: ['Mount', 'Vehicle'], controller: 'you' } }], [draw()]),
    ctx: creature,
    readings: ['Whenever a Mount or Vehicle you control attacks, draw a card.', 'Whenever a Mount or a Vehicle you control attacks, draw a card.'],
    near: ['Whenever a Mount and Vehicle you control attacks, draw a card.', 'Whenever a Mount or Dinosaur you control attacks, draw a card.'],
  },
  // FAST4 T28
  'counters-equal-to': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }], [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: { q: 'stat', stat: 'power', of: { ref: 'event', role: 'subject' } } } as EffectStep]),
    ctx: creature,
    readings: [
      "Whenever a creature an opponent controls dies, put a number of +1/+1 counters on Test Card equal to that creature's power.",
      "Whenever a creature an opponent controls dies, put X +1/+1 counters on Test Card, where X is that creature's power.",
    ],
    near: ["Whenever a creature an opponent controls dies, put a number of +1/+1 counters on Test Card equal to that creature's toughness.", 'Whenever a creature an opponent controls dies, put a +1/+1 counter on Test Card.'],
  },
  'enters-computed-counters': {
    def: statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], other: true } } } }] } } as StaticEffect]),
    ctx: creature,
    readings: [
      'Test Card enters with X +1/+1 counters on it, where X is the number of other creatures on the battlefield.',
      'Test Card enters with X +1/+1 counters on it, where X is the number of other creatures.',
      'Test Card enters with a +1/+1 counter on it for each other creature on the battlefield.',
    ],
    near: ['Test Card enters with X +1/+1 counters on it, where X is the number of other creatures you control.', 'Test Card enters with a +1/+1 counter on it.'],
  },
  'each-enters-additional': {
    def: statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], subtypes: ['Elf'], controller: 'you', other: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 1 }] } } as StaticEffect]),
    ctx: creature,
    readings: ['Each other Elf creature you control enters with an additional +1/+1 counter on it.', 'Other Elf creatures you control enter with a +1/+1 counter on them.'],
    near: ['Each Elf creature you control enters with an additional +1/+1 counter on it.', 'Each other Elf creature you control enters with two additional +1/+1 counters on it.'],
  },
  'two-puts': {
    def: spell([{ op: 'putCounters', on: t('c'), kind: '+1/+1', count: 1 } as EffectStep, { op: 'putCounters', on: t('c'), kind: 'flying', count: 1 } as EffectStep], [objTarget('c')]),
    readings: ['Put a +1/+1 counter and a flying counter on target creature.', 'Put a +1/+1 counter on target creature. Put a flying counter on it.'],
    near: ['Put a +1/+1 counter and a trample counter on target creature.', 'Put a +1/+1 counter or a flying counter on target creature.'],
  },
  'for-each-and-or': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'count', of: { ref: 'each', filter: { types: ['Creature', 'Artifact'], controller: 'you', other: true } } }, toughness: { q: 'count', of: { ref: 'each', filter: { types: ['Creature', 'Artifact'], controller: 'you', other: true } } } }] }]),
    ctx: creature,
    readings: ['Test Card gets +1/+1 for each other creature and/or artifact you control.', 'Test Card gets +1/+1 for each other creature or artifact you control.'],
    near: ['Test Card gets +1/+1 for each other creature and/or enchantment you control.', 'Test Card gets +1/+1 for each creature and/or artifact you control.'],
  },
  // FAST5 T49: the groups of render/np.ts for "except for" and the "that are ..." list of kinds
  'except-for': {
    def: spell([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], not: { token: true, controller: 'you' } } }, amount: 4 } as EffectStep]),
    readings: ['Test Card deals 4 damage to each creature except for tokens you control.', "Test Card deals 4 damage to each creature that isn\'t a token you control."],
    near: ['Test Card deals 4 damage to each creature except for tokens an opponent controls.', 'Test Card deals 4 damage to each creature except for creatures you control.'],
  },
  'that-are-kinds': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: { q: 'count', of: { ref: 'each', filter: { controller: 'you', anyOf: [{ types: ['Creature'] }, { subtypes: ['Vehicle'] }] } } }, toughness: 0 }] }]),
    ctx: creature,
    readings: ['Test Card gets +1/+0 for each creature and/or Vehicle you control.', 'Test Card gets +1/+0 for each permanent you control that is a creature or a Vehicle.'],
    near: ['Test Card gets +1/+0 for each permanent you control that is a creature or an Equipment.', 'Test Card gets +1/+0 for each permanent an opponent controls that is a creature or a Vehicle.'],
  },
  'other-than-self': {
    def: spell([{ op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you', other: true } }, kind: '+1/+1', count: 1 } as EffectStep]),
    ctx: creature,
    readings: ['Put a +1/+1 counter on each creature you control other than Test Card.', 'Put a +1/+1 counter on each other creature you control.'],
    near: ['Put a +1/+1 counter on each creature you control.', 'Put a +1/+1 counter on each creature an opponent controls other than Test Card.'],
  },
  'static-if': {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked', when: { cond: 'compare', left: { q: 'spellsCastThisTurn' }, op: '>=', right: 2 } }]),
    ctx: creature,
    readings: ["Test Card can't be blocked if you've cast two or more spells this turn.", "Test Card can't be blocked as long as you've cast two or more spells this turn.", "As long as you've cast two or more spells this turn, Test Card can't be blocked."],
    near: ["Test Card can't be blocked if you've cast three or more spells this turn.", "Test Card can't block if you've cast two or more spells this turn.", "Test Card can't be blocked unless you've cast two or more spells this turn."],
  },
  'cast-this-turn-tense': {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked', when: { cond: 'compare', left: { q: 'spellsCastThisTurn' }, op: '>=', right: 3 } }]),
    ctx: creature,
    readings: ["Test Card can't be blocked if you've cast three or more spells this turn.", "Test Card can't be blocked if you cast three or more spells this turn."],
    near: ["Test Card can't be blocked if you cast three or more spells this game.", "Test Card can't be blocked if an opponent cast three or more spells this turn."],
  },
  // FAST5 T58 (CR 601.2i): "a spell with mana value 4 or greater" cast this turn is one or more of them
  'cast-one-or-more': {
    def: trig([{ ev: 'attacks', attacker: { self: true } }], [draw()], {
      interveningIf: { cond: 'happened', event: { ev: 'cast', player: 'you', spell: { manaValue: { op: '>=', value: 4 } } }, scope: 'turn', times: { op: '>=', value: 1 } },
    }),
    ctx: creature,
    readings: [
      "Whenever Test Card attacks, if you've cast a spell with mana value 4 or greater this turn, draw a card.",
      "Whenever Test Card attacks, if you've cast one or more spells with mana value 4 or greater this turn, draw a card.",
    ],
    near: [
      "Whenever Test Card attacks, if you've cast two or more spells with mana value 4 or greater this turn, draw a card.",
      "Whenever Test Card attacks, if you've cast a spell with mana value 3 or greater this turn, draw a card.",
    ],
  },
  'counters-on-them': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you', counters: { kind: '+1/+1' } } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' } as AbilityDef] }] }]),
    ctx: creature,
    readings: ['Creatures you control with +1/+1 counters on them have trample.', 'Creatures you control with a +1/+1 counter on them have trample.'],
    near: ['Creatures you control with -1/-1 counters on them have trample.', 'Creatures you control with two +1/+1 counters on them have trample.'],
  },
  'pump-then-damage': {
    def: trig([{ ev: 'attacks', attacker: { self: true } } as EventPattern], [
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 0 }] }] } as EffectStep,
      { op: 'damage', source: { ref: 'self' }, to: you, amount: 1 } as EffectStep,
    ]),
    ctx: creature,
    readings: ['Whenever Test Card attacks, it gets +2/+0 until end of turn and deals 1 damage to you.', 'Whenever Test Card attacks, it gets +2/+0 until end of turn. It deals 1 damage to you.'],
    near: ['Whenever Test Card attacks, it gets +2/+0 until end of turn and deals 2 damage to you.', 'Whenever Test Card attacks, it gets +2/+0 until end of turn and deals 1 damage to any target.'],
  },
  'become-untapped': {
    def: statics([{ s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'untap' }, { s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'haveCountersPut' }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ["Enchanted creature can't become untapped and can't have counters put on it.", "Enchanted creature can't untap or have counters put on it."],
    near: ["Enchanted creature can't become tapped and can't have counters put on it.", "Enchanted creature can't become untapped and can't have counters put on them."],
  },
  'blocking-creature': {
    def: trig([{ ev: 'blocks', blocker: { types: ['Creature'] }, attacker: { types: ['Creature'], colors: ['R'] } } as EventPattern], [
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'event', role: 'blocker' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] } as EffectStep,
    ]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['Whenever a creature blocks a red creature, the blocking creature gets +1/+1 until end of turn.'],
    near: ['Whenever a creature blocks a red creature, the attacking creature gets +1/+1 until end of turn.', 'Whenever a creature blocks a red creature, the blocking creature gets +1/+1.'],
  },
  'that-creature-not-self': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you', other: true }, from: 'battlefield', to: 'graveyard' }], [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: { q: 'stat', stat: 'toughness', of: { ref: 'event', role: 'subject' } } } as EffectStep]),
    ctx: creature,
    readings: ["Whenever another creature you control dies, put a number of +1/+1 counters on Test Card equal to that creature's toughness."],
    near: ["Whenever another creature you control dies, put a number of +1/+1 counters on Test Card equal to that land's toughness.", "Whenever another creature you control dies, put a number of +1/+1 counters on Test Card equal to that creature's power."],
  },
  // FAST4 T32
  'attacking-nontoken': {
    def: statics([{ s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', mana: [{ kind: 'generic', amount: 1 }], times: { q: 'math', op: 'min', args: [1, { q: 'spellTargetCount', filter: { types: ['Creature'], attacking: true, token: false } }] }, floor: 'zero' } } as StaticEffect]),
    readings: ['Test Card costs {1} less to cast if it targets an attacking nontoken creature.', 'Test Card costs {1} less to cast if it targets a nontoken attacking creature.'],
    near: ['Test Card costs {1} less to cast if it targets an attacking token creature.', 'Test Card costs {1} less to cast if it targets a blocking nontoken creature.'],
  },
  'mana-value-after-caster': {
    def: statics([{ s: 'costMod', applies: { spells: { colorless: true, stackKind: 'spell', zone: 'stack', manaValue: { op: '>=', value: 7 } }, caster: 'you' }, change: { kind: 'reduce', generic: 1, floor: 'zero' } } as StaticEffect]),
    ctx: creature,
    readings: ['Colorless spells you cast with mana value 7 or greater cost {1} less to cast.', 'Colorless spells with mana value 7 or greater you cast cost {1} less to cast.'],
    near: ['Colorless spells you cast with mana value 7 or less cost {1} less to cast.', 'Colorless spells your opponents cast with mana value 7 or greater cost {1} less to cast.'],
  },
  'alternative-cost-condition-after': {
    def: statics([{ s: 'alternativeCost', cost: { mana: [{ kind: 'colored', color: 'B' }] }, name: 'alternative', when: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'] } }, atLeast: 13 } } as StaticEffect]),
    readings: ["You may pay {B} rather than pay Test Card's mana cost if there are thirteen or more creatures on the battlefield.", "If there are thirteen or more creatures on the battlefield, you may pay {B} rather than pay Test Card's mana cost."],
    near: ["You may pay {B} rather than pay Test Card's mana cost if there are twelve or more creatures on the battlefield.", "You may pay {B} rather than pay Test Card's mana cost unless there are thirteen or more creatures on the battlefield."],
  },
  // FAST4 T31
  'either-description-articles': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { anyOf: [{ subtypes: ['Bird'] }, { supertypes: ['Basic'], types: ['Land'] }] }, max: 1, reveal: true, as: 's' } as EffectStep,
      { op: 'move', what: bound('s'), to: { zone: 'hand' } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
    ]),
    readings: [
      'Search your library for a Bird or basic land card, reveal it, put it into your hand, then shuffle.',
      'Search your library for a Bird card or a basic land card, reveal it, put it into your hand, then shuffle.',
    ],
    near: ['Search your library for a Bird or basic land, reveal it, put it into your hand, then shuffle.', 'Search your library for a Bird or land card, reveal it, put it into your hand, then shuffle.'],
  },
  'their-owners-control': {
    def: spell([
      { op: 'move', what: t('c'), to: { zone: 'exile' }, as: 'x' } as EffectStep,
      { op: 'move', what: bound('x'), to: { zone: 'battlefield', controller: 'owner' } } as EffectStep,
    ], [objTarget('c', { types: ['Creature'], controller: 'you' }, { min: 0, max: 2 })]),
    readings: [
      "Exile up to two target creatures you control, then return those cards to the battlefield under their owner's control.",
      "Exile up to two target creatures you control, then return those cards to the battlefield under their owners' control.",
    ],
    near: ['Exile up to two target creatures you control, then return those cards to the battlefield under your control.', "Exile up to two target creatures you control, then return those cards to the battlefield tapped under their owner's control."],
  },
  'may-your-control': {
    def: spell([{ op: 'may', who: you, do: [
      { op: 'move', what: t('c'), to: { zone: 'exile' }, as: 'x' } as EffectStep,
      { op: 'move', what: bound('x'), to: { zone: 'battlefield', controller: you } } as EffectStep,
    ] } as EffectStep], [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    readings: ['You may exile target creature you control, then return that card to the battlefield under your control.', 'You may exile target creature you control, then return that card to the battlefield.'],
    near: ["You may exile target creature you control, then return that card to the battlefield under its owner's control.", "You may exile target creature you control, then return that card to its owner's hand."],
  },
  // FAST4 T34
  'past-tense-known-object': {
    def: spell([{ op: 'destroy', what: t('c') } as EffectStep, { op: 'if', cond: { cond: 'matches', object: t('c'), filter: { tapped: true } }, then: [draw()] } as EffectStep], [objTarget('c')]),
    readings: ['Destroy target creature. If it was tapped, draw a card.', "Destroy target creature. If it's tapped, draw a card."],
    near: ['Destroy target creature. If it was untapped, draw a card.', 'Destroy target creature. If it was attacking, draw a card.'],
  },
  'type-card-noun': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } } as EffectStep, { op: 'if', cond: { cond: 'matches', object: t('c'), filter: { types: ['Land'], isCard: true } }, then: [draw()] } as EffectStep], [objTarget('c', { zone: 'graveyard', isCard: true })]),
    readings: ["Exile target card from a graveyard. If it's a land card, draw a card.", 'Exile target card from a graveyard. If it was a land card, draw a card.'],
    near: ["Exile target card from a graveyard. If it's a creature card, draw a card.", "Exile target card from a graveyard. If it's a land, draw a card."],
  },
  'wheel': {
    def: spell([
      { op: 'move', what: { ref: 'each', filter: { zone: 'hand', owner: 'you' } }, to: { zone: 'library', owner: you }, as: 's' } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
      { op: 'draw', who: you, count: { q: 'resultCount', step: 's' } } as EffectStep,
    ]),
    readings: ['Shuffle the cards from your hand into your library, then draw that many cards.', 'You shuffle the cards from your hand into your library, then draw that many cards.'],
    near: ['Shuffle the cards from your hand into your library, then draw seven cards.', 'Shuffle the cards from your graveyard into your library, then draw that many cards.'],
  },
  'theyve-cast': {
    def: trig([{ ev: 'cast', player: 'any', spell: { notTypes: ['Creature'] } }], [{ op: 'damage', source: self, to: { ref: 'event', role: 'player' }, amount: { q: 'happenedCount', event: { ev: 'cast', spell: { notTypes: ['Creature'] } }, scope: 'turn', by: { ref: 'event', role: 'player' } } } as EffectStep]),
    ctx: creature,
    readings: ["Whenever a player casts a noncreature spell, Test Card deals damage to that player equal to the number of noncreature spells they've cast this turn.", 'Whenever a player casts a noncreature spell, Test Card deals damage to that player equal to the number of noncreature spells that player has cast this turn.'],
    near: ["Whenever a player casts a noncreature spell, Test Card deals damage to that player equal to the number of noncreature spells you've cast this turn.", "Whenever a player casts a noncreature spell, Test Card deals damage to that player equal to the number of creature spells they've cast this turn."],
  },
  'life-they-lost': {
    def: spell([{ op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: 'e', do: [{ op: 'loseLife', who: bound('e') as never, amount: { q: 'lifeLostThisTurn', of: bound('e') as never } }] } as EffectStep]),
    readings: ['Each opponent loses life equal to the life they lost this turn.', 'Each opponent loses life equal to the life that player lost this turn.', 'For each opponent, that player loses life equal to the life that player lost this turn.'],
    near: ['Each opponent loses life equal to the life you lost this turn.', 'Each opponent loses life equal to the life they gained this turn.'],
  },
  'colors-spent': {
    def: spell([{ op: 'discard', who: t('p'), count: { q: 'colorsSpent' } } as EffectStep], [playerTarget('p')]),
    readings: ['Target player discards X cards, where X is the number of colors of mana spent to cast Test Card.', 'Target player discards X cards, where X is the number of colors of mana spent to cast this spell.'],
    near: ['Target player discards X cards, where X is the number of colors of mana spent to cast that spell.', 'Target player discards X cards, where X is the number of colors of mana you spent this turn.'],
  },
  'one-two-or-three': {
    def: spell([{ op: 'damage', source: self, to: t('c'), amount: 3, divided: 'announced' } as EffectStep], [objTarget('c', { types: ['Creature'] }, { min: 1, max: 3, divide: { what: 'damage', total: 3 } })]),
    readings: ['Test Card deals 3 damage divided as you choose among one, two, or three target creatures.', 'Test Card deals 3 damage divided as you choose among one to three target creatures.'],
    near: ['Test Card deals 3 damage divided as you choose among one or two target creatures.', 'Test Card deals 3 damage divided as you choose among up to three target creatures.'],
  },
  'discard-where-x': {
    def: spell([{ op: 'discard', who: t('p'), count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } as EffectStep], [playerTarget('p')]),
    readings: ['Target player discards X cards, where X is the number of creatures you control.', 'Target player discards cards equal to the number of creatures you control.'],
    near: ['Target player discards X cards, where X is the number of lands you control.', 'Target player draws X cards, where X is the number of creatures you control.'],
  },
  'unless-they-their-choice': {
    def: spell([{ op: 'pay', who: t('p'), cost: { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] }, else: [{ op: 'damage', source: self, to: t('p'), amount: 2 }] } as EffectStep], [playerTarget('p')]),
    readings: ['Test Card deals 2 damage to target player unless they sacrifice a creature of their choice.', 'Test Card deals 2 damage to target player unless they sacrifice a creature.', 'Test Card deals 2 damage to target player unless that player sacrifices a creature.'],
    near: ['Test Card deals 2 damage to target player unless you sacrifice a creature.', 'Test Card deals 2 damage to target player unless they sacrifice an artifact of their choice.'],
  },
  'each-of-other-targets': {
    def: spell([{ op: 'damage', source: self, to: t('a'), amount: 4, also: [{ to: t('b'), amount: 3 }] } as EffectStep], [
      { id: 'a', kind: 'anyTarget', min: 1, max: 1, text: '' },
      { id: 'b', kind: 'anyTarget', min: 0, max: 2, text: '', distinctFrom: ['a'] },
    ]),
    readings: ['Test Card deals 4 damage to any target and 3 damage to each of up to two other targets.', 'Test Card deals 4 damage to any target and 3 damage to up to two other targets.'],
    near: ['Test Card deals 4 damage to any target and 3 damage to each of two other targets.', 'Test Card deals 4 damage to any target and 2 damage to each of up to two other targets.'],
  },
  // FAST5 T38
  'cost-change-order': {
    def: {
      kind: 'activated', text: '', cost: { tap: true }, sorcerySpeed: true, effect: { targets: [], steps: [draw()] },
      costChange: { kind: 'reduce', generic: { q: 'math', op: '*', args: [1, { q: 'count', of: { ref: 'each', filter: { subtypes: ['Equipment'], controller: 'you' } } }] }, floor: 'zero' },
    } as AbilityDef,
    readings: [
      '{T}: Draw a card. This ability costs {1} less to activate for each Equipment you control. Activate only as a sorcery.',
      '{T}: Draw a card. Activate only as a sorcery. This ability costs {1} less to activate for each Equipment you control.',
    ],
    near: ['{T}: Draw a card. This ability costs {1} more to activate for each Equipment you control. Activate only as a sorcery.', '{T}: Draw a card. This ability costs {1} less to activate for each Equipment you control. Activate only as a sorcery and only once each turn.'],
  },
  'twice-x': {
    def: spell([{ op: 'gainLife', who: t('p'), amount: { q: 'math', op: '*', args: [2, { q: 'X' }] } } as EffectStep], [playerTarget('p')]),
    readings: ['Target player gains twice X life.', 'Target player gains life equal to twice X.'],
    near: ['Target player gains X life.', 'Target player loses twice X life.'],
  },
  // M11-4 (CR 903.3e): a commander you own is "your commander"
  'your-commander': {
    def: { kind: 'static', text: '', condition: { cond: 'exists', of: { ref: 'each', filter: { commander: true, owner: 'you', controller: 'you' } } }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 2 }] }] } as AbilityDef,
    readings: ['As long as you control your commander, Test Card gets +2/+2.', 'As long as you control a commander you own, Test Card gets +2/+2.'],
    near: ['As long as you control a commander, Test Card gets +2/+2.', 'As long as an opponent controls your commander, Test Card gets +2/+2.'],
  },
  // CMDF (CR 903.8): "a commander" and "your commander" count the same casts from the command zone
  'a-commander-casts': {
    def: { kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Goblin'], controller: 'you' } }, mods: [{ layer: '7c', power: { q: 'commanderCasts' }, toughness: { q: 'commanderCasts' } }] }] } as AbilityDef,
    readings: ["Goblins you control get +1/+1 for each time you've cast your commander from the command zone this game.", "Goblins you control get +1/+1 for each time you've cast a commander from the command zone this game."],
    near: ["Goblins you control get +1/+1 for each time you've cast a commander this game.", "Goblins you control get +1/+1 for each time an opponent has cast a commander from the command zone this game."],
  },
  // FAST5 T68
  'self-they': {
    def: t12Static({ cond: 'not', of: { cond: 'happened', event: { ev: 'damage', source: { self: true }, combat: true }, scope: 'game' } }, [grow]),
    ctx: creature,
    readings: ["~ gets +1/+1 as long as they haven't dealt combat damage yet.", "~ gets +1/+1 as long as it hasn't dealt combat damage yet."],
    near: ["~ gets +1/+1 as long as they haven't dealt damage yet.", "~ gets +1/+1 as long as they haven't dealt combat damage this turn.", "~ gets +1/+1 as long as they have dealt combat damage yet."],
  },
  'named-control': {
    def: spell([{ op: 'destroy', what: { ref: 'each', filter: { name: 'Elf', controller: 'you' } } }]),
    readings: ['Destroy all permanents named Elf you control.', 'Destroy all permanents you control named Elf.'],
    near: ['Destroy all permanents named Elf an opponent controls.', 'Destroy all permanents you control named Wolf.'],
  },
  // std-sos
  'twice-x-counters': {
    def: spell([{ op: 'putCounters', on: t('c'), kind: 'stun', count: { q: 'math', op: '*', args: [2, { q: 'X' }] } } as EffectStep], [objTarget('c', { types: ['Creature'] })]),
    readings: ['Put twice X stun counters on target creature.', 'Put a number of stun counters equal to twice X on target creature.'],
    near: ['Put X stun counters on target creature.', 'Put twice X time counters on target creature.'],
  },
  'named-in-zone': {
    def: spell([{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'count', of: { ref: 'each', filter: { name: 'Elf', owner: 'you', zone: 'graveyard' } } } } as EffectStep]),
    readings: ['You gain life equal to the number of cards named Elf in your graveyard.', 'You gain life equal to the number of cards in your graveyard named Elf.'],
    near: ['You gain life equal to the number of cards named Wolf in your graveyard.', "You gain life equal to the number of cards named Elf in an opponent's graveyard."],
  },
  'counter-on-self': {
    def: t12Static({ cond: 'matches', object: { ref: 'self' }, filter: { counters: { kind: 'charge' } } }, [grow]),
    ctx: creature,
    readings: ['As long as ~ has a charge counter on it, ~ gets +1/+1.', 'As long as ~ has a charge counter on ~, ~ gets +1/+1.'],
    near: ['As long as ~ has a charge counter on it, ~ gets +2/+2.', 'As long as ~ has a time counter on ~, ~ gets +1/+1.'],
  },
  // FAST5X E2
  'exiled-card': {
    def: spell([{ op: 'move', what: t('t0'), to: { zone: 'library', position: 'bottom' } } as EffectStep], [{ id: 't0', kind: 'object', min: 1, max: 1, text: '', filter: { keyword: 'warp', isCard: true, zone: 'exile' } }]),
    readings: ["Put target exiled card with warp on the bottom of its owner's library.", "Put target card in exile with warp on the bottom of its owner's library."],
    near: ["Put target exiled creature with warp on the bottom of its owner's library.", "Put target card in your graveyard with warp on the bottom of its owner's library."],
  },
  // FAST5 T40
  'replace-condition-words': {
    def: statics([{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'you' }, condition: { cond: 'compare', left: { q: 'spellsCastThisTurn' }, op: '>=', right: 2 }, body: { b: 'modify', amount: { mul: 2 } } }]),
    ctx: creature,
    readings: ["If you would gain life and you've cast two or more spells this turn, you gain twice that much life instead.", "If you would gain life while you've cast two or more spells this turn, you gain twice that much life instead."],
    near: ["If you would gain life unless you've cast two or more spells this turn, you gain twice that much life instead.", "If you would gain life while you've cast three or more spells this turn, you gain twice that much life instead."],
  },
  'opponent-life-they': {
    def: statics([{ s: 'replace', replaces: { ev: 'life', change: 'loss', player: 'opponent' }, condition: { cond: 'turnOf', whose: 'you' }, body: { b: 'modify', amount: { mul: 2 } } }]),
    ctx: creature,
    readings: ['If an opponent would lose life during your turn, they lose twice that much life instead.', 'If an opponent would lose life and it is your turn, that player loses twice that much life instead.'],
    near: ['If an opponent would lose life during your turn, you lose twice that much life instead.', 'If an opponent would lose life during your next turn, they lose twice that much life instead.'],
  },
  'double-all-damage': {
    def: statics([{ s: 'replace', replaces: { ev: 'damage', source: { controller: 'you', subtypes: ['Goblin'] } }, body: { b: 'modify', amount: { mul: 2 } } }]),
    ctx: creature,
    readings: ['Double all damage that Goblin sources you control would deal.', 'If a Goblin you control would deal damage to a permanent or player, it deals double that damage instead.'],
    near: ['Triple all damage that Goblin sources you control would deal.', 'Double all damage that Goblin sources an opponent controls would deal.'],
  },
  'self-combat-prevention': {
    def: statics([
      { s: 'replace', replaces: { ev: 'damage', combat: true, recipient: { object: { self: true } } }, body: { b: 'prevent', amount: 'all' } },
      { s: 'replace', replaces: { ev: 'damage', combat: true, source: { self: true } }, body: { b: 'prevent', amount: 'all' } },
    ]),
    ctx: creature,
    readings: ['Prevent all combat damage that would be dealt to and dealt by Test Card.', 'Prevent all combat damage that would be dealt to Test Card. Prevent all combat damage that would be dealt by Test Card.'],
    near: ['Prevent all damage that would be dealt to and dealt by Test Card.', 'Prevent all combat damage that would be dealt to and dealt by Test Card this turn.'],
  },
  'counters-every-kind': {
    def: statics([{ s: 'replace', replaces: { ev: 'counters', change: 'put', on: { types: ['Creature'], controller: 'you' } }, body: { b: 'modify', count: { mul: 2 } } }]),
    ctx: creature,
    readings: [
      'If one or more counters would be put on a creature you control, twice that many of each of those kinds of counters are put on it instead.',
      'If one or more counters would be put on a creature you control, twice that many of those counters are put on it instead.',
    ],
    near: [
      'If one or more counters would be put on a creature you control, three times that many of each of those kinds of counters are put on it instead.',
      'If one or more counters would be put on a creature an opponent controls, twice that many of each of those kinds of counters are put on it instead.',
    ],
  },
  'prevent-plural-recipient': {
    def: statics([{ s: 'replace', replaces: { ev: 'damage', combat: false, recipient: { object: { types: ['Creature'], controller: 'you', other: true } } }, body: { b: 'prevent', amount: 'all' } }]),
    ctx: creature,
    readings: ['Prevent all noncombat damage that would be dealt to other creatures you control.', 'Prevent all noncombat damage that would be dealt to another creature you control.'],
    near: ['Prevent all combat damage that would be dealt to other creatures you control.', 'Prevent all noncombat damage that would be dealt to other creatures an opponent controls.'],
  },
  'draw-another': {
    def: spell([draw(1), { op: 'loseLife', who: you, amount: 1 } as EffectStep, draw(1)]),
    readings: ['Draw a card and lose 1 life. Draw another card.', 'Draw a card and lose 1 life. Draw a card.'],
    near: ['Draw a card and lose 1 life. Draw another two cards.', 'Draw a card and lose 1 life. Target player draws another card.'],
  },
  // FAST5X E1
  'cast-cost-named': {
    def: spell([draw(1), { op: 'if', cond: { cond: 'wasCast', kicked: 'bargain' }, then: [{ op: 'gainLife', who: you, amount: 2 }] } as EffectStep]),
    readings: ['Draw a card. If Test Card was bargained, you gain 2 life.', 'Draw a card. If this spell was bargained, you gain 2 life.'],
    near: ['Draw a card. If Test Card was kicked, you gain 2 life.', 'Draw a card. If the gift was promised, you gain 2 life.'],
  },
  'if-also': {
    def: spell([
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 1, toughness: 1 }] }] } as EffectStep,
      { op: 'if', cond: { cond: 'wasCast', kicked: 'gift' }, then: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flying', text: 'flying' }] }] }] }] } as EffectStep,
    ], [objTarget('c')]),
    readings: ['Target creature gets +1/+1 until end of turn. If the gift was promised, that creature also gains flying until end of turn.', 'Target creature gets +1/+1 until end of turn. If the gift was promised, that creature gains flying until end of turn.'],
    near: ['Target creature gets +1/+1 until end of turn. If the gift was promised, that creature also gains flying.', 'Target creature gets +1/+1 until end of turn. If the gift was promised, also that creature gains flying until end of turn.'],
  },
  'instead-front': {
    def: spell([{ op: 'if', cond: { cond: 'wasCast', kicked: 'gift' }, then: [{ op: 'tap', what: t('b') }], else: [{ op: 'tap', what: t('a') }] } as EffectStep], [
      objTarget('a', { types: ['Creature'] }, { onlyIf: { cond: 'not', of: { cond: 'wasCast', kicked: 'gift' } } }), objTarget('b', { types: ['Artifact'] }, { onlyIf: { cond: 'wasCast', kicked: 'gift' } }),
    ]),
    readings: ['Tap target creature. If the gift was promised, instead tap target artifact.', 'Tap target creature. If the gift was promised, tap target artifact instead.'],
    near: ['Tap target creature. If the gift was promised, tap target artifact.', 'Tap target creature. Instead, if the gift was promised, tap target artifact.'],
  },
  'spree-modes': {
    def: { kind: 'spell', text: '', effect: { targets: [], steps: [], modes: { min: 1, max: 2, options: [{ text: '', program: { targets: [], steps: [draw(1)] }, cost: { mana: [{ kind: 'generic', amount: 1 }] } }, { text: '', program: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 2 } as EffectStep] }, cost: { mana: [{ kind: 'generic', amount: 2 }] } }] } } } as AbilityDef,
    readings: ['+ {1} — Draw a card. + {2} — You gain 2 life.', 'Choose one or both — + {1} — Draw a card. + {2} — You gain 2 life.'],
    near: ['+ {1} — Draw a card. + {3} — You gain 2 life.', 'Choose one — + {1} — Draw a card. + {2} — You gain 2 life.'],
  },
  // FAST5X-4
  'search-up-to-where-x': {
    def: spell([{ op: 'search', who: you, zone: 'library', filter: { types: ['Land'], supertypes: ['Basic'] }, min: 0, max: { q: 'speed' }, as: 's' } as EffectStep]),
    readings: ['Search your library for up to X basic land cards, where X is your speed.', 'Search your library for up to your speed basic land cards.'],
    near: ['Search your library for X basic land cards, where X is your speed.', 'Search your library for up to X land cards, where X is your speed.'],
  },
  // FAST5X E5 (CR 602.5b): the Gathering Place family
  'or-if': {
    def: {
      kind: 'activated', text: '', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, units: [['G']] }] },
      onlyIf: { cond: 'any', of: [{ cond: 'matches', object: { ref: 'self' }, filter: { enteredThisTurn: true } }, { cond: 'exists', of: { ref: 'each', filter: { supertypes: ['Basic'], types: ['Land'], controller: 'you' } } }] },
    } as AbilityDef,
    readings: ['{T}: Add {G}. Activate only if Test Card entered this turn or if you control a basic land.', '{T}: Add {G}. Activate only if Test Card entered this turn or you control a basic land.'],
    near: ['{T}: Add {G}. Activate only if Test Card entered this turn and if you control a basic land.', '{T}: Add {G}. Activate only if Test Card entered this turn or if you control a land.'],
  },
  // FAST5 T42
  'or-less-written-out': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [objTarget('c', { zone: 'graveyard', owner: 'you', types: ['Creature'], manaValue: { op: '<=', value: 3 } })]),
    readings: ['Return target creature card with mana value 3 or less from your graveyard to your hand.', 'Return target creature card with mana value less than or equal to 3 from your graveyard to your hand.'],
    near: ['Return target creature card with mana value less than 3 from your graveyard to your hand.', 'Return target creature card with mana value greater than or equal to 3 from your graveyard to your hand.'],
  },
  'equal-to-computed': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [objTarget('c', { zone: 'graveyard', owner: 'you', types: ['Creature'], manaValue: { op: '==', value: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } } })]),
    readings: ['Return target creature card with mana value equal to the number of lands you control from your graveyard to your hand.'],
    near: ['Return target creature card with mana value less than the number of lands you control from your graveyard to your hand.'],
  },
  'lesser-mana-value': {
    def: trig([{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }], [{ op: 'move', what: t('c'), to: { zone: 'hand' } }], {}, [objTarget('c', { zone: 'graveyard', owner: 'you', types: ['Creature'], manaValue: { op: '<', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'subject' } } } })]),
    ctx: creature,
    readings: ['When Test Card dies, return target creature card with lesser mana value from your graveyard to your hand.'],
    near: ['When Test Card dies, return target creature card with greater mana value from your graveyard to your hand.', 'When Test Card dies, return target creature card with lesser power from your graveyard to your hand.'],
  },
  // std-rx28: a spell that targets one or more creatures (Storm, Windrider)
  'targets-one-or-more': {
    def: trig([{ ev: 'cast', player: 'you', spell: { targets: { ref: 'each', filter: { types: ['Creature'] } } } }], [draw()]),
    ctx: creature,
    readings: ['Whenever you cast a spell that targets a creature, draw a card.', 'Whenever you cast a spell that targets one or more creatures, draw a card.'],
    near: ['Whenever you cast a spell that targets two or more creatures, draw a card.', 'Whenever you cast a spell that targets one or more artifacts, draw a card.'],
  },
  // std-rx28: an object and then a player of what a spell or ability targets (Ertha Jo, Frontier Mentor)
  'targets-or-player': {
    def: trig([{ ev: 'cast', player: 'you', spell: { anyOf: [{ targets: { ref: 'each', filter: { types: ['Creature'] } } }, { targets: { ref: 'each', who: 'player' } }] } }], [draw()]),
    ctx: creature,
    readings: ['Whenever you cast a spell that targets a creature or a player, draw a card.', 'Whenever you cast a spell that targets a creature or player, draw a card.'],
    near: ['Whenever you cast a spell that targets a creature or an opponent, draw a card.', 'Whenever you cast a spell that targets a creature, draw a card.'],
  },
  'targeted-group': {
    def: trig([{ ev: 'cast', player: 'you', spell: { targets: { ref: 'each', filter: { types: ['Creature'] } } } }], [effectStep([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], targetedBy: { ref: 'event', role: 'spell' } } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flying', text: 'flying' }] }] } as StaticEffect], { d: 'endOfTurn' })]),
    ctx: creature,
    readings: ['Whenever you cast a spell that targets one or more creatures, those creatures gain flying until end of turn.'],
    near: ['Whenever you cast a spell that targets one or more creatures, creatures you control gain flying until end of turn.', 'Whenever you cast a spell that targets one or more creatures, all creatures gain flying until end of turn.'],
  },
  // std-rx28: the object's own entering named again by its name (Scarlet Spider, Ben Reilly)
  'self-again-enters': {
    def: { kind: 'static', text: '', zone: ['stack', 'battlefield'], condition: { cond: 'wasCast', kicked: true }, effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: { q: 'zoneSize', zone: 'hand', of: you } }] } }] } as unknown as AbilityDef,
    ctx: creature,
    readings: ['If Test Card was kicked, it enters with X +1/+1 counters on it, where X is the number of cards in your hand.', 'If Test Card was kicked, Test Card enters with X +1/+1 counters on Test Card, where X is the number of cards in your hand.'],
    near: ['If Test Card was kicked, Test Card enters with X +1/+1 counters on target creature, where X is the number of cards in your hand.', 'Test Card enters with X +1/+1 counters on Test Card, where X is the number of cards in your hand.'],
  },
  // std-rx28: the cast trigger's spell (Kellan, the Kid)
  'equal-or-lesser-mana-value': {
    def: trig([{ ev: 'cast', player: 'you' }], [{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'], manaValue: { op: '<=', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } } } }], notTypes: ['Land'], zone: 'hand', owner: 'you', isCard: true } }, min: 0, max: 1, as: 'cast' }, { op: 'cast', who: you, what: { ref: 'bound', name: 'cast' }, free: true }], {}, []),
    ctx: creature,
    readings: ['Whenever you cast a spell, you may cast a creature spell with equal or lesser mana value from your hand without paying its mana cost.'],
    near: ['Whenever you cast a spell, you may cast a creature spell with lesser mana value from your hand without paying its mana cost.', 'Whenever you cast a spell, you may cast a creature spell with equal or greater mana value from your hand without paying its mana cost.'],
  },
  'other-than-source': {
    def: trig([enters], [{ op: 'move', what: t('c'), to: { zone: 'hand' } }], {}, [objTarget('c', { types: ['Creature'], other: true })]),
    ctx: creature,
    readings: ["When Test Card enters, return another target creature to its owner's hand.", "When Test Card enters, return target creature other than Test Card to its owner's hand."],
    near: ["When Test Card enters, return target creature other than that creature to its owner's hand.", "When Test Card enters, return target creature to its owner's hand."],
  },
  'return-to-battlefield-first': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you } }], [objTarget('c', { zone: 'graveyard', owner: 'you', types: ['Creature'] })]),
    readings: ['Return target creature card from your graveyard to the battlefield.', 'Return to the battlefield target creature card from your graveyard.'],
    near: ['Return to the battlefield tapped target creature card from your graveyard.', 'Return to your hand target creature card from your graveyard.'],
  },
  'move-where-x': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you } }], [objTarget('c', { zone: 'graveyard', owner: 'you', types: ['Artifact'], manaValue: { op: '<=', value: { q: 'manaSpent' } } })]),
    readings: ['Return target artifact card with mana value less than or equal to the amount of mana spent to cast Test Card from your graveyard to the battlefield.', 'Return target artifact card with mana value X or less from your graveyard to the battlefield, where X is the amount of mana spent to cast Test Card.'],
    near: ['Return target artifact card with mana value X or less from your graveyard to the battlefield, where X is the number of colors of mana spent to cast Test Card.', 'Return target artifact card with mana value X or less from your graveyard to the battlefield.'],
  },
  'hand-or-graveyard': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { types: ['Creature'] }, max: 1, reveal: true, as: 's' },
      { op: 'chooseValue', who: you, what: 'option', as: 'd', link: 'd', options: ['hand', 'graveyard'], guard: { cond: 'exists', of: bound('s') } },
      { op: 'if', cond: { cond: 'chosen', link: 'd', equals: 'hand' }, then: [{ op: 'move', what: bound('s'), to: { zone: 'hand' } }] },
      { op: 'if', cond: { cond: 'chosen', link: 'd', equals: 'graveyard' }, then: [{ op: 'move', what: bound('s'), to: { zone: 'graveyard' } }] },
      { op: 'shuffle', who: you },
    ] as EffectStep[]),
    readings: ['Search your library for a creature card, reveal it, put it into your hand or graveyard, then shuffle.', 'Search your library for a creature card, reveal that card, put it into your hand or your graveyard, then shuffle.'],
    near: ['Search your library for a creature card, reveal it, put it into your hand or on top of your library, then shuffle.', 'Search your library for a creature card, put it into your hand or graveyard, then shuffle.'],
  },
  'one-of-them': {
    def: spell([
      { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 2 }, as: 'looked' },
      { op: 'chooseObjects', who: you, from: bound('looked'), min: 1, max: 1, as: 'kept' },
      { op: 'move', what: bound('kept'), to: { zone: 'hand' } },
      { op: 'move', what: bound('looked'), to: { zone: 'graveyard' } },
    ] as EffectStep[]),
    readings: ['Look at the top 2 cards of your library. Put one into your hand and the other into your graveyard.', 'Look at the top 2 cards of your library. Put one of them into your hand and the other into your graveyard.', 'Look at the top 2 cards of your library. Put one of those cards into your hand and the other into your graveyard.'],
    near: ['Look at the top 2 cards of your library. Put one of them into your hand and the other on the bottom of your library.', 'Look at the top 2 cards of your library. Put two of them into your hand and the other into your graveyard.'],
  },
  'mana-spent': {
    def: spell([{ op: 'draw', who: you, count: { q: 'manaSpent' } } as EffectStep]),
    readings: ['Draw cards equal to the amount of mana spent to cast Test Card.', 'Draw cards equal to the amount of mana spent to cast this spell.'],
    near: ['Draw cards equal to the amount of mana spent to cast that spell.', 'Draw cards equal to the amount of mana you spent this turn.'],
  },
  // FAST5 T66 (CR 202.3, 607.2a): the mana value of the card a linked ability exiled
  'mv-of-exiled-card': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'linked', link: 'exiled' } } }]),
    readings: ['You gain life equal to the mana value of the exiled card.', "You gain life equal to the exiled card's mana value."],
    near: ['You gain life equal to the power of the exiled card.', 'You gain life equal to the mana value of the exiled cards.'],
  },
  // FAST5 T66 (CR 107.3, 608.2h): Kinscaer Sentry's "mana value X or less ..., where X is the number of attacking creatures you control"
  'put-from-hand-where-x': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'], zone: 'hand', owner: 'you', isCard: true, manaValue: { op: '<=', value: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you', attacking: true } } } } } }, min: 0, max: 1, as: 'put' },
      { op: 'move', what: bound('put'), to: { zone: 'battlefield', controller: you, tapped: true, attacking: true } },
    ] as EffectStep[]),
    readings: [
      'You may put a creature card with mana value less than or equal to the number of attacking creatures you control from your hand onto the battlefield tapped and attacking.',
      'You may put a creature card with mana value X or less from your hand onto the battlefield tapped and attacking, where X is the number of attacking creatures you control.',
    ],
    near: [
      'You may put a creature card with mana value X or less from your hand onto the battlefield tapped and attacking, where X is the number of creatures you control.',
      'You may put a creature card with mana value X or less from your hand onto the battlefield tapped, where X is the number of attacking creatures you control.',
    ],
  },
  'each-player-without-max-speed': {
    def: spell([{ op: 'forEach', over: { ref: 'each', who: 'player' }, as: 'each', do: [
      { op: 'damage', source: self, to: { ref: 'bound', name: 'each' }, amount: 2, guard: { cond: 'not', of: { cond: 'designation', who: { ref: 'bound', name: 'each' }, what: 'maxSpeed' } } },
    ] } as EffectStep]),
    readings: ["Test Card deals 2 damage to each player who doesn't have max speed."],
    near: ['Test Card deals 2 damage to each player who has max speed.', "Test Card deals 2 damage to each opponent who doesn't have max speed.", 'Test Card deals 2 damage to each player.'],
  },
  // FAST5X E17
  'resolved-nth-time': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Artifact'], controller: 'you' }, to: 'battlefield' }] }, effect: { targets: [], steps: [
      { ...gain(1), guard: { cond: 'compare', left: { q: 'resolvedThisTurn' }, op: '==', right: 1 } } as EffectStep,
      { op: 'if', cond: { cond: 'compare', left: { q: 'resolvedThisTurn' }, op: '==', right: 2 }, then: [draw()] } as EffectStep,
    ] } } as AbilityDef,
    ctx: creature,
    readings: ["Whenever an artifact you control enters, you gain 1 life if this is the first time this ability has resolved this turn. If it's the second time, draw a card.", 'Whenever an artifact you control enters, you gain 1 life if this is the first time this ability has resolved this turn. If this is the second time this ability has resolved this turn, draw a card.'],
    near: ["Whenever an artifact you control enters, you gain 1 life if this is the first time this ability has resolved this turn. If it's the third time, draw a card.", "Whenever an artifact you control enters, you gain 1 life if this is the second time this ability has resolved this turn. If it's the second time, draw a card."],
  },
  'additional-pump': {
    def: spell([
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 2, toughness: 2 }] }] } as EffectStep,
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 1, toughness: 1 }] }] } as EffectStep,
    ], [objTarget('c', { types: ['Creature'] })]),
    readings: ['Target creature gets +2/+2 until end of turn. That creature gets an additional +1/+1 until end of turn.', 'Target creature gets +2/+2 until end of turn. That creature gets +1/+1 until end of turn.'],
    near: ['Target creature gets +2/+2 until end of turn. That creature gets an additional +2/+1 until end of turn.', 'Target creature gets +2/+2 until end of turn. That creature gets an additional +1/+1.'],
  },
  // FAST5X E9
  // FAST5X E16 (CR 120.4a, 120.10, 608.2c)
  'excess-damage-dealt': {
    def: spell([{ op: 'damage', source: self, to: t('c'), amount: 3, as: 'dealt' } as EffectStep,
      { op: 'if', cond: { cond: 'compare', left: { q: 'excessDamage', step: 'dealt', to: t('c') }, op: '>', right: 0 }, then: [draw()] } as EffectStep], [objTarget('c')]),
    readings: ['Test Card deals 3 damage to target creature. If excess damage was dealt to that creature this way, draw a card.',
      'Test Card deals 3 damage to target creature. If that creature is dealt excess damage this way, draw a card.',
      'Test Card deals 3 damage to target creature. If that creature was dealt excess damage this way, draw a card.'],
    near: ['Test Card deals 3 damage to target creature. If damage was dealt to that creature this way, draw a card.',
      'Test Card deals 3 damage to target creature. If excess damage was dealt to that creature this turn, draw a card.'],
  },
  'excess-damage-amount': {
    def: spell([{ op: 'fight', a: t('a'), b: t('b'), as: 'dealt' } as EffectStep,
      { op: 'gainLife', who: you, amount: { q: 'excessDamage', step: 'dealt', to: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } } } as EffectStep],
    [objTarget('a', { types: ['Creature'], controller: 'you' }), objTarget('b', { types: ['Creature'], controller: 'opponent' })]),
    readings: ['Target creature you control fights target creature an opponent controls. You gain life equal to the excess damage dealt to the creature an opponent controls this way.',
      'Target creature you control fights target creature an opponent controls. You gain life equal to the amount of excess damage dealt to the creature the opponent controls this way.'],
    near: ['Target creature you control fights target creature an opponent controls. You gain life equal to the damage dealt to the creature an opponent controls this way.',
      'Target creature you control fights target creature an opponent controls. You gain life equal to the excess damage dealt to the creature you control this way.'],
  },
  'your-main-phase': {
    def: spell([gain(1), { op: 'if', cond: { cond: 'not', of: { cond: 'turnOf', whose: 'you', step: ['main1', 'main2'] } }, then: [draw()] } as EffectStep]),
    readings: ["You gain 1 life. Then if it isn't your main phase, draw a card.", "You gain 1 life. Then if it's not your main phase, draw a card."],
    near: ["You gain 1 life. Then if it isn't your turn, draw a card.", "You gain 1 life. Then if it's your main phase, draw a card."],
  },
  'scried-or-surveilled': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'any', of: [
      { cond: 'happened', event: { ev: 'action', verb: 'scry', actor: 'you' }, scope: 'turn' }, { cond: 'happened', event: { ev: 'action', verb: 'surveil', actor: 'you' }, scope: 'turn' }] } } as AbilityDef,
    ctx: creature,
    readings: ["As long as you've scried or surveilled this turn, Test Card gets +1/+1.", 'As long as you have scried or surveilled this turn, Test Card gets +1/+1.'],
    near: ["As long as you've scried this turn, Test Card gets +1/+1.", "As long as you've surveilled this turn, Test Card gets +1/+1."],
  },
  'self-entered-this-turn': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'happened', event: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, scope: 'turn' } } as AbilityDef,
    ctx: creature,
    readings: ['As long as Test Card entered this turn, Test Card gets +1/+1.', 'As long as Test Card entered the battlefield this turn, Test Card gets +1/+1.'],
    near: ['As long as Test Card attacked this turn, Test Card gets +1/+1.'],
  },
  // FAST5X E22
  'gained-or-lost-life': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'any', of: [
      { cond: 'happened', event: { ev: 'life', change: 'gain', player: 'you' }, scope: 'turn' }, { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'you' }, scope: 'turn' }] } } as AbilityDef,
    ctx: creature,
    readings: ['As long as you gained or lost life this turn, Test Card gets +1/+1.', "As long as you've gained or lost life this turn, Test Card gets +1/+1."],
    near: ['As long as you gained and lost life this turn, Test Card gets +1/+1.', 'As long as you gained life this turn, Test Card gets +1/+1.'],
  },
  'graveyard-exile-history': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'happened', event: { ev: 'zoneChange', subject: { isCard: true, owner: 'you' }, from: 'graveyard' }, scope: 'turn' } } as AbilityDef,
    ctx: creature,
    readings: ['As long as a card left your graveyard this turn, Test Card gets +1/+1.', 'As long as one or more cards left your graveyard this turn, Test Card gets +1/+1.'],
    near: ['As long as two or more cards left your graveyard this turn, Test Card gets +1/+1.', "As long as a card left an opponent's graveyard this turn, Test Card gets +1/+1."],
  },
  'sacrificed-history': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'happened', event: { ev: 'action', verb: 'sacrifice', actor: 'you' }, scope: 'turn' } } as AbilityDef,
    ctx: creature,
    readings: ['As long as you sacrificed a permanent this turn, Test Card gets +1/+1.', 'As long as you sacrificed one or more permanents this turn, Test Card gets +1/+1.', "As long as you've sacrificed a permanent this turn, Test Card gets +1/+1."],
    near: ['As long as you sacrificed two or more permanents this turn, Test Card gets +1/+1.', 'As long as you sacrificed a creature this turn, Test Card gets +1/+1.'],
  },
  'didnt-cast-spell': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'not', of: { cond: 'happened', event: { ev: 'cast', player: 'you' }, scope: 'turn' } } } as AbilityDef,
    ctx: creature,
    readings: ["As long as you didn't cast a spell this turn, Test Card gets +1/+1.", "As long as you haven't cast a spell this turn, Test Card gets +1/+1."],
    near: ["As long as you didn't cast a creature spell this turn, Test Card gets +1/+1.", 'As long as you cast a spell this turn, Test Card gets +1/+1.'],
  },
  'conditional-mode-count': {
    def: { kind: 'spell', text: '', effect: { targets: [], steps: [], modes: { min: 1, max: 1, override: { when: { cond: 'compare', left: { q: 'descendedThisTurn' }, op: '>=', right: 1 }, min: 1, max: 2 },
      options: [{ text: '', program: { targets: [], steps: [draw(1)] } }, { text: '', program: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 2 } as EffectStep] } }] } } } as AbilityDef,
    readings: ['Choose one. If you descended this turn, you may choose both instead. • Draw a card. • You gain 2 life.', 'Choose one. If you descended this turn as you cast this spell, choose one or more instead. • Draw a card. • You gain 2 life.'],
    near: ['Choose one. If you descended this turn, choose both instead. • Draw a card. • You gain 2 life.', 'Choose one. You may choose both instead. • Draw a card. • You gain 2 life.'],
  },
  'additional-pump-static': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'compare', left: { q: 'descendedThisTurn' }, op: '>=', right: 1 } } as AbilityDef,
    ctx: creature,
    readings: ['As long as you descended this turn, Test Card gets +1/+1.', 'As long as you descended this turn, Test Card gets an additional +1/+1.', 'Test Card gets an additional +1/+1 as long as you descended this turn.'], // std-rh: the condition may follow
    near: ['As long as you descended this turn, Test Card gets an additional +2/+1.', 'Test Card gets an additional +1/+1.'],
  },
  'life-present-perfect': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'you' }, scope: 'turn' } } as AbilityDef,
    ctx: creature,
    readings: ['As long as you lost life this turn, Test Card gets +1/+1.', "As long as you've lost life this turn, Test Card gets +1/+1."],
    near: ["As long as you've gained life this turn, Test Card gets +1/+1."],
  },
  'controllers-next-untap-steps': {
    def: spell([{ op: 'effect', duration: { d: 'throughNextUntap' }, effects: [{ s: 'restrict', subject: t('c'), mode: 'cant', action: 'untapDuringUntapStep' }] } as EffectStep], [objTarget('c', { types: ['Creature'] }, { min: 0, max: 2 })]),
    readings: ["Up to two target creatures don't untap during their controller's next untap step.", "Up to two target creatures don't untap during their controllers' next untap steps."],
    near: ["Up to two target creatures don't untap during their controller's untap step.", "Up to two target creatures don't untap during your next untap step."],
  },
  // FAST5X E14
  'top-card-play': {
    def: statics([{ s: 'permit', who: you, action: 'play', fromTop: true }]),
    ctx: creature,
    readings: ['You may play cards from the top of your library.', 'You may play the top card of your library.'],
    near: ['You may play lands from the top of your library.', 'You may cast spells from the top of your library.', 'You may play the top two cards of your library.'],
  },
  'look-then-play': {
    def: statics([{ s: 'permit', who: you, action: 'lookAt' }, { s: 'permit', who: you, action: 'play', of: { types: ['Land'] }, fromTop: true }, { s: 'permit', who: you, action: 'cast', of: { types: ['Creature'], stackKind: 'spell', zone: 'stack' }, fromTop: true }]),
    ctx: creature,
    readings: [
      'You may look at the top card of your library any time, and you may play lands and cast creature spells from the top of your library.',
      'You may look at the top card of your library any time and you may play lands and cast creature spells from the top of your library.',
    ],
    near: [
      'You may look at the top card of your library any time, and you may play lands or cast creature spells from the top of your library.',
      'You may look at the top card of your library any time, and you may play lands and cast artifact spells from the top of your library.',
    ],
  },
  'quoted-ability-period': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 6, add: [
      { kind: 'static', text: '', effects: [{ s: 'permit', who: you, action: 'lookAt' }] },
      { kind: 'static', text: '', effects: [{ s: 'rule', rule: 'handSizeNoLimit', player: you }] },
    ] }] } as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: [
      'Creatures you control have "You may look at the top card of your library any time" and "You have no maximum hand size."',
      'Creatures you control have "You may look at the top card of your library any time." and "You have no maximum hand size."',
    ],
    near: [
      'Creatures you control have "You may look at the top card of your library any time" and "You have no minimum hand size."',
      'Creatures you control have "You may look at the top card of your library any time" or "You have no maximum hand size."',
    ],
  },
  // FAST5X E12
  'five-colors': {
    def: spell([draw(1), { op: 'if', cond: { cond: 'compare', left: { q: 'distinct', what: 'colors', among: { ref: 'each', filter: { controller: 'you' } } }, op: '>=', right: 5 }, then: [{ op: 'gainLife', who: you, amount: 2 }] } as EffectStep]),
    readings: ['Draw a card. If there are five or more colors among permanents you control, you gain 2 life.', 'Draw a card. If there are five colors among permanents you control, you gain 2 life.'],
    near: ['Draw a card. If there are four colors among permanents you control, you gain 2 life.', 'Draw a card. If there are five colors among creatures you control, you gain 2 life.'],
  },
  // FAST5X E20 (CR 700.13, 611.3a)
  'crime-present-perfect': {
    def: t12Static({ cond: 'happened', event: { ev: 'action', verb: 'commitCrime', actor: 'you' }, scope: 'turn' }, [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 0 }] }]),
    ctx: creature,
    readings: ["This creature gets +2/+0 as long as you've committed a crime this turn.", 'This creature gets +2/+0 as long as you committed a crime this turn.'],
    near: ["This creature gets +2/+0 as long as an opponent has committed a crime this turn.", "This creature gets +2/+0 as long as you've committed a crime this game."],
  },
  // FAST5X E25 (CR 603.2): Cryptid Inspector
  'and-whenever-other-kind': {
    def: trig([{ ev: 'zoneChange', subject: { faceDown: true, controller: 'you' }, to: 'battlefield' }, { ev: 'becomes', what: 'turnedFaceUp', object: { self: true } }, { ev: 'becomes', what: 'turnedFaceUp', object: { controller: 'you', other: true } }], [draw()]),
    ctx: creature,
    readings: ['Whenever a face-down permanent you control enters and whenever this creature or another permanent you control is turned face up, draw a card.',
      'Whenever a face-down permanent you control enters or this creature is turned face up or another permanent you control is turned face up, draw a card.'],
    near: ['Whenever a face-down permanent you control enters and whenever this creature is turned face up, draw a card.', 'Whenever a face-down permanent you control enters and whenever another permanent you control is turned face up, draw a card.'],
  },
  // FAST5X E25 (CR 708.3, 603.4): Tunnel Tipster's and Oblivious Bookworm's condition
  'entered-face-down': {
    def: t12Static({ cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'], faceDown: true, controller: 'you' }, to: 'battlefield' }, scope: 'turn' }, [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 0 }] }]),
    ctx: creature,
    readings: ['This creature gets +2/+0 as long as a face-down creature entered the battlefield under your control this turn.', 'This creature gets +2/+0 as long as a creature entered the battlefield face down under your control this turn.'],
    near: ['This creature gets +2/+0 as long as a creature entered the battlefield under your control this turn.', 'This creature gets +2/+0 as long as a face-down creature entered the battlefield face down under your control this turn.'],
  },
  // FAST5X E25 (CR 708.8, 603.4): Oblivious Bookworm's condition
  'turned-face-up-perfect': {
    def: t12Static({ cond: 'happened', event: { ev: 'becomes', what: 'turnedFaceUp', object: {} }, scope: 'turn', by: 'you' }, [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 2, toughness: 0 }] }]),
    ctx: creature,
    readings: ["This creature gets +2/+0 as long as you've turned a permanent face up this turn.", 'This creature gets +2/+0 as long as you turned a permanent face up this turn.'],
    near: ['This creature gets +2/+0 as long as you turned a creature face up this turn.', 'This creature gets +2/+0 as long as you turned a permanent face down this turn.'],
  },
  // FAST5X E20 (CR 700.12)
  'outlaw-word': {
    def: trig([{ ev: 'cast', player: 'you', spell: { subtypes: ['Assassin', 'Mercenary', 'Pirate', 'Rogue', 'Warlock'] } }], [draw()]),
    readings: ['Whenever you cast an outlaw spell, draw a card.', 'Whenever you cast an Assassin, Mercenary, Pirate, Rogue, or Warlock spell, draw a card.'],
    near: ['Whenever you cast a Rogue spell, draw a card.', 'Whenever you cast an outlaw creature spell, draw a card.'],
  },
  'not-uncontracted': {
    def: spell([draw(1), { op: 'if', cond: { cond: 'not', of: { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } } }, then: [{ op: 'gainLife', who: you, amount: 2 }] } as EffectStep]),
    readings: ["Draw a card. If Test Card isn't tapped, you gain 2 life.", 'Draw a card. If Test Card is not tapped, you gain 2 life.'],
    near: ['Draw a card. If Test Card is tapped, you gain 2 life.', "Draw a card. If Test Card isn't untapped, you gain 2 life."],
  },
  'no-longer-suspected': {
    def: spell([{ op: 'designateObject', what: t('c'), designation: 'unsuspected' } as EffectStep, draw(1)], [objTarget('c', { types: ['Creature'] })]),
    readings: ['Target creature is no longer suspected. Draw a card.'],
    near: ['Target creature is suspected. Draw a card.', 'Target creature is no longer tapped. Draw a card.'],
  },
  // FAST5X E23 (CR 106.6): mana spending restrictions
  'spend-spell-number': {
    def: spendMana({ spells: { subtypes: ['Dragon'] } }),
    readings: ['{T}: Add {C}. Spend this mana only to cast a Dragon spell.', '{T}: Add {C}. Spend this mana only to cast Dragon spells.'],
    near: ['{T}: Add {C}. Spend this mana only to cast a Dragon card.', '{T}: Add {C}. Spend this mana only to cast a Goblin spell.'],
  },
  'spend-type-list': {
    def: spendMana({ spells: { subtypes: ['Dwarf', 'Equipment', 'Saga'] } }),
    readings: ['{T}: Add {C}. Spend this mana only to cast Dwarf, Equipment, or Saga spells.', '{T}: Add {C}. Spend this mana only to cast Dwarf, Equipment, and Saga spells.', '{T}: Add {C}. Spend this mana only to cast Dwarf, Equipment, and/or Saga spells.'],
    near: ['{T}: Add {C}. Spend this mana only to cast Dwarf, Equipment, and Saga cards.', '{T}: Add {C}. Spend this mana only to cast Dwarf and Saga spells.'],
  },
  'spend-clause-join': {
    def: spendMana({ spells: { types: ['Artifact'] }, abilities: {} }),
    readings: [
      '{T}: Add {C}. Spend this mana only to cast an artifact spell or activate an ability.',
      '{T}: Add {C}. Spend this mana only to cast an artifact spell or to activate an ability.',
      '{T}: Add {C}. Spend this mana only to cast artifact spells and activate abilities.',
      '{T}: Add {C}. Spend this mana only to activate an ability or cast an artifact spell.',
    ],
    near: ['{T}: Add {C}. Spend this mana only to cast an artifact spell.', '{T}: Add {C}. Spend this mana only to cast an artifact spell or activate an ability of an artifact.'],
  },
  'spend-ability-source': {
    def: spendMana({ abilities: { types: ['Artifact'] } }),
    readings: [
      '{T}: Add {C}. Spend this mana only to activate abilities of artifacts.',
      '{T}: Add {C}. Spend this mana only to activate abilities of artifact sources.',
      '{T}: Add {C}. Spend this mana only to activate an ability of an artifact.',
      '{T}: Add {C}. Spend this mana only to activate an ability of an artifact source.',
    ],
    near: ['{T}: Add {C}. Spend this mana only to activate abilities.', '{T}: Add {C}. Spend this mana only to activate abilities of creature sources.'],
  },
  'spend-face-up-door': {
    def: spendMana({ unlock: true, turnFaceUp: {} }),
    readings: [
      '{T}: Add {C}. Spend this mana only to unlock a door or turn a permanent face up.',
      '{T}: Add {C}. Spend this mana only to unlock doors or turn permanents face up.',
    ],
    near: ['{T}: Add {C}. Spend this mana only to unlock a door or turn a creature face up.', '{T}: Add {C}. Spend this mana only to unlock a door.'],
  },
  // FAST5 T63
  'sacrificed-described': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'happened', event: { ev: 'action', verb: 'sacrifice', actor: 'you', object: { types: ['Artifact'] } }, scope: 'turn' } } as AbilityDef,
    ctx: creature,
    readings: ["As long as you've sacrificed an artifact this turn, Test Card gets +1/+1.", 'As long as you sacrificed an artifact this turn, Test Card gets +1/+1.'],
    near: ["As long as you've sacrificed a creature this turn, Test Card gets +1/+1.", "As long as an opponent has sacrificed an artifact this turn, Test Card gets +1/+1.", "As long as you've sacrificed an artifact this game, Test Card gets +1/+1."],
  },
  'enters-tapped-not-your-turn': {
    def: { kind: 'static', text: '', zone: ['stack', 'battlefield'], effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', tapped: true, tappedUnless: { cond: 'turnOf', whose: 'you' } } }] } as AbilityDef,
    ctx: creature,
    readings: ["Test Card enters tapped unless it's your turn.", "Test Card enters tapped if it's not your turn."],
    near: ["Test Card enters tapped if it's your turn.", "Test Card enters tapped unless it's an opponent's turn."],
  },
  // FAST5 T44
  'pay-mana-and-life': {
    def: spell([{ op: 'pay', who: you, cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'B' }], other: [{ kind: 'payLife', amount: 2 }] }, then: [draw(1)] } as EffectStep]),
    readings: ['You may pay {1}{B} and 2 life. If you do, draw a card.', 'You may pay {1}{B} and pay 2 life. If you do, draw a card.'],
    near: ['You may pay {1}{B} and 3 life. If you do, draw a card.', 'You may pay {1}{B} or 2 life. If you do, draw a card.', 'You may pay {1}{B}. If you do, draw a card.'],
  },
  'token-or-article': {
    def: spell([{ op: 'pay', who: you, cost: { other: [{ kind: 'sacrifice', filter: { anyOf: [{ token: true }, { types: ['Land'] }] }, count: 1 }] }, then: [draw(1)] } as EffectStep]),
    readings: ['You may sacrifice a token or a land. If you do, draw a card.', 'You may sacrifice a token or land. If you do, draw a card.'],
    near: ['You may sacrifice a token or a creature. If you do, draw a card.', 'You may sacrifice a land. If you do, draw a card.', 'You may sacrifice a token and a land. If you do, draw a card.'],
  },
  // FAST5 T59
  'shared-modifier-each-alternative': {
    def: spell([{ op: 'destroy', what: t('c') }], [objTarget('c', { anyOf: [{ notTypes: ['Creature'], types: ['Artifact'] }, { notTypes: ['Creature'], types: ['Enchantment'] }] })]),
    readings: ['Destroy target noncreature artifact or noncreature enchantment.', 'Destroy target noncreature artifact or enchantment.'],
    near: ['Destroy target noncreature artifact or creature enchantment.', 'Destroy target artifact or noncreature enchantment.', 'Destroy target noncreature artifact and enchantment.'],
  },
  'exiled-with-it-hand': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }] }, effect: { targets: [], steps: [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'hand' } }] } } as AbilityDef,
    ctx: creature,
    readings: ["When Test Card leaves the battlefield, return the exiled card to its owner's hand.", "When Test Card leaves the battlefield, put each card exiled with it into its owner's hand."],
    near: ["When Test Card leaves the battlefield, put each card exiled with it into your hand.", "When Test Card leaves the battlefield, put the exiled card onto the battlefield."],
  },
  // FAST5 T67
  'chosen-that-type': {
    def: spell([
      { op: 'chooseValue', who: you, what: 'creatureType', as: 'chosenCreatureType', link: 'chosenCreatureType' } as EffectStep,
      { op: 'draw', who: you, count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you', chosen: { link: 'chosenCreatureType', quality: 'creatureType' } } } } } as EffectStep,
    ]),
    readings: ['Choose a creature type. Draw a card for each creature you control of that type.', 'Choose a creature type. Draw a card for each creature you control of the chosen type.'],
    near: ['Choose a creature type. Draw a card for each creature you control of that color.', 'Choose a creature type. Draw a card for each creature you control.'],
  },
  'chosen-zone-order': {
    def: spell([
      { op: 'chooseValue', who: you, what: 'creatureType', as: 'chosenCreatureType', link: 'chosenCreatureType' } as EffectStep,
      { op: 'draw', who: you, count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true, chosen: { link: 'chosenCreatureType', quality: 'creatureType' } } } } } as EffectStep,
    ]),
    readings: ['Choose a creature type. Draw a card for each creature card of the chosen type in your graveyard.', 'Choose a creature type. Draw a card for each creature card in your graveyard of the chosen type.'],
    near: ['Choose a creature type. Draw a card for each creature card of the chosen type in your hand.', 'Choose a creature type. Draw a card for each creature card in your graveyard.'],
  },
  'token-for-each-lead': {
    def: spell([{ op: 'createToken', who: you, token: { power: 1, toughness: 1, colors: ['R'], types: ['Creature'], subtypes: ['Monk'] }, count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Shrine'], controller: 'you' } } } } as EffectStep]),
    readings: ['For each Shrine you control, create a 1/1 red Monk creature token.', 'Create a 1/1 red Monk creature token for each Shrine you control.'],
    near: ['For each Shrine you control, create two 1/1 red Monk creature tokens.', 'For each Shrine an opponent controls, create a 1/1 red Monk creature token.'],
  },
  // FAST5X E19
  'mana-spent-at-least': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'cast', player: 'you', spell: { types: ['Instant', 'Sorcery'] } }] },
      interveningIf: { cond: 'compare', left: { q: 'spellManaSpent', of: { ref: 'event', role: 'spell' } }, op: '>=', right: 5 }, effect: { targets: [], steps: [draw(1)] } } as AbilityDef,
    ctx: creature,
    readings: ['Whenever you cast an instant or sorcery spell, if five or more mana was spent to cast it, draw a card.', 'Whenever you cast an instant or sorcery spell, if at least five mana was spent to cast that spell, draw a card.'],
    near: ['Whenever you cast an instant or sorcery spell, if five mana was spent to cast it, draw a card.', 'Whenever you cast an instant or sorcery spell, if six or more mana was spent to cast it, draw a card.'],
  },
  // FAST5 T48
  'mana-restriction-number': {
    def: {
      kind: 'activated', text: '', cost: { tap: true }, isMana: true,
      effect: { targets: [], steps: [{ op: 'addMana', who: you, units: [['W']], restriction: { spells: { types: ['Artifact'] }, abilities: { types: ['Artifact'] } } }] },
    } as AbilityDef,
    readings: ['{T}: Add {W}. Spend this mana only to cast an artifact spell or activate an ability of an artifact source.', '{T}: Add {W}. Spend this mana only to cast artifact spells or activate abilities of artifact sources.'],
    near: ['{T}: Add {W}. Spend this mana only to cast an artifact spell or activate abilities of artifact sources.', '{T}: Add {W}. Spend this mana only to cast an artifact spell and activate an ability of an artifact source.', '{T}: Add {W}. Spend this mana only to cast an artifact spell or activate an ability of a creature source.'],
  },
  // FAST5X E21
  'counters-any-kind': {
    def: trig([dies], [gain(2)], { interveningIf: { cond: 'matches', object: self, filter: { counters: { kind: 'any' } } } }),
    ctx: creature,
    readings: ['When Test Card dies, if it had counters on it, you gain 2 life.', 'When Test Card dies, if it had a counter on it, you gain 2 life.', 'When Test Card dies, if it had one or more counters on it, you gain 2 life.'],
    near: ['When Test Card dies, if it had no counters on it, you gain 2 life.', 'When Test Card dies, if it had a +1/+1 counter on it, you gain 2 life.', 'When Test Card dies, if it had two or more counters on it, you gain 2 life.'],
  },
  'put-its-counters': {
    def: trig([dies], [{ op: 'moveCounters', from: self, to: t('c'), kind: 'any', count: 'all' } as EffectStep], {}, [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    ctx: creature,
    readings: ['When Test Card dies, put its counters on target creature you control.', 'When Test Card dies, put those counters on target creature you control.'],
    near: ['When Test Card dies, put its +1/+1 counters on target creature you control.', 'When Test Card dies, move its counters onto target creature you control.', 'When Test Card dies, put its counters on each creature you control.'],
  },
  // M12-3
  'one-of-your-opponents': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'damage', source: { types: ['Creature'] }, recipient: { player: 'opponent' }, combat: true }] }, effect: { targets: [], steps: [draw(1)] } } as AbilityDef,
    ctx: creature,
    readings: ['Whenever a creature deals combat damage to one of your opponents, draw a card.', 'Whenever a creature deals combat damage to an opponent, draw a card.'],
    near: ['Whenever a creature deals combat damage to one of your creatures, draw a card.', 'Whenever a creature deals combat damage to you, draw a card.'],
  },
  // FAST5 T51
  'mana-symbols-spent': {
    def: trig([enters], [gain(3)], { interveningIf: { cond: 'wasCast', spent: { color: 'R', atLeast: 2 } } }),
    ctx: unknown,
    readings: ['When Test Card enters, if {R}{R} was spent to cast it, you gain 3 life.', 'When Test Card enters, if at least two red mana was spent to cast it, you gain 3 life.'],
    near: ['When Test Card enters, if {R} was spent to cast it, you gain 3 life.', 'When Test Card enters, if {W}{W} was spent to cast it, you gain 3 life.'],
  },
  'not-cast-or-free': {
    def: trig([enters], [gain(3)], { interveningIf: { cond: 'compare', left: { q: 'manaSpent' }, op: '==', right: 0 } }),
    ctx: unknown,
    readings: ["When Test Card enters, if it wasn't cast or no mana was spent to cast it, you gain 3 life.", "When Test Card enters, if Test Card wasn't cast or no mana was spent to cast Test Card, you gain 3 life."],
    near: ["When Test Card enters, if it wasn't cast or no mana was spent to cast it, you gain 4 life."],
  },
  'mana-spent-it': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'manaSpent' } } as EffectStep]),
    ctx: unknown,
    readings: ['You gain life equal to the amount of mana spent to cast it.', 'You gain life equal to the amount of mana spent to cast this spell.'],
    near: ['You gain life equal to the amount of mana spent to cast that spell.'],
  },
  'plural-name-deal': {
    def: trig([enters], [{ op: 'damage', source: self, to: { ref: 'each', who: 'opponent' }, amount: 3 } as EffectStep]),
    ctx: unknown,
    readings: ['When Test Card enters, Test Card deals 3 damage to each opponent.', 'When Test Card enters, Test Card deal 3 damage to each opponent.'],
    near: ['When Test Card enters, Test Card deals 2 damage to each opponent.'],
  },
  'enters-number-of-counters': {
    def: statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: { q: 'manaSpent' } }] } } as StaticEffect]),
    ctx: creature,
    readings: [
      'This creature enters with a number of +1/+1 counters on it equal to the amount of mana spent to cast it.',
      'This creature enters with X +1/+1 counters on it, where X is the amount of mana spent to cast it.',
    ],
    near: ['This creature enters with a number of -1/-1 counters on it equal to the amount of mana spent to cast it.'],
  },
  // FAST5X E7
  'alt-cost-paid': {
    def: spell([draw(1), { op: 'if', cond: { cond: 'wasCast', via: 'sneak' }, then: [{ op: 'gainLife', who: you, amount: 2 }] } as EffectStep]),
    readings: ["Draw a card. If Test Card's sneak cost was paid, you gain 2 life.", "Draw a card. If this spell's sneak cost was paid, you gain 2 life.", 'Draw a card. If its sneak cost was paid, you gain 2 life.'],
    near: ["Draw a card. If Test Card's evoke cost was paid, you gain 2 life.", 'Draw a card. If Test Card was kicked, you gain 2 life.', 'Draw a card. If Test Card was cast using web-slinging, you gain 2 life.'],
  },
  // FAST5 T43
  'rest-of-group': {
    def: spell([
      { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 3 }, as: 'seen' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: bound('seen'), zone: 'library' } }, min: 1, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' } } as EffectStep,
      { op: 'move', what: { ref: 'each', filter: { is: bound('seen'), not: { is: bound('c') }, zone: 'library' } }, to: { zone: 'graveyard' } } as EffectStep,
    ]),
    readings: ['Look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.', 'Look at the top three cards of your library. Put one of them into your hand and the other into your graveyard.'],
    near: ['Look at the top three cards of your library. Put one of them into your hand and the rest into your hand.', 'Look at the top three cards of your library. Put one of them into your hand and all of them into your graveyard.'],
  },
  'rest-bottom-short': {
    def: spell([
      { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 4 }, as: 'seen' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], is: bound('seen'), zone: 'library' } }, min: 0, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
      { op: 'move', what: { ref: 'each', filter: { is: bound('seen'), not: { is: bound('c') }, zone: 'library' } }, to: { zone: 'library', position: 'bottom', order: 'random' } } as EffectStep,
    ]),
    readings: [
      'Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order.',
      'Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom in a random order.',
    ],
    near: [
      'Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom in any order.',
      'Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on top in a random order.',
    ],
  },
  'top-cards-where-x': {
    def: spell([{ op: 'look', who: you, at: { ref: 'topCards', player: you, count: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } } } as EffectStep]),
    readings: ['Look at the top X cards of your library, where X is the number of lands you control.'],
    near: ['Look at the top X cards of your library, where X is the number of creatures you control.', 'Look at the top X cards of your library.'],
  },
  // FAST5X E15
  'greatest-highest': {
    def: spell([{ op: 'draw', who: you, count: { q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, agg: 'max' } } as EffectStep]),
    readings: ['Draw cards equal to the greatest power among creatures you control.', 'Draw cards equal to the highest power among creatures you control.'],
    near: ['Draw cards equal to the least power among creatures you control.', 'Draw cards equal to the total power of creatures you control.', 'Draw cards equal to the greatest toughness among creatures you control.'],
  },
  'whichever-is-greater': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'math', op: 'max', args: [2, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }] } } as EffectStep]),
    readings: ['You gain life equal to the greater of 2 and the number of creatures you control.', 'You gain life equal to 2 or the number of creatures you control, whichever is greater.'],
    near: ['You gain life equal to 2 or the number of creatures you control, whichever is less.', 'You gain life equal to 3 or the number of creatures you control, whichever is greater.'],
  },
  'pays-mana-equal-to': {
    def: spell([{ op: 'pay', who: { ref: 'controllerOf', object: t('t0') }, cost: { mana: [{ kind: 'generic', amount: 1 }] }, times: { q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, agg: 'max' }, else: [{ op: 'counter', what: t('t0') }] } as EffectStep], [{ id: 't0', kind: 'spell', min: 1, max: 1, text: '' }]),
    readings: ['Counter target spell unless its controller pays mana equal to the greatest power among creatures you control.', 'Counter target spell unless its controller pays {1} the greatest power among creatures you control times.'],
    near: ['Counter target spell unless its controller pays life equal to the greatest power among creatures you control.', 'Counter target spell unless its controller pays mana equal to the greatest toughness among creatures you control.'],
  },
  // std-rx25
  'pays-x-where': {
    def: spell([{ op: 'pay', who: { ref: 'controllerOf', object: t('t0') }, cost: { mana: [{ kind: 'generic', amount: 1 }] }, times: { q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, agg: 'max' }, else: [{ op: 'counter', what: t('t0') }] } as EffectStep], [{ id: 't0', kind: 'spell', min: 1, max: 1, text: '' }]),
    readings: ['Counter target spell unless its controller pays {X}, where X is the greatest power among creatures you control.', 'Counter target spell unless its controller pays mana equal to the greatest power among creatures you control.'],
    near: ['Counter target spell unless its controller pays {X}, where X is the greatest toughness among creatures you control.', 'Counter target spell unless its controller pays X life, where X is the greatest power among creatures you control.'],
  },
  // FAST5 T52
  'hand-size-equal-to': {
    def: t12Static(
      { cond: 'compare', left: T52_TYPES, op: '>=', right: 4 },
      [{ s: 'rule', rule: 'maxHandSize', player: { ref: 'each', who: 'opponent' }, value: { q: 'math', op: '-', args: [7, T52_TYPES] } } as StaticEffect],
    ),
    ctx: creature,
    readings: [
      "As long as there are four or more card types among cards in your graveyard, each opponent's maximum hand size is equal to seven minus the number of those card types.",
      "As long as there are four or more card types among cards in your graveyard, each opponent's maximum hand size is 7 minus the number of card types among cards in your graveyard.",
    ],
    near: [
      "As long as there are four or more card types among cards in your graveyard, each opponent's maximum hand size is equal to seven plus the number of those card types.",
      "As long as there are four or more card types among cards in your graveyard, each opponent's maximum hand size is equal to seven minus the number of those colors.",
      "As long as there are five or more card types among cards in your graveyard, each opponent's maximum hand size is equal to seven minus the number of those card types.",
    ],
  },
  'exile-top-where-x': {
    def: spell([{ op: 'move', what: { ref: 'topCards', player: you, count: T52_TYPES }, to: { zone: 'exile' } } as EffectStep]),
    readings: ['Exile the top X cards of your library, where X is the number of card types among cards in your graveyard.'],
    near: [
      'Exile the top X cards of your library, where X is the number of creature types among cards in your graveyard.',
      'Exile the top X cards of your graveyard, where X is the number of card types among cards in your graveyard.',
      'Exile the top X cards of your library face down, where X is the number of card types among cards in your graveyard.',
    ],
  },
  // FAST5 T55
  'token-name-first': {
    def: spell([{ op: 'createToken', who: you, count: 1, token: { name: 'Mowu', colors: ['G'], supertypes: ['Legendary'], types: ['Creature'], subtypes: ['Dog'], power: 3, toughness: 3 } } as EffectStep]),
    readings: ['Create Mowu, a legendary 3/3 green Dog creature token.', 'Create a legendary 3/3 green Dog creature token named Mowu.'],
    near: ['Create Angelo, a legendary 3/3 green Dog creature token.', 'Create Mowu, a 3/3 green Dog creature token.', 'Create Mowu, a legendary 3/3 white Dog creature token.'],
  },
  'token-own-name': {
    def: spell([{
      op: 'createToken', who: you, count: 1,
      token: {
        name: 'Redwing', colors: ['U'], supertypes: ['Legendary'], types: ['Creature'], subtypes: ['Bird', 'Scout'], power: 1, toughness: 1, keywords: ['flying'],
        abilities: [{ kind: 'triggered', text: '', trigger: { on: [{ ev: 'attacks', attacker: { self: true } }] }, effect: { targets: [], steps: [{ op: 'surveil', who: you, count: 1 }] } } as AbilityDef],
      },
    } as EffectStep]),
    readings: [
      'Create Redwing, a legendary 1/1 blue Bird Scout creature token with flying and "Whenever Redwing attacks, surveil 1."',
      'Create Redwing, a legendary 1/1 blue Bird Scout creature token with flying and "Whenever this token attacks, surveil 1."',
    ],
    near: ['Create Redwing, a legendary 1/1 blue Bird Scout creature token with flying and "Whenever Falcon attacks, surveil 1."'],
  },
  'loyalty-cost-bracket': {
    def: spell([{
      op: 'createToken', who: you, count: 1,
      token: { colors: [], types: ['Creature'], subtypes: ['Wizard'], power: 2, toughness: 2, abilities: [{ kind: 'activated', text: '', cost: { loyalty: -2 }, effect: { targets: [], steps: [{ op: 'surveil', who: you, count: 1 }] } } as AbilityDef] },
    } as EffectStep]),
    readings: ['Create a 2/2 colorless Wizard creature token with "[−2]: Surveil 1."', 'Create a 2/2 colorless Wizard creature token with "−2: Surveil 1."'],
    near: ['Create a 2/2 colorless Wizard creature token with "[−3]: Surveil 1."', 'Create a 2/2 colorless Wizard creature token with "[+2]: Surveil 1."'],
  },
  'block-or-be-blocked-by': {
    def: statics([
      { s: 'restrict', subject: self, mode: 'cant', action: 'block', other: { types: ['Creature'], notSubtypes: ['Spirit'] } },
      { s: 'restrict', subject: self, mode: 'cant', action: 'beBlockedBy', other: { types: ['Creature'], notSubtypes: ['Spirit'] } },
    ] as StaticEffect[]),
    ctx: creature,
    readings: ["~ can't block or be blocked by non-Spirit creatures.", "~ can't block non-Spirit creatures. ~ can't be blocked by non-Spirit creatures."],
    near: ["~ can't block or be blocked by Spirit creatures.", "~ can't block non-Spirit creatures.", "~ can block or be blocked by non-Spirit creatures."],
  },
  // FAST5 T56: the flashback cost of a granted flashback is the card's own mana cost
  'flashback-cost-card': {
    def: spell([{
      op: 'effect', duration: { d: 'endOfTurn' },
      effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flashback', costIsManaCost: true, text: 'flashback' }] }] }],
    } as unknown as EffectStep], [{ id: 'c', kind: 'object', min: 1, max: 1, filter: { types: ['Instant', 'Sorcery'], zone: 'graveyard', owner: 'you', isCard: true } } as never]),
    readings: [
      'Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.',
      'Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to that card\x27s mana cost.',
    ],
    near: [
      'Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its power.',
      'Target instant or sorcery card in your graveyard gains flashback until end of turn.',
    ],
  },
  // FAST5 T61
  'then-draw': {
    def: spell([{ op: 'surveil', who: you, count: 3, guard: { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: you }, op: '==', right: 0 } } as EffectStep, draw(3)]),
    readings: ['Surveil 3 if you have no cards in hand. Then draw three cards.', 'Surveil 3 if you have no cards in hand. Draw three cards.'],
    near: ['Surveil 3 if you have no cards in hand. Then draw four cards.', 'Surveil 3 if you have no cards in hand. Then discard three cards.'],
  },
  'comma-then-may': {
    def: spell([
      { op: 'mill', who: you, count: 3 } as EffectStep,
      { op: 'pay', who: you, cost: { other: [{ kind: 'exileFrom', zone: 'graveyard', filter: { subtypes: ['Elf'] }, count: 1 }] }, then: [{ op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: 2 }] } as EffectStep,
    ]),
    readings: ['Mill three cards, then you may exile an Elf card from your graveyard. If you do, each opponent loses 2 life.', 'Mill three cards. You may exile an Elf card from your graveyard. If you do, each opponent loses 2 life.'],
    near: ['Mill three cards, then you may exile an Elf card from your graveyard. If you do, each opponent loses 3 life.', 'Mill three cards and you may exile an Elf card from your graveyard. If you do, each opponent loses 2 life.'],
  },
  'character-object-pronoun': {
    def: trig([{ ev: 'step', step: 'end', whose: 'you' } as EventPattern], [{ op: 'putCounters', on: self, kind: '+1/+1', count: 1 } as EffectStep], { interveningIf: { cond: 'matches', object: self, filter: { tapped: true } } }),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Legendary', 'Creature', 'Human'] },
    readings: ['At the beginning of your end step, if Test Card is tapped, put a +1/+1 counter on her.', 'At the beginning of your end step, if Test Card is tapped, put a +1/+1 counter on him.', 'At the beginning of your end step, if Test Card is tapped, put a +1/+1 counter on it.'],
    near: ['At the beginning of your end step, if Test Card is tapped, put a +1/+1 counter on them.', 'At the beginning of your end step, if Test Card is tapped, put two +1/+1 counters on her.'],
  },
  'for-each-other-than-self': {
    def: spell([{ op: 'putCounters', on: self, kind: '+1/+1', count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Mount', 'Vehicle'], controller: 'you', other: true } } } } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Vehicle'] },
    readings: ['Put a +1/+1 counter on Test Card for each Mount and/or Vehicle you control other than Test Card.', 'Put a +1/+1 counter on Test Card for each other Mount or Vehicle you control.'],
    near: ['Put a +1/+1 counter on Test Card for each Mount and/or Vehicle you control.', 'Put a +1/+1 counter on Test Card for each Mount and/or Vehicle an opponent controls other than Test Card.'],
  },
  'mill-put-all': {
    def: spell([
      { op: 'mill', who: you, count: 6, as: 'm' } as EffectStep,
      { op: 'move', what: { ref: 'each', filter: { anyOf: [{ types: ['Instant', 'Sorcery'] }], is: bound('m'), zone: 'any' } }, to: { zone: 'hand' } } as EffectStep,
    ]),
    readings: ['Mill six cards, then put all instant and sorcery cards from among them into your hand.'],
    near: ['Mill six cards, then put all instant and sorcery cards from among them onto the battlefield.', 'Mill six cards, then put up to one instant and sorcery card from among them into your hand.', 'Mill five cards, then put all instant and sorcery cards from among them into your hand.'],
  },
  // FAST5 T71
  'mill-pick-wording': {
    def: spell([
      { op: 'mill', who: you, count: 4, as: 'm' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], is: bound('m'), zone: 'any' } }, min: 0, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' } } as EffectStep,
    ]),
    readings: [
      'Mill four cards, then you may put a land card from among them into your hand.',
      'Mill four cards, then you may return a land card from among them to your hand.',
      'Mill four cards, then put up to one land card from among them into your hand.',
      'Mill four cards. You may put a land card from among them into your hand.', // FAST5 T75: two sentences
      'Mill four cards. You may put a land card from among the milled cards into your hand.',
      'Mill four cards, then you may put a land card from among the milled cards into your hand.',
    ],
    near: ['Mill four cards, then you may put a land card from among them onto the battlefield.', 'Mill four cards, then put a land card from among them into your hand.', 'Mill four cards, then you may put a creature card from among them into your hand.'],
  },
  // FAST5 T75 (steps-cards.ts#search)
  'search-and-reveal': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { subtypes: ['Forest'] }, min: 0, max: 2, reveal: true, as: 's' } as EffectStep,
    ]),
    readings: ['Search your library for up to two Forest cards, reveal them.', 'Search your library for up to two Forest cards and reveal them.'],
    near: ['Search your library for up to two Forest cards and reveal it.', 'Search your library for up to two Forest cards.', 'Search your library for up to three Forest cards and reveal them.'],
  },
  'found-card-noun': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { types: ['Land'], supertypes: ['Basic'] }, max: 1, as: 'f' } as EffectStep,
      { op: 'move', what: bound('f'), to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
      { op: 'untap', what: bound('f') } as EffectStep,
    ]),
    readings: ['Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Untap that land.', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Untap that card.'],
    near: ['Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Untap that creature.', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Untap that Forest.'],
  },
  // cmd4 (abil.ts#onlyIfWords): your turn up to the beginning of combat, and your declare attackers step not begun this turn
  'before-attackers-declared': {
    def: {
      kind: 'activated', text: '', cost: { tap: true },
      onlyIf: { cond: 'all', of: [{ cond: 'turnOf', whose: 'you', step: ['upkeep', 'draw', 'main1', 'beginCombat'] }, { cond: 'not', of: { cond: 'happened', event: { ev: 'step', step: 'declareAttackers', whose: 'you' }, scope: 'turn' } }] },
      effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 2 } as EffectStep] },
    } as AbilityDef,
    ctx: creature,
    readings: ['{T}: You gain 2 life. Activate only during your turn, before attackers are declared.'],
    near: ['{T}: You gain 2 life. Activate only during your turn, before blockers are declared.', '{T}: You gain 2 life. Activate only during your turn.', '{T}: You gain 2 life. Activate only before attackers are declared.'],
  },
  // std-exile-play-1-3
  'opponent-may-play-that-card': {
    def: {
      kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] },
      effect: { targets: [], steps: [{ op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: 'eachOpponent', do: [
        { op: 'chooseObjects', who: { ref: 'bound', name: 'eachOpponent' }, from: { ref: 'each', filter: { zone: 'hand', owner: { ref: 'bound', name: 'eachOpponent' } } }, min: 1, max: 1, as: 'exiledCard' },
        { op: 'move', what: { ref: 'bound', name: 'exiledCard' }, to: { zone: 'exile' } },
        { op: 'effect', duration: { d: 'remainsExiled' }, effects: [{ s: 'permit', who: { ref: 'bound', name: 'eachOpponent' }, action: 'play', of: { is: { ref: 'bound', name: 'exiledCard' } } }] },
      ] } as EffectStep] },
    } as AbilityDef,
    ctx: creature,
    readings: ['When ~ enters, each opponent exiles a card from their hand and may play that card for as long as it remains exiled.', 'When ~ enters, each opponent exiles a card from their hand and may play it for as long as it remains exiled.'],
    near: ['When ~ enters, each opponent exiles a card from their hand and may cast that card for as long as it remains exiled.', 'When ~ enters, each opponent exiles a card from their hand and may play that card this turn.'],
  },
};

/** FAST5X E23: "{T}: Add {C}." with a spending restriction (CR 106.6). */
function spendMana(restriction: ManaRestriction): AbilityDef {
  return { kind: 'activated', text: '', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, units: [['C']], restriction }] } } as AbilityDef;
}
Object.assign(EXAMPLES, {
  // FAST5X batch 1 integration (E27 beside FAST5 T56)
  'keyword-last-type-spelled': {
    def: spell([{ op: 'destroy', what: t('c') }], [objTarget('c', { anyOf: [{ types: ['Artifact', 'Enchantment'] }, { types: ['Creature'], keyword: 'flying' }] })]),
    readings: ['Destroy target artifact, enchantment, or creature with flying.', 'Destroy target artifact or enchantment or creature with flying.'],
    near: ['Destroy target artifact, enchantment, or creature.', 'Destroy target artifact or enchantment or creature with reach.', 'Destroy target artifact or creature with flying.'],
  },
});

Object.assign(EXAMPLES, {
  // FAST5X E27
  'pay-life-equal-to': {
    def: { kind: 'keyword', keyword: 'ward', text: '', cost: { other: [{ kind: 'payLife', amount: { q: 'stat', stat: 'power', of: { ref: 'self' } } }] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ["Ward--Pay life equal to ~'s power.", "Ward--Pay ~'s power life."],
    near: ["Ward--Pay life equal to ~'s toughness.", "Ward--Pay energy equal to ~'s power."],
  },
  'as-transforms-into-self': {
    def: { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'becomes', what: 'transformed', object: { self: true } }, body: { b: 'during', do: [{ op: 'gainLife', who: you, amount: 3 }] } }] } as unknown as AbilityDef,
    ctx: creature,
    readings: ['As ~ transforms into ~, you gain 3 life.', 'As ~ transforms into ~, gain 3 life.', 'As ~ transforms, gain 3 life.'],
    near: ['When ~ transforms into ~, you gain 3 life.', 'As ~ transforms into ~, you gain 4 life.'],
  },
});

const T47_RESTLESS: EffectStep = { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [
  { layer: 4, types: { set: ['Creature'] }, subtypes: { set: ['Cat'] } }, { layer: 6, add: [{ kind: 'static', text: 'During your turn, this creature has first strike.', condition: { cond: 'turnOf', whose: 'you' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'first strike', text: 'first strike' }] }] }] }] },
  { layer: '7b', power: 2, toughness: 1 }] }] } as EffectStep;
Object.assign(EXAMPLES, {
  // w8-followups (CR 205.1b): rid.stillLand adds the subtypes, so the resolved change adds card types and subtypes only
  'still-a-land-keeps-types': {
    def: spell([{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: t('c'), mods: [
      { layer: 4, types: { add: ['Creature'] }, subtypes: { add: ['Elemental'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }] }, { layer: '7b', power: 4, toughness: 4 }] }] } as EffectStep],
    [objTarget('c', { types: ['Land'], controller: 'you' })]),
    readings: ["Target land you control becomes a 4/4 Elemental creature with trample. It's still a land.", 'Target land you control becomes a 4/4 Elemental creature with trample in addition to its other types.'],
    near: ['Target land you control becomes a 4/4 Elemental creature with trample.', "Target land you control becomes a 4/4 Elemental creature with haste. It's still a land."],
  },
  // FAST5 T47
  'quote-last-lead-duration': {
    def: spell([T47_RESTLESS], [objTarget('c', { types: ['Land'] })]),
    readings: ['Until end of turn, target land becomes a 2/1 Cat creature with "During your turn, this creature has first strike."', 'Target land becomes a 2/1 Cat creature with "During your turn, this land has first strike." until end of turn.', 'Target land becomes a 2/1 Cat creature with "During your turn, this land has first strike" until end of turn.'],
    near: ['Until end of turn, target land becomes a 2/1 Cat creature with "During your turn, this creature has first strike." until end of turn.', 'Until end of turn, target land becomes a 2/1 Cat creature with "During your turn, this creature has vigilance."'],
  },
  'permanent-type-is': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: 'owner' }, as: 'm' } as EffectStep, { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: bound('m'), mods: [{ layer: 4, types: { set: ['Enchantment'] } }] }] } as EffectStep], [objTarget('c', { zone: 'graveyard', isCard: true })]),
    readings: ["Return target card from a graveyard to the battlefield under its owner's control. It's an enchantment.", "Return target card from a graveyard to the battlefield under its owner's control. It becomes an enchantment."],
    near: ["Return target card from a graveyard to the battlefield under its owner's control. It's an enchantment until end of turn.", "Return target card from a graveyard to the battlefield under its owner's control. It's an artifact."],
  },
  'lki-intervening-if': {
    def: trig([dies], [draw()], { interveningIf: { cond: 'matches', object: { ref: 'event', role: 'subject' }, filter: { types: ['Creature'] } } }),
    ctx: creature,
    readings: ['When Test Card dies, if it was a creature, draw a card.', "When Test Card dies, if it's a creature, draw a card."],
    near: ['When Test Card dies, if it was a land, draw a card.', 'When Test Card dies, if it was tapped, draw a card.'],
  },
  // FAST5X E26 (CR 702.75a): hideaway's free play, the condition after the instruction
  'play-exiled-if-after': {
    def: spell([{ op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } }, atLeast: 3 }, then: [{ op: 'cast', who: you, what: { ref: 'linked', link: 'exiled' }, free: true, optional: true, play: true }] } as EffectStep]),
    readings: ['You may play the exiled card without paying its mana cost if you control three or more artifacts.', 'If you control three or more artifacts, you may play the exiled card without paying its mana cost.'],
    near: ['You may play the exiled card without paying its mana cost if you control four or more artifacts.', 'You may cast the exiled card without paying its mana cost if you control three or more artifacts.'],
  },
  // FAST5 batch 8 integration (CR 603.4, 115.3): "other" of the object a trigger event is about, said or spelled out
  'other-than-event-object': {
    def: trig([{ ev: 'zoneChange', subject: { subtypes: ['Forest'], controller: 'you' }, to: 'battlefield' } as EventPattern], [{ op: 'draw', who: you, count: 1 } as EffectStep], {
      interveningIf: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you', not: { is: { ref: 'event', role: 'subject' } } } }, atLeast: 5 },
    }),
    readings: ['Whenever a Forest you control enters, if you control five or more other Forests, draw a card.', 'Whenever a Forest you control enters, if you control five or more Forests other than it, draw a card.'],
    near: ['Whenever a Forest you control enters, if you control five or more Forests, draw a card.', 'Whenever a Forest you control enters, if you control four or more other Forests, draw a card.'],
  },
  // FAST5 T65
  'double-counters-each-of': {
    def: spell([{ op: 'putCounters', on: t('c'), kind: '+1/+1', count: 3 }, { op: 'action', action: 'doubleCounters', subject: t('c'), who: you, arg: '+1/+1' } as EffectStep], [{ ...objTarget('c', { types: ['Creature'] }), min: 1, max: 3, divide: { what: 'counters', total: 3 } } as never]),
    readings: ['Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of those creatures.', 'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on those creatures.'],
    near: ['Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on each of these creatures.', 'Distribute three +1/+1 counters among one, two, or three target creatures, then double the number of +1/+1 counters on one of those creatures.'],
  },
  // FAST5 T78
  'tap-any-number-chosen': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'], controller: 'you', tapped: false } }, min: 0, max: 'any', as: 'c' } as EffectStep,
      { op: 'tap', what: bound('c'), as: 'n' } as EffectStep,
    ]),
    readings: ['Tap any number of untapped creatures you control.', 'Choose any number of untapped creatures you control. Tap them.'],
    near: ['Tap any number of tapped creatures you control.', 'Tap up to two untapped creatures you control.', 'Tap any number of untapped creatures.'],
  },
  'remove-counter-from-each-of': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'], controller: 'you' }], counters: { kind: '+1/+1' } } }, min: 2, max: 2, as: 'h' } as EffectStep,
      { op: 'removeCounters', from: bound('h'), kind: '+1/+1', count: 1 } as EffectStep,
    ]),
    readings: ['Remove a +1/+1 counter from each of two creatures you control.', 'Choose two creatures you control with a +1/+1 counter on them. Remove a +1/+1 counter from them.'],
    near: ['Remove a +1/+1 counter from each of three creatures you control.', 'Remove a charge counter from each of two creatures you control.', 'Remove two +1/+1 counters from each of two creatures you control.'],
  },
  'that-many-paid-life': {
    def: spell([
      { op: 'let', name: 'n', value: { q: 'life', of: you } } as EffectStep,
      { op: 'pay', who: you, cost: { other: [{ kind: 'payLife', amount: { q: 'var', name: 'n' } }] }, then: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: { q: 'var', name: 'n' } } as EffectStep] } as EffectStep,
    ]),
    readings: ['You may pay life equal to your life total. If you do, put that many +1/+1 counters on Test Card.', 'You may pay life equal to your life total. If you do, put a number of +1/+1 counters equal to that much on Test Card.'],
    near: ['You may pay life equal to your life total. If you do, put a +1/+1 counter on Test Card.', 'You may pay life equal to your life total. If you do, put twice that many +1/+1 counters on Test Card.'],
  },
  // std-hob (cloud batch 2, zz-cloud/std-hob.json)
  'found-one-of-them': {
    def: spell(STD_HOB_SEARCH),
    readings: [
      'Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      'Search your library for up to two basic land cards, reveal them, put one of them onto the battlefield tapped and the other into your hand, then shuffle.',
    ],
    near: [
      'Search your library for up to two basic land cards, reveal them, put one onto the battlefield and the other into your hand, then shuffle.',
      'Search your library for up to two basic land cards, reveal them, put one into your hand and the other onto the battlefield tapped, then shuffle.',
    ],
  },
  'reveal-those-cards': {
    def: spell(STD_HOB_SEARCH),
    readings: [
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      'Search your library for up to two basic land cards, reveal them, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    ],
    near: [
      'Search your library for up to two basic land cards, reveal these cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      'Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    ],
  },
  'equipped-attacking-order': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { attacking: true, equipped: true, types: ['Creature'] } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'menace', text: 'menace' }] }] }] } as EffectStep]),
    readings: ['Each equipped attacking creature gains menace until end of turn.', 'Each attacking equipped creature gains menace until end of turn.'],
    near: ['Each attacking creature gains menace until end of turn.', 'Each equipped creature gains menace until end of turn.'],
  },
  'pump-and-group-gains-duration': {
    def: spell([{
      op: 'effect', duration: { d: 'endOfTurn' },
      effects: [
        { s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1, toughness: 0 }] },
        { s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }] }] },
      ],
    } as EffectStep]),
    ctx: creature,
    readings: ['Until end of turn, this creature gets +1/+0 and creatures you control gain trample.', 'This creature gets +1/+0 and creatures you control gain trample until end of turn.'],
    near: ['Until end of turn, this creature gets +1/+0 and creatures you control gain haste.', 'This creature gets +1/+0 and creatures you control gain trample.'],
  },
  'token-named-after-keywords': {
    def: spell([{ op: 'createToken', who: you, count: 1, token: { colors: [], types: ['Artifact', 'Creature'], subtypes: ['Wall'], power: 3, toughness: 1, keywords: ['defender'], name: 'Stone Boulder' } } as EffectStep]),
    readings: ['Create a 3/1 colorless Wall artifact creature token with defender named Stone Boulder.', 'Create a 3/1 colorless Wall artifact creature token named Stone Boulder with defender.'],
    near: ['Create a 3/1 colorless Wall artifact creature token with defender named Stone Wall.', 'Create a 3/1 colorless Wall artifact creature token named Stone Boulder.'],
  },
  // CLOUD std-otj
  'cant-for-dont': {
    def: spell([
      { op: 'mill', who: you, count: 3, as: 'm' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], is: bound('m'), zone: 'any' } }, min: 1, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' }, as: 'd' } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'd', not: true }, then: [{ op: 'createToken', who: you, count: 1, token: { predefined: 'Treasure' } } as EffectStep] } as EffectStep,
    ]),
    readings: [
      "Mill three cards. Put a land card from among the milled cards into your hand. If you don't, create a Treasure token.",
      "Mill three cards. Put a land card from among the milled cards into your hand. If you can't, create a Treasure token.",
    ],
    near: ['Mill three cards. Put a land card from among the milled cards into your hand. If you do, create a Treasure token.', "Mill three cards. Put a land card from among the milled cards into your hand. If you can't, create a Clue token."],
  },
  'mill-pick-own-sentence': {
    def: spell([
      { op: 'mill', who: you, count: 3, as: 'm' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], is: bound('m'), zone: 'any' } }, min: 1, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' } } as EffectStep,
    ]),
    readings: [
      'Mill three cards. Put a land card from among the milled cards into your hand.',
      'Mill three cards. Put a land card from among them into your hand.',
      'Mill three cards, then put a land card from among them into your hand.',
    ],
    near: ['Mill three cards. You may put a land card from among the milled cards into your hand.', 'Mill three cards. Put a land card from among the milled cards onto the battlefield.'],
  },
  // LOOK3 (zz-cloud/look3.json) and Cloud std-fin, CR 608.2c (Risen Reef, N'Yami-Class Mother Ship): the move the condition says was not performed, named by the words
  // for its card either way
  'not-put-the-card': {
    def: spell([
      { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 1 }, as: 'seen' } as EffectStep,
      { op: 'if', cond: { cond: 'matches', object: bound('seen'), filter: { types: ['Land'], isCard: true } }, then: [{ op: 'may', who: you, do: [{ op: 'move', what: bound('seen'), to: { zone: 'battlefield', controller: you }, as: 'moved' }] }] } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'moved', not: true, to: 'battlefield' }, then: [{ op: 'move', what: bound('seen'), to: { zone: 'hand' } }] } as EffectStep,
    ]),
    readings: [
      "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your hand.",
      "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put it onto the battlefield, put it into your hand.",
    ],
    near: [
      "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you put the card onto the battlefield, put it into your hand.",
      "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card into your hand, put it into your hand.",
      "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't, put it into your hand.",
      "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. Otherwise, put it into your hand.",
      // Cloud std-fin's near miss for the same family (one entry: LOOK3's templates are the one reading of these words)
      "Look at the top card of your library. If it's a land card, you may put it onto the battlefield. If you don't put the card onto the battlefield, put it into your graveyard.",
    ],
  },
  // std-dsk (cloud batch 2, zz-cloud/std-dsk.json)
  'counter-kind-choice': {
    def: spell([
      { op: 'chooseValue', who: you, what: 'option', as: 'counterChoice', link: 'counterChoice', options: ['flying', 'lifelink', '+1/+1'] } as EffectStep,
      ...(['flying', 'lifelink', '+1/+1'].map((k) => ({ op: 'if', cond: { cond: 'chosen', link: 'counterChoice', equals: k }, then: [{ op: 'putCounters', on: self, kind: k, count: 1 }] }) as EffectStep)),
    ]),
    ctx: creature,
    readings: [
      'Put a flying, lifelink, or +1/+1 counter on Test Card.',
      'Put your choice of a flying, lifelink, or +1/+1 counter on Test Card.',
      'Put your choice of a flying counter, a lifelink counter, or a +1/+1 counter on Test Card.',
    ],
    near: ['Put a flying, lifelink, and +1/+1 counter on Test Card.', 'Put a flying or lifelink counter on Test Card.', 'Put a flying, lifelink, or +1/+1 counter on each creature you control.'],
  },
  'win-lose-trailing-if': {
    def: spell([draw(1), { op: 'if', cond: { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: you }, op: '>=', right: 15 }, then: [{ op: 'winGame', who: you }] } as EffectStep]),
    readings: ['Draw a card. You win the game if you have fifteen or more cards in hand.', 'Draw a card. If you have fifteen or more cards in hand, you win the game.'],
    near: ['Draw a card. You win the game if you have fourteen or more cards in hand.', 'Draw a card. You lose the game if you have fifteen or more cards in hand.'],
  },
  'unless-control': {
    def: spell([draw(1), { op: 'if', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } } }, then: [{ op: 'discard', who: you, count: 1 }] } as EffectStep]),
    readings: ['Draw a card. Then discard a card unless you control an artifact.', 'Draw a card. If you control no artifacts, discard a card.'],
    near: ['Draw a card. Then discard a card unless you control a creature.', 'Draw a card. Then discard a card if you control an artifact.'],
  },
  // CLOUD C8: what a cost exiled or discarded
  'cost-exiled-noun': {
    def: { kind: 'activated', text: '', cost: { other: [{ kind: 'exileFrom', zone: 'battlefield', filter: { types: ['Creature'], controller: 'you' }, count: 1 }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'costExiled' } } }] } } as unknown as AbilityDef,
    readings: ["Exile a creature you control: You gain life equal to the exiled creature's mana value.", "Exile a creature you control: You gain life equal to the exiled card's mana value."],
    near: ["Exile a creature you control: You gain life equal to the sacrificed creature's mana value.", "Exile a creature you control: You gain life equal to the exiled creature's power."],
  },
  'becomes-x-over-x': {
    def: {
      kind: 'activated', text: '', cost: { other: [{ kind: 'discard', count: 1 }] },
      effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] }, subtypes: { set: ['Cat'] } }, { layer: '7b', power: { q: 'stat', stat: 'manaValue', of: { ref: 'costDiscarded' } }, toughness: { q: 'stat', stat: 'manaValue', of: { ref: 'costDiscarded' } } }] }] }] },
    } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: [
      "Discard a card: ~ becomes an X/X Cat artifact creature until end of turn, where X is the discarded card's mana value.",
      "Discard a card: ~ becomes a Cat artifact creature with base power and base toughness each equal to the discarded card's mana value until end of turn.",
    ],
    near: [
      "Discard a card: ~ becomes an X/X Cat artifact creature until end of turn, where X is the discarded card's power.",
      "Discard a card: ~ becomes an X/X Cat artifact creature, where X is the discarded card's mana value.",
      "Discard a card: ~ becomes an X/X Cat creature until end of turn, where X is the discarded card's mana value.",
    ],
  },
  'discard-number-equal': {
    def: spell([{ op: 'discard', who: { ref: 'each', who: 'opponent' }, count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Rat'], controller: 'you' } } } } as EffectStep]),
    readings: ['Each opponent discards a number of cards equal to the number of Rats you control.', 'Each opponent discards X cards, where X is the number of Rats you control.', 'Each opponent discards cards equal to the number of Rats you control.'],
    near: ['Each opponent discards a number of cards equal to the number of Bats you control.', 'Each opponent mills a number of cards equal to the number of Rats you control.'],
  },
  'stat-of-cost-moved': {
    def: { kind: 'activated', text: '', cost: { other: [{ kind: 'discard', count: 1 }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'costDiscarded' } } }] } } as unknown as AbilityDef,
    readings: ["Discard a card: You gain life equal to the discarded card's mana value.", 'Discard a card: You gain life equal to the mana value of the discarded card.'],
    near: ["Discard a card: You gain life equal to the discarded card's power.", "Discard a card: You gain life equal to the exiled card's mana value.", "Discard a card: You gain life equal to the sacrificed card's mana value."],
  },
  // CLOUD std-misc
  'chosen-that-name': {
    def: spell([
      { op: 'chooseValue', who: you, what: 'cardName', as: 'chosenCardName', link: 'chosenCardName' } as EffectStep,
      { op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'], chosen: { link: 'chosenCardName', quality: 'cardName' } } } } as EffectStep,
    ]),
    readings: ['Choose a card name. Destroy all creatures with that name.', 'Choose a card name. Destroy all creatures with the chosen name.'],
    near: ['Choose a card name. Destroy all creatures with that type.', 'Choose a card name. Destroy all creatures.'],
  },
  'colored-one-or-more': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'cast', player: 'you', spell: { colorless: false } }] }, effect: { targets: [], steps: [draw(1)] } } as AbilityDef,
    ctx: creature,
    readings: ["Whenever you cast a spell that's one or more colors, draw a card.", 'Whenever you cast a colored spell, draw a card.'],
    near: ['Whenever you cast a colorless spell, draw a card.', "Whenever you cast a spell that's two or more colors, draw a card."],
  },
  'colors-of-one-object': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'cast', player: 'you' }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: { q: 'distinct', what: 'colors', among: { ref: 'event', role: 'spell' } } } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ["Whenever you cast a spell, you gain 1 life for each of that spell's colors.", 'Whenever you cast a spell, you gain 1 life for each color among that spell.'],
    near: ["Whenever you cast a spell, you gain 1 life for each of that spell's targets.", "Whenever you cast a spell, you gain 2 life for each of that spell's colors."],
  },
  'different-names-that-have': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { types: ['Land'] }, min: 0, max: 5, differentNames: true, as: 'search' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'exile' } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
    ]),
    readings: ['Search your library for up to five land cards that have different names, exile them, then shuffle.', 'Search your library for up to five land cards with different names, exile them, then shuffle.'],
    near: ['Search your library for up to five land cards, exile them, then shuffle.', 'Search your library for up to five land cards that have different names, put them into your hand, then shuffle.'],
  },
  'token-half-rounded': {
    def: spell([{ op: 'createToken', who: you, count: { q: 'math', op: 'ceilDiv', args: [{ q: 'X' }, 2] }, token: { predefined: 'Food' } } as EffectStep]),
    readings: ['Create half X Food tokens, rounded up.'],
    near: ['Create half X Food tokens, rounded down.', 'Create half X Food tokens.', 'Create X Food tokens.'],
  },
} satisfies Record<string, Example>);

// r3-static: "The tokens have ..." after the creation, two rule changes of you in one sentence
const R3S_SERVO = { colors: [], types: ['Artifact', 'Creature'], subtypes: ['Servo'], power: 1, toughness: 1, abilities: [{ kind: 'static', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block' }] }] };
Object.assign(EXAMPLES, {
  'the-tokens-have': {
    def: spell([{ op: 'createToken', who: you, count: 2, token: R3S_SERVO } as unknown as EffectStep]),
    readings: ['Create two 1/1 colorless Servo artifact creature tokens. The tokens have "This creature can\'t block."', 'Create two 1/1 colorless Servo artifact creature tokens. They have "This creature can\'t block."'],
    near: ['Create two 1/1 colorless Servo artifact creature tokens. The token has "This creature can\'t block."', 'Create two 1/1 colorless Servo artifact creature tokens. The creatures have "This creature can\'t block."'],
  },
  'no-max-hand-no-life-loss': {
    def: statics([{ s: 'rule', rule: 'handSizeNoLimit', player: you }, { s: 'rule', rule: 'noLossForZeroLife' }]),
    readings: ["You have no maximum hand size and don't lose the game for having 0 or less life.", "You have no maximum hand size. You don't lose the game for having 0 or less life."],
    near: ["You have no maximum hand size and can't lose the game.", "You have no maximum hand size and don't lose the game for having 0 or less poison counters."],
  },
} satisfies Record<string, Example>);

// r4-static (Standard round 4): an opponent's life total, a plural name, attacking an opponent, an Adventure before the zone, died under your control, a group's evasion
const R4S_GHOUL = { kind: 'static', text: '', condition: { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, lifeIs: { op: '<=', n: 10 } }, op: '>=', right: 1 }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste' }] }] }] } as unknown as AbilityDef;
const R4S_DIED = { q: 'happenedCount', event: { ev: 'zoneChange', subject: { controller: 'you', types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' } as unknown as Quantity;
const RX24_POISONED = { kind: 'static', text: '', condition: { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, poisonIs: { op: '>=', n: 1 } }, op: '>=', right: 1 }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste' }] }] }] } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  // std-rx24 (CR 122.1f): one or more poison counters is "poisoned"
  'poisoned-one-or-more': {
    def: RX24_POISONED,
    ctx: creature,
    readings: ['Test Card has haste as long as an opponent is poisoned.', 'Test Card has haste as long as an opponent has one or more poison counters.'],
    near: ['Test Card has haste as long as you are poisoned.', 'Test Card has haste as long as an opponent has two or more poison counters.'],
  },
  'opponent-life-or-fewer': {
    def: R4S_GHOUL,
    ctx: creature,
    readings: ['Test Card has haste as long as an opponent has 10 or less life.', 'Test Card has haste as long as an opponent has 10 or fewer life.'],
    near: ['Test Card has haste as long as you have 10 or less life.', 'Test Card has haste as long as an opponent has 10 or more life.'],
  },
  'plural-name-agreement': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you', other: true }, to: 'battlefield' }], [effectStep([{ s: 'continuous', affects: self, mods: [{ layer: '7c', power: 1, toughness: 0 }] }], { d: 'endOfTurn' })]),
    ctx: { selfNames: ['The Test Twins'], selfTypes: ['Creature'] },
    readings: ['Whenever another creature you control enters, The Test Twins get +1/+0 until end of turn.', 'Whenever another creature you control enters, The Test Twins gets +1/+0 until end of turn.'],
    near: ['Whenever another creature you control enters, The Test Twins get +0/+1 until end of turn.', 'Whenever another creature you control enters, The Test Twins get +1/+0 until your next turn.'],
  },
  'attacking-one-of-your-opponents': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], attacking: { defender: 'opponent' } } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'trample' }] }] } as unknown as StaticEffect]),
    ctx: creature,
    readings: ["Each creature that's attacking one of your opponents has trample.", 'Each creature attacking one of your opponents has trample.'],
    near: ["Each creature that's attacking you has trample.", 'Each attacking creature has trample.'],
  },
  'adventure-before-zone': {
    def: spell([{ op: 'move', what: t('t0'), to: { zone: 'hand', owner: you } } as unknown as EffectStep], [objTarget('t0', { zone: 'graveyard', owner: 'you', isCard: true, adventure: true } as never)]),
    readings: ['Return target card that has an Adventure from your graveyard to your hand.', 'Return target card from your graveyard that has an Adventure to your hand.'],
    near: ['Return target card that has an Adventure from your hand to your graveyard.', 'Return target creature card that has an Adventure from your graveyard to your hand.'],
  },
  'died-under-your-control': {
    def: spell([{ op: 'draw', who: you, count: R4S_DIED } as EffectStep]),
    readings: ['Draw a card for each creature that died under your control this turn.', 'Draw a card for each creature you control that died this turn.'],
    near: ['Draw a card for each creature that died this turn.', 'Draw a card for each creature that died under your control last turn.'],
  },
  'shared-subject-group-evasion': {
    def: statics([
      { s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Spider'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] },
      { s: 'restrict', subject: { ref: 'each', filter: { subtypes: ['Spider'], controller: 'you' } }, mode: 'cant', action: 'beBlockedBy', other: { types: ['Creature'], keyword: 'defender' } } as unknown as StaticEffect,
    ]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ["Spiders you control get +1/+1 and can't be blocked by creatures with defender.", "Spiders you control get +1/+1. Spiders you control can't be blocked by creatures with defender."],
    near: ["Spiders you control get +1/+1 and can't block creatures with defender.", "Spiders you control get +1/+1 and can't be blocked by creatures with flying."],
  },
  'static-all-creature-types': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, subtypes: { all: true } }, { layer: '7c', power: 1, toughness: 1 }] } as unknown as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] },
    readings: ['Equipped creature gets +1/+1 and is all creature types.', 'Equipped creature gets +1/+1 and has all creature types.'],
    near: ['Equipped creature gets +1/+1 and is all land types.', 'Equipped creature gets +1/+2 and is all creature types.'],
  },
  'untap-each-or-all': {
    def: statics([{ s: 'rule', rule: 'untapDuringOtherUntapSteps', of: { types: ['Creature'], controller: 'you' } } as unknown as StaticEffect]),
    ctx: creature,
    readings: ["Untap each creature you control during each other player's untap step.", "Untap all creatures you control during each other player's untap step."],
    near: ["Untap each creature you control during your untap step.", "Untap each land you control during each other player's untap step."],
  },
  'other-than-self-subject': {
    def: trig([{ ev: 'attacks', attacker: { self: true } } as EventPattern], [effectStep([{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Dinosaur'], controller: 'you', other: true } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }], { d: 'endOfTurn' })]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature', 'Dinosaur'] },
    readings: ['Whenever Test Card attacks, Dinosaurs you control other than Test Card get +1/+1 until end of turn.', 'Whenever Test Card attacks, other Dinosaurs you control get +1/+1 until end of turn.'],
    near: ['Whenever Test Card attacks, Dinosaurs you control get +1/+1 until end of turn.', 'Whenever Test Card attacks, Dinosaurs your opponents control other than Test Card get +1/+1 until end of turn.'],
  },
} satisfies Record<string, Example>);

// r5-static (Standard round 5): the cost to attack or block, the kind-you-control condition, the "Otherwise" static ability
const r5Attached = { ref: 'attachedTo' } as const;
Object.assign(EXAMPLES, {
  'combat-tax-each': {
    def: statics([{ s: 'rule', rule: 'attackTax', of: { types: ['Creature'] }, cost: { mana: [{ kind: 'generic', amount: 2 }] } } as unknown as StaticEffect]),
    ctx: creature,
    readings: ["Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.", "Creatures can't attack you unless their controller pays {2} for each of those creatures."],
    near: ["Creatures can't attack you unless their controller pays {3} for each of those creatures.", "Creatures can't attack you unless their controller pays {2} for each creature you control."],
  },
  'is-a-kind-you-control': {
    def: t12Static({ cond: 'matches', object: r5Attached, filter: { subtypes: ['Knight'], controller: 'you' } }, [{ s: 'continuous', affects: r5Attached, mods: [{ layer: '7c', power: 1, toughness: 1 }] }]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ["Enchanted creature gets +1/+1 as long as it's a Knight you control."],
    near: ["Enchanted creature gets +1/+1 as long as it's a Knight an opponent controls.", "Enchanted creature gets +1/+1 as long as it's a Wizard you control."],
  },
  'all-activated-abilities-of': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, addActivatedOf: { ref: 'each', filter: { subtypes: ['Goblin'], controller: 'you' } } }] } as unknown as StaticEffect]),
    ctx: creature,
    readings: ['Test Card has all activated abilities of Goblins you control.', 'Test Card has all activated abilities of all Goblins you control.', 'Test Card has all activated abilities of each Goblin you control.'],
    near: ['Test Card has all triggered abilities of Goblins you control.', 'Test Card has all activated abilities of Goblins your opponents control.'],
  },
  'otherwise-it': {
    def: { kind: 'static', text: '', condition: { cond: 'turnOf', whose: 'you' }, effects: [{ s: 'continuous', affects: r5Attached, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flying' }] }] }], otherwise: [{ s: 'continuous', affects: r5Attached, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'reach' }] }] }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['Equipped creature has flying during your turn. Otherwise, it has reach.', 'Equipped creature has flying during your turn. Otherwise, equipped creature has reach.'],
    near: ['Equipped creature has flying during your turn. Otherwise, it has flying.', 'Equipped creature has flying during your turn. Then, it has reach.'],
  },
} satisfies Record<string, Example>);

// CLOUD std-tmt: "add that much {R}", a plural name's damage trigger, "one or more of your opponents are attacked", "It enters tapped and attacking that player."
const TMT_DEALT: EventPattern = { ev: 'damage', recipient: { object: { self: true } } };
const TMT_COMBAT: EventPattern = { ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } };
Object.assign(EXAMPLES, {
  'mana-that-much': {
    def: trig([TMT_DEALT], [{ op: 'addMana', who: you, dynamic: { kind: 'ofType', type: 'R', count: { q: 'eventAmount' } } } as EffectStep]),
    ctx: creature,
    readings: ['Whenever Test Card is dealt damage, add that much {R}.', 'Whenever Test Card is dealt damage, add an amount of {R} equal to that much.'],
    near: ['Whenever Test Card is dealt damage, add that much {G}.', 'Whenever Test Card is dealt damage, add that much {R}{R}.', 'Whenever Test Card is dealt damage, add {R}.'],
  },
  'plural-name-deals-damage': {
    def: trig([TMT_COMBAT], [draw()]),
    ctx: creature,
    readings: ['Whenever Test Card deals combat damage to a player, draw a card.', 'Whenever Test Card deal combat damage to a player, draw a card.'],
    near: ['Whenever Test Card deals damage to a player, draw a card.', 'Whenever Test Card deal combat damage to a creature, draw a card.'],
  },
  'opponents-are-attacked': {
    def: trig([{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'opponent' }], [draw()], { batch: true, wholeBatch: true }),
    ctx: creature,
    readings: ['Whenever one or more of your opponents are attacked, draw a card.'],
    // Standard merge wave 3: "one or more creatures attack an opponent" triggers once for each opponent attacked (std-tla), so it is a near miss now (CR 603.2c)
    near: ['Whenever one or more creatures attack an opponent, draw a card.', 'Whenever one or more of your opponents attack, draw a card.', 'Whenever you are attacked, draw a card.', 'Whenever one or more creatures attack you, draw a card.'],
  },
  'linked-exiled-it': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 2 }], other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }, effect: { targets: [], steps: [
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: { ref: 'linked', link: 'exiled' }, zone: 'any', isCard: true, anyOf: [{ types: ['Creature'] }] } }, min: 1, max: 1, as: 'r' } as EffectStep,
      { op: 'move', what: bound('r'), to: { zone: 'battlefield', controller: you } } as EffectStep,
      { op: 'move', what: { ref: 'each', filter: { is: { ref: 'linked', link: 'exiled' }, zone: 'any', not: { is: bound('r') } } }, to: { zone: 'hand' } } as EffectStep,
    ] } } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Land'] },
    readings: [
      "{2}, Sacrifice Test Card: Return a creature card exiled with Test Card to the battlefield under your control. Return each other card exiled with Test Card to its owner's hand.",
      "{2}, Sacrifice Test Card: Return a creature card exiled with it to the battlefield under your control. Return each other card exiled with it to its owner's hand.",
    ],
    near: [
      "{2}, Sacrifice Test Card: Return a creature card exiled with Test Card to the battlefield under your control. Return each other card exiled with Test Card to your hand.",
      "{2}, Sacrifice Test Card: Return an artifact card exiled with Test Card to the battlefield under your control. Return each other card exiled with Test Card to its owner's hand.",
      "{2}, Sacrifice Test Card: Return a creature card exiled with Test Card to the battlefield under your control.",
    ],
  },
  'enters-attacking-rider': {
    def: trig([TMT_COMBAT], [{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you, tapped: true, attacking: { defender: { ref: 'event', role: 'recipient' } } } } as EffectStep], {}, [objTarget('c', { types: ['Creature'], zone: 'graveyard', isCard: true })]),
    ctx: creature,
    readings: [
      'Whenever Test Card deals combat damage to a player, put target creature card from a graveyard onto the battlefield under your control. It enters tapped and attacking that player.',
      'Whenever Test Card deals combat damage to a player, put target creature card from a graveyard onto the battlefield tapped and attacking that player under your control.',
    ],
    near: [
      'Whenever Test Card deals combat damage to a player, put target creature card from a graveyard onto the battlefield under your control. It enters tapped.',
      'Whenever Test Card deals combat damage to a player, put target creature card from a graveyard onto the battlefield under your control. It enters tapped and attacking.',
      'Whenever Test Card deals combat damage to a player, put target creature card from a graveyard onto the battlefield under your control.',
    ],
  },
  // Cloud std-eoe
  'choose-targets-first': {
    def: trig([{ ev: 'attacks', attacker: { self: true } } as EventPattern], [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flying', text: 'flying' }] }] }] } as EffectStep], {}, [objTarget('c', { types: ['Creature'] }, { min: 0, max: 1 })]),
    ctx: creature,
    readings: [
      'Whenever Test Card attacks, up to one target creature gains flying until end of turn.',
      'Whenever Test Card attacks, choose up to one target creature. That creature gains flying until end of turn.',
      'Whenever Test Card attacks, choose up to one target creature. It gains flying until end of turn.',
    ],
    near: ['Whenever Test Card attacks, choose up to one target creature. That creature gains trample until end of turn.', 'Whenever Test Card attacks, choose target creature. That creature gains flying until end of turn.'],
  },
  'pump-pair-where-x-duration': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [
      { s: 'continuous', affects: t('a'), mods: [{ layer: '7c', power: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } }, toughness: 0 }] },
      { s: 'continuous', affects: t('b'), mods: [{ layer: '7c', power: 0, toughness: { q: 'math', op: '*', args: [-1, { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } }] } }] },
    ] } as EffectStep], [objTarget('a', { types: ['Creature'], controller: 'you' }), objTarget('b', { types: ['Creature'], controller: 'opponent' })]),
    readings: [
      'Until end of turn, target creature you control gets +X/+0 and target creature an opponent controls gets -0/-X, where X is the number of artifacts you control.',
      'Target creature you control gets +X/+0 until end of turn and target creature an opponent controls gets -0/-X until end of turn, where X is the number of artifacts you control.',
    ],
    near: ['Until end of turn, target creature you control gets +X/+0 and target creature an opponent controls gets -X/-0, where X is the number of artifacts you control.', 'Until end of turn, target creature you control gets +X/+0 and target creature an opponent controls gets -0/-X, where X is the number of creatures you control.'],
  },
  'unless-pays-if-they-do': {
    def: spell([{ op: 'pay', who: { ref: 'controllerOf', object: t('s') }, cost: { mana: [{ kind: 'generic', amount: 2 }] }, else: [{ op: 'counter', what: t('s') }], then: [{ op: 'surveil', who: you, count: 2 }] } as EffectStep], [{ id: 's', kind: 'spell', min: 1, max: 1, text: '' }]),
    readings: ['Counter target spell unless its controller pays {2}. If they do, surveil 2.', "Target spell's controller may pay {2}. If that player does, you surveil 2. If that player doesn't, counter it."],
    near: ['Counter target spell unless its controller pays {2}. If they do, scry 2.', "Counter target spell unless its controller pays {2}. If they don't, surveil 2."],
  },
  'control-then-entering-state': {
    def: trig([{ ev: 'attacks', attacker: { self: true } } as EventPattern], [{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you, tapped: true, attacking: true } } as EffectStep], {}, [objTarget('c', { types: ['Creature'], zone: 'graveyard', owner: 'opponent', isCard: true })]),
    ctx: creature,
    readings: [
      "Whenever Test Card attacks, put target creature card from an opponent's graveyard onto the battlefield under your control tapped and attacking.",
      "Whenever Test Card attacks, put target creature card from an opponent's graveyard onto the battlefield tapped and attacking under your control.",
    ],
    near: ["Whenever Test Card attacks, put target creature card from an opponent's graveyard onto the battlefield under your control tapped.", "Whenever Test Card attacks, put target creature card from an opponent's graveyard onto the battlefield under your control attacking and tapped."],
  },
  'cant-be-blocked-then-pt': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7b', power: 1, toughness: 1 }] }, { s: 'restrict', subject: t('c'), mode: 'cant', action: 'beBlocked' }] } as EffectStep], [objTarget('c')]),
    readings: ["Target creature can't be blocked this turn and has base power and toughness 1/1 until end of turn.", "Target creature has base power and toughness 1/1 until end of turn and can't be blocked this turn."],
    near: ["Target creature can't block this turn and has base power and toughness 1/1 until end of turn.", "Target creature can't be blocked this turn and has base power and toughness 1/2 until end of turn."],
  },
  // cloud r3-mech (CR 702.143a, 607.2i)
  'was-foretold': {
    def: spell([draw(1), { op: 'if', cond: { cond: 'wasCast', via: 'foretell' }, then: [{ op: 'gainLife', who: you, amount: 2 }] } as EffectStep]),
    readings: ['Draw a card. If Test Card was foretold, you gain 2 life.', 'Draw a card. If this spell was foretold, you gain 2 life.'],
    near: ['Draw a card. If Test Card was kicked, you gain 2 life.', 'Draw a card. If Test Card was bargained, you gain 2 life.'],
  },
  // cloud r4-mech (CR 500.8)
  'extra-combat-then-main': {
    def: spell([{ op: 'extraPhase', phase: 'combat', followedBy: 'main' } as EffectStep]),
    readings: ['There is an additional combat phase after this phase followed by an additional main phase.', 'After this phase, there is an additional combat phase followed by an additional main phase.'],
    near: ['After this phase, there is an additional combat phase followed by an additional end step.', 'After this phase, there is an additional main phase followed by an additional combat phase.'],
  },
  // cmd1 (commander batch)
  'no-opponent-more-life': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] }, interveningIf: { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, lifeVs: { op: '>', than: { ref: 'you' } } }, op: '==', right: 0 }, effect: { targets: [], steps: [draw()] } } as AbilityDef,
    readings: ['At the beginning of your upkeep, if no opponent has more life than you, draw a card.', 'At the beginning of your upkeep, if you have the most life or are tied for most life, draw a card.'],
    near: ['At the beginning of your upkeep, if no opponent has less life than you, draw a card.', 'At the beginning of your upkeep, if you have the most life, draw a card.'],
  },
  'sacrifice-either-article': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'sacrifice', filter: { anyOf: [{ types: ['Creature'], other: true }, { types: ['Artifact'] }] }, count: 1 }] }, effect: { targets: [], steps: [draw()] } } as AbilityDef,
    ctx: creature,
    readings: ['{1}, Sacrifice another creature or an artifact: Draw a card.', '{1}, Sacrifice another creature or artifact: Draw a card.'],
    near: ['{1}, Sacrifice a creature or an artifact: Draw a card.', '{1}, Sacrifice another creature or an enchantment: Draw a card.'],
  },
  'quoted-dash-keyword-grant': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 6, add: [
      { kind: 'keyword', keyword: 'flying', text: 'flying' },
      { kind: 'keyword', keyword: 'deathtouch', text: 'deathtouch' },
      { kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'payLife', amount: 2 }] }, text: 'Ward--Pay 2 life.' },
      { kind: 'triggered', text: 'At the beginning of your upkeep, draw a card.', trigger: { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } },
    ] as never }] }]),
    readings: [
      'Creatures you control have flying, deathtouch, "Ward—Pay 2 life," and "At the beginning of your upkeep, draw a card."',
      'Creatures you control have flying and deathtouch, "Ward—Pay 2 life," and "At the beginning of your upkeep, draw a card."',
    ],
    near: [
      'Creatures you control have flying, deathtouch, "Ward—Pay 3 life," and "At the beginning of your upkeep, draw a card."',
      'Creatures you control have flying, deathtouch, ward—pay 2 life, and "At the beginning of your upkeep, draw a card."',
    ],
  },
  'enters-additional-counter': {
    def: statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you', other: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 1 }] } } as StaticEffect]),
    ctx: creature,
    readings: ['Other creatures you control enter with an additional +1/+1 counter on them.', 'Other creatures you control enter with a +1/+1 counter on them.'],
    near: ['Other creatures you control enter with two additional +1/+1 counters on them.', 'Other creatures you control enter with an additional -1/-1 counter on them.'],
  },
} satisfies Record<string, Example>);

// FAST5 T64: the copy wordings
const T64_ENTERS = { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' } as const;
const t64Replace = (copy: Record<string, unknown>): AbilityDef => ({ kind: 'static', text: '', zone: ['stack', 'battlefield'], effects: [{ s: 'replace', replaces: T64_ENTERS, body: { b: 'enters', copy } }] }) as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'copy-keeps-name': {
    def: t64Replace({ of: { types: ['Creature'], controller: 'you' }, optional: true, except: [{ retain: ['name'] }] }),
    ctx: creature,
    readings: ['You may have Test Card enter as a copy of a creature you control, except its name is Test Card.', 'You may have Test Card enter as a copy of a creature you control, except his name is Test Card.', 'You may have Test Card enter as a copy of a creature you control, except her name is Test Card.'],
    near: ['You may have Test Card enter as a copy of a creature you control, except its name is Bob.', 'You may have Test Card enter as a copy of a creature you control, except its name is Test Card and it has flying.'],
  },
  'copy-other-creature-types': {
    def: spell([{ op: 'copy', what: t('c'), result: 'token', who: you, except: [{ layer: 4, subtypes: { add: ['Spirit'] } }] } as EffectStep], [objTarget('c')]),
    readings: ["Create a token that's a copy of target creature, except it's a Spirit in addition to its other types.", "Create a token that's a copy of target creature, except it's a Spirit in addition to its other creature types."],
    near: ["Create a token that's a copy of target creature, except it's a Spirit.", "Create a token that's a copy of target creature, except it's a Spirit in addition to its other land types."],
  },
  'second-target': {
    def: spell([effectStep([{ s: 'continuous', affects: t('a'), mods: [{ layer: '1a', copyOf: t('b') }] }], { d: 'endOfTurn' })], [objTarget('a', { types: ['Artifact'], controller: 'you' }), objTarget('b', { types: ['Artifact'], controller: 'you' })]),
    readings: ['Target artifact you control becomes a copy of a second target artifact you control until end of turn.', 'Target artifact you control becomes a copy of target artifact you control until end of turn.'],
    near: ['Target artifact you control becomes a copy of a third target artifact you control until end of turn.', 'Target artifact you control becomes a copy of another target artifact you control until end of turn.'],
  },
  'plural-name-verb': {
    def: trig([enters], [draw()], { interveningIf: { cond: 'wasCast', by: 'you' } }),
    ctx: creature,
    readings: ['When Test Card enters, if you cast it, draw a card.', 'When Test Card enter, if you cast Test Card, draw a card.'],
    near: ['When Test Card enters, if you cast it from your hand, draw a card.', 'When Test Card enters, if you cast a spell, draw a card.'],
  },
  'copy-zone-words': {
    def: t64Replace({ of: { types: ['Creature'], zone: 'battlefield', manaValue: { op: '<=', value: { q: 'manaSpent' } } }, optional: true }),
    ctx: creature,
    readings: ['You may have Test Card enter as a copy of any creature on the battlefield with mana value less than or equal to the amount of mana spent to cast Test Card.', 'You may have Test Card enter as a copy of any creature with mana value less than or equal to the amount of mana spent to cast Test Card on the battlefield.'],
    near: ['You may have Test Card enter as a copy of any creature in a graveyard with mana value less than or equal to the amount of mana spent to cast Test Card.', 'You may have Test Card enter as a copy of any creature on the battlefield with mana value less than the amount of mana spent to cast Test Card.'],
  },
  'tapped-copy-token': {
    def: spell([{ op: 'copy', what: t('c'), result: 'token', who: you, tapped: true } as EffectStep], [objTarget('c')]),
    readings: ["Create a tapped token that's a copy of target creature.", "Create a token that's a copy of target creature tapped."],
    near: ["Create an untapped token that's a copy of target creature.", "Create a tapped token that's a copy of target creature, attacking."],
  },
  'type-list-commas': {
    def: spell([{ op: 'destroy', what: t('c') } as EffectStep], [objTarget('c', { anyOf: [{ types: ['Artifact'] }, { types: ['Enchantment'], notSubtypes: ['Aura'] }, { types: ['Land'] }] })]),
    readings: ['Destroy target artifact, non-Aura enchantment, or land.', 'Destroy target artifact or non-Aura enchantment or land.'],
    near: ['Destroy target artifact, non-Aura enchantment, and land.', 'Destroy target artifact, enchantment, or land.'],
  },
} satisfies Record<string, Example>);

// FAST5X E29: impulse-draw permissions (CR 611.2b, 609.4b)
const E29_EXILE = { op: 'move', what: { ref: 'topCards', player: you, count: 1 }, to: { zone: 'exile' }, as: 'x' } as EffectStep;
const e29Permit = (duration: unknown, extra: Record<string, unknown> = {}): EffectStep =>
  ({ op: 'effect', duration, effects: [{ s: 'permit', who: you, action: 'cast', of: { is: bound('x') }, ...extra }] } as unknown as EffectStep);
Object.assign(EXAMPLES, {
  'remains-exiled-pronoun': {
    def: spell([E29_EXILE, e29Permit({ d: 'remainsExiled' })]),
    readings: ['Exile the top card of your library. You may cast that card for as long as it remains exiled.', 'Exile the top card of your library. For as long as that card remains exiled, you may cast it.'],
    near: ['Exile the top card of your library. You may cast that card for as long as it remains in your graveyard.', 'Exile the top card of your library. You may cast that card for as long as it remains tapped.'],
  },
  'any-type-rider-pronoun': {
    def: spell([E29_EXILE, e29Permit({ d: 'endOfTurn' }, { anyManaType: true })]),
    readings: ['Exile the top card of your library. You may cast that card this turn, and mana of any type can be spent to cast it.', 'Exile the top card of your library. You may cast that card this turn, and mana of any type can be spent to cast that spell.'],
    near: ['Exile the top card of your library. You may cast that card this turn, and mana of any color can be spent to cast it.', 'Exile the top card of your library. You may cast that card this turn.'],
  },
  // FAST5 T70: a statistic of what a cost sacrificed, and counters for every N cards in the graveyard
  'stat-of-sacrificed': {
    def: { kind: 'activated', text: '', cost: { other: [{ kind: 'sacrifice', filter: { types: ['Artifact'] }, count: 1 }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'costSacrificed' } } }] } } as unknown as AbilityDef,
    readings: ["Sacrifice an artifact: You gain life equal to the sacrificed artifact's mana value.", 'Sacrifice an artifact: You gain life equal to the mana value of the sacrificed artifact.'],
    near: ["Sacrifice an artifact: You gain life equal to the sacrificed artifact's power.", 'Sacrifice an artifact: You gain life equal to the power of the sacrificed artifact.', "Sacrifice an artifact: You gain life equal to the sacrificed creature's mana value."],
  },
  'counters-per-cards': {
    def: spell([
      { op: 'createToken', who: you, count: 2, token: { colors: ['W'], types: ['Creature'], subtypes: ['Spirit'], power: 1, toughness: 1 }, as: 'g' },
      { op: 'putCounters', on: bound('g'), kind: '+1/+1', count: { q: 'math', op: 'floorDiv', args: [{ q: 'zoneSize', zone: 'graveyard', of: you }, 3] } },
    ]),
    readings: [
      'Create two 1/1 white Spirit creature tokens. Put a +1/+1 counter on each of them for every three cards in your graveyard.',
      'Create two 1/1 white Spirit creature tokens. Put a +1/+1 counter on them for every three cards in your graveyard.',
    ],
    near: [
      'Create two 1/1 white Spirit creature tokens. Put a +1/+1 counter on each of them for every two cards in your graveyard.',
      "Create two 1/1 white Spirit creature tokens. Put a +1/+1 counter on each of them for every three cards in an opponent's graveyard.",
      'Create two 1/1 white Spirit creature tokens. Put a +1/+1 counter on each of them for each card in your graveyard.',
    ],
  },
  // FAST5 T69
  'type-set-loses-others': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: 'owner' }, as: 'm' } as EffectStep, { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: bound('m'), mods: [
      { layer: 4, types: { set: ['Artifact'] }, subtypes: { set: ['Treasure'] } },
      { layer: 6, add: [{ kind: 'activated', text: '', cost: { tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, units: [['W', 'U', 'B', 'R', 'G']] }] } } as AbilityDef] },
    ] }] } as EffectStep], [objTarget('c', { zone: 'graveyard', isCard: true })]),
    readings: [
      "Return target card from a graveyard to the battlefield under its owner's control. It becomes a Treasure artifact and gains \"{T}, Sacrifice this artifact: Add one mana of any color.\"",
      "Return target card from a graveyard to the battlefield under its owner's control. It's a Treasure artifact with \"{T}, Sacrifice this artifact: Add one mana of any color,\" and it loses all other card types.",
    ],
    near: [
      "Return target card from a graveyard to the battlefield under its owner's control. It's a Treasure artifact with \"{T}, Sacrifice this artifact: Add one mana of any color,\" and it loses all other abilities.",
      "Return target card from a graveyard to the battlefield under its owner's control. It's a Treasure artifact with \"{T}, Sacrifice this artifact: Add one mana of any color,\" and it keeps all other card types.",
    ],
  },
  'replace-duration-leads': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'damage' }, body: { b: 'modify', amount: { mul: 2 } } }] } as EffectStep]),
    readings: [
      'If a source would deal damage to a permanent or player this turn, it deals double that damage instead.',
      'This turn, if a source would deal damage to a permanent or player, it deals double that damage instead.',
    ],
    near: [
      'If a source would deal damage to a permanent or player this turn, it deals triple that damage instead.',
      'Until your next turn, if a source would deal damage to a permanent or player, it deals double that damage instead.',
    ],
  },
  // FAST5 T74
  'search-that-many': {
    def: spell([
      { op: 'move', what: { ref: 'each', filter: { attacking: true, types: ['Creature'], controller: t('p') } }, to: { zone: 'exile' }, as: 'x' } as EffectStep,
      { op: 'search', who: t('p'), zone: 'library', filter: { types: ['Land'], supertypes: ['Basic'] }, min: 0, max: { q: 'resultCount', step: 'x' }, as: 's' } as EffectStep,
    ], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '', players: { who: 'any' } }]),
    readings: [
      'Exile all attacking creatures target player controls. That player searches their library for that many basic land cards.',
    ],
    near: [
      'Exile all attacking creatures target player controls. That player searches their library for that many land cards.',
      'Exile all attacking creatures target player controls. That player searches their library for two basic land cards.',
    ],
  },

  // FAST5 T77
  'type-add-is': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: 'owner' }, as: 'm' } as EffectStep, { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: bound('m'), mods: [
      { layer: 4, subtypes: { add: ['Demon'] } },
    ] }] } as EffectStep], [objTarget('c', { zone: 'graveyard', isCard: true })]),
    readings: [
      "Return target card from a graveyard to the battlefield under its owner's control. It becomes a Demon in addition to its other types.",
      "Return target card from a graveyard to the battlefield under its owner's control. It's a Demon in addition to its other types.",
    ],
    near: [
      "Return target card from a graveyard to the battlefield under its owner's control. It's a Demon in addition to its other types until end of turn.",
      "Return target card from a graveyard to the battlefield under its owner's control. It's a Zombie in addition to its other types.",
    ],
  },
  'all-colors-word': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 5, colors: { set: ['W', 'U', 'B', 'R', 'G'] } }] } as StaticEffect]),
    readings: ['Each creature you control is all colors.', 'Each creature you control is white, blue, black, red, and green.'],
    near: ['Each creature you control is all colors until end of turn.', 'Each creature you control is white, blue, black, and red.', 'Each creature you control is colorless.'],
  },
  // CLOUD C2
  'players-no-max-hand': {
    def: statics([{ s: 'rule', rule: 'handSizeNoLimit', player: { ref: 'each', who: 'player' } } as StaticEffect]),
    readings: ['Players have no maximum hand size.', 'Each player has no maximum hand size.'],
    near: ['Opponents have no maximum hand size.', 'Each opponent has no maximum hand size.', 'You have no maximum hand size.'],
  },
  'hand-size-rest-of-game': {
    def: spell([draw(), { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'rule', rule: 'handSizeNoLimit', player: { ref: 'you' } }] } as EffectStep]),
    readings: ['Draw a card. You have no maximum hand size for the rest of the game.', 'Draw a card. You have no maximum hand size.'],
    near: ['Draw a card. You have no maximum hand size until end of turn.', 'Draw a card. You have no maximum hand size for the rest of the turn.'],
  },
  // Cloud C3
  'tap-and-freeze-it': {
    def: trig([{ ev: 'blocks', blocker: { self: true }, attacker: { types: ['Creature'] } } as EventPattern], [
      { op: 'tap', what: { ref: 'event', role: 'attacker' } } as EffectStep,
      effectStep([{ s: 'restrict', subject: { ref: 'event', role: 'attacker' }, mode: 'cant', action: 'untapDuringUntapStep' } as StaticEffect], { d: 'throughNextUntap' }),
    ]),
    readings: [
      "Whenever Test Card blocks a creature, tap that creature and it doesn't untap during its controller's next untap step.",
      "Whenever Test Card blocks a creature, tap that creature. That creature doesn't untap during its controller's next untap step.",
    ],
    near: [
      "Whenever Test Card blocks a creature, tap that creature and it doesn't untap during its controller's untap step.",
      "Whenever Test Card blocks a creature, tap that creature and it doesn't untap during your next untap step.",
      "Whenever Test Card blocks a creature, untap that creature and it doesn't untap during its controller's next untap step.",
    ],
  },
  'that-are-subtypes': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you', anyOf: [{ subtypes: ['Wolf'] }, { subtypes: ['Werewolf'] }] } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] } as StaticEffect]),
    readings: ['Wolf or Werewolf creatures you control get +1/+1.', 'Creatures you control that are Wolves or Werewolves get +1/+1.'],
    near: ['Creatures you control that are Wolves and Werewolves get +1/+1.', 'Creatures you control that are Wolves or Elves get +1/+1.', 'Creatures you control that are Wolves get +1/+1.'],
  },
  // CLOUD C4
  'other-than-target': {
    def: spell([
      { op: 'destroy', what: t('c') } as EffectStep,
      { op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'], not: { is: t('c') } } } } as EffectStep,
    ], [objTarget('c')]),
    readings: ['Destroy target creature. Destroy all other creatures.', 'Destroy target creature. Destroy all creatures other than that creature.'],
    near: ['Destroy target creature. Destroy all creatures.', 'Destroy target creature. Destroy all other artifacts.'],
  },
  // CLOUD C5
  'choice-sentence': {
    def: spell([
      { op: 'chooseValue', who: { ref: 'you' }, what: 'creatureType', as: 'ct', link: 'ct' } as EffectStep,
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], chosen: { link: 'ct', quality: 'creatureType' } } }, mods: [{ layer: '7c', power: 2, toughness: 2 }] }] } as EffectStep,
    ]),
    readings: ['Creatures of the creature type of your choice get +2/+2 until end of turn.', 'Choose a creature type. Creatures of the chosen type get +2/+2 until end of turn.'],
    near: ['Choose a creature type. Creatures of the chosen type get +2/+2.', 'Choose a color. Creatures of the chosen color get +2/+2 until end of turn.', 'Choose a creature type. Creatures of the chosen type get +1/+1 until end of turn.'],
  },
  'chosen-type-words': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent', chosen: { link: 'type', quality: 'creatureType' } } }, mods: [{ layer: '7c', power: -1, toughness: -1 }] } as StaticEffect]),
    readings: ['Creatures your opponents control of the chosen type get -1/-1.', 'Creatures of the chosen type your opponents control get -1/-1.'],
    near: ['Creatures you control of the chosen type get -1/-1.', 'Creatures your opponents control of the chosen color get -1/-1.', 'Creatures of the chosen type get -1/-1.'],
  },
  'chosen-spells-you-cast': {
    def: statics([{ s: 'costMod', applies: { spells: { stackKind: 'spell', chosen: { link: 'cardType', quality: 'cardType' } }, caster: 'you' }, change: { kind: 'reduce', generic: 1, floor: 'zero' } } as StaticEffect]),
    readings: ['Spells you cast of the chosen type cost {1} less to cast.', 'Spells of the chosen type you cast cost {1} less to cast.'],
    near: ['Spells you cast of the chosen type cost {1} more to cast.', 'Spells your opponents cast of the chosen type cost {1} less to cast.', 'Spells you cast of the chosen color cost {1} less to cast.'],
  },
} satisfies Record<string, Example>);

// Cloud std-fin: the readings of zz-cloud/std-fin.json and its renderer readings
Object.assign(EXAMPLES, {
  // CR 603.2, 603.2c: Giott, King of the Dwarves
  'and-whenever-enters': {
    def: trig([enters, { ev: 'zoneChange', subject: { subtypes: ['Equipment'], controller: 'you' }, to: 'battlefield' }], [draw()]),
    ctx: creature,
    readings: ['Whenever this creature enters and whenever an Equipment you control enters, draw a card.', 'Whenever this creature or an Equipment you control enters, draw a card.'],
    near: ['Whenever this creature enters and whenever an Aura you control enters, draw a card.', 'Whenever this creature enters and whenever an Equipment you control dies, draw a card.'],
  },
  // CR 608.2c, 608.2h: Mastermind Plum, Feral Appetite
  'exiled-this-way-tense': {
    def: spell([
      { op: 'move', what: t('c'), to: { zone: 'exile' }, as: 'd' } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'd', which: { types: ['Creature'], isCard: true }, to: 'exile' }, then: [draw()] } as EffectStep,
    ], [objTarget('c', { zone: 'graveyard', isCard: true })]),
    readings: ['Exile target card from a graveyard. If a creature card was exiled this way, draw a card.', 'Exile target card from a graveyard. If a creature card is exiled this way, draw a card.'],
    near: ['Exile target card from a graveyard. If an artifact card was exiled this way, draw a card.', 'Exile target card from a graveyard. If a creature card was destroyed this way, draw a card.'],
  },
  // CR 701.8a, 608.2d: Light of Judgment
  'destroy-up-to-chosen': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { subtypes: ['Equipment'], attachedToObject: t('c') } }, min: 0, max: 1, as: 'x' } as EffectStep,
      { op: 'destroy', what: bound('x') } as EffectStep,
    ], [objTarget('c')]),
    readings: ['Destroy up to one Equipment attached to target creature.', 'Choose up to one Equipment attached to target creature. Destroy that Equipment.'],
    near: ['Destroy up to two Equipment attached to target creature.', 'Destroy up to one Aura attached to target creature.', 'Destroy an Equipment attached to target creature.'],
  },
  // CR 701.3a, 608.2d: Beatrix, Loyal General; Unexpected Request
  'attach-chosen': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { subtypes: ['Equipment'], controller: 'you' } }, min: 0, max: 'any', as: 'a' } as EffectStep,
      { op: 'attach', what: bound('a'), to: t('c') } as EffectStep,
    ], [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    readings: ['Attach any number of Equipment you control to target creature you control.', 'Choose any number of Equipment you control. Attach them to target creature you control.'],
    near: ['Attach any number of Auras you control to target creature you control.', 'Attach up to one Equipment you control to target creature you control.', 'Attach an Equipment you control to target creature you control.'],
  },
  // std-rx32 (CR 613.4b, 604.3a): Ms. Marvel, Kamala Khan's quoted ability
  'static-base-power-is': {
    def: statics([{ s: 'continuous', affects: self, mods: [{ layer: '7b', power: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } } }] } as StaticEffect]),
    readings: ["~'s base power is equal to the number of artifacts you control.", '~ has base power equal to the number of artifacts you control.'],
    near: ["~'s base toughness is equal to the number of artifacts you control.", "~'s power is equal to the number of artifacts you control.", "~'s base power is equal to the number of creatures you control."],
  },
  // CR 613.4b, 611.2a: PuPu UFO
  'base-power-becomes': {
    def: spell([effectStep([{ s: 'continuous', affects: t('c'), mods: [{ layer: '7b', power: 4 }] } as StaticEffect], { d: 'endOfTurn' })], [objTarget('c')]),
    readings: ["Until end of turn, target creature's base power becomes 4.", "Target creature's base power becomes 4 until end of turn.", 'Target creature has base power 4 until end of turn.'],
    near: ["Until end of turn, target creature's base power becomes 5.", "Until end of turn, target creature's base toughness becomes 4.", "Target creature's power becomes 4 until end of turn."],
  },
} satisfies Record<string, Example>);

// std-tdm (cloud batch 2, zz-cloud/std-tdm.json): the readings of its ten reviewed families
const TDM_LANDS: Quantity = { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } };
const TDM_SEARCH: EffectStep = { op: 'search', who: you, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, max: 1, reveal: true, as: 'search' } as EffectStep;
const TDM_DRAGON = { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Dragon'], controller: 'you' } } };
Object.assign(EXAMPLES, {
  'three-counter-kinds': {
    def: spell([
      { op: 'putCounters', on: t('c'), kind: '+1/+1', count: 1 } as EffectStep,
      { op: 'putCounters', on: t('c'), kind: 'reach', count: 1 } as EffectStep,
      { op: 'putCounters', on: t('c'), kind: 'deathtouch', count: 1 } as EffectStep,
    ], [objTarget('c')]),
    readings: ['Put a +1/+1 counter, a reach counter, and a deathtouch counter on target creature.', 'Put a +1/+1 counter and a reach counter on target creature. Put a deathtouch counter on it.'],
    near: ['Put a +1/+1 counter, a reach counter, or a deathtouch counter on target creature.', 'Put a +1/+1 counter, a reach counter, and a lifelink counter on target creature.'],
  },
  'shuffle-top-instead': {
    def: spell([TDM_SEARCH, { op: 'shuffle', who: you } as EffectStep, {
      op: 'if', cond: TDM_DRAGON,
      then: [{ op: 'move', what: bound('search'), to: { zone: 'battlefield', controller: you, tapped: true } }],
      else: [{ op: 'move', what: bound('search'), to: { zone: 'library', position: 'top' } }],
    } as EffectStep]),
    readings: ['Search your library for a basic land card, reveal it, then shuffle and put that card on top. If you control a Dragon, put that card onto the battlefield tapped instead.'],
    near: [
      'Search your library for a basic land card, reveal it, then shuffle and put that card on top. If you control a Dragon, put that card onto the battlefield instead.',
      'Search your library for a basic land card, reveal it, then shuffle and put that card on top. If you control a Goblin, put that card onto the battlefield tapped instead.',
    ],
  },
  'counters-on-it-once': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you, counters: [{ kind: 'hexproof', count: 1 }, { kind: 'indestructible', count: 1 }] } } as EffectStep], [objTarget('c', { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true })]),
    readings: [
      'Return target creature card from your graveyard to the battlefield with a hexproof counter and an indestructible counter on it.',
      'Return target creature card from your graveyard to the battlefield with a hexproof counter on it and an indestructible counter on it.',
    ],
    near: [
      'Return target creature card from your graveyard to the battlefield with a hexproof counter or an indestructible counter on it.',
      'Return target creature card from your graveyard to the battlefield with a hexproof counter and a shield counter on it.',
    ],
  },
  'cast-spell-or-spell': {
    def: trig([{ ev: 'cast', player: 'you', spell: { anyOf: [{ notTypes: ['Creature'] }, { subtypes: ['Dragon'] }] } } as EventPattern], [draw()]),
    readings: ['Whenever you cast a noncreature spell or a Dragon spell, draw a card.', 'Whenever you cast a noncreature or Dragon spell, draw a card.'],
    near: ['Whenever you cast a noncreature spell or a Goblin spell, draw a card.', 'Whenever you cast a noncreature spell and a Dragon spell, draw a card.'],
  },
  'destroyed-this-way-noun': {
    def: spell([{ op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'] } }, as: 'd' } as EffectStep, { op: 'draw', who: you, count: { q: 'resultCount', step: 'd' } } as EffectStep]),
    readings: ['Destroy all creatures. Draw a card for each creature destroyed this way.', 'Destroy all creatures. Draw a card for each permanent destroyed this way.'],
    near: ['Destroy all creatures. Draw a card for each artifact destroyed this way.', 'Destroy all creatures. Draw a card for each creature exiled this way.'],
  },
  'activation-condition-pair': {
    def: { kind: 'activated', text: '', cost: { tap: true }, effect: { targets: [], steps: [draw()] }, onlyIf: { cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }] } } as unknown as AbilityDef,
    readings: ['{T}: Draw a card. Activate only during your turn and only if you control a creature.', '{T}: Draw a card. Activate only if you control a creature and only during your turn.'],
    near: ['{T}: Draw a card. Activate only during your turn.', '{T}: Draw a card. Activate only during your turn and only if you control an artifact.'],
  },
  'divided-where-x': {
    def: trig([enters], [{ op: 'damage', source: self, to: t('t0'), amount: TDM_LANDS, divided: 'announced' } as EffectStep], {}, [
      { id: 't0', kind: 'object', min: 0, max: 'any', text: '', filter: { types: ['Creature'], controller: 'opponent' }, divide: { what: 'damage', total: TDM_LANDS } } as TargetSpec,
    ]),
    ctx: creature,
    readings: [
      'When this creature enters, it deals X damage divided as you choose among any number of target creatures your opponents control, where X is the number of lands you control.',
      'When this creature enters, it deals damage equal to the number of lands you control divided as you choose among any number of target creatures your opponents control.',
    ],
    near: [
      'When this creature enters, it deals X damage divided as you choose among any number of target creatures your opponents control, where X is the number of creatures you control.',
      'When this creature enters, it deals X damage divided evenly, rounded down, among any number of target creatures your opponents control, where X is the number of lands you control.',
    ],
  },
  'didnt-draw-this-way': {
    def: trig([enters], [
      { op: 'draw', who: you, count: 1, guard: { cond: 'exists', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } }, as: 'drew' } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'drew', not: true }, then: [{ op: 'putCounters', on: self, kind: '+1/+1', count: 1 }] } as EffectStep,
    ]),
    ctx: creature,
    readings: [
      "When this creature enters, draw a card if you control an artifact. If you don't draw a card this way, put a +1/+1 counter on this creature.",
      "When this creature enters, draw a card if you control an artifact. If you don't, put a +1/+1 counter on this creature.",
    ],
    near: [
      'When this creature enters, draw a card if you control an artifact. If you draw a card this way, put a +1/+1 counter on this creature.',
      "When this creature enters, draw a card if you control an artifact. If you don't draw two cards this way, put a +1/+1 counter on this creature.",
    ],
  },
  'drew-one-or-more-this-way': {
    def: trig([enters], [
      { op: 'may', who: you, do: [{ op: 'draw', who: you, count: 1, as: 'drew' }] } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'drew' }, then: [{ op: 'discard', who: you, count: 2 }] } as EffectStep,
    ]),
    ctx: creature,
    readings: [
      'When this creature enters, you may draw a card. If you draw one or more cards this way, discard two cards.',
    ],
    near: [
      "When this creature enters, you may draw a card. If you don't draw a card this way, discard two cards.",
      'When this creature enters, you may draw a card. If you draw two or more cards this way, discard two cards.',
    ],
  },
  'library-no-cards-in-it': {
    def: spell([{ op: 'if', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { zone: 'library', owner: 'you', isCard: true } } } }, then: [draw()] } as EffectStep]),
    readings: ['If your library has no cards in it, draw a card.', 'If there are no cards in your library, draw a card.'],
    near: ['If your graveyard has no cards in it, draw a card.', 'If your library has cards in it, draw a card.'],
  },
  'sacrifice-other-than-self': {
    def: { kind: 'activated', text: '', cost: { tap: true, other: [{ kind: 'sacrifice', filter: { types: ['Creature'], controller: 'you', other: true }, count: 1 }] }, effect: { targets: [], steps: [draw()] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['{T}, Sacrifice another creature: Draw a card.', '{T}, Sacrifice a creature other than Test Card: Draw a card.', '{T}, Sacrifice a creature you control other than Test Card: Draw a card.'],
    near: ['{T}, Sacrifice a creature: Draw a card.', '{T}, Sacrifice another artifact: Draw a card.'],
  },
} satisfies Record<string, Example>);

// CLOUD std-blb
const BLB_LOOK = { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 4 }, as: 'them' } as unknown as EffectStep;
Object.assign(EXAMPLES, {
  'look-from-the-top': {
    def: spell([{ op: 'look', who: you, at: { ref: 'topCards', player: you, count: 3 } } as unknown as EffectStep]),
    readings: ['Look at the top three cards of your library.', 'Look at three cards from the top of your library.'],
    near: ['Look at three cards from the bottom of your library.', "Look at the top three cards of target player's library.", 'Look at four cards from the top of your library.'],
  },
  'put-n-cards-from-among': {
    def: spell([
      BLB_LOOK,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: bound('them'), zone: 'library' } }, min: 2, max: 2, as: 'chosen' } as unknown as EffectStep,
      { op: 'move', what: bound('chosen'), to: { zone: 'hand' } } as EffectStep,
      { op: 'move', what: { ref: 'each', filter: { is: bound('them'), not: { is: bound('chosen') }, zone: 'library' } }, to: { zone: 'graveyard' } } as unknown as EffectStep,
    ]),
    readings: [
      'Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard.',
      'Look at the top four cards of your library. Put two cards from among them into your hand and the rest into your graveyard.',
    ],
    near: [
      'Look at the top four cards of your library. Put two cards from among them into your graveyard and the rest into your hand.',
      'Look at the top four cards of your library. Put up to two cards from among them into your hand and the rest into your graveyard.',
    ],
  },
  'choose-n-then-repeat': {
    def: { kind: 'spell', text: '', effect: { targets: [], steps: [], modes: { min: 2, max: 2, allowRepeat: true, options: [{ text: '', program: { targets: [], steps: [draw(1)] } }, { text: '', program: { targets: [], steps: [gain(2)] } }] } } } as unknown as AbilityDef,
    readings: ['Choose two. You may choose the same mode more than once. • Draw a card. • You gain 2 life.', 'Choose two — • Draw a card. • You gain 2 life. You may choose the same mode more than once.'],
    near: ['Choose two. • Draw a card. • You gain 2 life.', 'Choose three. You may choose the same mode more than once. • Draw a card. • You gain 2 life.'],
  },
  'also-trailing-if': {
    def: spell([
      effectStep([{ s: 'continuous', affects: t('c'), mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }] }] } as StaticEffect], { d: 'endOfTurn' }),
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: 1, toughness: 0 }] }], guard: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Mouse'], controller: 'you' } } } } as unknown as EffectStep,
    ], [objTarget('c')]),
    readings: [
      'Target creature gains trample until end of turn. It also gets +1/+0 until end of turn if you control a Mouse.',
      'Target creature gains trample until end of turn. If you control a Mouse, it also gets +1/+0 until end of turn.',
    ],
    near: [
      'Target creature gains trample until end of turn. It also gets +1/+0 until end of turn unless you control a Mouse.',
      'Target creature gains trample until end of turn. It also gets +2/+0 until end of turn if you control a Mouse.',
    ],
  },
  'colored-source-you-control': {
    def: statics([{ s: 'replace', replaces: { ev: 'damage', source: { colors: ['R'], controller: 'you' }, recipient: { player: 'opponent', object: { controller: 'opponent' } } }, body: { b: 'modify', amount: { add: 2 } } } as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: [
      'If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.',
      'If a red permanent you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.',
    ],
    near: [
      'If a red source would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.',
      'If a blue source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.',
      'If a red source an opponent controls would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.',
    ],
  },
} satisfies Record<string, Example>);

Object.assign(EXAMPLES, {
  // Cloud std-lci
  'kinds-list-own-mods': {
    def: spell([{ op: 'destroy', what: { ref: 'each', filter: { anyOf: [{ types: ['Artifact'] }, { types: ['Enchantment'] }, { types: ['Land'], notSupertypes: ['Basic'] }], controller: 'you' } } } as EffectStep]),
    readings: ['Destroy all artifacts, enchantments, and nonbasic lands you control.', 'Destroy all artifacts, enchantments, or nonbasic lands you control.'],
    near: ['Destroy all artifacts, enchantments, and basic lands you control.', 'Destroy all artifacts, enchantments, and nonbasic lands.', 'Destroy all artifacts, creatures, and nonbasic lands you control.'],
  },
  'explores-again': {
    def: trig([enters], [{ op: 'action', action: 'explore', who: { ref: 'controllerOf', object: self }, subject: self, n: 2 } as EffectStep]),
    ctx: creature,
    readings: ['When Test Card enters, it explores twice.', 'When Test Card enters, it explores, then it explores again.'],
    near: ['When Test Card enters, it explores, then it explores.', 'When Test Card enters, it explores again.', 'When Test Card enters, it explores, then it explores again twice.'],
  },
  // std-ry10 (CR 202.3, 701.20a): the mana value of a card chosen out of a revealed hand, said before or after "from it"
  'mana-value-after-hand': {
    def: spell([
      { op: 'reveal', who: t('p') as PlayerRef, what: { ref: 'each', filter: { zone: 'hand', owner: t('p') as PlayerRef } }, as: 'them' },
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ notTypes: ['Land'], isCard: true, manaValue: { op: '<=', value: 2 } }], is: bound('them'), zone: 'any' } }, min: 1, max: 1, as: 'chosen' },
      { op: 'discard', who: t('p') as PlayerRef, count: 1, filter: { is: bound('chosen') } },
    ] as EffectStep[], [playerTarget('p')]),
    readings: [
      'Target player reveals their hand. You choose a nonland card from it with mana value 2 or less. That player discards that card.',
      'Target player reveals their hand. You choose a nonland card with mana value 2 or less from it. That player discards that card.',
    ],
    near: [
      'Target player reveals their hand. You choose a nonland card from it with mana value 2 or greater. That player discards that card.',
      'Target player reveals their hand. You choose a nonland card from it. That player discards that card.',
      'Target player reveals their hand. You choose a card from it with mana value 2 or less. That player discards that card.',
    ],
  },
  'exile-from-seen-hand': {
    def: trig([enters], [
      { op: 'look', who: you, at: { ref: 'each', filter: { zone: 'hand', owner: t('p') } }, as: 'them' },
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ notTypes: ['Land'], isCard: true }], is: bound('them'), zone: 'any' } }, min: 0, max: 1, as: 'chosen' },
      { op: 'move', what: bound('chosen'), to: { zone: 'exile' }, until: { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' } } },
    ] as EffectStep[], {}, [{ ...playerTarget('p'), players: { who: 'opponent' } }]),
    ctx: creature,
    readings: [
      "When Test Card enters, look at target opponent's hand. You may exile a nonland card from it until Test Card leaves the battlefield.",
      "When Test Card enters, look at target opponent's hand. You may choose a nonland card from it. Exile that card until Test Card leaves the battlefield.",
    ],
    near: [
      "When Test Card enters, look at target opponent's hand. Exile a nonland card from it until Test Card leaves the battlefield.",
      "When Test Card enters, look at target opponent's hand. You may exile a nonland card from it.",
      "When Test Card enters, look at target opponent's hand. You may exile a card from it until Test Card leaves the battlefield.",
    ],
  },
  'quote-comma-where': {
    def: spell([{
      op: 'createToken', who: you, count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } },
      token: { colors: ['B'], types: ['Creature'], subtypes: ['Rat'], power: 1, toughness: 1, abilities: [{ kind: 'static', text: "This token can't block", effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block' }] }] },
    } as EffectStep]),
    readings: [
      'Create X 1/1 black Rat creature tokens with "This token can\'t block," where X is the number of creatures you control.',
      'Create X 1/1 black Rat creature tokens with "This token can\'t block.", where X is the number of creatures you control.',
    ],
    near: [
      'Create X 1/1 black Rat creature tokens with "This token can\'t attack," where X is the number of creatures you control.',
      'Create X 1/1 black Rat creature tokens with "This token can\'t block," where X is the number of lands you control.',
      'Create X 1/1 black Rat creature tokens with "This token can\'t block" where X is the number of creatures you control.',
    ],
  },
  'that-many-from-top': {
    def: trig([{ ev: 'damage', source: { self: true }, recipient: { player: 'any' }, combat: true } as EventPattern], [{ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: { q: 'eventAmount' } } } as EffectStep]),
    ctx: creature,
    readings: [
      'Whenever Test Card deals combat damage to a player, reveal that many cards from the top of your library.',
      'Whenever Test Card deals combat damage to a player, reveal the top X cards of your library, where X is that much.',
    ],
    near: [
      'Whenever Test Card deals combat damage to a player, reveal that many cards from the bottom of your library.',
      'Whenever Test Card deals combat damage to a player, reveal that many cards from the top of their library.',
      'Whenever Test Card deals combat damage to a player, reveal two cards from the top of your library.',
    ],
  },
  'each-deals-own-power': {
    def: spell([
      { op: 'damage', source: { ref: 'each', filter: { anyOf: [{ subtypes: ['Bird'], other: true }], controller: 'you' } }, to: t('t0'), amount: { q: 'stat', stat: 'power', of: { ref: 'subject' } }, perSource: true } as EffectStep,
    ], [objTarget('t0')]),
    readings: ['Each other Bird you control deals damage equal to its power to target creature.', 'All other Birds you control each deal damage equal to their power to target creature.'],
    near: ['Each other Bird you control deals damage equal to its toughness to target creature.', 'Each Bird you control deals damage equal to its power to target creature.', 'Each other Bird an opponent controls deals damage equal to its power to target creature.'],
  },
  'attached-owner-shuffle': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 2 }] }, effect: { targets: [], steps: [
      { op: 'move', what: { ref: 'attachedTo' }, to: { zone: 'library', owner: { ref: 'ownerOf', object: { ref: 'attachedTo' } } } },
      { op: 'shuffle', who: { ref: 'ownerOf', object: { ref: 'attachedTo' } } },
    ] } } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ["{2}: Shuffle enchanted creature into its owner's library.", "{2}: Enchanted creature's owner shuffles it into their library."],
    near: ["{2}: Enchanted creature's controller shuffles it into their library.", "{2}: Enchanted creature's owner puts it into their library.", "{2}: Enchanted creature's owner shuffles it into your library."],
  },
  'owner-of-object-shuffle': {
    def: spell([
      { op: 'move', what: t('t0'), to: { zone: 'library', owner: { ref: 'ownerOf', object: t('t0') } } },
      { op: 'shuffle', who: { ref: 'ownerOf', object: t('t0') } },
    ] as EffectStep[], [objTarget('t0')]),
    readings: ["Target creature's owner shuffles it into their library.", 'The owner of target creature shuffles it into their library.'],
    near: ['The owner of target creature shuffles it into your library.', 'The controller of target creature shuffles it into their library.', 'The owner of target creature puts it into their library.'],
  },
  'self-or-another-entered': {
    def: { kind: 'activated', text: '', cost: { tap: true }, effect: { targets: [], steps: [draw()] }, onlyIf: { cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Artifact'], controller: 'you' }, to: 'battlefield' }, scope: 'turn' } } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['{T}: Draw a card. Activate only if an artifact entered the battlefield under your control this turn.', '{T}: Draw a card. Activate only if Test Card or another artifact entered the battlefield under your control this turn.'],
    near: ['{T}: Draw a card. Activate only if another artifact entered the battlefield under your control this turn.', '{T}: Draw a card. Activate only if Test Card or another creature entered the battlefield under your control this turn.', '{T}: Draw a card. Activate only if Test Card entered the battlefield under your control this turn.'],
  },
} satisfies Record<string, Example>);

// Cloud std-woe (zz-cloud/std-woe.json)
const instant = { selfNames: ['Test Card'], selfTypes: ['Instant'] };
Object.assign(EXAMPLES, {
  'dealt-by-spell': {
    def: spell([
      { op: 'damage', source: self, to: t('c'), amount: 2 } as EffectStep,
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { anyOf: [{}], dealtDamageBySourceThisTurn: true }, from: 'battlefield', to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } }] } as unknown as EffectStep,
    ], [objTarget('c')]),
    ctx: instant,
    readings: [
      'Test Card deals 2 damage to target creature. If a permanent dealt damage by Test Card would die this turn, exile it instead.',
      'Test Card deals 2 damage to target creature. If a permanent dealt damage by Test Card this turn would die this turn, exile it instead.',
    ],
    near: [
      'Test Card deals 2 damage to target creature. If a creature dealt damage by Test Card would die this turn, exile it instead.',
      "Test Card deals 2 damage to target creature. If a permanent dealt damage by Test Card would die this turn, return it to its owner's hand instead.",
    ],
  },
  'exists-is-status': {
    def: spell([{ op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Rat'], attacking: true } } }, then: [draw()] } as unknown as EffectStep]),
    readings: ['If a Rat is attacking, draw a card.', 'If there is an attacking Rat on the battlefield, draw a card.'],
    near: ['If a Rat is blocking, draw a card.', 'If a Rat is tapped, draw a card.', 'If a Rat is attacking, draw two cards.'],
  },
  'identity-with-list': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [
      { layer: 4, subtypes: { set: ['Dragon'] } },
      { layer: 6, add: [{ kind: 'keyword', keyword: 'flying', text: 'flying' }, { kind: 'keyword', keyword: 'haste', text: 'haste' }] },
      { layer: '7b', power: 4, toughness: 4 },
    ] } as unknown as StaticEffect]),
    ctx: creature,
    readings: ['Test Card is a Dragon with base power and toughness 4/4, flying, and haste.', 'Test Card is a Dragon with base power and toughness 4/4 and has flying and haste.'],
    near: ['Test Card is a Dragon with base power and toughness 4/4, flying, and vigilance.', 'Test Card is a Dragon with base power and toughness 5/5, flying, and haste.', 'Test Card is a Dragon with base power and toughness 4/4, flying, or haste.'],
  },
  'life-lost-amount': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'lifeLostThisTurn', of: you } } as unknown as EffectStep]),
    readings: ['You gain life equal to the amount of life you lost this turn.', "You gain life equal to the amount of life you've lost this turn.", 'You gain life equal to the life you lost this turn.'],
    near: ['You gain life equal to the amount of life you gained this turn.', 'You gain life equal to the amount of life you lost last turn.'],
  },
  'that-are-colors': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'costMod', applies: { spells: { anyOf: [{ stackKind: 'spell', zone: 'stack' }], colors: ['B', 'R'] }, caster: 'you' }, change: { kind: 'reduce', generic: 1 } }] } as unknown as EffectStep]),
    readings: ['Spells you cast this turn that are black and/or red cost {1} less to cast.', 'Black or red spells you cast this turn cost {1} less to cast.'],
    near: ['Spells you cast this turn that are black and/or green cost {1} less to cast.', 'Spells you cast this turn that are black and/or red cost {2} less to cast.', 'Spells your opponents cast this turn that are black and/or red cost {1} less to cast.'],
  },
  'then-after-manual': {
    def: spell([{ op: 'manual', text: 'Exchange your graveyard and library.', reason: 'not understood' } as unknown as EffectStep, { op: 'shuffle', who: you } as EffectStep]),
    readings: ['Exchange your graveyard and library. Then shuffle your library.', 'Exchange your graveyard and library. Shuffle your library.'],
    near: ['Exchange your graveyard and library. Then draw a card.', 'Exchange your graveyard and library, then shuffle your library.'],
  },
} satisfies Record<string, Example>);

// CLOUD std-mkm (zz-cloud/std-mkm.json): seven new groups, three widened
const MKM_EACH = bound('each');
const mkmPunisher = (who: 'opponent' | 'player', costs: Record<string, unknown>[], last: EffectStep): EffectStep => {
  let step: EffectStep = last;
  for (const c of [...costs].reverse()) step = { op: 'pay', who: MKM_EACH, cost: { other: [c] }, else: [step] } as unknown as EffectStep;
  return { op: 'forEach', over: { ref: 'each', who }, as: 'each', do: [step] } as unknown as EffectStep;
};
const MKM_SAC_CREATURE = { kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 };
Object.assign(EXAMPLES, {
  'player-attacks-with': {
    def: trig([{ ev: 'attacks', attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 3 } } as EventPattern], [draw()], { batch: true }),
    ctx: creature,
    readings: ['Whenever an opponent attacks with three or more creatures, draw a card.', 'Whenever three or more creatures your opponents control attack, draw a card.'],
    near: ['Whenever you attack with three or more creatures, draw a card.', 'Whenever an opponent attacks with two or more creatures, draw a card.', 'Whenever a player attacks with three or more creatures, draw a card.'],
  },
  'each-of-your-opponents': {
    def: spell([{ op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: 2 } as EffectStep]),
    readings: ['Each opponent loses 2 life.', 'Each of your opponents loses 2 life.'],
    near: ['Each player loses 2 life.', 'Each of your opponents loses 3 life.', 'Each of your opponents gains 2 life.'],
  },
  'turn-chosen-face-up': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, min: 1, max: 1, as: 'faceup' } as EffectStep,
      { op: 'changeFace', what: bound('faceup'), to: 'faceUp' } as EffectStep,
    ]),
    readings: ['Turn a creature you control face up.', 'Choose a creature you control. Turn it face up.'],
    near: ['Turn target creature you control face up.', 'Turn a creature you control face down.', 'Turn all creatures you control face up.'],
  },
  'suspect-one-of-them': {
    def: trig([{ ev: 'zoneChange', subject: { other: true, types: ['Creature'], controller: 'you' }, to: 'battlefield' }], [{ op: 'may', who: you, do: [
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: { ref: 'event', role: 'subject' }, suspected: false } }, min: 1, max: 1, as: 'suspect' },
      { op: 'action', action: 'suspect', who: you, subject: bound('suspect') },
    ] } as EffectStep], { batch: true }),
    ctx: creature,
    readings: [
      'Whenever one or more other creatures you control enter, you may suspect one of them.',
      'Whenever one or more other creatures you control enter, you may suspect one of the other creatures.',
      'Whenever one or more other creatures you control enter, you may suspect one of those creatures.',
    ],
    near: [
      'Whenever one or more other creatures you control enter, you may suspect each of them.',
      'Whenever one or more other creatures you control enter, suspect one of them.',
      'Whenever one or more other creatures you control enter, you may suspect target creature.',
    ],
  },
  'each-unless-they': {
    def: spell([mkmPunisher('opponent', [{ kind: 'discard', count: 1 }, MKM_SAC_CREATURE], { op: 'loseLife', who: MKM_EACH, amount: 3 } as unknown as EffectStep)]),
    readings: ['Each opponent loses 3 life unless they discard a card or sacrifice a creature.', 'For each opponent, that player loses 3 life unless they discard a card or sacrifice a creature.'],
    near: [
      'Each opponent loses 3 life unless they discard a card.',
      'Each opponent loses 3 life unless you discard a card or sacrifice a creature.',
      'Each opponent loses 3 life unless they sacrifice a creature or discard a card.',
      'Each player loses 3 life unless they discard a card or sacrifice a creature.',
    ],
  },
  'unless-they-sacrifice-their-choice': {
    def: spell([mkmPunisher('player', [MKM_SAC_CREATURE], { op: 'loseLife', who: MKM_EACH, amount: 2 } as unknown as EffectStep)]),
    readings: ['Each player loses 2 life unless they sacrifice a creature.', 'Each player loses 2 life unless they sacrifice a creature of their choice.'],
    near: ['Each player loses 2 life unless they sacrifice a creature of your choice.', 'Each opponent loses 2 life unless they sacrifice a creature.', 'Each player loses 2 life unless you sacrifice a creature.'],
  },
  // std-rx33: the attached creature's P/T change and grant, then its extra block (render/stat.ts#sharedSubject)
  'gets-has-can-block-additional': {
    def: statics([
      { s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: 2, toughness: 2 }, { layer: 6, add: [{ kind: 'keyword', keyword: 'vigilance', text: 'vigilance' }] }] } as StaticEffect,
      { s: 'rule', rule: 'extraBlockers', value: 1, of: { is: { ref: 'attachedTo' } } } as StaticEffect,
    ]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: [
      'Enchanted creature gets +2/+2, has vigilance, and can block an additional creature each combat.',
      'Enchanted creature gets +2/+2 and has vigilance. Enchanted creature can block an additional creature each combat.',
    ],
    near: [
      'Enchanted creature gets +2/+2, has vigilance, and can block two additional creatures each combat.',
      'Enchanted creature gets +2/+2, has vigilance, and can block an additional creature this turn.',
      'Enchanted creature gets +2/+2, has reach, and can block an additional creature each combat.',
    ],
  },
  'gets-has-cant-be-blocked': {
    def: statics([
      { s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'vigilance', text: 'vigilance' }] }, { layer: '7c', power: 2, toughness: 1 }] } as StaticEffect,
      { s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'beBlocked', max: 1 } as StaticEffect,
    ]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: [
      "Equipped creature gets +2/+1, has vigilance, and can't be blocked by more than one creature.",
      "Equipped creature gets +2/+1 and has vigilance. Equipped creature can't be blocked by more than one creature.",
      "Equipped creature gets +2/+1 and has vigilance and equipped creature can't be blocked by more than one creature.",
    ],
    near: [
      "Equipped creature gets +2/+1, has vigilance, and can't be blocked.",
      "Equipped creature gets +2/+1, has vigilance, and can't block.",
      "Equipped creature gets +2/+1, has reach, and can't be blocked by more than one creature.",
    ],
  },
  'unsuspected-if-suspected': {
    def: spell([{ op: 'untap', what: t('c') }, { op: 'designateObject', what: t('c'), designation: 'unsuspected' } as EffectStep], [objTarget('c')]),
    readings: ["Untap target creature. If it's suspected, it's no longer suspected.", 'Untap target creature. If it is suspected, it is no longer suspected.', "Untap target creature. It's no longer suspected."],
    near: ["Untap target creature. If it's tapped, it's no longer suspected.", "Untap target creature. If it's suspected, it's suspected.", "Untap target creature. If it's not suspected, it's no longer suspected."],
  },
  'sized-creature-with': {
    def: statics([{ s: 'continuous', affects: self, mods: [
      { layer: 4, types: { add: ['Creature'] }, subtypes: { add: ['Elk'] } },
      { layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }, { kind: 'keyword', keyword: 'haste', text: 'haste' }] },
      { layer: '7b', power: 3, toughness: 3 },
    ] } as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['This enchantment is a 3/3 Elk creature with trample and haste in addition to its other types.', 'Test Card is a 3/3 Elk creature with trample and haste in addition to its other types.'],
    near: [
      'This enchantment is a 3/3 Elk creature with trample and haste.',
      'This enchantment is a 3/3 Elk creature with trample in addition to its other types.',
      'This enchantment is a 4/4 Elk creature with trample and haste in addition to its other types.',
    ],
  },
  'gets-and-cant-become-suspected': {
    def: statics([
      { s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: 1, toughness: 1 }] } as StaticEffect,
      { s: 'restrict', subject: { ref: 'attachedTo' }, mode: 'cant', action: 'beSuspected' } as StaticEffect,
    ]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ["Enchanted creature gets +1/+1 and can't become suspected.", "Enchanted creature gets +1/+1. Enchanted creature can't become suspected."],
    near: ["Enchanted creature gets +1/+1 and can't block.", "Enchanted creature gets +1/+1 and is suspected.", "Enchanted creature gets +2/+2 and can't become suspected."],
  },
  'then-after-sentence': {
    def: spell([mkmPunisher('opponent', [{ kind: 'discard', count: 1 }], { op: 'loseLife', who: MKM_EACH, amount: 3 } as unknown as EffectStep), draw()]),
    readings: ['Each opponent loses 3 life unless they discard a card. Draw a card.', 'Each opponent loses 3 life unless they discard a card. Then draw a card.'],
    near: ['Each opponent loses 3 life unless they discard a card. Then each opponent draws a card.', 'Each opponent loses 3 life unless they discard a card. Then you may draw a card.', 'Each opponent loses 3 life unless they discard a card. Then draw two cards.'],
  },
} satisfies Record<string, Example>);

// std-tla (cloud batch 2, zz-cloud/std-tla.json)
const STD_TLA_MILL: EffectStep = { op: 'mill', who: you, count: 3, as: 'm' } as EffectStep;
Object.assign(EXAMPLES, {
  'plural-name-attacks': {
    def: trig([{ ev: 'attacks', attacker: { self: true } }], [draw()]),
    ctx: creature,
    readings: ['Whenever Test Card attacks, draw a card.', 'Whenever Test Card attack, draw a card.'],
    near: ['Whenever Test Card blocks, draw a card.', 'Whenever Test Card attacks alone, draw a card.'],
  },
  'milled-this-way-cond': {
    def: spell([STD_TLA_MILL, { op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { types: ['Land'], isCard: true, is: bound('m'), zone: 'any' } } }, then: [draw()] } as EffectStep]),
    readings: [
      'Mill three cards. If a land card was milled this way, draw a card.',
      'Mill three cards. If a land card is milled this way, draw a card.',
      'Mill three cards. If at least one land card is milled this way, draw a card.',
    ],
    near: ['Mill three cards. If a creature card was milled this way, draw a card.', 'Mill three cards. If a land card was discarded this way, draw a card.', 'Mill three cards. If two land cards were milled this way, draw a card.'],
  },
  'mill-pick-milled-this-way': {
    def: spell([
      STD_TLA_MILL,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: bound('m'), zone: 'any' } }, min: 0, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' } } as EffectStep,
    ]),
    readings: [
      'Mill three cards. You may put a creature card milled this way into your hand.',
      'Mill three cards. You may put a creature card from among the cards milled this way into your hand.',
      'Mill three cards. You may put a creature card from among them into your hand.',
    ],
    near: ['Mill three cards. You may put a land card milled this way into your hand.', 'Mill three cards. You may put a creature card milled this way onto the battlefield.', 'Mill three cards. Put a creature card milled this way into your hand.'],
  },
  'flash-condition-first': {
    def: { kind: 'static', text: '', zone: ['hand'], condition: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Wizard'], controller: 'you' } } }, effects: [{ s: 'permit', who: you, action: 'haveFlash', of: { self: true } }] } as unknown as AbilityDef,
    ctx: creature,
    readings: ['If you control a Wizard, you may cast Test Card as though it had flash.', 'As long as you control a Wizard, you may cast Test Card as though it had flash.'],
    near: ['If you control a Wizard, you may cast Test Card as though it had haste.', 'If you control a Goblin, you may cast Test Card as though it had flash.', 'If you control a Wizard, you may cast Test Card as though they had flash.'],
  },
  'you-attack-a-player': {
    def: trig([{ ev: 'attacks', attacker: { controller: 'you', types: ['Creature'], power: { op: '>=', value: 4 } }, count: { op: '>=', value: 1 }, defender: 'any' }], [draw()], { batch: true }),
    ctx: creature,
    readings: [
      'Whenever you attack a player with one or more creatures with power 4 or greater, draw a card.',
      'Whenever one or more creatures you control with power 4 or greater attack a player, draw a card.',
    ],
    near: [
      'Whenever you attack with one or more creatures with power 4 or greater, draw a card.',
      'Whenever you attack a player with one or more creatures with power 3 or greater, draw a card.',
      'Whenever you attack a planeswalker with one or more creatures with power 4 or greater, draw a card.',
    ],
  },
  // CLOUD std-fdn
  'stat-of-object': {
    def: spell([{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'toughness', of: t('c') } }], [objTarget('c')]),
    readings: ["You gain life equal to target creature's toughness.", 'You gain life equal to the toughness of target creature.'],
    near: ['You gain life equal to the power of target creature.', 'You gain life equal to the toughness of target creatures.'],
  },
  'control-different-names': {
    def: spell([{ op: 'if', cond: { cond: 'compare', left: { q: 'distinct', what: 'names', among: { ref: 'each', filter: { subtypes: ['Gate'], controller: 'you' } } }, op: '>=', right: 3 }, then: [draw()] } as EffectStep]),
    readings: ['If you control three or more Gates with different names, draw a card.', 'If there are three or more names among Gates you control, draw a card.'],
    near: ['If you control three or more Gates, draw a card.', 'If you control two or more Gates with different names, draw a card.'],
  },
} satisfies Record<string, Example>);

// CLOUD std-dft
const STDDFT_GRAVE: Quantity = { q: 'count', of: { ref: 'each', filter: { types: ['Artifact', 'Creature'], zone: 'graveyard', owner: 'you', isCard: true } } };
Object.assign(EXAMPLES, {
  'each-type-list-and-or': {
    def: statics([{ s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', generic: { q: 'math', op: '*', args: [1, STDDFT_GRAVE] }, floor: 'zero' } } as StaticEffect]),
    readings: [
      'This spell costs {1} less to cast for each artifact and/or creature card in your graveyard.',
      'This spell costs {1} less to cast for each artifact or creature card in your graveyard.',
      'This spell costs {1} less to cast for each artifact and creature card in your graveyard.',
    ],
    near: [
      'This spell costs {1} less to cast for each artifact and/or land card in your graveyard.',
      'This spell costs {1} less to cast for each artifact and/or creature card in an opponent\'s graveyard.',
      'This spell costs {2} less to cast for each artifact and/or creature card in your graveyard.',
    ],
  },
  'serial-comma-after-reveal': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { types: ['Creature'] }, max: 1, reveal: true, as: 's' } as EffectStep,
      { op: 'move', what: bound('s'), to: { zone: 'hand' } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
    ]),
    readings: [
      'Search your library for a creature card, reveal it, put it into your hand, then shuffle.',
      'Search your library for a creature card, reveal it, and put it into your hand. Then shuffle.',
    ],
    near: [
      'Search your library for a creature card, reveal it, and put it into your graveyard. Then shuffle.',
      'Search your library for a land card, reveal it, and put it into your hand. Then shuffle.',
    ],
  },
} satisfies Record<string, Example>);

// CLOUD std-spm: the families of zz-cloud/std-spm.json and the readings it needed
const SPM_OPPONENT = { id: 'p', kind: 'player', min: 1, max: 1, text: 'target opponent', players: { who: 'opponent' } } as const;
const SPM_PREVENT = (then?: EffectStep[]): StaticEffect => ({ s: 'replace', replaces: { ev: 'damage', recipient: { object: { self: true } } }, body: { b: 'prevent', amount: 'all', ...(then ? { then } : {}) } } as StaticEffect);
const SPM_POWER: Quantity = { q: 'stat', stat: 'power', of: self };
const SPM_LOST: Quantity = { q: 'lifeLost', step: 'lost', who: you } as Quantity;
Object.assign(EXAMPLES, {
  'was-cast-pronoun': {
    def: trig([enters], [draw()], { interveningIf: { cond: 'wasCast' } }),
    ctx: creature,
    readings: ['When Test Card enters, if Test Card was cast, draw a card.', 'When Test Card enters, if it was cast, draw a card.'],
    near: ['When Test Card enters, if you cast it, draw a card.', "When Test Card enters, if it wasn't cast, draw a card."],
  },
  'damage-would-be-dealt-to': {
    def: statics([SPM_PREVENT()]),
    ctx: creature,
    readings: ['If Test Card would be dealt damage, prevent that damage.', 'If damage would be dealt to Test Card, prevent that damage.', 'Prevent all damage that would be dealt to Test Card.'],
    near: ['If damage would be dealt by Test Card, prevent that damage.', 'If combat damage would be dealt to Test Card, prevent that damage.'],
  },
  'shared-where-x': {
    def: spell([{ op: 'draw', who: you, count: SPM_POWER } as EffectStep, { op: 'gainLife', who: you, amount: SPM_POWER } as EffectStep]),
    readings: ["Draw X cards and you gain X life, where X is Test Card's power.", "Draw cards equal to Test Card's power and you gain life equal to its power."],
    near: ["Draw X cards and you gain X life, where X is Test Card's toughness.", "Draw X cards and you gain two life, where X is Test Card's power."],
  },
  'grant-and-color': {
    def: spell([effectStep([{ s: 'continuous', affects: self, mods: [{ layer: 5, colors: { set: [] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'hexproof', text: 'hexproof' }] }] } as StaticEffect], { d: 'endOfTurn' })]),
    ctx: creature,
    readings: ['Test Card becomes colorless and gains hexproof until end of turn.', 'Test Card gains hexproof and becomes colorless until end of turn.'],
    near: ['Test Card gains hexproof and becomes colorless.', 'Test Card gains flying and becomes colorless until end of turn.', 'Test Card gains hexproof and becomes blue until end of turn.'],
  },
  'each-kind-and-kind': {
    def: spell([{ op: 'action', action: 'doubleEachKind', who: you, subject: { ref: 'each', filter: { anyOf: [{ subtypes: ['Spider'] }, { supertypes: ['Legendary'], types: ['Creature'] }], controller: 'you' } } } as EffectStep]),
    readings: ['Double the number of each kind of counter on each Spider and legendary creature you control.', 'Double the number of each kind of counter on each Spider you control or legendary creature you control.'],
    near: ['Double the number of each kind of counter on each Spider and legendary artifact you control.', 'Double the number of each kind of counter on each Spider and creature you control.'],
  },
  'prevented-that-many': {
    def: statics([SPM_PREVENT([{ op: 'putCounters', on: self, kind: '+1/+1', count: { q: 'preventedAmount' } } as EffectStep])]),
    ctx: creature,
    readings: [
      'If damage would be dealt to Test Card, prevent that damage and put that many +1/+1 counters on Test Card.',
      'If damage would be dealt to Test Card, prevent that damage. Put a number of +1/+1 counters equal to the damage prevented this way on Test Card.',
    ],
    near: ['If damage would be dealt to Test Card, prevent that damage and put a +1/+1 counter on Test Card.', 'If damage would be dealt to Test Card, prevent that damage and put twice that many +1/+1 counters on Test Card.'],
  },
  'life-lost-by-player': {
    def: trig([enters], [
      { op: 'may', who: you, do: [{ op: 'exchange', a: you, b: t('p'), what: 'life' } as EffectStep], as: 'lost' } as EffectStep,
      { op: 'if', cond: { cond: 'compare', left: SPM_LOST, op: '>', right: 0 }, then: [{ op: 'draw', who: you, count: SPM_LOST } as EffectStep] } as EffectStep,
    ], {}, [SPM_OPPONENT]),
    ctx: creature,
    readings: [
      'When Test Card enters, you may exchange life totals with target opponent. If you lost life this way, draw that many cards.',
      'When Test Card enters, you may exchange life totals with target opponent. If you lost life this way, draw cards equal to the life you lost this way.',
    ],
    near: ['When Test Card enters, you may exchange life totals with target opponent. If you lost life this way, draw a card.', 'When Test Card enters, you may exchange life totals with target opponent. If you gained life this way, draw that many cards.'],
  },
  'cards-from-the-top': {
    def: spell([{ op: 'look', who: you, at: { ref: 'topCards', player: you, count: 3 } } as EffectStep]),
    readings: ['Look at the top three cards of your library.', 'Look at three cards from the top of your library.'],
    near: ['Look at three cards from the bottom of your library.', 'Look at four cards from the top of your library.'],
  },
  'prevent-and-then': {
    def: statics([SPM_PREVENT([draw()])]),
    ctx: creature,
    readings: ['If damage would be dealt to Test Card, prevent that damage. Draw a card.', 'If damage would be dealt to Test Card, prevent that damage and draw a card.'],
    near: ['If damage would be dealt to Test Card, prevent that damage or draw a card.', 'If damage would be dealt to Test Card, prevent that damage and draw two cards.'],
  },
  'each-player-who-doesnt': {
    def: spell([{ op: 'may', who: { ref: 'each', who: 'player' }, do: [{ op: 'discard', who: { ref: 'iterating' }, count: 1 }], otherwise: [{ op: 'loseLife', who: { ref: 'iterating' }, amount: 3 }] } as EffectStep]),
    readings: ["Each player may discard a card. Each player who doesn't loses 3 life.", "Each player may discard a card. If you don't, that player loses 3 life."],
    near: ["Each player may discard a card. Each player who does loses 3 life.", "Each player may discard a card. Each player who doesn't loses 2 life."],
  },
  'exchange-life-with': {
    def: spell([{ op: 'exchange', a: you, b: t('p'), what: 'life' } as EffectStep], [SPM_OPPONENT]),
    readings: ['You and target opponent exchange life totals.', 'Exchange life totals with target opponent.'],
    near: ['Exchange life totals with each opponent.', 'Exchange hands with target opponent.'],
  },
} satisfies Record<string, Example>);

// CLOUD std-ecl: the families of zz-cloud/std-ecl.json (render/equivalence.ts)
Object.assign(EXAMPLES, {
  'flash-condition': {
    def: { kind: 'static', text: '', zone: ['hand'], condition: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Faerie'], controller: 'you' } } }, effects: [{ s: 'permit', who: you, action: 'haveFlash', of: { self: true } }] } as unknown as AbilityDef,
    ctx: creature,
    readings: ['You may cast this spell as though it had flash if you control a Faerie.', 'As long as you control a Faerie, you may cast this spell as though it had flash.'],
    near: ['You may cast this spell as though it had flash if you control a Goblin.', 'You may cast this spell as though it had flash if an opponent controls a Faerie.', 'You may cast this spell as though it had haste if you control a Faerie.'],
  },
  'gains-all-creature-types': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 4, subtypes: { all: true } }] }] } as EffectStep], [objTarget('c', { types: ['Creature'] }, { min: 0, max: 1 })]),
    readings: ['Up to one target creature gains all creature types until end of turn.', 'Up to one target creature has all creature types until end of turn.', 'Up to one target creature is every creature type until end of turn.'],
    near: ['Up to one target creature gains all creature types.', 'Up to one target creature gains all creature types until your next turn.', 'Up to one target creature loses all creature types until end of turn.'],
  },
  'enters-and-whenever-any': {
    def: trig([enters, { ev: 'cast', player: 'you', spell: { manaValue: { op: '>=', value: 4 } } } as EventPattern], [draw()]),
    ctx: creature,
    readings: [
      'When this creature enters and whenever you cast a spell with mana value 4 or greater, draw a card.',
      'Whenever this creature enters or you cast a spell with mana value 4 or greater, draw a card.',
      'Whenever this creature enters and whenever you cast a spell with mana value 4 or greater, draw a card.',
    ],
    near: [
      'When this creature enters and whenever an opponent casts a spell with mana value 4 or greater, draw a card.',
      'When this creature enters and whenever you cast a spell with mana value 3 or greater, draw a card.',
      'When this creature dies and whenever you cast a spell with mana value 4 or greater, draw a card.',
    ],
  },
  'copy-tapped-attacking-front': {
    def: trig([{ ev: 'attacks', attacker: { self: true } } as EventPattern], [{ op: 'copy', what: t('c'), result: 'token', who: you, tapped: true, attacking: true } as EffectStep], {}, [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    ctx: creature,
    readings: [
      "Whenever this creature attacks, create a tapped and attacking token that's a copy of target creature you control.",
      "Whenever this creature attacks, create a token that's a copy of target creature you control, tapped and attacking.",
    ],
    near: [
      "Whenever this creature attacks, create a tapped token that's a copy of target creature you control.",
      "Whenever this creature attacks, create an attacking token that's a copy of target creature you control.",
      "Whenever this creature attacks, create a tapped and attacking token that's a copy of target creature an opponent controls.",
    ],
  },
  'share-creature-type-zone': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } }], [objTarget('c', { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true }, { min: 2, max: 2, sharedCreatureType: true })]),
    readings: ['Return two target creature cards that share a creature type from your graveyard to your hand.', 'Return two target creature cards from your graveyard that share a creature type to your hand.'],
    near: [
      'Return two target creature cards that share a card type from your graveyard to your hand.',
      'Return two target creature cards from your graveyard to your hand.',
      'Return two target creature cards that share a color from your graveyard to your hand.',
      'Return two target creature cards that share a creature type from an opponent\'s graveyard to your hand.',
    ],
  },
} satisfies Record<string, Example>);

// CLOUD std-msh: the definitions of its families
const MSH_LOOK = (manaValue?: { op: '<='; value: number }): AbilityDef => spell([
  { op: 'look', who: you, at: { ref: 'topCards', player: you, count: 3 }, as: 'them' } as EffectStep,
  { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: bound('them'), notTypes: ['Land'], zone: 'library', ...(manaValue ? { manaValue } : {}) } }, min: 0, max: 1, as: 'cast' } as EffectStep,
  { op: 'cast', who: you, what: bound('cast'), free: true } as EffectStep,
  { op: 'move', what: { ref: 'each', filter: { is: bound('them'), not: { is: bound('cast') }, zone: 'library' } }, to: { zone: 'library', position: 'bottom', order: 'random' } } as EffectStep,
]);
const MSH_REST = 'Put the rest on the bottom of your library in a random order.';
const MSH_DRAWN2: EventPattern = { ev: 'draw', player: 'you', nth: 2 } as EventPattern;

Object.assign(EXAMPLES, {
  // CLOUD std-msh (CR 122.6, 604.1): Beast, Erudite Aerialist's condition
  'counters-put-perfect': {
    def: t12Static({ cond: 'happened', event: { ev: 'counters', change: 'put', kind: '+1/+1', on: { self: true }, by: 'you' }, scope: 'turn' }, [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flying' }] }] } as StaticEffect]),
    ctx: creature,
    readings: ["As long as you've put one or more +1/+1 counters on Test Card this turn, Test Card has flying.", 'As long as you put one or more +1/+1 counters on Test Card this turn, Test Card has flying.'],
    near: ["As long as you've put one or more -1/-1 counters on Test Card this turn, Test Card has flying.", "As long as you've put one or more +1/+1 counters on Test Card, Test Card has flying.", "As long as an opponent has put one or more +1/+1 counters on Test Card this turn, Test Card has flying."],
  },
  // CLOUD std-msh (CR 701.10a-c): Epic Fight
  'double-pt-of-possessive': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: { q: 'stat', stat: 'power', of: t('c') }, toughness: { q: 'stat', stat: 'toughness', of: t('c') } }] }] } as EffectStep], [objTarget('c')]),
    readings: ["Double target creature's power and toughness until end of turn.", 'Double the power and toughness of target creature until end of turn.'],
    near: ["Double target creature's power and toughness.", 'Double the power of target creature until end of turn.', "Double target creature's toughness until end of turn."],
  },
  // CLOUD std-msh (CR 608.2c, 608.2g): Svella, Ice Shaper
  'seen-group-them': {
    def: MSH_LOOK(),
    readings: [`Look at the top three cards of your library. You may cast a spell from among them without paying its mana cost. ${MSH_REST}`, `Look at the top three cards of your library. You may cast a spell from among those cards without paying its mana cost. ${MSH_REST}`],
    near: [`Look at the top three cards of your library. You may cast a spell from among the cards in your graveyard without paying its mana cost. ${MSH_REST}`, `Look at the top three cards of your library. You may cast a creature spell from among them without paying its mana cost. ${MSH_REST}`],
  },
  // CLOUD std-msh (CR 202.3): Cosmic Cube and Perception Bobblehead
  'cast-free-mv-or-less': {
    def: MSH_LOOK({ op: '<=', value: 3 }),
    readings: [`Look at the top three cards of your library. You may cast a spell from among them with mana value less than or equal to 3 without paying its mana cost. ${MSH_REST}`, `Look at the top three cards of your library. You may cast a spell with mana value 3 or less from among them without paying its mana cost. ${MSH_REST}`],
    near: [`Look at the top three cards of your library. You may cast a spell with mana value 3 or greater from among them without paying its mana cost. ${MSH_REST}`, `Look at the top three cards of your library. You may cast a spell from among them with mana value less than or equal to 2 without paying its mana cost. ${MSH_REST}`, `Look at the top three cards of your library. You may cast a spell with mana value 3 or less from among them. ${MSH_REST}`],
  },
  // CLOUD std-msh (CR 613.4b, 613.1f): Moon Girl and Devil Dinosaur
  'basept-become-lead': {
    def: trig([MSH_DRAWN2], [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7b', power: 6, toughness: 6 }, { layer: 6, add: [{ kind: 'keyword', keyword: 'trample' }] }] }] } as EffectStep]),
    ctx: creature,
    readings: [
      "Whenever you draw your second card each turn, until end of turn, Test Card's base power and toughness become 6/6 and they gain trample.",
      "Whenever you draw your second card each turn, until end of turn, Test Card's base power and toughness become 6/6 and it gains trample.",
      'Whenever you draw your second card each turn, Test Card has base power and toughness 6/6 and gains trample until end of turn.',
    ],
    near: [
      "Whenever you draw your second card each turn, until end of turn, Test Card's base power and toughness become 6/6 and they gain flying.",
      "Whenever you draw your second card each turn, until end of turn, Test Card's base power and toughness become 5/5 and they gain trample.",
      "Whenever you draw your second card each turn, Test Card's base power and toughness become 6/6 and they gain trample.",
      "Whenever you draw your second card each turn, until end of turn, Test Card's power and toughness become 6/6 and they gain trample.",
    ],
  },
  // CLOUD std-msh (CR 202.3): Evil's Thrall
  'stat-than-object': {
    def: spell([{ op: 'tap', what: t('c') } as EffectStep, { op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { controller: 'you', subtypes: ['Villain'], manaValue: { op: '>', value: { q: 'stat', of: t('c'), stat: 'manaValue' } } } } }, then: [draw()] } as EffectStep], [objTarget('c')]),
    readings: ['Tap target creature. If you control a Villain with greater mana value than that creature, draw a card.', 'Tap target creature. If you control a Villain with mana value greater than its mana value, draw a card.'],
    near: ['Tap target creature. If you control a Villain with lesser mana value than that creature, draw a card.', 'Tap target creature. If you control a Villain with greater power than that creature, draw a card.', 'Tap target creature. If you control a Hero with greater mana value than that creature, draw a card.'],
  },
  // CLOUD std-msh (CR 506.5): Crowd of True Believers
  'attacking-alone-contraction': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [pump] } as EffectStep], [objTarget('c', { types: ['Creature'], controller: 'you', attackingAlone: true })]),
    readings: ["Target creature you control that's attacking alone gets +1/+1 until end of turn.", 'Target creature you control that is attacking alone gets +1/+1 until end of turn.'],
    near: ["Target creature you control that's attacking gets +1/+1 until end of turn.", "Target creature you control that's blocking alone gets +1/+1 until end of turn.", 'Target attacking creature you control gets +1/+1 until end of turn.'],
  },
  // CLOUD std-msh (CR 115.4): Red Hulk
  'any-other-target-self': {
    def: trig([enters], [{ op: 'damage', source: self, to: t('c'), amount: 2 } as EffectStep], {}, [{ id: 'c', kind: 'anyTarget', min: 1, max: 1, text: '', filter: { other: true } }]),
    ctx: creature,
    readings: ['When Test Card enters, it deals 2 damage to any other target.', 'When Test Card enters, it deals 2 damage to another target.'],
    near: ['When Test Card enters, it deals 2 damage to any target.', 'When Test Card enters, it deals 2 damage to another target creature.', 'When Test Card enters, it deals 2 damage to each other target.'],
  },
  // CLOUD std-msh (CR 614.1a, 107.3): Hawkeye, Young Avenger
  'instead-first-where-x': {
    def: statics([{ s: 'replace', replaces: { ev: 'damage', source: { controller: 'you' }, recipient: { player: 'opponent' }, combat: false }, body: { b: 'modify', amount: { add: { q: 'stat', of: self, stat: 'power' } } } } as StaticEffect]),
    ctx: creature,
    readings: [
      "If a source you control would deal noncombat damage to an opponent, instead it deals that much damage plus X, where X is Test Card's power.",
      "If a source you control would deal noncombat damage to an opponent, instead that source deals that much damage plus X, where X is Test Card's power.",
      "If a source you control would deal noncombat damage to an opponent, it deals Test Card's power more damage instead.",
    ],
    near: [
      "If a source you control would deal noncombat damage to an opponent, instead it deals that much damage minus X, where X is Test Card's power.",
      "If a source you control would deal noncombat damage to an opponent, instead it deals that much damage plus X, where X is Test Card's toughness.",
      "If a source you control would deal combat damage to an opponent, instead it deals that much damage plus X, where X is Test Card's power.",
    ],
  },
} satisfies Record<string, Example>);

// Cloud C7: what an earlier instruction moved (render/moved.ts; zz-cloud/c7.json)
const C7_EXILE: EffectStep = { op: 'move', what: t('c'), to: { zone: 'exile' }, as: 'ex' } as EffectStep;
const C7_GRAVEYARD_CARD = objTarget('c', { zone: 'graveyard', isCard: true });
Object.assign(EXAMPLES, {
  'moved-this-way-words': {
    def: spell([C7_EXILE, { op: 'gainLife', who: you, amount: { q: 'resultCount', step: 'ex', which: { isCard: true } } } as EffectStep], [C7_GRAVEYARD_CARD]),
    readings: ['Exile target card from a graveyard. You gain 1 life for each card exiled this way.', 'Exile target card from a graveyard. You gain 1 life for each card put into exile this way.'],
    near: ['Exile target card from a graveyard. You gain 1 life for each card exiled this turn.', 'Exile target card from a graveyard. You gain 1 life for each card destroyed this way.', 'Exile target card from a graveyard. You gain 1 life for each card put into a graveyard this way.'],
  },
  'moved-this-way-condition': {
    def: spell([C7_EXILE, { op: 'if', cond: { cond: 'did', step: 'ex', which: { types: ['Creature'], isCard: true }, to: 'exile' }, then: [gain(2)] } as EffectStep], [C7_GRAVEYARD_CARD]),
    readings: [
      'Exile target card from a graveyard. If a creature card was exiled this way, you gain 2 life.',
      'Exile target card from a graveyard. If a creature card is exiled this way, you gain 2 life.',
      'Exile target card from a graveyard. If at least one creature card was exiled this way, you gain 2 life.',
      'Exile target card from a graveyard. If you exiled a creature card this way, you gain 2 life.',
    ],
    near: ['Exile target card from a graveyard. If a land card was exiled this way, you gain 2 life.', 'Exile target card from a graveyard. If a creature card was destroyed this way, you gain 2 life.', 'Exile target card from a graveyard. If no creature card was exiled this way, you gain 2 life.'],
  },
});
// CLOUD C6: the choosing player of a group (`{ref:'iterating'}`) in a filter, and the sacrifice of all permanents of a description by each player (CR 608.2e, 701.21a)
const C6_EACH_PLAYER: PlayerRef = { ref: 'each', who: 'player' };
const C6_ITERATING: PlayerRef = { ref: 'iterating' };
Object.assign(EXAMPLES, {
  'sacrifice-all-they-control': {
    def: spell([{ op: 'sacrificeChoice', who: C6_EACH_PLAYER, filter: { types: ['Creature'], controller: C6_ITERATING }, count: 1, mode: 'all' } as EffectStep]),
    readings: ['Each player sacrifices all creatures they control.', 'Each player sacrifices all creatures.'],
    near: ['Each player sacrifices all creatures you control.', 'Each player sacrifices all artifacts they control.', 'Each player sacrifices a creature they control.'],
  },
  'iterating-controller': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'], power: { op: '<=', value: 2 }, controller: C6_ITERATING } }, min: 1, max: 1, perPlayer: C6_EACH_PLAYER, as: 'chosen' } as EffectStep,
      { op: 'destroy', what: bound('chosen') } as EffectStep,
    ]),
    readings: [
      'For each player, choose a creature with power 2 or less that player controls. Destroy those creatures.',
      'For each player, choose a creature that player controls with power 2 or less. Destroy those creatures.',
      'For each player, choose a creature with power 2 or less they control. Destroy those creatures.',
    ],
    near: ['For each player, choose a creature with power 2 or less you control. Destroy those creatures.', 'For each player, choose a creature with power 3 or less that player controls. Destroy those creatures.'],
  },
} satisfies Record<string, Example>);

// CLOUD C9 (cloud batch 3): wide "instead" folds and "search for any card"
const C9_ALL_CREATURES = { ref: 'each' as const, filter: { types: ['Creature'] } };
const C9_GAINED = { cond: 'happened', event: { ev: 'life', change: 'gain', player: 'you' }, scope: 'turn' };
Object.assign(EXAMPLES, {
  'search-any-card': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: {}, max: 1, as: 's' } as EffectStep,
      { op: 'move', what: bound('s'), to: { zone: 'hand' } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
    ]),
    readings: ['Search your library for a card, put it into your hand, then shuffle.', 'Search your library for any card, put it into your hand, then shuffle.'],
    near: ['Search your library for any two cards, put them into your hand, then shuffle.', 'Search your library for any creature card, put it into your hand, then shuffle.'],
  },
  'wide-instead': {
    def: spell([{
      op: 'if', cond: C9_GAINED,
      then: [{ op: 'destroy', what: C9_ALL_CREATURES } as EffectStep],
      else: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: C9_ALL_CREATURES, mods: [{ layer: '7c', power: -1, toughness: -1 }] }] } as EffectStep],
    } as EffectStep]),
    readings: [
      'If you gained life this turn, destroy all creatures. Otherwise, all creatures get -1/-1 until end of turn.',
      'All creatures get -1/-1 until end of turn. If you gained life this turn, destroy all creatures instead.',
      'All creatures get -1/-1 until end of turn. If you gained life this turn, instead destroy all creatures.',
    ],
    near: ['All creatures get -1/-1 until end of turn. If you gained life this turn, destroy all creatures.', 'Destroy all creatures. If you gained life this turn, all creatures get -1/-1 until end of turn instead.'],
  },
} satisfies Record<string, Example>);

// C10 (cloud batch 3): the graveyard permissions (zz-cloud/c10.json; render/stat.ts#graveyardPermit, render/abil.ts)
const C10_ART = { types: ['Artifact'], stackKind: 'spell', zone: 'stack' };
const c10Cast = (extra: Record<string, unknown> = {}): StaticEffect => ({ s: 'permit', who: you, action: 'cast', of: C10_ART, from: 'graveyard', ...extra } as unknown as StaticEffect);
const c10Static = (effects: StaticEffect[], level: Record<string, unknown> = {}): AbilityDef => ({ kind: 'static', text: '', ...level, effects } as unknown as AbilityDef);
const C10_LIFE = { other: [{ kind: 'payLife', amount: 3 }] };
const C10_FINALITY = [{ kind: 'finality', count: 1 }];
Object.assign(EXAMPLES, {
  'graveyard-permit-other-costs': {
    def: statics([c10Cast({ addCost: C10_LIFE })]),
    readings: ['You may cast artifact spells from your graveyard by paying 3 life in addition to paying their other costs.', 'You may cast artifact spells from your graveyard by paying 3 life in addition to their other costs.'],
    near: ['You may cast artifact spells from your graveyard by paying 3 life rather than paying their mana costs.', 'You may cast artifact spells from your graveyard by paying 2 life in addition to paying their other costs.'],
  },
  'graveyard-permit-rider-noun': {
    def: statics([c10Cast({ entersWith: C10_FINALITY })]),
    readings: ['You may cast artifact spells from your graveyard. If you cast a spell this way, that artifact enters with a finality counter on it.', 'You may cast artifact spells from your graveyard. If you cast a spell this way, it enters with a finality counter on it.'],
    near: ['You may cast artifact spells from your graveyard. If you cast a spell this way, that artifact enters with a shield counter on it.', 'You may cast artifact spells from your graveyard. If you do, that artifact enters with a finality counter on it.'],
  },
  'once-during-your-turns': {
    def: c10Static([{ s: 'permit', who: you, action: 'cast', of: { types: ['Creature'], stackKind: 'spell', zone: 'stack' }, from: 'graveyard', oncePerTurn: true } as unknown as StaticEffect], { condition: { cond: 'turnOf', whose: 'you' } }),
    readings: ['Once during each of your turns, you may cast a creature spell from your graveyard.', "As long as it's your turn, once each turn, you may cast a creature spell from your graveyard."],
    near: ['Once during each of your turns, you may cast a creature spell from your hand.', 'Once each turn, you may cast a creature spell from your graveyard.'],
  },
  'this-turn-exile-that-card': {
    def: spell([effectStep([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { isCard: true, owner: 'you' }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } } as unknown as StaticEffect], { d: 'endOfTurn' })]),
    readings: ['If a card would be put into your graveyard from anywhere this turn, exile that card instead.', 'If a card would be put into your graveyard from anywhere this turn, exile it instead.'],
    near: ["If a card would be put into an opponent's graveyard from anywhere this turn, exile that card instead.", 'If a card would be put into your graveyard from anywhere this turn, put it into your hand instead.'],
  },
  // Cloud C3 follow-up (cloud batch 3)
  'untap-steps-plural': {
    def: statics([{ s: 'restrict', subject: { ref: 'each', filter: { types: ['Artifact'] } }, mode: 'cant', action: 'untapDuringUntapStep' } as StaticEffect]),
    readings: ["Artifacts don't untap during their controllers' untap steps.", "Artifacts don't untap during their controller's untap step."],
    near: ["Artifacts don't untap during their controllers' next untap steps.", "Creatures don't untap during their controllers' untap steps.", "Artifacts untap during their controllers' untap steps."],
  },
  // Cloud r3-repl (Standard round 3)
  'instead-first': {
    def: statics([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }, body: { b: 'instead', do: [{ op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'exile' } }, { op: 'gainLife', who: you, amount: 3 }] } } as unknown as StaticEffect]),
    readings: ['If a creature an opponent controls would die, instead exile it and you gain 3 life.', 'If a creature an opponent controls would die, exile it and you gain 3 life instead.'],
    near: ['If a creature an opponent controls would die, instead exile it and you gain 2 life.', 'If a creature an opponent controls would die, instead destroy it and you gain 3 life.'],
  },
  'each-with-plural': {
    def: spell([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'battlefield' } } as unknown as EffectStep], [{ id: 't0', kind: 'object', min: 0, max: 2, filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', manaValue: { op: '<=', value: 2 } } } as unknown as TargetSpec]),
    readings: ['Return up to two target creature cards with mana value 2 or less from your graveyard to the battlefield.', 'Return up to two target creature cards each with mana value 2 or less from your graveyard to the battlefield.'],
    near: ['Return up to two target creature cards each with mana value 3 or less from your graveyard to the battlefield.', 'Return up to two target creature cards each with power 2 or less from your graveyard to the battlefield.'],
  },
  'mill-they': {
    def: statics([{ s: 'replace', replaces: { ev: 'action', verb: 'mill', actor: 'opponent' }, body: { b: 'modify', count: { add: 2 } } } as unknown as StaticEffect]),
    readings: ['If an opponent would mill one or more cards, they mill that many cards plus two instead.', 'If an opponent would mill one or more cards, that player mills that many cards plus two instead.'],
    near: ['If an opponent would mill one or more cards, they mill that many cards plus three instead.', 'If you would mill one or more cards, they mill that many cards plus two instead.'],
  },
  // r3-cost (Standard round 3)
  'damage-dealt-amount': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: { q: 'eventAmount' } } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['Whenever Test Card deals combat damage to a player, you gain that much life.', 'Whenever Test Card deals combat damage to a player, you gain life equal to the amount of damage dealt.'],
    near: ['Whenever Test Card deals combat damage to a player, you gain life equal to the amount of life lost.', 'Whenever Test Card deals combat damage to a player, you gain that much life twice.'],
  },
  'behold-spelled-out': {
    def: { kind: 'static', text: '', zone: ['stack'], effects: [{ s: 'additionalCost', cost: { other: [{ kind: 'behold', filter: { types: ['Creature'] }, count: 1 }] } } as StaticEffect] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Sorcery'] },
    readings: ['As an additional cost to cast Test Card, behold a creature.', 'As an additional cost to cast Test Card, choose a creature you control or reveal a creature card from your hand.'],
    near: ['As an additional cost to cast Test Card, choose a creature you control and reveal a creature card from your hand.', 'As an additional cost to cast Test Card, choose an artifact you control or reveal an artifact card from your hand.'],
  },
  'mana-amount-before': {
    def: spell([{ op: 'addMana', who: you, dynamic: { kind: 'ofType', type: 'R', count: 6 } } as EffectStep]),
    readings: ['Add six {R}.', 'Add an amount of {R} equal to 6.'],
    near: ['Add six {G}.', 'Add six {R}{R}.', 'Add five {R}.'],
  },
} satisfies Record<string, Example>);

// r3-choose (Standard round 3): targets, choices and modes (zz-cloud/r3-choose.json)
const R3_PLAYERS: TargetSpec = { id: 'p', kind: 'player', min: 0, max: 'any', text: '' } as TargetSpec;
const R3_OPPONENT: TargetSpec = { id: 'p', kind: 'player', min: 1, max: 1, text: '', players: { who: 'opponent' } } as TargetSpec;
const R3_DOUBLE: StaticEffect = { s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: { q: 'stat', stat: 'power', of: t('c') }, toughness: { q: 'stat', stat: 'toughness', of: t('c') } }] } as unknown as StaticEffect;
const r3Gains = (keyword: string): StaticEffect => ({ s: 'continuous', affects: t('c'), mods: [{ layer: 6, add: [{ kind: 'keyword', keyword, text: keyword }] }] } as unknown as StaticEffect);
Object.assign(EXAMPLES, {
  'protection-each-color': {
    def: { kind: 'keyword', keyword: 'protection', quality: 'color:any', text: '' } as AbilityDef,
    line: [{ kind: 'keyword', keyword: 'protection', quality: 'color:any', text: '' }],
    readings: ['Protection from each color', 'Protection from all colors'],
    near: ['Protection from each creature', 'Protection from red'],
  },
  'total-number-of': {
    def: spell([{ op: 'action', action: 'investigate', who: you, n: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: t('p') } } } } as unknown as EffectStep], [R3_PLAYERS]),
    readings: [
      'Choose any number of target players. Investigate X times, where X is the total number of creatures those players control.',
      'Choose any number of target players. Investigate X times, where X is the number of creatures those players control.',
    ],
    near: ['Choose any number of target players. Investigate X times, where X is the total number of lands those players control.', 'Choose any number of target players. Investigate X times, where X is the total number of creatures you control.'],
  },
  'double-and-gains-duration': {
    def: spell([effectStep([R3_DOUBLE, r3Gains('flying')], { d: 'endOfTurn' })], [objTarget('c')]),
    readings: ["Until end of turn, double target creature's power and toughness and it gains flying.", "Double target creature's power and toughness and it gains flying until end of turn."],
    near: ["Until end of turn, double target creature's power and toughness and it gains trample.", "Until end of turn, double target creature's power and it gains flying."],
  },
  'targets-each-again': {
    def: spell([draw(1, t('p') as unknown as PlayerRef)], [R3_PLAYERS]),
    readings: ['Choose any number of target players. Those players each draw a card.', 'Choose any number of target players. Those players draw a card.', 'Any number of target players each draw a card.'],
    near: ['Choose any number of target players. Those players each draw two cards.', 'Choose any number of target players. Those players each discard a card.'],
  },
  'chosen-target-player': {
    def: spell([draw(1), { op: 'loseLife', who: t('p'), amount: 2 } as unknown as EffectStep], [R3_OPPONENT]),
    readings: ['Choose target opponent. Draw a card. Then the chosen player loses 2 life.', 'Draw a card. Target opponent loses 2 life.', 'Choose target opponent. Draw a card. Then that player loses 2 life.'],
    near: ['Choose target opponent. Draw a card. Then the chosen player loses 3 life.', 'Choose target player. Draw a card. Then the chosen player loses 2 life.'],
  },
  'return-self-by-name': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 3 }] }, effect: { targets: [], steps: [
      { op: 'move', what: self, to: { zone: 'exile' }, as: 'b0' },
      { op: 'move', what: bound('b0'), to: { zone: 'battlefield', controller: { ref: 'anOpponent' } } },
    ] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ["{3}: Exile Test Card, then return it to the battlefield under an opponent's control.", "{3}: Exile Test Card, then return Test Card to the battlefield under an opponent's control."],
    near: ["{3}: Exile Test Card, then return it to the battlefield under your control.", "{3}: Exile Test Card, then return it to your hand."],
  },
} satisfies Record<string, Example>);

// Standard merge wave 4: r3-choose's and cmd1's readings of a counted number of investigations
Object.assign(EXAMPLES, {
  'investigate-times-for-each': {
    def: spell([{ op: 'action', action: 'investigate', who: you, n: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } as unknown as EffectStep]),
    readings: ['Investigate X times, where X is the number of creatures you control.', 'Investigate once for each creature you control.'],
    near: ['Investigate once for each creature an opponent controls.', 'Investigate twice for each creature you control.', 'Investigate X times, where X is the number of lands you control.'],
  },
} satisfies Record<string, Example>);

// Standard round 3, r3-fx (zz-cloud/r3-fx.json): readings added to existing groups
Object.assign(EXAMPLES, {
  'plural-name-events': {
    def: trig([{ ev: 'attacks', attacker: { self: true } }, { ev: 'blocks', blocker: { self: true } }] as EventPattern[], [draw()]),
    ctx: creature,
    readings: ['Whenever Test Card attacks or blocks, draw a card.', 'Whenever Test Card attack or block, draw a card.'],
    near: ['Whenever Test Card attacks, draw a card.', 'Whenever Test Card attacks or becomes blocked, draw a card.'],
  },
  'hand-size-your-hand': {
    def: trig([{ ev: 'step', step: 'upkeep', whose: 'you' }], [draw()], { interveningIf: { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: you }, op: '>=', right: 4 } }),
    ctx: creature,
    readings: ['At the beginning of your upkeep, if you have four or more cards in your hand, draw a card.', 'At the beginning of your upkeep, if you have four or more cards in hand, draw a card.'],
    near: ['At the beginning of your upkeep, if you have four or more cards in your graveyard, draw a card.', "At the beginning of your upkeep, if you have four or more cards in an opponent's hand, draw a card."],
  },
  'subtype-card-set-and': {
    def: spell([{ op: 'move', what: { ref: 'each', filter: { subtypes: ['Zombie', 'Vampire'], zone: 'graveyard', owner: 'you', isCard: true } }, to: { zone: 'battlefield', controller: you } } as EffectStep]),
    readings: ['Return all Zombie and Vampire cards from your graveyard to the battlefield.', 'Return all Zombie or Vampire cards from your graveyard to the battlefield.', 'Return all Zombie and/or Vampire cards from your graveyard to the battlefield.'],
    near: ['Return all Zombie and Vampire cards from your graveyard to your hand.', 'Return all Zombie and Goblin cards from your graveyard to the battlefield.', 'Return all Zombie cards from your graveyard to the battlefield.'],
  },
  'self-by-name-after-move': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 4 }] }, effect: { targets: [], steps: [
      { op: 'move', what: self, to: { zone: 'exile' }, as: 'gone' } as EffectStep,
      { op: 'move', what: bound('gone'), to: { zone: 'battlefield', controller: 'owner', transformed: true } } as EffectStep,
    ] } } as AbilityDef,
    ctx: creature,
    readings: ["{4}: Exile ~, then return ~ to the battlefield transformed under ~'s owner's control.", "{4}: Exile ~, then return it to the battlefield transformed under its owner's control."],
    near: ["{4}: Exile ~, then return ~ to the battlefield transformed under your control.", "{4}: Exile ~, then return ~ to the battlefield under ~'s owner's control."],
  },
  'moved-group-plural': {
    def: spell([
      { op: 'move', what: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true } }, to: { zone: 'battlefield', controller: you }, as: 'them' } as EffectStep,
      effectStep([{ s: 'continuous', affects: bound('them'), mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste' }] }] } as StaticEffect], { d: 'endOfTurn' }),
    ]),
    readings: ['Return all creature cards from your graveyard to the battlefield. They gain haste until end of turn.', 'Return all creature cards from your graveyard to the battlefield. Those creatures gain haste until end of turn.'],
    near: ['Return all creature cards from your graveyard to the battlefield. It gains haste until end of turn.', 'Return all creature cards from your graveyard to the battlefield. Creatures you control gain haste until end of turn.'],
  },
} satisfies Record<string, Example>);

// CLOUD cmd5: a draw and a loss of life with one X, two token creations sharing "create", a cast restriction during combat
const CMD5_ELVES: Quantity = { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } };
Object.assign(EXAMPLES, {
  // Standard round 4, r4-fxz
  'where-x-then-if-x': {
    def: spell([
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: self, mods: [{ layer: '7c', power: TDM_LANDS, toughness: 0 }] }] } as unknown as EffectStep,
      { op: 'if', cond: { cond: 'compare', left: TDM_LANDS, op: '>=', right: 4 }, then: [gain(2)] } as unknown as EffectStep,
    ]),
    ctx: creature,
    readings: ['~ gets +X/+0 until end of turn, where X is the number of lands you control. If X is 4 or more, you gain 2 life.'],
    near: ['~ gets +X/+0 until end of turn, where X is the number of lands you control. If X is 5 or more, you gain 2 life.', '~ gets +X/+0 until end of turn, where X is the number of lands you control. If X is 4 or less, you gain 2 life.', '~ gets +X/+0 until end of turn, where X is the number of creatures you control. If X is 4 or more, you gain 2 life.'],
  },
  'draw-computed-where-x': {
    def: spell([{ op: 'draw', who: you, count: TDM_LANDS } as EffectStep]),
    readings: ['Draw X cards, where X is the number of lands you control.', 'Draw a card for each land you control.'],
    near: ['Draw X cards, where X is the number of creatures you control.', 'Discard X cards, where X is the number of lands you control.'],
  },
  'zones-and-or': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Land'], zone: ['hand', 'graveyard'], owner: 'you' } }, min: 0, max: 2, as: 'put' } as unknown as EffectStep,
      { op: 'move', what: bound('put'), to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
    ]),
    readings: ['Put up to two land cards from your hand and/or graveyard onto the battlefield tapped.', 'Put up to two land cards from your hand or graveyard onto the battlefield tapped.'],
    near: ['Put up to two land cards from your hand and/or library onto the battlefield tapped.', 'Put up to two land cards from your hand and graveyard onto the battlefield tapped.'],
  },
  'counted-that-many': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { controller: 'you', anyOf: [{ types: ['Artifact'] }, { types: ['Enchantment'] }, { token: true }] } }, min: 0, max: 'any', as: 'toSacrifice' } as unknown as EffectStep,
      { op: 'sacrifice', what: bound('toSacrifice'), as: 'sacrifice' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true } }, min: { q: 'resultCount', step: 'sacrifice' }, max: { q: 'resultCount', step: 'sacrifice' }, as: 'returned' } as unknown as EffectStep,
      { op: 'move', what: bound('returned'), to: { zone: 'battlefield', controller: you } } as EffectStep,
    ]),
    readings: ['Sacrifice any number of artifacts, enchantments, and/or tokens. Return that many creature cards from your graveyard to the battlefield.'],
    near: ['Sacrifice any number of artifacts, enchantments, and/or tokens. Return that many creature cards from your graveyard to your hand.', 'Sacrifice any number of artifacts, enchantments, and/or tokens. Return two creature cards from your graveyard to the battlefield.'],
  },
  'from-all-graveyards': {
    def: spell([{ op: 'move', what: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', isCard: true } }, to: { zone: 'battlefield', controller: you } } as EffectStep]),
    readings: ['Put all creature cards from all graveyards onto the battlefield under your control.', 'Put all creature cards in all graveyards onto the battlefield under your control.'],
    near: ['Put all creature cards from your graveyard onto the battlefield under your control.', 'Put all creature cards from all graveyards onto the battlefield under their owners\' control.'],
  },
  'discard-that-many-event': {
    def: trig([{ ev: 'life', change: 'loss', player: 'you' }], [{ op: 'discard', who: you, count: { q: 'eventAmount' } } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['Whenever you lose life, discard that many cards.'],
    near: ['Whenever you lose life, discard a card.', 'Whenever you gain life, discard that many cards.'],
  },
  'self-from-hand': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 2 }] }, zone: ['hand'], effect: { targets: [], steps: [{ op: 'move', what: { ref: 'self' }, to: { zone: 'battlefield', controller: { ref: 'you' } } }] } } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Land'] },
    readings: ['{2}: Put ~ from your hand onto the battlefield.', '{2}: Put ~ onto the battlefield.'],
    near: ['{2}: Put ~ from your graveyard onto the battlefield.', '{2}: Put ~ from your hand onto the battlefield tapped.'],
  },
  'unless-that-player-either': {
    def: spell([mkmPunisher('opponent', [MKM_SAC_CREATURE, { kind: 'discard', count: 1 }], { op: 'loseLife', who: MKM_EACH, amount: 3 } as unknown as EffectStep)]),
    readings: [
      'Each opponent loses 3 life unless they sacrifice a creature or discard a card.',
      'Each opponent loses 3 life unless that player sacrifices a creature of their choice or discards a card.',
      'Each opponent loses 3 life unless that player sacrifices a creature or discards a card.',
    ],
    near: [
      'Each opponent loses 3 life unless that player sacrifices a creature of your choice or discards a card.',
      'Each opponent loses 3 life unless you sacrifice a creature or discard a card.',
      'Each opponent loses 3 life unless that player discards a card or sacrifices a creature.',
      'Each opponent loses 3 life unless that player sacrifice a creature or discard a card.',
    ],
  },
  'life-draw-where-x': {
    def: spell([{ op: 'let', name: 'whereX', value: CMD5_ELVES } as EffectStep, { op: 'draw', who: you, count: { q: 'var', name: 'whereX' } } as EffectStep, { op: 'loseLife', who: you, amount: { q: 'var', name: 'whereX' } } as EffectStep]),
    readings: ['You draw X cards and lose X life, where X is the number of Elves you control.', 'You draw X cards and you lose X life, where X is the number of Elves you control.'],
    near: ['You draw X cards and you lose X life, where X is the number of Goblins you control.', 'You draw X cards and you gain X life, where X is the number of Elves you control.'],
  },
  'token-and-token': {
    def: spell([
      { op: 'createToken', who: you, count: 1, token: { predefined: 'Treasure' } } as EffectStep,
      { op: 'createToken', who: you, count: 1, token: { colors: ['G'], types: ['Creature'], subtypes: ['Squirrel'], power: 1, toughness: 1 } } as EffectStep,
    ]),
    readings: ['Create a Treasure token and a 1/1 green Squirrel creature token.', 'Create a Treasure token. Create a 1/1 green Squirrel creature token.'],
    near: ['Create a Treasure token and a 2/2 green Squirrel creature token.', 'Create a Food token and a 1/1 green Squirrel creature token.'],
  },
  'energy-count-words': {
    def: { kind: 'activated', text: '', cost: { tap: true, other: [{ kind: 'payEnergy', amount: 6 }] }, effect: { targets: [], steps: [draw(2)] } } as unknown as AbilityDef,
    readings: ['{T}, Pay six {E}: Draw two cards.', '{T}, Pay {E}{E}{E}{E}{E}{E}: Draw two cards.'],
    near: ['{T}, Pay five {E}: Draw two cards.', '{T}, Pay six {E}: Draw three cards.'],
  },
  'restriction-during-combat': {
    def: statics([{ s: 'restrict', subject: { ref: 'each', who: 'opponent' }, mode: 'cant', action: 'cast', when: { cond: 'turnOf', whose: 'any', step: ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'] } } as StaticEffect]),
    ctx: unknown,
    readings: ["Your opponents can't cast spells during combat."],
    near: ["Your opponents can't cast spells during your turn.", "Your opponents can't activate abilities during combat."],
  },
} satisfies Record<string, Example>);

// r3-copy (Standard round 3): copy exceptions said with one subject or of the card itself, a group that becomes copies, the new targets of an optional copy
const R3_HASTE = { kind: 'keyword', keyword: 'haste', text: 'haste' } as unknown as AbilityDef;
const R3_HEXPROOF = { kind: 'keyword', keyword: 'hexproof', text: 'hexproof' } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'copy-exceptions-one-subject': {
    def: spell([{ op: 'copy', what: t('c'), result: 'token', who: you, except: [{ layer: 4, supertypes: { remove: ['Legendary'] } }, { layer: 4, subtypes: { add: ['Reflection'] } }, { layer: 6, add: [R3_HASTE] }] } as EffectStep], [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    readings: [
      "Create a token that's a copy of target creature you control, except it isn't legendary, is a Reflection in addition to its other types, and has haste.",
      "Create a token that's a copy of target creature you control, except it isn't legendary, it's a Reflection in addition to its other types, and it has haste.",
    ],
    near: [
      "Create a token that's a copy of target creature you control, except it isn't legendary, is a Spirit in addition to its other types, and has haste.",
      "Create a token that's a copy of target creature you control, except it isn't legendary, is a Reflection in addition to its other types, and has flying.",
    ],
  },
  'copy-exception-self-name': {
    def: trig([{ ev: 'step', step: 'beginCombat', whose: 'you' } as EventPattern], [effectStep([{ s: 'continuous', affects: self, mods: [{ layer: '1a', copyOf: t('c'), except: [{ layer: 6, add: [R3_HEXPROOF] }] }] } as StaticEffect], { d: 'endOfTurn' })], {}, [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    ctx: creature,
    readings: [
      'At the beginning of combat on your turn, Test Card becomes a copy of target creature you control until end of turn, except Test Card has hexproof.',
      'At the beginning of combat on your turn, Test Card becomes a copy of target creature you control until end of turn, except it has hexproof.',
    ],
    near: [
      'At the beginning of combat on your turn, Test Card becomes a copy of target creature you control until end of turn, except Test Card has flying.',
      'At the beginning of combat on your turn, Test Card becomes a copy of target creature you control, except Test Card has hexproof.',
    ],
  },
  'become-copies-plural': {
    def: spell([effectStep([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } }, mods: [{ layer: '1a', copyOf: t('c') }] } as StaticEffect], { d: 'endOfTurn' })], [objTarget('c')]),
    readings: ['Artifacts you control become copies of target creature until end of turn.', 'Artifacts you control become a copy of target creature until end of turn.'],
    near: ['Artifacts you control become copies of target creature.', 'Creatures you control become copies of target creature until end of turn.'],
  },
  'copy-if-you-do-new-targets': {
    def: spell([{ op: 'copy', what: t('s'), result: 'spell', who: you, newTargets: 'may' } as EffectStep], [objTarget('s', { types: ['Instant'] }, { kind: 'spell' })]),
    readings: ['Copy target instant spell. You may choose new targets for the copy.', 'Copy target instant spell. If you do, you may choose new targets for the copy.'],
    near: ['Copy target sorcery spell. If you do, you may choose new targets for the copy.', 'Copy target instant spell. If you do, you may choose new targets for the copies.'],
  },
} satisfies Record<string, Example>);
// Standard round 3, r3-trig
Object.assign(EXAMPLES, {
  'activated-loyalty-perfect': {
    def: trig([{ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 } }], [draw()], { batch: true, interveningIf: { cond: 'happened', event: { ev: 'activate', player: 'you', ability: 'loyalty' }, scope: 'turn' } }),
    ctx: creature,
    readings: ["Whenever you attack, if you've activated a loyalty ability this turn, draw a card.", 'Whenever you attack, if you activated a loyalty ability this turn, draw a card.'],
    near: ["Whenever you attack, if you've activated an ability this turn, draw a card.", "Whenever you attack, if you've activated a loyalty ability, draw a card."],
  },
  'attack-total-power': {
    def: trig([{ ev: 'attacks', attacker: { controller: 'you' }, count: { op: '>=', value: 1 }, power: { op: '>=', value: 8 } }], [draw()], { batch: true }),
    ctx: creature,
    readings: ['Whenever you attack with creatures with total power 8 or greater, draw a card.', 'Whenever you attack with creatures with total power 8 or more, draw a card.'],
    near: ['Whenever you attack with creatures with total power 7 or greater, draw a card.', 'Whenever you attack with eight or more creatures, draw a card.'],
  },
  'type-add-has-is': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield' }, as: 'm' } as EffectStep, { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: bound('m'), mods: [
      { layer: 4, subtypes: { add: ['Zombie'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'haste', text: 'Haste' }] },
    ] }] } as EffectStep], [objTarget('c', { types: ['Creature'], zone: 'graveyard', isCard: true, owner: 'you' })]),
    readings: [
      'Return target creature card from your graveyard to the battlefield. It has haste and is a Zombie in addition to its other types.',
      'Return target creature card from your graveyard to the battlefield. It becomes a Zombie in addition to its other types and gains haste.',
    ],
    near: [
      'Return target creature card from your graveyard to the battlefield. It has haste and is a Spirit in addition to its other types.',
      'Return target creature card from your graveyard to the battlefield. It has haste until end of turn and is a Zombie in addition to its other types.',
    ],
  },
  'copy-guard-new-targets': {
    def: trig([{ ev: 'cast', player: 'you', spell: { self: true } }], [{ op: 'copy', what: self, result: 'spell', who: you, guard: { cond: 'happened', event: { ev: 'life', change: 'gain', player: 'you' }, scope: 'turn' }, newTargets: 'may' } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Instant'] },
    readings: ['When you cast this spell, copy it if you gained life this turn. You may choose new targets for the copy.'],
    near: ['When you cast this spell, copy it. You may choose new targets for the copy if you gained life this turn.', 'When you cast this spell, copy it if you lost life this turn. You may choose new targets for the copy.'],
  },
} satisfies Record<string, Example>);

// Standard round 3, r3-moved: what a cost moved, said "this way"; a reflexive trigger in the present tense; a choice of up to one (render/moved.ts, fold.ts)
const R3M_ALTAR = (cond: unknown): AbilityDef => ({ kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'sacrifice', filter: { types: ['Creature'], other: true }, count: 1 }] }, effect: { targets: [], steps: [draw(1), { op: 'if', cond, then: [gain(2)] } as EffectStep] } } as unknown as AbilityDef);
Object.assign(EXAMPLES, {
  'moved-this-way-cost': {
    def: R3M_ALTAR({ cond: 'matches', object: { ref: 'costSacrificed' }, filter: { subtypes: ['Goblin'] } }),
    ctx: creature,
    readings: [
      '{1}, Sacrifice another creature: Draw a card. If a Goblin was sacrificed this way, you gain 2 life.',
      '{1}, Sacrifice another creature: Draw a card. If at least one Goblin was sacrificed this way, you gain 2 life.',
      '{1}, Sacrifice another creature: Draw a card. If the sacrificed creature was a Goblin, you gain 2 life.',
    ],
    near: ['{1}, Sacrifice another creature: Draw a card. If a Goblin was destroyed this way, you gain 2 life.', '{1}, Sacrifice another creature: Draw a card. If an Elf was sacrificed this way, you gain 2 life.'],
  },
  'moved-this-way-present': {
    def: spell([
      draw(1),
      { op: 'discard', who: you, count: 1, as: 'd' } as EffectStep,
      { op: 'reflexive', when: { did: 'd', if: { cond: 'did', step: 'd', which: { notTypes: ['Land'], isCard: true, owner: 'you' } } }, targets: [], do: [gain(2)] } as EffectStep,
    ]),
    readings: ['Draw a card, then discard a card. When you discard a nonland card this way, you gain 2 life.', 'Draw a card, then discard a card. When you discarded a nonland card this way, you gain 2 life.'],
    near: ['Draw a card, then discard a card. When you discard a land card this way, you gain 2 life.', 'Draw a card, then discard a card. When you sacrifice a nonland card this way, you gain 2 life.'],
  },
  'moved-this-way-cost-count': {
    def: { kind: 'activated', text: '', cost: { tap: true, other: [{ kind: 'exileFrom', zone: 'graveyard', count: 'any' }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: { q: 'count', of: { ref: 'costExiled' } } } as EffectStep] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['{T}, Exile any number of cards from your graveyard: You gain life equal to the number of cards exiled this way.'],
    near: ['{T}, Exile any number of cards from your graveyard: You gain life equal to the number of cards discarded this way.', '{T}, Exile any number of cards from your graveyard: You gain life equal to the number of cards exiled this turn.'],
  },
  'up-to-one-put': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Land'], zone: 'graveyard', owner: 'you', isCard: true } }, min: 0, max: 1, as: 'put' } as EffectStep,
      { op: 'move', what: bound('put'), to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
    ]),
    readings: ['You may put a land card from your graveyard onto the battlefield tapped under your control.', 'Put up to one land card from your graveyard onto the battlefield tapped under your control.'],
    near: ['Put up to two land cards from your graveyard onto the battlefield tapped under your control.', 'Put up to one land card from your graveyard onto the battlefield under your control.'],
  },
} satisfies Record<string, Example>);

// Standard round 3, r3-refs: the readings of its families (invented wordings, design 6.10)
const R3REFS_DAMAGED: EventPattern = { ev: 'damage', recipient: { object: { self: true } } } as EventPattern;
const R3REFS_ATTACKS: EventPattern = { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' }, alone: true } as unknown as EventPattern;
Object.assign(EXAMPLES, {
  'extra-phase-after-and': {
    def: trig([R3REFS_DAMAGED], [{ op: 'untap', what: self } as EffectStep, { op: 'extraPhase', phase: 'combat' } as EffectStep]),
    ctx: creature,
    readings: ['Whenever Test Card is dealt damage, untap Test Card and there is an additional combat phase after this phase.', 'Whenever Test Card is dealt damage, untap Test Card. After this phase, there is an additional combat phase.'],
    near: ['Whenever Test Card is dealt damage, untap Test Card and there is an additional main phase after this phase.', 'Whenever Test Card is dealt damage, untap Test Card and there is an additional combat phase after this turn.'],
  },
  'delayed-trigger-sentences': {
    def: spell([{ op: 'delay', when: { at: 'event', event: R3REFS_ATTACKS }, duration: { d: 'endOfTurn' }, do: [
      { op: 'putCounters', on: { ref: 'event', role: 'attacker' }, kind: '+1/+1', count: 2 } as EffectStep,
      effectStep([{ s: 'continuous', affects: { ref: 'event', role: 'attacker' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'menace', text: 'menace' }] }] } as StaticEffect], { d: 'endOfTurn' }),
    ] } as EffectStep]),
    readings: ['Whenever a creature you control attacks alone this turn, put two +1/+1 counters on it. It gains menace until end of turn.', 'Whenever a creature you control attacks alone this turn, put two +1/+1 counters on it and it gains menace until end of turn.'],
    near: ['Whenever a creature you control attacks alone this turn, put two +1/+1 counters on it. It gains flying until end of turn.', 'Whenever a creature you control attacks alone this turn, put two +1/+1 counters on it. Draw a card.'],
  },
  'search-and-reveal-one': {
    def: spell([{ op: 'search', who: you, zone: 'library', filter: { types: ['Artifact', 'Land'] }, max: 1, reveal: true, as: 'found' } as EffectStep, { op: 'move', what: bound('found'), to: { zone: 'hand' } } as EffectStep, { op: 'shuffle', who: you } as EffectStep]),
    readings: ['Search your library for an artifact or land card and reveal it. Put it into your hand. Then shuffle.', 'Search your library for an artifact or land card, reveal it, put it into your hand, then shuffle.'],
    near: ['Search your library for an artifact or land card and reveal them. Put it into your hand. Then shuffle.', 'Search your library for an artifact or land card and reveal it. Put it onto the battlefield. Then shuffle.'],
  },
  'search-zones-no-serial-comma': {
    def: spell([{ op: 'search', who: you, zone: 'graveyard', alsoZones: ['hand', 'library'], filter: { types: ['Artifact'] }, max: 1, as: 'found' } as EffectStep, { op: 'move', what: bound('found'), to: { zone: 'battlefield', controller: you } } as EffectStep, { op: 'shuffle', who: you, ifSearched: true } as EffectStep]),
    readings: ['Search your graveyard, hand and/or library for an artifact card and put it onto the battlefield. If you search your library this way, shuffle.', 'Search your graveyard, hand, and/or library for an artifact card and put it onto the battlefield. If you search your library this way, shuffle.'],
    near: ['Search your graveyard, hand or library for an artifact card and put it onto the battlefield. If you search your library this way, shuffle.', 'Search your graveyard and/or library for an artifact card and put it onto the battlefield. If you search your library this way, shuffle.'],
  },
  'linked-put-one-owners-hand': {
    def: spell([{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { is: { ref: 'linked', link: 'exiled' }, zone: 'any', isCard: true } }, min: 1, max: 1, as: 'back' } as EffectStep, { op: 'move', what: bound('back'), to: { zone: 'hand' } } as EffectStep]),
    readings: ["Put a card exiled with Test Card into its owner's hand.", "Return a card exiled with Test Card to its owner's hand.", "Put a card exiled with it into its owner's hand."],
    near: ["Put a card exiled with Test Card into your hand.", "Put each card exiled with Test Card into its owner's hand."],
  },
  'chosen-permanent-counters': {
    def: spell([{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ subtypes: ['Forest'] }], controller: 'you' } }, min: 1, max: 1, as: 'on' } as EffectStep, { op: 'putCounters', on: bound('on'), kind: '+1/+1', count: 2 } as EffectStep]),
    readings: ['Put two +1/+1 counters on a Forest you control.', 'Choose a Forest you control. Put two +1/+1 counters on it.'],
    near: ['Put two +1/+1 counters on target Forest you control.', 'Put two +1/+1 counters on each Forest you control.'],
  },
  'put-card-is-permanent': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Artifact', 'Creature'], zone: 'hand', owner: 'you', isCard: true } }, min: 0, max: 1, as: 'put' } as EffectStep,
      { op: 'move', what: bound('put'), to: { zone: 'battlefield', controller: you } } as EffectStep,
      effectStep([{ s: 'continuous', affects: bound('put'), mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste', text: 'haste' }] }] } as StaticEffect], { d: 'permanent' }),
    ]),
    readings: ['You may put an artifact or creature card from your hand onto the battlefield. That permanent gains haste.', 'You may put an artifact or creature card from your hand onto the battlefield. It gains haste.'],
    near: ['You may put an artifact or creature card from your hand onto the battlefield. That land gains haste.', 'You may put an artifact or creature card from your hand onto the battlefield. That permanent gains flying.'],
  },
  'exiled-group-them': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Artifact'] }], controller: 'you' } }, min: 0, max: 'any', as: 'picked' } as EffectStep,
      { op: 'move', what: bound('picked'), to: { zone: 'exile' }, as: 'gone' } as EffectStep,
      { op: 'move', what: bound('gone'), to: { zone: 'battlefield', controller: 'owner' } } as EffectStep,
    ]),
    readings: ["Exile any number of artifacts you control, then return them to the battlefield under their owner's control.", "Exile any number of artifacts you control, then return those cards to the battlefield under their owner's control."],
    near: ["Exile any number of artifacts you control, then return it to the battlefield under their owner's control.", "Exile any number of artifacts you control, then return them to the battlefield under your control."],
  },
  'per-player-you-choose': {
    def: spell([{ op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Artifact'], controller: { ref: 'iterating' } } }, min: 1, max: 1, perPlayer: { ref: 'each', who: 'player' }, as: 'kept' } as EffectStep, { op: 'destroy', what: bound('kept') } as EffectStep]),
    readings: ['For each player, you choose an artifact that player controls. Destroy those artifacts.', 'For each player, choose an artifact that player controls. Destroy those artifacts.'],
    near: ['For each opponent, you choose an artifact that player controls. Destroy those artifacts.', 'For each player, you choose a creature that player controls. Destroy those artifacts.'],
  },
  'gains-then-loses-other': {
    def: spell([effectStep([{ s: 'continuous', affects: t('a'), mods: [{ layer: 6, removeAll: true, add: [{ kind: 'keyword', keyword: 'flying', text: 'flying' }] }] } as StaticEffect], { d: 'permanent' })], [objTarget('a')]),
    readings: ['Target creature gains flying and loses all other abilities.', 'Target creature loses all abilities and gains flying.'],
    near: ['Target creature gains flying and loses all abilities.', 'Target creature gains reach and loses all other abilities.'],
  },
  'additional-card-for-each': {
    def: trig([{ ev: 'step', step: 'draw', whose: 'you' } as EventPattern], [{ op: 'draw', who: you, count: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, sizeIs: { zone: 'hand', op: '<=', n: 2 } } } as EffectStep]),
    ctx: unknown,
    readings: ['At the beginning of your draw step, draw an additional card for each opponent who has two or fewer cards in hand.', 'At the beginning of your draw step, draw a card for each opponent who has two or fewer cards in hand.'],
    near: ['At the beginning of your draw step, draw an additional card for each opponent who has two or more cards in hand.', 'At the beginning of your draw step, draw an additional card for each player who has two or fewer cards in hand.'],
  },
} satisfies Record<string, Example>);
// r4-dig (Standard round 4: zz-cloud/r4-dig.json; fourteen reviewed groups, render/equivalence.ts)
Object.assign(EXAMPLES, {
  "r4dig-mill-that-many": {
    def: {"kind":"triggered","text":"","trigger":{"on":[{"ev":"life","change":"loss","player":"any"}]},"effect":{"targets":[],"steps":[{"op":"mill","who":{"ref":"event","role":"player"},"count":{"q":"eventAmount"}}]}} as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever a player loses life, that player mills that many cards."],
    near: ["Whenever a player loses life, that player mills that many cards plus one.", "Whenever a player loses life, you mill that many cards."],
  },
  "r4dig-player-exiles-top-x": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"player","min":1,"max":1,"text":"","players":{"who":"any"}}],"steps":[{"op":"move","what":{"ref":"topCards","player":{"ref":"target","id":"t0"},"count":{"q":"zoneSize","zone":"hand","of":{"ref":"you"}}},"to":{"zone":"exile"}}]}} as unknown as AbilityDef,
    readings: ["Target player exiles the top X cards of their library, where X is the number of cards in your hand."],
    near: ["Target player exiles the top X cards of their library, where X is the number of cards in your graveyard.", "Target player exiles the top X cards of your library, where X is the number of cards in your hand."],
  },
  "r4dig-search-either-description": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"search","who":{"ref":"you"},"zone":"library","filter":{"anyOf":[{"name":"Island"},{"name":"Forest"}]},"max":1,"reveal":true,"as":"search"},{"op":"move","what":{"ref":"bound","name":"search"},"to":{"zone":"hand"}},{"op":"shuffle","who":{"ref":"you"}}]}} as unknown as AbilityDef,
    readings: ["Search your library for a card named Island or Forest, reveal it, put it into your hand, then shuffle."],
    near: ["Search your library for a card named Island and Forest, reveal it, put it into your hand, then shuffle.", "Search your library for a card named Island or Swamp, reveal it, put it into your hand, then shuffle."],
  },
  "r4dig-shuffle-put-it-on-top": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"search","who":{"ref":"you"},"zone":"library","filter":{"anyOf":[{"subtypes":["Forest"]},{"subtypes":["Desert"]}]},"max":1,"reveal":true,"as":"search"},{"op":"shuffle","who":{"ref":"you"}},{"op":"move","what":{"ref":"bound","name":"search"},"to":{"zone":"library","position":"top"}}]}} as unknown as AbilityDef,
    readings: ["Search your library for a Forest card or a Desert card, reveal it, then shuffle and put it on top.", "Search your library for a Forest card or a Desert card, reveal it, then shuffle and put that card on top."],
    near: ["Search your library for a Forest card or a Desert card, reveal it, then shuffle and put it on the bottom.", "Search your library for a Forest card or a Desert card, reveal it, then shuffle and put it into your hand."],
  },
  "r4dig-play-from-exile": {
    def: {"kind":"triggered","text":"","trigger":{"on":[{"ev":"attacks","attacker":{"self":true}}]},"effect":{"targets":[],"steps":[{"op":"move","what":{"ref":"topCards","player":{"ref":"you"},"count":1},"to":{"zone":"exile"},"as":"impulse"},{"op":"effect","duration":{"d":"endOfTurn"},"effects":[{"s":"permit","who":{"ref":"you"},"action":"play","of":{"is":{"ref":"bound","name":"impulse"}}}]}]}} as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever Test Card attacks, exile the top card of your library. You may play that card from exile this turn.", "Whenever Test Card attacks, exile the top card of your library. You may play that card this turn."],
    near: ["Whenever Test Card attacks, exile the top card of your library. You may play that card from your graveyard this turn.", "Whenever Test Card attacks, exile the top card of your library. You may cast that card from exile this turn."],
  },
  "r4dig-up-to-from-among": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"look","who":{"ref":"you"},"at":{"ref":"topCards","player":{"ref":"you"},"count":4},"as":"them"},{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"anyOf":[{"types":["Creature"]}],"is":{"ref":"bound","name":"them"},"zone":"library"}},"min":0,"max":2,"as":"chosen"},{"op":"reveal","who":{"ref":"you"},"what":{"ref":"bound","name":"chosen"}},{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"hand"}},{"op":"move","what":{"ref":"each","filter":{"is":{"ref":"bound","name":"them"},"not":{"is":{"ref":"bound","name":"chosen"}},"zone":"library"}},"to":{"zone":"library","position":"bottom","order":"random"}}]}} as unknown as AbilityDef,
    readings: ["Look at the top four cards of your library. You may reveal up to two creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.", "Look at the top four cards of your library. Reveal up to two creature cards from among them and put those cards into your hand. Put the rest on the bottom of your library in a random order."],
    near: ["Look at the top four cards of your library. You may reveal up to three creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.", "Look at the top four cards of your library. You may reveal two creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order."],
  },
  "r4dig-reveal-top-and-put": {
    def: {"kind":"triggered","text":"","trigger":{"on":[{"ev":"attacks","attacker":{"self":true}}]},"effect":{"targets":[],"steps":[{"op":"reveal","who":{"ref":"you"},"what":{"ref":"topCards","player":{"ref":"you"},"count":1},"as":"them"},{"op":"move","what":{"ref":"bound","name":"them"},"to":{"zone":"hand"}}]}} as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever Test Card attacks, reveal the top card of your library and put it into your hand.", "Whenever Test Card attacks, reveal the top card of your library and put that card into your hand."],
    near: ["Whenever Test Card attacks, reveal the top card of your library and put it into your graveyard.", "Whenever Test Card attacks, reveal the top two cards of your library and put it into your hand."],
  },
  "r4dig-and-or-cards-joined": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"mill","who":{"ref":"you"},"count":4,"as":"them"},{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"anyOf":[{"types":["Creature","Land"]}],"is":{"ref":"bound","name":"them"},"zone":"any"}},"min":0,"max":2,"as":"chosen"},{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"hand"}}]}} as unknown as AbilityDef,
    readings: ["Mill four cards. You may put up to two creature and/or land cards from among the milled cards into your hand.", "Mill four cards. Put up to two creature or land cards from among them into your hand."],
    near: ["Mill four cards. You may put up to two creature and/or artifact cards from among the milled cards into your hand.", "Mill four cards. You may put up to three creature and/or land cards from among the milled cards into your hand."],
  },
  "r4dig-mill-pick-apart": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"mill","who":{"ref":"you"},"count":6,"as":"them"},{"op":"move","what":{"ref":"each","filter":{"anyOf":[{"types":["Creature"]}],"is":{"ref":"bound","name":"them"},"zone":"any"}},"to":{"zone":"hand"}}]}} as unknown as AbilityDef,
    readings: ["Mill six cards. Then put all creature cards from among the milled cards into your hand.", "Mill six cards, then put all creature cards from among them into your hand.", "Mill six cards. Put all creature cards from among those cards into your hand."],
    near: ["Mill six cards. Then put all land cards from among the milled cards into your hand.", "Mill six cards. Then put all creature cards from among the milled cards onto the battlefield."],
  },
  "r4dig-either-card-from-graveyard": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"mill","who":{"ref":"you"},"count":2},{"op":"may","who":{"ref":"you"},"do":[{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"anyOf":[{"types":["Artifact"]},{"types":["Land"]}],"zone":"graveyard","owner":"you","isCard":true}},"min":1,"max":1,"as":"regrow"},{"op":"move","what":{"ref":"bound","name":"regrow"},"to":{"zone":"hand"}}]}]}} as unknown as AbilityDef,
    readings: ["Mill two cards, then you may return an artifact card or a land card from your graveyard to your hand."],
    near: ["Mill two cards, then you may return an artifact card and a land card from your graveyard to your hand.", "Mill two cards, then you may return an artifact card or a creature card from your graveyard to your hand."],
  },
  "r4dig-exile-of-them-face-down": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"player","min":1,"max":1,"text":"","players":{"who":"opponent"}}],"steps":[{"op":"look","who":{"ref":"you"},"at":{"ref":"topCards","player":{"ref":"target","id":"t0"},"count":4},"as":"them"},{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"is":{"ref":"bound","name":"them"},"zone":"library"}},"min":2,"max":2,"as":"chosen"},{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"exile","faceDown":true}},{"op":"move","what":{"ref":"each","filter":{"is":{"ref":"bound","name":"them"},"not":{"is":{"ref":"bound","name":"chosen"}},"zone":"library"}},"to":{"zone":"library","position":"bottom","order":"random"}}]}} as unknown as AbilityDef,
    readings: ["Look at the top four cards of target opponent's library, exile two of them face down, then put the rest on the bottom of their library in a random order.", "Look at the top four cards of target opponent's library. Exile two of them face down and put the rest on the bottom of their library in a random order."],
    near: ["Look at the top four cards of target opponent's library, exile three of them face down, then put the rest on the bottom of their library in a random order.", "Look at the top four cards of target opponent's library, exile two of them face down, then put the rest on top of their library in a random order."],
  },
  "r4dig-any-of-revealed-and-rest": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"revealUntil","who":{"ref":"you"},"filter":{"types":["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]},"count":{"q":"count","of":{"ref":"each","filter":{"subtypes":["Elf"],"controller":"you"}}},"as":"hit","revealed":"revealed"},{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"is":{"ref":"bound","name":"hit"},"zone":"library"}},"min":0,"max":"any","as":"chosen"},{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"battlefield","controller":{"ref":"you"}}},{"op":"move","what":{"ref":"each","filter":{"is":{"ref":"bound","name":"revealed"},"not":{"is":{"ref":"bound","name":"chosen"}},"zone":"library"}},"to":{"zone":"library","position":"bottom","order":"random"}}]}} as unknown as AbilityDef,
    readings: ["Reveal cards from the top of your library until you reveal X permanent cards, where X is the number of Elves you control. Put any number of those permanent cards onto the battlefield, then put the rest of the revealed cards on the bottom of your library in a random order.", "Reveal cards from the top of your library until you reveal X permanent cards, where X is the number of Elves you control. Put any number of those cards onto the battlefield, then put the rest of the revealed cards on the bottom of your library in a random order."],
    near: ["Reveal cards from the top of your library until you reveal X permanent cards, where X is the number of Elves you control. Put any number of those permanent cards into your hand, then put the rest of the revealed cards on the bottom of your library in a random order.", "Reveal cards from the top of your library until you reveal X permanent cards, where X is the number of Goblins you control. Put any number of those permanent cards onto the battlefield, then put the rest of the revealed cards on the bottom of your library in a random order."],
  },
  "r4dig-reveal-x-from-hand": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"player","min":1,"max":1,"text":"","players":{"who":"any"}}],"steps":[{"op":"chooseObjects","who":{"ref":"target","id":"t0"},"from":{"ref":"each","filter":{"zone":"hand","owner":{"ref":"target","id":"t0"}}},"min":{"q":"zoneSize","zone":"graveyard","of":{"ref":"you"}},"max":{"q":"zoneSize","zone":"graveyard","of":{"ref":"you"}},"as":"picked"},{"op":"reveal","who":{"ref":"target","id":"t0"},"what":{"ref":"bound","name":"picked"},"as":"them"}]}} as unknown as AbilityDef,
    readings: ["Target player reveals X cards from their hand, where X is the number of cards in your graveyard.", "Target player reveals a number of cards from their hand equal to the number of cards in your graveyard."],
    near: ["Target player reveals X cards from their hand, where X is the number of cards in your hand.", "Target player reveals X cards from their graveyard, where X is the number of cards in your graveyard."],
  },
  "r4dig-player-looks-and-exiles": {
    def: {"kind":"triggered","text":"","trigger":{"on":[{"ev":"attacks","attacker":{"self":true}}]},"effect":{"targets":[{"id":"t0","kind":"player","min":1,"max":1,"text":"","players":{"who":"any"}}],"steps":[{"op":"look","who":{"ref":"defending"},"at":{"ref":"topCards","player":{"ref":"target","id":"t0"},"count":1},"as":"seen"},{"op":"move","what":{"ref":"bound","name":"seen"},"to":{"zone":"exile","faceDown":true}}]}} as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever Test Card attacks, defending player looks at the top card of target player's library and exiles it face down.", "Whenever Test Card attacks, defending player looks at the top card of target player's library and exiles that card face down."],
    near: ["Whenever Test Card attacks, defending player looks at the top card of target player's library and exiles it.", "Whenever Test Card attacks, defending player looks at the top card of target player's library and puts it into their graveyard."],
  },
  "r4dig-guarded-destroy-after": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"object","min":1,"max":1,"text":"","filter":{"types":["Creature"]}}],"steps":[{"op":"mill","who":{"ref":"you"},"count":2},{"op":"destroy","what":{"ref":"target","id":"t0"},"guard":{"cond":"compare","left":{"q":"stat","stat":"manaValue","of":{"ref":"target","id":"t0"}},"op":"<=","right":{"q":"zoneSize","zone":"graveyard","of":{"ref":"you"}}}}]}} as unknown as AbilityDef,
    readings: ["Choose target creature. Mill two cards, then destroy the chosen creature if its mana value is less than or equal to the number of cards in your graveyard.", "Choose target creature. Mill two cards. If its mana value is the number of cards in your graveyard or less, destroy it."],
    near: ["Choose target creature. Mill two cards, then destroy the chosen creature if its mana value is greater than or equal to the number of cards in your graveyard.", "Choose target creature. Mill two cards, then exile the chosen creature if its mana value is less than or equal to the number of cards in your graveyard."],
  },
  // std-rx22 (CR 701.6a, 608.2c): a guarded counter said instruction first, "Counter target spell if it's blue." (Pyroblast, Hydroblast, Disrupting Shoal)
  "stdrx22-guarded-counter-after": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"spell","min":1,"max":1,"text":""}],"steps":[{"op":"counter","what":{"ref":"target","id":"t0"},"guard":{"cond":"matches","object":{"ref":"target","id":"t0"},"filter":{"colors":["G"]}}}]}} as unknown as AbilityDef,
    readings: ["Counter target spell if it's green.", "If target spell is green, counter it."],
    near: ["Counter target spell unless it's green.", "Counter target spell if it's red.", "Exile target spell if it's green."],
  },
} satisfies Record<string, Example>);

// Standard round 4, r4-moved: "this way" conditions in the present tense, after a search, with the subject left out; a counted creation led by "for each" (render/cond.ts, steps-zones.ts)
const R4M_GOBLIN = { subtypes: ['Goblin'] };
Object.assign(EXAMPLES, {
  'dont-put-into-hand': {
    def: spell([
      { op: 'may', who: you, do: [
        { op: 'search', who: you, zone: 'library', filter: { types: ['Artifact'] }, max: 1, reveal: true, as: 's' },
        { op: 'move', what: bound('s'), to: { zone: 'hand' }, as: 'm' },
        { op: 'shuffle', who: you },
      ] } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'm', not: true, which: { isCard: true }, to: 'hand' }, then: [gain(2)] } as EffectStep,
    ]),
    readings: [
      "You may search your library for an artifact card, reveal it, put it into your hand, then shuffle. If you don't put a card into your hand this way, you gain 2 life.",
      "You may search your library for an artifact card, reveal it, put it into your hand, then shuffle. If you didn't put a card into your hand this way, you gain 2 life.",
    ],
    near: [
      'You may search your library for an artifact card, reveal it, put it into your hand, then shuffle. If you put a card into your hand this way, you gain 2 life.',
      "You may search your library for an artifact card, reveal it, put it into your hand, then shuffle. If you don't put a card onto the battlefield this way, you gain 2 life.",
    ],
  },
  'searched-this-way': {
    def: spell([
      { op: 'may', who: you, do: [
        { op: 'search', who: you, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, max: 1, as: 'search' },
        { op: 'move', what: bound('search'), to: { zone: 'battlefield', controller: you, tapped: true } },
      ], as: 'did' } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'did' }, then: [gain(2)] } as EffectStep,
    ]),
    readings: [
      'You may search your library for a basic land card and put it onto the battlefield tapped. If you do, you gain 2 life.',
      'You may search your library for a basic land card and put it onto the battlefield tapped. If you search your library this way, you gain 2 life.',
    ],
    near: [
      'You may search your library for a basic land card and put it onto the battlefield tapped. If you search your graveyard this way, you gain 2 life.',
      "You may search your library for a basic land card and put it onto the battlefield tapped. If you don't, you gain 2 life.",
    ],
  },
  'returned-subject-left-out': {
    def: spell([
      { op: 'mill', who: you, count: 4, as: 'them' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] }], is: bound('them'), zone: 'any' } }, min: 0, max: 1, as: 'chosen' } as EffectStep,
      { op: 'move', what: bound('chosen'), to: { zone: 'hand' }, as: 'did' } as EffectStep,
      { op: 'if', cond: { cond: 'any', of: [{ cond: 'exists', of: { ref: 'each', filter: { ...R4M_GOBLIN, controller: 'you' } } }, { cond: 'did', step: 'did', which: { ...R4M_GOBLIN, isCard: true }, to: 'hand' }] }, then: [gain(3)] } as EffectStep,
    ]),
    readings: [
      'Mill four cards. You may put a permanent card from among the cards milled this way into your hand. If you control a Goblin or returned a Goblin card to your hand this way, you gain 3 life.',
      'Mill four cards. You may put a permanent card from among the cards milled this way into your hand. If you control a Goblin or you put a Goblin card into your hand this way, you gain 3 life.',
    ],
    near: [
      'Mill four cards. You may put a permanent card from among the cards milled this way into your hand. If you control a Goblin or returned an Elf card to your hand this way, you gain 3 life.',
      'Mill four cards. You may put a permanent card from among the cards milled this way into your hand. If you control a Goblin and returned a Goblin card to your hand this way, you gain 3 life.',
    ],
  },
  'linked-exiled-graveyard': {
    def: { kind: 'activated', text: '', cost: { tap: true }, effect: { targets: [], steps: [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'graveyard' } } as EffectStep] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ["{T}: Put each card exiled with ~ into its owner's graveyard.", "{T}: Put each card exiled with it into its owner's graveyard."],
    near: ["{T}: Put each card exiled with ~ into its owner's hand.", "{T}: Put each card exiled with ~ into your graveyard."],
  },
  'for-each-lead-create': {
    def: spell([
      { op: 'mill', who: { ref: 'each', who: 'player' }, count: 3, as: 'mill' } as EffectStep,
      { op: 'createToken', who: you, count: { q: 'resultCount', step: 'mill', which: { types: ['Creature'], isCard: true } }, token: { colors: ['B'], types: ['Creature'], subtypes: ['Zombie'], power: 2, toughness: 2 }, tapped: true } as EffectStep,
    ]),
    readings: [
      'Each player mills three cards. For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token.',
      'Each player mills three cards. For each creature card put into a graveyard this way, create a tapped 2/2 black Zombie creature token.',
      'Each player mills three cards. Create a tapped 2/2 black Zombie creature token for each creature card put into a graveyard this way.',
    ],
    near: [
      'Each player mills three cards. For each creature card put into a graveyard this way, you create a 2/2 black Zombie creature token.',
      'Each player mills three cards. For each land card put into a graveyard this way, you create a tapped 2/2 black Zombie creature token.',
      ],
    },
  } satisfies Record<string, Example>);

// r4-copy (Standard round 4): a nonlegendary copy with a base power and toughness and a subtype; the copy of a card cast in the next sentence or after "then"
Object.assign(EXAMPLES, {
  'copy-not-legendary-then-identity': {
    def: spell([{ op: 'copy', what: t('c'), result: 'token', who: you, except: [{ layer: 4, supertypes: { remove: ['Legendary'] } }, { layer: 4, subtypes: { add: ['Knight'] } }, { layer: '7b', power: 3, toughness: 3 }] } as EffectStep], [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    readings: [
      "Create a token that's a copy of target creature you control, except it's not legendary and it's a 3/3 Knight in addition to its other types.",
      "Create a token that's a copy of target creature you control, except it isn't legendary and it's a 3/3 Knight in addition to its other types.",
    ],
    near: [
      "Create a token that's a copy of target creature you control, except it's not legendary and it's a 3/3 Rogue in addition to its other types.",
      "Create a token that's a copy of target creature you control, except it's not legendary and it's a 2/2 Knight in addition to its other types.",
    ],
  },
  'replace-leading-while': {
    def: statics([{ s: 'replace', replaces: { ev: 'createToken', player: 'you' }, optional: true,
      condition: { cond: 'all', of: [{ cond: 'matches', object: { ref: 'attachedTo' }, filter: { types: ['Creature'] } }, { cond: 'not', of: { cond: 'happened', event: { ev: 'createToken', player: 'you' }, scope: 'turn' } }] },
      body: { b: 'instead', do: [{ op: 'copy', what: { ref: 'attachedTo' }, result: 'token', who: you, count: { q: 'eventAmount' } } as EffectStep] } } as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] },
    readings: [
      'As long as Test Card is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature.',
      'While Test Card is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature.',
    ],
    near: [
      'While Test Card is attached to a creature, the first time you would create one or more tokens each turn, you may instead create twice that many tokens that are copies of equipped creature.',
      'While Test Card is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of target creature.',
    ],
  },
  'copy-card-then-cast': {
    def: spell([
      { op: 'move', what: t('c'), to: { zone: 'exile' }, as: 'moved' } as EffectStep,
      { op: 'cast', who: you, what: { ref: 'bound', name: 'moved' }, copyIn: 'exile', optional: true, free: true } as EffectStep,
    ], [objTarget('c', { types: ['Instant'], zone: 'graveyard', owner: 'you', isCard: true })]),
    readings: [
      'Exile target instant card from your graveyard. Copy it. You may cast the copy without paying its mana cost.',
      'Exile target instant card from your graveyard. Copy it, then you may cast the copy without paying its mana cost.',
    ],
    near: [
      'Exile target instant card from your graveyard. Copy it. You may cast the copy.',
      'Exile target instant card from your graveyard. Copy it. You may cast it without paying its mana cost.',
    ],
  },
} satisfies Record<string, Example>);

// Standard round 4, r4-refs: the readings of its families (invented wordings, design 6.10)
const R4REFS_OPP = { ...playerTarget('p'), players: { who: 'opponent' } } as TargetSpec;
const r4Spell = (steps: unknown[], targets: TargetSpec[] = []): AbilityDef => spell(steps as EffectStep[], targets);
Object.assign(EXAMPLES, {
  'lasting-cant-cast-duration-first': {
    def: r4Spell([effectStep([{ s: 'restrict', action: 'cast', mode: 'cant', other: { not: { castFrom: 'hand' } }, subject: { ref: 'each', who: 'opponent' } } as unknown as StaticEffect], { d: 'untilNextTurn', whose: you } as never)]),
    readings: ["Until your next turn, your opponents can't cast spells from anywhere other than their hands.", "Your opponents can't cast spells from anywhere other than their hands until your next turn."],
    near: ["Until end of turn, your opponents can't cast spells from anywhere other than their hands.", "Until your next turn, your opponents can't cast spells from anywhere other than their graveyards."],
  },
  'card-they-own': {
    def: r4Spell([
      { op: 'mill', count: 2, who: { ref: 'target', id: 'p' } },
      { op: 'chooseObjects', as: 'card', from: { ref: 'each', filter: { faceDown: false, isCard: true, owner: { ref: 'target', id: 'p' }, zone: 'exile' } }, max: 1, min: 0, who: you },
      { op: 'move', to: { zone: 'graveyard' }, what: bound('card') },
    ], [R4REFS_OPP]),
    readings: ['Target opponent mills two cards. You may put a face-up exiled card they own into their graveyard.', 'Target opponent mills two cards. You may put a face-up exiled card that player owns into their graveyard.'],
    near: ['Target opponent mills two cards. You may put a face-up exiled card you own into their graveyard.', 'Target opponent mills two cards. You may put a face-up exiled card they own into their hand.'],
  },
  'search-every-zone-chosen-name': {
    def: r4Spell([
      { op: 'chooseValue', as: 'chosenCardName', link: 'chosenCardName', what: 'cardName', who: you },
      { op: 'search', allZones: true, alsoZones: ['hand', 'library'], as: 'found', filter: { chosen: { link: 'chosenCardName', quality: 'cardName' } }, max: 3, min: 0, owner: { ref: 'target', id: 'p' }, who: you, zone: 'graveyard' },
      { op: 'move', to: { zone: 'exile' }, what: bound('found') },
      { op: 'shuffle', who: { ref: 'target', id: 'p' } },
    ], [R4REFS_OPP]),
    readings: [
      "Choose a card name. Search target opponent's graveyard, hand, and library for up to three cards with that name and exile them. Then that player shuffles.",
      "Choose a card name. Search target opponent's graveyard, hand and library for up to three cards with the chosen name and exile them. That player shuffles.",
    ],
    near: [
      "Choose a card name. Search target opponent's graveyard and library for up to three cards with that name and exile them. Then that player shuffles.",
      "Choose a card name. Search target opponent's graveyard, hand, and library for up to two cards with that name and exile them. Then that player shuffles.",
    ],
  },
  'damage-power-to-itself': {
    def: r4Spell([{ op: 'damage', amount: { q: 'stat', of: t('c'), stat: 'power' }, source: t('c'), to: t('c') }], [objTarget('c')]),
    readings: ['Target creature deals damage equal to its power to itself.', 'Target creature deals damage to itself equal to its power.'],
    near: ['Target creature deals damage equal to its toughness to itself.', 'Target creature deals damage equal to its power to you.'],
  },
  'additional-counter': {
    def: r4Spell([{ op: 'putCounters', kind: '+1/+1', count: 1, on: t('c') }], [objTarget('c')]),
    readings: ['Put a +1/+1 counter on target creature.', 'Put an additional +1/+1 counter on target creature.'],
    near: ['Put two additional +1/+1 counters on target creature.', 'Put an additional -1/-1 counter on target creature.'],
  },
  'counters-x-or-times-each': {
    def: { kind: 'activated', text: '', cost: { tap: true }, effect: { targets: [], steps: [
      { op: 'putCounters', kind: '+1/+1', on: self, count: { q: 'math', op: '*', args: [1, { q: 'math', op: 'max', args: [{ q: 'math', op: '-', args: [{ q: 'spellsCastThisTurn' }, 1] }, 0] }] } } as EffectStep,
    ] } } as AbilityDef,
    ctx: creature,
    readings: ["{T}: Put a +1/+1 counter on Test Card for each spell you've cast this turn other than the first."],
    near: ["{T}: Put a +1/+1 counter on Test Card for each spell you've cast this turn.", "{T}: Put two +1/+1 counters on Test Card for each spell you've cast this turn other than the first."],
  },
  'library-position-ordinal': {
    def: r4Spell([{ op: 'move', to: { position: { nth: 3 }, zone: 'library' }, what: t('c') }], [objTarget('c')]),
    readings: ["Put target creature into its owner's library third from the top.", "Put target creature into its owner's library 3rd from the top."],
    near: ["Put target creature into its owner's library second from the top.", "Put target creature into its owner's library third from the bottom."],
  },
  'draw-x-where-counted': {
    def: r4Spell([{ op: 'draw', who: you, count: { q: 'happenedCount', event: { ev: 'zoneChange', from: 'library', to: 'graveyard', subject: { owner: { ref: 'target', id: 'p' } } }, scope: 'turn' } }], [{ ...playerTarget('p'), players: { who: 'any' } } as TargetSpec]),
    readings: [
      "Draw X cards, where X is the number of cards that were put into target player's graveyard from their library this turn.",
      "Draw cards equal to the number of cards that were put into target player's graveyard from their library this turn.",
    ],
    near: ["Draw X cards, where X is the number of cards that were put into your graveyard from your library this turn.", "Draw X cards, where X is the number of cards that were put into target player's graveyard from their hand this turn."],
  },
} satisfies Record<string, Example>);

// Standard round 4, r4-trig
const R4_CONTROL: EffectStep[] = [
  effectStep([{ s: 'continuous', affects: self, mods: [{ layer: 2, controller: { ref: 'active' } }] }], { d: 'permanent' }),
  { op: 'untap', what: self } as EffectStep,
];
Object.assign(EXAMPLES, {
  'gain-control-and-untap': {
    def: trig([{ ev: 'damage', recipient: { player: 'you' }, combat: true }], R4_CONTROL),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ["Whenever you're dealt combat damage, the attacking player gains control of this artifact and untaps it.", "Whenever you're dealt combat damage, the active player gains control of this artifact. Untap it."],
    near: ["Whenever you're dealt combat damage, the attacking player gains control of this artifact and taps it.", "Whenever you're dealt combat damage, you gain control of this artifact and untap it."],
  },
  'dies-mixed-types': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Artifact', 'Creature'], other: true }, from: 'battlefield', to: 'graveyard' }], [gain(1)]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['Whenever another artifact or creature is put into a graveyard from the battlefield, you gain 1 life.', 'Whenever another artifact or creature dies, you gain 1 life.'],
    near: ['Whenever another artifact or creature is put into a graveyard from anywhere, you gain 1 life.', 'Whenever another artifact or enchantment dies, you gain 1 life.'],
  },
  'put-into-your-graveyard': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Creature'], token: false, owner: 'you' }, from: 'battlefield', to: 'graveyard' }], [gain(1)]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['Whenever a nontoken creature is put into your graveyard from the battlefield, you gain 1 life.', 'Whenever a nontoken creature you own dies, you gain 1 life.'],
    near: ['Whenever a nontoken creature is put into a graveyard from the battlefield, you gain 1 life.', "Whenever a nontoken creature is put into an opponent's graveyard from the battlefield, you gain 1 life.", 'Whenever a nontoken creature you own is put into your graveyard from the battlefield, you gain 1 life.'],
  },
  'and-or-card-types-batch': {
    def: trig([{ ev: 'zoneChange', subject: { types: ['Artifact', 'Creature'], isCard: true, owner: 'you' }, from: 'graveyard' }], [gain(1)], { batch: true }),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['Whenever one or more artifact and/or creature cards leave your graveyard, you gain 1 life.', 'Whenever one or more artifact or creature cards leave your graveyard, you gain 1 life.'],
    near: ['Whenever one or more artifact and/or land cards leave your graveyard, you gain 1 life.', 'Whenever an artifact or creature card leaves your graveyard, you gain 1 life.'],
  },
  'attacking-player': {
    def: trig([{ ev: 'damage', recipient: { player: 'you' }, combat: true }], [{ op: 'draw', who: { ref: 'active' }, count: 1 } as EffectStep]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ["Whenever you're dealt combat damage, the attacking player draws a card.", "Whenever you're dealt combat damage, the active player draws a card."],
    near: ["Whenever you're dealt combat damage, the defending player draws a card.", "Whenever you're dealt combat damage, you draw a card."],
  },
  'enters-and-at-step': {
    def: trig([enters, { ev: 'step', step: 'upkeep', whose: 'you' }], [gain(1)]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['When this enchantment enters and at the beginning of your upkeep, you gain 1 life.'],
    near: ['When this enchantment enters and at the beginning of each upkeep, you gain 1 life.', 'When this enchantment dies and at the beginning of your upkeep, you gain 1 life.'],
  },
} satisfies Record<string, Example>);

// std-ry4 (zz-cloud/std-ry4.json): new alt site abil.ts#atStepAndWhenever
Object.assign(EXAMPLES, {
  'at-step-and-whenever': {
    def: trig([{ ev: 'step', step: 'upkeep', whose: 'you' }, { ev: 'cast', player: 'you', spell: { colors: ['G'] } }], [gain(1)]),
    readings: ['At the beginning of your upkeep and whenever you cast a green spell, you gain 1 life.'],
    near: ['At the beginning of each upkeep and whenever you cast a green spell, you gain 1 life.', 'At the beginning of your upkeep and whenever you cast a red spell, you gain 1 life.'],
  },
} satisfies Record<string, Example>);

// Standard round 4, r4-fxb (zz-cloud/r4-fxb.json): new alt sites fold.ts#choiceToken, stat.ts (each combat this turn), cond.ts#cmpWords
Object.assign(EXAMPLES, {
  'token-or-token': {
    def: spell([
      { op: 'chooseValue', who: you, what: 'option', as: 'tokenChoice', link: 'tokenChoice', options: ['Food', 'Treasure'] } as unknown as EffectStep,
      { op: 'if', cond: { cond: 'chosen', link: 'tokenChoice', equals: 'Food' }, then: [{ op: 'createToken', who: you, count: 1, token: { predefined: 'Food' } }] } as unknown as EffectStep,
      { op: 'if', cond: { cond: 'chosen', link: 'tokenChoice', equals: 'Treasure' }, then: [{ op: 'createToken', who: you, count: 1, token: { predefined: 'Treasure' } }] } as unknown as EffectStep,
    ]),
    readings: ['Create a Food token or a Treasure token.', 'Create your choice of a Food token or a Treasure token.'],
    near: ['Create a Food token and a Treasure token.', 'Create a Clue token or a Treasure token.', 'Create a Treasure token or a Food token.'],
  },
  'each-combat-this-turn': {
    def: spell([effectStep([{ s: 'restrict', subject: t('c'), mode: 'mustIfAble', action: 'beBlocked' } as unknown as StaticEffect], { d: 'endOfTurn' })], [objTarget('c')]),
    readings: ['Target creature must be blocked this turn if able.', 'Target creature must be blocked each combat this turn if able.'],
    near: ['Target creature must be blocked each combat if able.', "Target creature can't be blocked each combat this turn."],
  },
  'exactly-number': {
    def: trig([{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }], [draw()], { interveningIf: { cond: 'compare', left: { q: 'stat', of: { ref: 'self' }, stat: 'power' }, op: '==', right: 4 } }),
    ctx: creature,
    readings: ['When this creature enters, if its power is 4, draw a card.', 'When this creature enters, if its power is exactly 4, draw a card.'],
    near: ['When this creature enters, if its power is exactly 5, draw a card.', 'When this creature enters, if its power is at least 4, draw a card.'],
  },
  'group-each-of': {
    def: spell([
      effectStep([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] } as unknown as StaticEffect], { d: 'endOfTurn' }),
      { op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: 'indestructible', count: 1 } as EffectStep,
    ]),
    readings: ['Creatures you control get +1/+1 until end of turn. Put an indestructible counter on each of them.', 'Creatures you control get +1/+1 until end of turn. Put an indestructible counter on them.'],
    near: ['Creatures you control get +1/+1 until end of turn. Put an indestructible counter on one of them.', 'Creatures you control get +1/+1 until end of turn. Put an indestructible counter on each of those artifacts.'],
  },
  'for-each-of-group': {
    def: spell([
      { op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: '+1/+1', count: 1, as: 'got' } as EffectStep,
      { op: 'gainLife', who: you, amount: { q: 'count', of: bound('got') } } as EffectStep,
    ]),
    readings: ['Put a +1/+1 counter on each creature you control. You gain 1 life for each of those creatures.', 'Put a +1/+1 counter on each creature you control. You gain life equal to the number of those creatures.'],
    near: ['Put a +1/+1 counter on each creature you control. You gain 2 life for each of those creatures.', 'Put a +1/+1 counter on each creature you control. You gain 1 life for each creature you control.'],
  },
  'if-you-do-also': {
    def: spell([
      { op: 'damage', source: self, to: t('c'), amount: 4 } as EffectStep,
      { op: 'pay', who: you, cost: { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1 }] }, then: [{ op: 'damage', source: self, to: { ref: 'controllerOf', object: t('c') }, amount: 2 }] } as unknown as EffectStep,
    ], [objTarget('c')]),
    readings: ["Test Card deals 4 damage to target creature. You may exile a card from your graveyard. If you do, Test Card also deals 2 damage to that creature's controller.", "Test Card deals 4 damage to target creature. You may exile a card from your graveyard. If you do, Test Card deals 2 damage to that creature's controller."],
    near: ["Test Card deals 4 damage to target creature. You may exile a card from your graveyard. If you do, Test Card also deals 3 damage to that creature's controller.", "Test Card deals 4 damage to target creature. You may exile a card from your graveyard. Test Card also deals 2 damage to that creature's controller."],
  },
  'tapped-tokens-where-x': {
    def: spell([{ op: 'createToken', who: you, count: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'opponent' } } }, token: { predefined: 'Treasure' }, tapped: true } as EffectStep]),
    readings: ['Create X tapped Treasure tokens, where X is the number of artifacts your opponents control.', 'Create a tapped Treasure token for each artifact your opponents control.'],
    near: ['Create X Treasure tokens, where X is the number of artifacts your opponents control.', 'Create X tapped Treasure tokens, where X is the number of artifacts you control.'],
  },
  'your-combat-phase': {
    def: spell([{ op: 'if', cond: { cond: 'turnOf', whose: 'you', step: ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'] }, then: [draw()] } as unknown as EffectStep]),
    readings: ["If it's your combat phase, draw a card.", 'If it is your combat phase, draw a card.'],
    near: ["If it's your main phase, draw a card.", "If it's an opponent's combat phase, draw a card."],
  },
  'first-end-step': {
    def: spell([{ op: 'if', cond: { cond: 'happened', event: { ev: 'step', step: 'end' }, scope: 'turn', times: { op: '==', value: 1 } }, then: [draw()] } as unknown as EffectStep]),
    readings: ["If it's the first end step of the turn, draw a card.", 'If it is the first end step of the turn, draw a card.'],
    near: ["If it's the second end step of the turn, draw a card.", "If it's the first upkeep of the turn, draw a card."],
  },
  'it-triggers-additional': {
    def: statics([{ s: 'triggerMod', abilitiesOf: { other: true, subtypes: ['Elemental'], controller: 'you' }, additional: 1 } as unknown as StaticEffect]),
    ctx: creature,
    readings: ['If a triggered ability of another Elemental you control triggers, it triggers an additional time.', 'If a triggered ability of another Elemental you control triggers, that ability triggers an additional time.'],
    near: ['If a triggered ability of another Elemental you control triggers, it triggers two additional times.', 'If a triggered ability of another Goblin you control triggers, it triggers an additional time.'],
  },
  'additional-steps': {
    def: spell([{ op: 'extraStep', step: 'upkeep', count: 2, afterPhase: true } as unknown as EffectStep]),
    readings: ['You get two additional upkeep steps after this phase.', 'There are two additional upkeep steps after this phase.'],
    near: ['You get two additional upkeep steps after this step.', 'You get three additional upkeep steps after this phase.'],
  },
  'counters-on-group': {
    def: spell([{ op: 'draw', who: you, count: { q: 'counters', on: { ref: 'each', filter: { types: ['Land'], controller: 'you' } }, kind: '+1/+1' } } as EffectStep]),
    readings: ['Draw cards equal to the number of +1/+1 counters on lands you control.', 'Draw cards equal to the number of +1/+1 counters on all lands you control.'],
    near: ['Draw cards equal to the number of +1/+1 counters on creatures you control.', 'Draw cards equal to the number of charge counters on lands you control.'],
  },
  'self-other-types': {
    def: spell([effectStep([{ s: 'continuous', affects: self, mods: [{ layer: 4, subtypes: { add: ['Dragon'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'flying' }] }] } as unknown as StaticEffect], { d: 'endOfTurn' })]),
    ctx: creature,
    readings: ["Until end of turn, Test Card becomes a Dragon in addition to its other types and gains flying.", "Until end of turn, Test Card becomes a Dragon in addition to Test Card's other types and gains flying."],
    near: ['Until end of turn, Test Card becomes a Dragon and gains reach.', "Until end of turn, Test Card becomes a Demon in addition to Test Card's other types and gains flying."],
  },
  'token-base-pt-equal': {
    def: spell([{ op: 'createToken', who: you, count: 1, token: { colors: ['G'], types: ['Creature'], subtypes: ['Fungus', 'Dinosaur'], power: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, toughness: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } } as EffectStep]),
    readings: ['Create an X/X green Fungus Dinosaur creature token, where X is the number of creatures you control.', 'Create a green Fungus Dinosaur creature token with base power and toughness each equal to the number of creatures you control.'],
    near: ['Create a green Fungus Dinosaur creature token with base power each equal to the number of creatures you control.', 'Create a green Fungus Dinosaur creature token with base power and toughness each equal to the number of lands you control.'],
  },
  'that-amount-of-damage': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'damage', source: { controller: 'you' }, recipient: { player: 'opponent' } }] }, effect: { targets: [], steps: [{ op: 'damage', source: self, to: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } }, amount: { q: 'eventAmount' } } as unknown as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['Whenever a source you control deals damage to an opponent, Test Card deals that much damage to each creature your opponents control.', 'Whenever a source you control deals damage to an opponent, Test Card deals that amount of damage to each creature your opponents control.'],
    near: ['Whenever a source you control deals damage to an opponent, Test Card deals that amount of life to each creature your opponents control.', 'Whenever a source you control deals damage to an opponent, Test Card deals that amount of damage to each creature you control.'],
  },
  'token-all-colors': {
    def: spell([{ op: 'createToken', who: you, count: 1, token: { colors: ['W', 'U', 'B', 'R', 'G'], types: ['Creature'], subtypes: ['Elemental'], power: 2, toughness: 2 } } as EffectStep]),
    readings: ['Create a 2/2 white, blue, black, red, and green Elemental creature token.', "Create a 2/2 Elemental creature token that's all colors."],
    near: ["Create a 2/2 Elemental creature token that's all creature types.", "Create a 2/2 Elemental creature token that's every color."],
  },
  'also-after-instruction': {
    def: spell([
      effectStep([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 0 }] } as unknown as StaticEffect], { d: 'endOfTurn' }),
      effectStep([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], subtypes: ['Goblin'], controller: 'you' } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste' }] }] } as unknown as StaticEffect], { d: 'endOfTurn' }),
    ]),
    readings: ['Creatures you control get +1/+0 until end of turn. Goblin creatures you control gain haste until end of turn.', 'Creatures you control get +1/+0 until end of turn. Goblin creatures you control also gain haste until end of turn.'],
    near: ['Creatures you control also get +1/+0 until end of turn. Goblin creatures you control gain haste until end of turn.', 'Creatures you control get +1/+0 until end of turn. Goblin creatures you control also gain trample until end of turn.'],
  },
} satisfies Record<string, Example>);

// r4-repl (zz-cloud/r4-repl.json): the readings of its reviewed families (synthetic lines)
Object.assign(EXAMPLES, {
  // CR 702.190b, 400.7: Karai, Future of the Foot
  'sneak-paid-this-turn': {
    def: {"kind": "triggered", "trigger": {"on": [{"ev": "step", "step": "end", "whose": "you"}]}, "interveningIf": {"cond": "all", "of": [{"cond": "wasCast", "via": "sneak"}, {"cond": "happened", "event": {"ev": "zoneChange", "subject": {"self": true}, "to": "battlefield"}, "scope": "turn"}]}, "effect": {"targets": [], "steps": [{"op": "draw", "who": {"ref": "you"}, "count": 1}]}, "text": ""} as unknown as AbilityDef,
    ctx: creature,
    readings: ["At the beginning of your end step, if this creature's sneak cost was paid this turn, draw a card.", 'At the beginning of your end step, if its sneak cost was paid this turn, draw a card.'],
    near: ["At the beginning of your end step, if this creature's sneak cost was paid this turn, draw two cards.", "At the beginning of your end step, if this creature's ninjutsu cost was paid this turn, draw a card."],
  },
  // CR 608.2c, 404.1: Flow State
  'two-cards-one-zone': {
    def: {"kind": "spell", "effect": {"targets": [], "steps": [{"op": "scry", "who": {"ref": "you"}, "count": 1}, {"op": "if", "cond": {"cond": "all", "of": [{"cond": "exists", "of": {"ref": "each", "filter": {"types": ["Artifact"], "isCard": true, "zone": "graveyard", "owner": "you"}}}, {"cond": "exists", "of": {"ref": "each", "filter": {"types": ["Enchantment"], "zone": "graveyard", "owner": "you", "isCard": true}}}]}, "then": [{"op": "draw", "who": {"ref": "you"}, "count": 1}]}]}, "text": ""} as unknown as AbilityDef,
    readings: ['Scry 1. If there is an artifact card and an enchantment card in your graveyard, draw a card.', 'Scry 1. If there is an artifact card in your graveyard and there is an enchantment card in your graveyard, draw a card.'],
    near: ['Scry 1. If there is an artifact card and a creature card in your graveyard, draw a card.', 'Scry 1. If there is an artifact card or an enchantment card in your graveyard, draw a card.'],
  },
  // CR 611.2a, 614.1a: Walk-In Closet // Forgotten Cellar
  'permit-and-replace': {
    def: {"kind": "spell", "effect": {"targets": [], "steps": [{"op": "effect", "duration": {"d": "endOfTurn"}, "effects": [{"s": "permit", "who": {"ref": "you"}, "action": "cast", "of": {"stackKind": "spell", "zone": "stack"}, "from": "graveyard"}, {"s": "replace", "replaces": {"ev": "zoneChange", "subject": {"isCard": true, "owner": "you"}, "to": "graveyard"}, "body": {"b": "modify", "destination": {"zone": "exile"}}}]}]}, "text": ""} as unknown as AbilityDef,
    readings: ['You may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, exile it instead.', 'You may cast spells from your graveyard this turn. If a card would be put into your graveyard from anywhere this turn, exile it instead.'],
    near: ['You may cast spells from your graveyard this turn, and if a card would be put into your graveyard from anywhere this turn, put it on the bottom of your library instead.', 'You may cast spells from your hand this turn, and if a card would be put into your graveyard from anywhere this turn, exile it instead.'],
  },
  // CR 611.2a, 615.1a: Eerie Interference
  'prevent-duration-placed': {
    def: {"kind": "spell", "effect": {"targets": [], "steps": [{"op": "effect", "duration": {"d": "endOfTurn"}, "effects": [{"s": "replace", "replaces": {"ev": "damage", "source": {"types": ["Creature"]}, "recipient": {"player": "you", "object": {"types": ["Creature"], "controller": "you"}}}, "body": {"b": "prevent", "amount": "all"}}]}]}, "text": ""} as unknown as AbilityDef,
    readings: ['Prevent all damage that would be dealt to you and creatures you control this turn by creatures.', 'This turn, prevent all damage that would be dealt to you and creatures you control by creatures.'],
    near: ['Prevent all damage that would be dealt to you and creatures you control this turn by artifacts.', 'Prevent all damage that would be dealt to you this turn by creatures.'],
  },
  // CR 601.2h, 106.1: Wildgrowth Archaic
  'spell-colors-it': {
    def: {"kind": "triggered", "trigger": {"on": [{"ev": "cast", "player": "you", "spell": {"types": ["Creature"]}}]}, "effect": {"targets": [], "steps": [{"op": "effect", "duration": {"d": "permanent"}, "effects": [{"s": "replace", "replaces": {"ev": "zoneChange", "subject": {"is": {"ref": "event", "role": "spell"}}, "to": "battlefield"}, "body": {"b": "enters", "counters": [{"kind": "+1/+1", "count": {"q": "spellColorsSpent"}}]}}]}]}, "text": ""} as unknown as AbilityDef,
    ctx: creature,
    readings: ['Whenever you cast a creature spell, that creature enters with X additional +1/+1 counters on it, where X is the number of colors of mana spent to cast it.', 'Whenever you cast a creature spell, that creature enters with X additional +1/+1 counters on it, where X is the number of colors of mana spent to cast that spell.'],
    near: ['Whenever you cast a creature spell, that creature enters with X additional +1/+1 counters on it, where X is the amount of mana spent to cast it.', 'Whenever you cast an artifact spell, that creature enters with X additional +1/+1 counters on it, where X is the number of colors of mana spent to cast it.'],
  },
  // CR 614.10, 121.3: Living Conundrum
  'skip-that-draw': {
    def: {"kind": "static", "effects": [{"s": "replace", "replaces": {"ev": "draw", "player": "you"}, "condition": {"cond": "exists", "of": {"ref": "each", "filter": {"subtypes": ["Wizard"], "controller": "you"}}}, "body": {"b": "skip"}}], "text": ""} as unknown as AbilityDef,
    ctx: creature,
    readings: ['If you would draw a card while you control a Wizard, skip that draw instead.', 'If you would draw a card while you control a Wizard, skip it instead.'],
    near: ['If you would draw a card while you control a Wizard, draw two cards instead.', 'If you would draw a card while you control a Goblin, skip that draw instead.'],
  },
  // Merge wave 8 e3xp: r4-repl's passive and E3XP's active wording of one token replacement (CR 614.1a, 614.5)
  'tokens-plus-one-voice': {
    def: {"kind": "static", "effects": [{"s": "replace", "replaces": {"ev": "createToken", "player": "you"}, "body": {"b": "modify", "then": {"as": "created", "do": [{"op": "createToken", "who": {"ref": "you"}, "count": 1, "token": {"predefined": "Food"}}]}}}], "text": ""} as unknown as AbilityDef,
    ctx: creature,
    readings: ['If one or more tokens would be created under your control, those tokens plus a Food token are created instead.', 'If you would create one or more tokens, instead create those tokens plus an additional Food token.'],
    near: ['If you would create one or more tokens, instead create those tokens plus an additional Clue token.', 'If an opponent would create one or more tokens, instead create those tokens plus an additional Food token.'],
  },
  // CR 608.2c, 614.15: Grow from the Ashes
  'joined-replaced-move': {
    def: {"kind": "spell", "effect": {"targets": [], "steps": [{"op": "search", "who": {"ref": "you"}, "zone": "library", "filter": {"supertypes": ["Basic"], "types": ["Land"]}, "max": 1, "reveal": true, "as": "search"}, {"op": "if", "cond": {"cond": "exists", "of": {"ref": "each", "filter": {"subtypes": ["Wizard"], "controller": "you"}}}, "then": [{"op": "move", "what": {"ref": "bound", "name": "search"}, "to": {"zone": "battlefield", "controller": {"ref": "you"}}, "as": "moved"}], "else": [{"op": "move", "what": {"ref": "bound", "name": "search"}, "to": {"zone": "hand"}, "as": "moved"}]}, {"op": "shuffle", "who": {"ref": "you"}}]}, "text": ""} as unknown as AbilityDef,
    readings: ['Search your library for a basic land card, reveal it, and put it into your hand. If you control a Wizard, put that card onto the battlefield instead. Then shuffle.', 'Search your library for a basic land card, reveal it, put it into your hand. If you control a Wizard, put that card onto the battlefield instead. Then shuffle.'],
    near: ['Search your library for a basic land card, reveal it, and put it into your hand. If you control a Wizard, put that card onto the battlefield tapped instead. Then shuffle.', 'Search your library for a basic land card, reveal it, and put it into your hand. If you control a Wizard, put that card into your graveyard instead. Then shuffle.'],
  },
} satisfies Record<string, Example>);

// Standard round 5, r5-moved: a destroy of what a damage step dealt damage to, the plural linked return, "all the cards", the reflexive search, the exiled group, "no cards"
const R5M_GOBLIN = { subtypes: ['Goblin'] };
Object.assign(EXAMPLES, {
  'dealt-this-way-destroy-it': {
    def: spell([
      { op: 'damage', source: self, to: t('c'), amount: 3, as: 'hit' } as EffectStep,
      { op: 'destroy', what: { ref: 'each', filter: { anyOf: [R5M_GOBLIN], is: bound('hit') } } } as EffectStep,
    ], [objTarget('c')]),
    readings: ['Test Card deals 3 damage to target creature. If a Goblin is dealt damage this way, destroy it.'],
    near: ['Test Card deals 3 damage to target creature. If an Elf is dealt damage this way, destroy it.', 'Test Card deals 3 damage to target creature. If a Goblin is dealt damage this way, exile it.'],
  },
  'linked-exiled-hands-plural': {
    def: trig([dies], [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'hand' } } as EffectStep]),
    ctx: creature,
    readings: ["When this creature dies, return the exiled cards to their owners' hands.", "When this creature dies, put each card exiled with it into its owner's hand.", "When this creature dies, put all cards exiled with this creature into their owners' hands."],
    near: ["When this creature dies, return the exiled cards to the battlefield under their owners' control.", "When this creature dies, put the exiled cards into their owners' graveyards."],
  },
  'all-the-cards-from-hand': {
    def: spell([{ op: 'move', what: { ref: 'each', filter: { zone: 'hand', owner: 'you', isCard: true } }, to: { zone: 'exile' } } as EffectStep]),
    readings: ['Exile all cards from your hand.', 'Exile all the cards from your hand.'],
    near: ['Exile all the cards from your graveyard.', 'Exile all the creature cards from your hand.'],
  },
  'searched-this-way-reflexive': {
    def: spell([
      { op: 'search', who: you, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, max: 1, as: 'search' } as EffectStep,
      { op: 'move', what: bound('search'), to: { zone: 'battlefield', controller: you, tapped: true } } as EffectStep,
      { op: 'shuffle', who: you } as EffectStep,
      { op: 'reflexive', when: { did: 'search' }, targets: [], do: [gain(2)] } as EffectStep,
    ]),
    readings: [
      'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. When you search your library this way, you gain 2 life.',
      'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. When you do, you gain 2 life.',
    ],
    near: [
      'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. When you search your graveyard this way, you gain 2 life.',
      'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. When you draw a card this way, you gain 2 life.',
    ],
  },
  'cards-exiled-this-way-group': {
    def: spell([
      { op: 'move', what: { ref: 'topCards', player: you, count: 2 }, to: { zone: 'exile' }, as: 'them' } as EffectStep,
      { op: 'effect', duration: { d: 'endOfNextTurn', whose: you }, effects: [{ s: 'permit', who: you, action: 'play', of: { is: bound('them') } }] } as EffectStep,
    ]),
    readings: [
      'Exile the top two cards of your library. Until the end of your next turn, you may play cards exiled this way.',
      'Exile the top two cards of your library. Until the end of your next turn, you may play those cards.',
    ],
    near: [
      'Exile the top two cards of your library. Until the end of your next turn, you may play cards milled this way.',
      'Exile the top two cards of your library. Until end of turn, you may play cards exiled this way.',
    ],
  },
  'no-cards-into-hand': {
    def: spell([
      { op: 'mill', who: you, count: 3, as: 'them' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: bound('them'), zone: 'any' } }, min: 0, max: 1, as: 'chosen' } as EffectStep,
      { op: 'move', what: bound('chosen'), to: { zone: 'hand' }, as: 'did' } as EffectStep,
      { op: 'if', cond: { cond: 'did', step: 'did', not: true, which: {}, to: 'hand' }, then: [gain(2)] } as EffectStep,
    ]),
    readings: [
      'Mill three cards. You may put a creature card from among them into your hand. If you put no cards into your hand this way, you gain 2 life.',
      "Mill three cards. You may put a creature card from among them into your hand. If you don't put a card into your hand this way, you gain 2 life.",
    ],
    near: [
      'Mill three cards. You may put a creature card from among them into your hand. If you put no cards into your graveyard this way, you gain 2 life.',
      'Mill three cards. You may put a creature card from among them into your hand. If you put a card into your hand this way, you gain 2 life.',
    ],
  },
} satisfies Record<string, Example>);

// Standard round 5, r5-trig
Object.assign(EXAMPLES, {
  'self-and-or-others-enter': {
    def: trig([enters, { ev: 'zoneChange', subject: { types: ['Creature'], token: false, controller: 'you', other: true }, to: 'battlefield' }], [gain(1)], { batch: true }),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['Whenever this creature and/or one or more other nontoken creatures you control enter, you gain 1 life.', 'Whenever this creature enters or one or more other nontoken creatures you control enter, you gain 1 life.'],
    near: ['Whenever this creature and/or one or more other nontoken creatures you control die, you gain 1 life.', 'Whenever this creature and/or one or more other nontoken creatures an opponent controls enter, you gain 1 life.'],
  },
} satisfies Record<string, Example>);

// r5-dig (Standard round 5: zz-cloud/r5-dig.json; eleven reviewed groups, render/equivalence.ts)
Object.assign(EXAMPLES, {
  "r5dig-comma-then-unless": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"spell","min":1,"max":1,"text":""}],"steps":[{"op":"scry","who":{"ref":"you"},"count":1},{"op":"pay","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}},"cost":{"mana":[{"kind":"generic","amount":1}]},"times":{"q":"count","of":{"ref":"each","filter":{"types":["Creature"],"controller":"you"}}},"else":[{"op":"counter","what":{"ref":"target","id":"t0"}}]}]}} as unknown as AbilityDef,
    readings: ["Choose target spell. Scry 1, then counter the chosen spell unless its controller pays {1} for each creature you control."],
    near: ["Choose target spell. Scry 1, then counter the chosen spell unless its controller pays {2} for each creature you control.", "Choose target spell. Scry 1, then counter the chosen spell unless its controller pays {1} for each artifact you control."],
  },
  "r5dig-revealed-cards": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"look","who":{"ref":"you"},"at":{"ref":"topCards","player":{"ref":"you"},"count":7},"as":"them"},{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"anyOf":[{"types":["Creature"]}],"is":{"ref":"bound","name":"them"},"zone":"library"}},"min":0,"max":2,"as":"chosen"},{"op":"reveal","who":{"ref":"you"},"what":{"ref":"bound","name":"chosen"}},{"op":"if","cond":{"cond":"exists","of":{"ref":"each","filter":{"subtypes":["Forest"],"controller":"you"}}},"then":[{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"battlefield","controller":{"ref":"you"}}}],"else":[{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"hand"}}]},{"op":"shuffle","who":{"ref":"you"}}]}} as unknown as AbilityDef,
    readings: ["Look at the top seven cards of your library. You may reveal up to two creature cards from among them. If you control a Forest, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand. Then shuffle."],
    near: ["Look at the top seven cards of your library. You may reveal up to three creature cards from among them. If you control a Forest, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand. Then shuffle.", "Look at the top seven cards of your library. You may reveal up to two creature cards from among them. If you control a Forest, put the revealed cards into your hand. Otherwise, put the revealed cards onto the battlefield. Then shuffle."],
  },
  "r5dig-face-down-piles": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"look","who":{"ref":"you"},"at":{"ref":"topCards","player":{"ref":"you"},"count":4},"as":"looked"},{"op":"piles","cards":{"ref":"bound","name":"looked"},"separator":{"ref":"you"},"chosen":"chosenPile","other":"otherPile","faceDown":true,"chooser":{"ref":"anOpponent"}},{"op":"move","what":{"ref":"bound","name":"chosenPile"},"to":{"zone":"hand"}},{"op":"move","what":{"ref":"bound","name":"otherPile"},"to":{"zone":"graveyard"}}]}} as unknown as AbilityDef,
    readings: ["Look at the top four cards of your library and separate them into a face-down pile and a face-up pile. An opponent chooses one of the piles. Put that pile into your hand and the other into your graveyard.", "Look at the top four cards of your library and separate them into a face-down pile and a face-up pile. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard."],
    near: ["Look at the top four cards of your library and separate them into a face-down pile and a face-up pile. An opponent chooses one of the piles. Put that pile into your graveyard and the other into your hand.", "Look at the top five cards of your library and separate them into a face-down pile and a face-up pile. An opponent chooses one of the piles. Put that pile into your hand and the other into your graveyard."],
  },
  "r5dig-other-chooses-chosen-rest": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"search","who":{"ref":"you"},"zone":"library","filter":{"types":["Artifact"]},"min":0,"max":3,"differentNames":true,"reveal":true,"as":"search"},{"op":"chooseObjects","who":{"ref":"anOpponent"},"from":{"ref":"each","filter":{"is":{"ref":"bound","name":"search"},"zone":"library"}},"min":2,"max":2,"as":"chosen"},{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"graveyard"}},{"op":"move","what":{"ref":"each","filter":{"is":{"ref":"bound","name":"search"},"not":{"is":{"ref":"bound","name":"chosen"}},"zone":"library"}},"to":{"zone":"battlefield","controller":{"ref":"you"},"tapped":true}},{"op":"shuffle","who":{"ref":"you"}}]}} as unknown as AbilityDef,
    readings: ["Search your library for up to three artifact cards with different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield tapped, then shuffle."],
    near: ["Search your library for up to three artifact cards with different names and reveal them. An opponent chooses one of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield tapped, then shuffle.", "Search your library for up to three artifact cards with different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield, then shuffle."],
  },
  "r5dig-each-other-creature": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"object","min":1,"max":1,"text":"","filter":{"types":["Creature"],"controller":"you"}}],"steps":[{"op":"damage","source":{"ref":"target","id":"t0"},"to":{"ref":"each","filter":{"types":["Creature"],"not":{"is":{"ref":"target","id":"t0"}}}},"amount":{"q":"stat","stat":"power","of":{"ref":"target","id":"t0"}}}]}} as unknown as AbilityDef,
    readings: ["Target creature you control deals damage equal to its power to each other creature.", "Target creature you control deals damage equal to its power to each creature other than it."],
    near: ["Target creature you control deals damage equal to its power to each creature.", "Target creature you control deals damage equal to its power to each other creature you control."],
  },
  "r5dig-reveal-until-into-graveyard": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"player","min":1,"max":1,"text":"","players":{"who":"any"}}],"steps":[{"op":"forEach","over":{"ref":"target","id":"t0"},"as":"revealer","do":[{"op":"revealUntil","who":{"ref":"iterating"},"filter":{"types":["Land"]},"as":"hit","revealed":"revealed","count":2},{"op":"move","what":{"ref":"each","filter":{"is":{"ref":"bound","name":"revealed"},"zone":"library"}},"to":{"zone":"graveyard"}}]}]}} as unknown as AbilityDef,
    readings: ["Target player reveals cards from the top of their library until they reveal two land cards, then puts all cards revealed this way into their graveyard.", "Target player reveals cards from the top of their library until they reveal two land cards, then puts those cards into their graveyard."],
    near: ["Target player reveals cards from the top of their library until they reveal two land cards, then puts all cards revealed this way into their hand.", "Target player reveals cards from the top of their library until they reveal three land cards, then puts all cards revealed this way into their graveyard."],
  },
  "r5dig-owner-may-play-each": {
    def: {"kind":"spell","text":"","effect":{"targets":[{"id":"t0","kind":"object","min":1,"max":1,"text":"","filter":{"types":["Artifact"]}}],"steps":[{"op":"move","what":{"ref":"union","of":[{"ref":"target","id":"t0"},{"ref":"topCards","player":{"ref":"you"},"count":1}]},"to":{"zone":"exile"},"as":"them"},{"op":"forEach","over":{"ref":"bound","name":"them"},"as":"card","do":[{"op":"effect","effects":[{"s":"permit","who":{"ref":"ownerOf","object":{"ref":"bound","name":"card"}},"action":"play","of":{"is":{"ref":"bound","name":"card"}}}],"duration":{"d":"endOfNextTurn","whose":{"ref":"ownerOf","object":{"ref":"bound","name":"card"}}}}]}]}} as unknown as AbilityDef,
    readings: ["Exile target artifact and the top card of your library. For each of those cards, its owner may play it until the end of their next turn."],
    near: ["Exile target artifact and the top card of your library. For each of those cards, its owner may play it until the end of your next turn.", "Exile target artifact and the top card of your library. For each of those cards, its owner may cast it until the end of their next turn."],
  },
  "r5dig-until-exiled-another": {
    def: {"kind":"triggered","text":"","trigger":{"on":[{"ev":"cast","player":"you","spell":{"types":["Instant"]}}]},"effect":{"targets":[],"steps":[{"op":"may","who":{"ref":"you"},"do":[{"op":"move","what":{"ref":"topCards","player":{"ref":"you"},"count":1},"to":{"zone":"exile"},"as":"them"}],"as":"did"},{"op":"if","cond":{"cond":"did","step":"did"},"then":[{"op":"effect","duration":{"d":"untilExiledWith"},"effects":[{"s":"permit","who":{"ref":"you"},"action":"play","of":{"is":{"ref":"bound","name":"them"}}}]}]}]}} as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever you cast an instant spell, you may exile the top card of your library. If you do, you may play that card until you exile another card with Test Card."],
    near: ["Whenever you cast an instant spell, you may exile the top card of your library. If you do, you may play that card until end of turn.", "Whenever you cast an instant spell, you may exile the top card of your library. If you do, you may cast that card until you exile another card with Test Card."],
  },
  "r5dig-choose-one-elliptical": {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"move","what":{"ref":"topCards","player":{"ref":"you"},"count":3},"to":{"zone":"exile"},"as":"them"},{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"is":{"ref":"bound","name":"them"},"zone":"any"}},"min":1,"max":1,"as":"chosen"},{"op":"effect","duration":{"d":"endOfTurn"},"effects":[{"s":"permit","who":{"ref":"you"},"action":"play","of":{"is":{"ref":"bound","name":"chosen"}}}]}]}} as unknown as AbilityDef,
    readings: ["Exile the top three cards of your library. Choose one. You may play that card this turn.", "Exile the top three cards of your library. Choose one of them. You may play that card this turn."],
    near: ["Exile the top three cards of your library. Choose two. You may play that card this turn.", "Exile the top three cards of your library. Choose one. You may play that card until end of your next turn."],
  },
  "r5dig-cast-as-adventure": {
    def: {"kind":"triggered","text":"","trigger":{"on":[{"ev":"zoneChange","subject":{"self":true},"from":"battlefield","to":"graveyard"}]},"effect":{"targets":[],"steps":[{"op":"effect","duration":{"d":"endOfNextTurn","whose":{"ref":"you"}},"effects":[{"s":"permit","who":{"ref":"you"},"action":"cast","of":{"is":{"ref":"event","role":"subject"}},"asAdventure":true}]}]}} as unknown as AbilityDef,
    ctx: creature,
    readings: ["When Test Card dies, you may cast it from your graveyard as an Adventure until the end of your next turn."],
    near: ["When Test Card dies, you may cast it from your hand as an Adventure until the end of your next turn.", "When Test Card dies, you may cast it from your graveyard as an Adventure until end of turn."],
  },
  // card wave 2, std-rw9 (CR 608.2c-d): Choco, Seeker of Paradise
  'then-after-may-dig': {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"look","who":{"ref":"you"},"at":{"ref":"topCards","player":{"ref":"you"},"count":3},"as":"them"},{"op":"may","who":{"ref":"you"},"do":[{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"is":{"ref":"bound","name":"them"},"zone":"library"}},"min":1,"max":1,"as":"chosen"},{"op":"move","what":{"ref":"bound","name":"chosen"},"to":{"zone":"hand"}}]},{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"anyOf":[{"types":["Land"]}],"is":{"ref":"bound","name":"them"},"zone":"library"}},"min":0,"max":"any","as":"lands"},{"op":"move","what":{"ref":"bound","name":"lands"},"to":{"zone":"battlefield","controller":{"ref":"you"},"tapped":true}},{"op":"move","what":{"ref":"each","filter":{"is":{"ref":"bound","name":"them"},"not":{"is":{"ref":"bound","name":"lands"}},"zone":"library"}},"to":{"zone":"graveyard"}}]}} as unknown as AbilityDef,
    readings: ["Look at the top three cards of your library. You may put one of them into your hand. Then put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard.", "Look at the top three cards of your library. You may put one of them into your hand. Put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard."],
    near: ["Look at the top three cards of your library. You may put one of them into your hand, then put any number of land cards from among them onto the battlefield tapped and the rest into your graveyard.", "Look at the top three cards of your library. You may put one of them into your hand. Then put any number of land cards from among them onto the battlefield and the rest into your graveyard."],
  },
} satisfies Record<string, Example>);

// Standard round std-rq (card wave 2, slice s1)
const STDRQ_MAY = (as: string): EffectStep => ({ op: 'may', who: { ref: 'each', who: 'opponent' }, anyOne: true, as, do: [{ op: 'sacrificeChoice', who: { ref: 'iterating' }, filter: { types: ['Creature'] }, count: 1 }] } as EffectStep);
Object.assign(EXAMPLES, {
  'any-one-did': {
    def: spell([STDRQ_MAY('d'), { op: 'if', cond: { cond: 'did', step: 'd' }, then: [draw()] }]),
    readings: ['Any opponent may sacrifice a creature of their choice. If a player does, draw a card.', 'Any opponent may sacrifice a creature of their choice. If they do, draw a card.'],
    near: ['Any opponent may sacrifice a creature of their choice. If you do, draw a card.', 'Each opponent may sacrifice a creature of their choice. If a player does, draw a card.'],
  },
  'cast-max-mana-value': {
    def: spell([{ op: 'exileUntil', who: you, filter: { notTypes: ['Land'] }, as: 'c' }, { op: 'cast', who: you, what: { ref: 'bound', name: 'c' }, free: true, optional: true, maxManaValue: 3 }] as EffectStep[]),
    readings: ["Exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that spell's mana value is 3 or less.", "Exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if the resulting spell's mana value is 3 or less."],
    near: ["Exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that spell's mana value is 4 or less.", "Exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that spell's mana value is 3 or greater."],
  },
  'damage-n-for-each': {
    def: spell([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', who: 'opponent' }, amount: { q: 'math', op: '*', args: [2, { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } }] } }] as EffectStep[]),
    readings: ['~ deals 2 damage to each opponent for each artifact you control.'],
    near: ['~ deals 3 damage to each opponent for each artifact you control.', '~ deals 2 damage to each opponent for each creature you control.'],
  },
  'top-cards-equal-to': {
    def: spell([{ op: 'move', what: { ref: 'topCards', player: you, count: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } } }, to: { zone: 'exile' } }] as EffectStep[]),
    readings: ['Exile cards from the top of your library equal to the number of artifacts you control.', 'Exile the top X cards of your library, where X is the number of artifacts you control.'],
    near: ['Exile cards from the top of your library equal to the number of creatures you control.', 'Exile cards from the bottom of your library equal to the number of artifacts you control.'],
  },
});

// std-ro (precon round O): the cards revealed this way
const STD_RO_REVEAL = { op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 4 }, as: 'r' } as unknown as EffectStep;
const stdRoPutAll = (to: Record<string, unknown>): AbilityDef => spell([
  STD_RO_REVEAL,
  { op: 'move', what: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], is: bound('r'), zone: 'library' } }, to: { zone: 'hand' } } as unknown as EffectStep,
  { op: 'move', what: { ref: 'each', filter: { is: bound('r'), zone: 'library' } }, to } as unknown as EffectStep,
]);
Object.assign(EXAMPLES, {
  'revealed-this-way-group': {
    def: stdRoPutAll({ zone: 'graveyard' }),
    readings: ['Reveal the top four cards of your library. Put all land cards revealed this way into your hand and the rest into your graveyard.', 'Reveal the top four cards of your library. Put all land cards from among them into your hand and the rest into your graveyard.'],
    near: ['Reveal the top four cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.', 'Reveal the top four cards of your library. Put all land cards revealed this way into your hand and the rest on the bottom of your library in any order.', 'Reveal the top four cards of your library. Put all land cards milled this way into your hand and the rest into your graveyard.'],
  },
} satisfies Record<string, Example>);

// Standard round rx10 (std-rx10): two targets announced together, their fight, the target an "if" tests (zz-cloud/std-rx10.json)
const RX10_MINE = objTarget('a', { types: ['Creature'], controller: 'you' }, { text: 'target creature you control' });
const RX10_THEIRS = objTarget('b', { types: ['Creature'], not: { controller: 'you' } }, { text: "target creature you don't control" });
Object.assign(EXAMPLES, {
  'chosen-pair-targets': {
    def: spell([{ op: 'putCounters', on: t('a'), kind: '+1/+1', count: 1 } as EffectStep, { op: 'fight', a: t('a'), b: t('b') } as EffectStep], [RX10_MINE, RX10_THEIRS]),
    readings: ["Choose target creature you control and target creature you don't control. Put a +1/+1 counter on the creature you control. Then those creatures fight each other.", "Put a +1/+1 counter on target creature you control. Then that creature fights target creature you don't control."],
    near: ["Choose target creature you control and target creature you don't control. Put a +1/+1 counter on the creature you don't control. Then those creatures fight each other.", "Choose target creature you control and target creature you don't control. Put a +1/+1 counter on it. Then those creatures fight each other."],
  },
  'chosen-pair-fight': {
    def: spell([{ op: 'fight', a: t('a'), b: t('b') } as EffectStep], [RX10_MINE, RX10_THEIRS]),
    readings: ["Choose target creature you control and target creature you don't control. Then those creatures fight each other.", "Choose target creature you control and target creature you don't control. The chosen creatures fight each other.", "Target creature you control fights target creature you don't control."],
    near: ["Choose target creature you control and target creature you don't control. Then those creatures fight.", "Choose target creature you control and target creature you don't control. Then those creatures fight each other twice."],
  },
  'if-tested-target-it': {
    def: spell([{ op: 'if', cond: { cond: 'matches', object: t('a'), filter: { enteredThisTurn: true } }, then: [{ op: 'putCounters', on: t('a'), kind: '+1/+1', count: 1 }] } as unknown as EffectStep, { op: 'fight', a: t('a'), b: t('b') } as EffectStep], [RX10_MINE, RX10_THEIRS]),
    readings: ["Choose target creature you control and target creature you don't control. If the creature you control entered this turn, put a +1/+1 counter on it. Then those creatures fight each other."],
    near: ["Choose target creature you control and target creature you don't control. If the creature you control entered this turn, put a +1/+1 counter on the creature you don't control. Then those creatures fight each other.", "Choose target creature you control and target creature you don't control. If the creature you don't control entered this turn, put a +1/+1 counter on it. Then those creatures fight each other."],
  },
});
// card wave 2, std-rx12: render/cond.ts#cardWithStats (card-with-stat)
const RX12_SEEN = { op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, as: 'r' } as unknown as EffectStep;
const rx12Peek = (filter: Record<string, unknown>): AbilityDef => spell([RX12_SEEN, { op: 'if', cond: { cond: 'matches', object: bound('r'), filter }, then: [{ op: 'move', what: bound('r'), to: { zone: 'hand' } }] } as unknown as EffectStep]);
Object.assign(EXAMPLES, {
  'card-with-stat': {
    def: rx12Peek({ types: ['Creature'], manaValue: { op: '<=', value: 3 }, isCard: true }),
    readings: [
      "Reveal the top card of your library. If it's a creature card with mana value 3 or less, put it into your hand.",
      'Reveal the top card of your library. If it has mana value 3 or less and is a creature card, put it into your hand.',
    ],
    near: [
      "Reveal the top card of your library. If it's a creature card with mana value 4 or less, put it into your hand.",
      "Reveal the top card of your library. If it's a creature card with power 3 or less, put it into your hand.",
      "Reveal the top card of your library. If it's an artifact card with mana value 3 or less, put it into your hand.",
      "Reveal the top card of your library. If it's a creature card with mana value 3 or greater, put it into your hand.",
    ],
  },
} satisfies Record<string, Example>);

// std-rr (wave 2 slice s2): opponents dealt damage as one batch (render/evt.ts) and the object's owner shuffling it (render/fold.ts#shuffleInto)
Object.assign(EXAMPLES, {
  'opponents-are-dealt-damage': {
    def: trig([{ ev: 'damage', recipient: { player: 'opponent' }, combat: true }], [draw()], { batch: true, wholeBatch: true }),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['Whenever one or more opponents are dealt combat damage, draw a card.', 'Whenever one or more of your opponents are dealt combat damage, draw a card.'],
    near: ['Whenever one or more players are dealt combat damage, draw a card.', 'Whenever one or more of your opponents are dealt damage, draw a card.', 'Whenever an opponent is dealt combat damage, draw a card.'],
  },
  'self-owner-shuffles-self': {
    def: spell([draw(), { op: 'move', what: self, to: { zone: 'library', owner: { ref: 'ownerOf', object: self } } } as EffectStep, { op: 'shuffle', who: { ref: 'ownerOf', object: self } } as EffectStep]),
    readings: ["Draw a card. Shuffle ~ into its owner's library.", "Draw a card. ~'s owner shuffles ~ into their library."],
    near: ["Draw a card. ~'s owner shuffles ~ into your library.", "Draw a card. ~'s controller shuffles ~ into their library.", "Draw a card. You shuffle ~ into their library."],
  },
});

// std-rx29 (wave 2, Standard lane rx29): "choose exactly N" (render/steps-flow.ts#chooseObjects), "their total power" (render/qty.ts) and the sacrifice of any
// number before a where-X sentence (render/fold.ts#sacrificeAnyThenWhereX)
const RX29_CHOOSE2 = { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], controller: 'you' } }, min: 2, max: 2, as: 'chosen' } as unknown as EffectStep;
const RX29_SAC_CHOICE = { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { controller: 'you', anyOf: [{ other: true, types: ['Creature'] }] } }, min: 0, max: 'any', as: 'sac' } as unknown as EffectStep;
const RX29_SAC = { op: 'sacrifice', what: bound('sac') } as unknown as EffectStep;
const RX29_MILL_TOTAL = { op: 'mill', who: you, count: { q: 'stat', stat: 'power', of: bound('sac'), sum: true } } as unknown as EffectStep;
Object.assign(EXAMPLES, {
  'choose-exactly-n': {
    def: spell([RX29_CHOOSE2, { op: 'untap', what: bound('chosen') } as unknown as EffectStep]),
    readings: ['Choose two creatures you control. Untap them.', 'Choose exactly two creatures you control. Untap the chosen creatures.', 'Choose exactly two creatures you control. Untap them.'],
    near: ['Choose up to two creatures you control. Untap them.', 'Choose exactly three creatures you control. Untap the chosen creatures.', 'Choose exactly two creatures you control. Untap the chosen artifacts.'],
  },
  'sacrificed-total-their': {
    def: spell([RX29_SAC_CHOICE, RX29_SAC, RX29_MILL_TOTAL]),
    readings: ['Sacrifice any number of other creatures, then mill X cards, where X is their total power.'],
    near: ['Sacrifice any number of other creatures, then mill X cards, where X is their total toughness.', 'Sacrifice any number of other creatures, then draw X cards, where X is their total power.'],
  },
  'sacrifice-any-then-where-x': {
    def: spell([RX29_SAC_CHOICE, RX29_SAC, RX29_MILL_TOTAL, draw()]),
    readings: ['Sacrifice any number of other creatures, then mill X cards, where X is their total power. Draw a card.'],
    near: ['Sacrifice any number of other creatures, then mill X cards. Draw a card, where X is their total power.', 'Sacrifice any number of creatures, then mill X cards, where X is their total power. Draw a card.'],
  },
} satisfies Record<string, Example>);

// std-costs-2: "each chosen <noun>" (render/program.ts#chosenFirst)
const COSTS2_MINE = objTarget('c', { types: ['Creature'], owner: 'you' }, { min: 0, max: 'any', text: 'any number of target creatures you own' });
const COSTS2_SEARCH = [
  { op: 'search', who: you, zone: 'library', filter: { types: ['Creature'] }, max: 1, reveal: true, as: 'found' },
  { op: 'if', cond: { cond: 'compare', left: { q: 'stat', stat: 'power', of: bound('found') }, op: '<=', right: 2 }, then: [{ op: 'move', what: bound('found'), to: { zone: 'battlefield', controller: you } }], else: [{ op: 'move', what: bound('found'), to: { zone: 'hand' } }] },
  { op: 'shuffle', who: you },
] as unknown as EffectStep[];
Object.assign(EXAMPLES, {
  'put-instead-of-hand': {
    def: spell(COSTS2_SEARCH),
    readings: [
      "Search your library for a creature card, reveal it, put it into your hand, then shuffle. If that card's power is 2 or less, put that card onto the battlefield instead of putting it into your hand.",
      'Search your library for a creature card and reveal it. Put it onto the battlefield if its power is 2 or less. Otherwise, put it into your hand. Then shuffle.',
    ],
    near: [
      "Search your library for a creature card, reveal it, put it into your hand, then shuffle. If that card's power is 2 or less, put that card into your graveyard instead of putting it into your hand.",
      "Search your library for an artifact card, reveal it, put it into your hand, then shuffle. If that card's power is 2 or less, put that card onto the battlefield instead of putting it into your hand.",
    ],
  },
  'each-chosen': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } } as EffectStep], [COSTS2_MINE]),
    readings: ['Choose any number of target creatures you own. Return each chosen creature to your hand.', 'Choose any number of target creatures you own. Return the chosen creatures to your hand.'],
    near: ['Choose any number of target creatures you own. Return each chosen artifact to your hand.', 'Choose any number of target creatures you own. Return each chosen creature to the battlefield.'],
  },
} satisfies Record<string, Example>);

// std-mana-12: a list of one player's verbs (render/evt.ts) and "you've done all N this turn" (render/cond.ts#doneAllPhrase)
const MANA12_BENDS = (['waterbend', 'earthbend', 'firebend', 'airbend'] as const).map((verb) => ({ ev: 'action', verb, actor: 'you' }) as EventPattern);
Object.assign(EXAMPLES, {
  'verb-list-or': {
    def: trig(MANA12_BENDS, [draw()]),
    readings: ['Whenever you waterbend, earthbend, firebend, or airbend, draw a card.', 'Whenever you waterbend or earthbend or firebend or airbend, draw a card.'],
    near: ['Whenever you waterbend, earthbend, or airbend, draw a card.', 'Whenever you waterbend, earthbend, firebend, and airbend, draw a card.'],
  },
  'done-all-trigger-actions': {
    def: trig(MANA12_BENDS, [draw(), { op: 'if', cond: { cond: 'all', of: MANA12_BENDS.map((event) => ({ cond: 'happened', event, scope: 'turn' })) }, then: [draw()] } as unknown as EffectStep]),
    readings: ["Whenever you waterbend, earthbend, firebend, or airbend, draw a card. Then if you've done all four this turn, draw a card."],
    near: ["Whenever you waterbend, earthbend, firebend, or airbend, draw a card. Then if you've done all three this turn, draw a card.", "Whenever you waterbend, earthbend, firebend, or airbend, draw a card. Then if you've done all four this game, draw a card."],
  },
} satisfies Record<string, Example>);

describe('design 6.8 (G6), D14: the equivalence table is documented and every family is exercised', () => {
  it('every family of the table has an example here, and every example a family', () => {
    expect(EQUIVALENCE_FAMILIES.map((f) => f.id).sort()).toEqual(Object.keys(EXAMPLES).sort());
  });
  it('every family says where it is written, why it is the same thing, and what evidences it', () => {
    for (const f of EQUIVALENCE_FAMILIES) {
      expect(f.where.length, f.id).toBeGreaterThan(0);
      expect(f.reason.length, f.id).toBeGreaterThan(20);
      expect(f.evidence, f.id).toMatch(/CR \d|design \d|Oracle/);
    }
  });
  it.each(Object.entries(EXAMPLES))('%s: every reading is accepted and a near miss is not', (_id, ex) => {
    if (ex.line) {
      const gate = (text: string): boolean => renderGateKeywordLine(ex.line!, [text], { selfNames: ['Test Card'], ...(ex.ctx ?? {}) }).ok;
      for (const r of ex.readings) expect(gate(r), r).toBe(true);
      for (const n of ex.near) expect(gate(n), n).toBe(false);
      return;
    }
    for (const r of ex.readings) accepts(ex.def, r, ex.ctx);
    for (const n of ex.near) rejects(ex.def, n, ex.ctx);
  });
});

describe('design 6.8 (G6): the number of alternative groups per file is the number the table was reviewed for', () => {
  it('matches the sources of render/', () => {
    const dir = fileURLToPath(new URL('../../../src/render/', import.meta.url));
    const actual: Record<string, number> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'equivalence.ts').sort()) {
      const n = (readFileSync(dir + file, 'utf8').match(/\balt\(/g) ?? []).length;
      if (n > 0) actual[file] = n;
    }
    expect(actual, 'a new alt(...) group needs a review: add it to a family of EQUIVALENCE_FAMILIES (or add a family) and update ALT_SITES').toEqual(ALT_SITES);
  });
});

// r4-cost (Standard round 4): costs, mana and choices (zz-cloud/r4-cost.json)
Object.assign(EXAMPLES, {
  'opponent-dealt-damage-perfect': {
    def: { kind: 'activated', text: '', cost: { tap: true }, onlyIf: { cond: 'happened', event: { ev: 'damage', combat: false, recipient: { player: 'opponent' } }, scope: 'turn' }, effect: { targets: [], steps: [draw()] } } as AbilityDef,
    ctx: creature,
    readings: ['{T}: Draw a card. Activate only if an opponent was dealt noncombat damage this turn.', '{T}: Draw a card. Activate only if an opponent has been dealt noncombat damage this turn.'],
    near: ['{T}: Draw a card. Activate only if an opponent has been dealt combat damage this turn.', '{T}: Draw a card. Activate only if you have been dealt noncombat damage this turn.'],
  },
  'unchosen-header-stop': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you', other: true }, to: 'battlefield' }] }, effect: { targets: [], steps: [], modes: { min: 1, max: 1, unchosen: 'turn', options: [{ program: { targets: [], steps: [draw()] } }, { program: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 2 } as EffectStep] } }] } } } as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever another creature you control enters, choose one that hasn't been chosen this turn — • Draw a card. • You gain 2 life.", "Whenever another creature you control enters, choose one that hasn't been chosen this turn. • Draw a card. • You gain 2 life."],
    near: ["Whenever another creature you control enters, choose one that hasn't been chosen. • Draw a card. • You gain 2 life.", "Whenever another creature you control enters, choose one. • Draw a card. • You gain 2 life."],
  },
  'mana-choose-color': {
    def: { kind: 'activated', text: '', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, dynamic: { kind: 'anyOneColor', count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['{T}: Add X mana of any one color, where X is the number of creatures you control.', '{T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control.'],
    near: ['{T}: Choose a color. Add an amount of mana of any color equal to the number of creatures you control.', '{T}: Choose two colors. Add an amount of mana of that color equal to the number of creatures you control.'],
  },
  // r5-cost: a granted harmonize whose cost is the card's mana cost
  'keyword-cost-is-mana-cost': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: '', filter: { types: ['Sorcery'], zone: 'graveyard', owner: 'you', isCard: true } }], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'harmonize', text: 'harmonize', costIsManaCost: true }] }] }] } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['When Test Card enters, target sorcery card in your graveyard gains harmonize until end of turn. Its harmonize cost is equal to its mana cost.', "When Test Card enters, target sorcery card in your graveyard gains harmonize until end of turn. The harmonize cost is equal to that card's mana cost."],
    near: ['When Test Card enters, target sorcery card in your graveyard gains harmonize until end of turn. Its flashback cost is equal to its mana cost.', 'When Test Card enters, target sorcery card in your graveyard gains harmonize until end of turn. Its harmonize cost is equal to its power.'],
  },
  // r5-cost: the controller of a target for each opponent
  'that-opponent-controls': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [{ id: 't0', kind: 'object', min: 0, max: 1, text: '', filter: { types: ['Creature'], controller: 'opponent' }, perOpponent: true }], steps: [{ op: 'tap', what: { ref: 'target', id: 't0' } } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['When Test Card enters, for each opponent, tap up to one target creature that player controls.', 'When Test Card enters, for each opponent, tap up to one target creature that opponent controls.'],
    near: ['When Test Card enters, for each opponent, tap up to one target creature you control.', 'When Test Card enters, for each opponent, tap up to one target creature that creature controls.'],
  },
} satisfies Record<string, Example>);
// Standard round 5, r5-refs: the readings of its families (invented wordings, design 6.10)
const R5REFS_CTRL = { ref: 'controllerOf', object: { ref: 'event', role: 'object' } };
Object.assign(EXAMPLES, {
  'attacks-one-of-your-opponents': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'opponent' }] }, effect: { targets: [], steps: [gain(1)] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['Whenever a creature attacks an opponent, you gain 1 life.', 'Whenever a creature attacks one of your opponents, you gain 1 life.'],
    near: ['Whenever a creature attacks you, you gain 1 life.', 'Whenever a creature attacks one of your planeswalkers, you gain 1 life.'],
  },
  'cast-the-exiled-card': {
    def: statics([{ s: 'permit', who: you, action: 'cast', of: { is: { ref: 'linked', link: 'exiled' } } } as unknown as StaticEffect]),
    ctx: creature,
    readings: ['You may cast the exiled card.', 'You may cast spells from among cards exiled with Test Card.'],
    near: ['You may play the exiled card.', 'You may cast the exiled creature.'],
  },
  'cast-this-way-any-type': {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"move","as":"impulse","to":{"zone":"exile"},"what":{"ref":"topCards","count":1,"player":{"ref":"you"}}},{"op":"effect","duration":{"d":"endOfTurn"},"effects":[{"s":"permit","action":"play","anyManaType":true,"of":{"is":{"ref":"bound","name":"impulse"}},"who":{"ref":"you"}}]}]}} as unknown as AbilityDef,
    readings: ['Exile the top card of your library. You may play that card this turn, and mana of any type can be spent to cast that spell.', 'Exile the top card of your library. You may play that card this turn. If you cast a spell this way, you may spend mana as though it were mana of any type to cast it.'],
    near: ['Exile the top card of your library. You may play that card this turn. If you cast a spell this way, you may spend mana as though it were mana of any color to cast it.', 'Exile the top card of your library. You may play that card this turn.'],
  },
  'exiled-card-of-this-ability': {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"chooseObjects","as":"exiled","from":{"ref":"each","filter":{"isCard":true,"owner":"you","types":["Creature"],"zone":"hand"}},"max":1,"min":1,"who":{"ref":"you"}},{"op":"move","to":{"zone":"exile"},"what":{"ref":"bound","name":"exiled"}},{"op":"copy","result":"token","what":{"ref":"bound","name":"exiled"},"who":{"ref":"you"}}]}} as unknown as AbilityDef,
    readings: ["Exile a creature card from your hand. Create a token that's a copy of the exiled card.", "Exile a creature card from your hand. Create a token that's a copy of that card."],
    near: ["Exile a creature card from your hand. Create a token that's a copy of the exiled cards.", "Exile a creature card from your hand. Create a token that's a copy of the discarded card."],
  },
  'play-cards-exiled-with': {
    def: statics([{ s: 'permit', who: you, action: 'play', of: { is: { ref: 'linked', link: 'exiled' } } } as unknown as StaticEffect]),
    ctx: creature,
    readings: ['You may play cards exiled with Test Card.', 'You may play lands and cast spells from among cards exiled with Test Card.'],
    near: ['You may cast spells from among cards exiled with Test Card.', 'You may play lands from among cards exiled with Test Card.'],
  },
  'each-player-who-does-sentence': {
    def: spell([{
      op: 'may', who: { ref: 'each', who: 'player' }, do: [
        { op: 'move', what: { ref: 'each', filter: { zone: 'hand', owner: { ref: 'iterating' } } }, to: { zone: 'library', owner: { ref: 'iterating' } } },
        { op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', owner: { ref: 'iterating' } } }, to: { zone: 'library', owner: { ref: 'iterating' } } },
        { op: 'shuffle', who: { ref: 'iterating' } }, { op: 'draw', who: { ref: 'iterating' }, count: 3 },
      ],
    } as unknown as EffectStep]),
    readings: ['Each player may shuffle their hand and graveyard into their library, then each player who does draws three cards.', 'Each player may shuffle their hand and graveyard into their library. Each player who does draws three cards.'],
    near: ['Each player may shuffle their hand and graveyard into their library. Each player who doesn\'t draws three cards.', 'Each player may shuffle their hand and graveyard into their library. Each player who does draws two cards.'],
  },
  'each-other-player-opponent': {
    def: spell([{ op: 'move', what: t('o'), to: { zone: 'exile' } } as EffectStep], [{ ...objTarget('o', { types: ['Creature'], controller: 'opponent' }), min: 0, perOpponent: true } as TargetSpec]),
    readings: ['For each opponent, exile up to one target creature that player controls.', 'For each other player, exile up to one target creature that player controls.'],
    near: ['For each player, exile up to one target creature that player controls.', 'For each other player, exile up to one target creature you control.'],
  },
  'player-may-impulse': {
    def: {
      kind: 'triggered', text: '', trigger: { on: [{ ev: 'damage', recipient: { object: { types: ['Creature'] } } }] }, effect: {
        targets: [], steps: [{
          op: 'may', who: R5REFS_CTRL, do: [
            { op: 'move', what: { ref: 'topCards', player: R5REFS_CTRL, count: 2 }, to: { zone: 'exile' }, as: 'them' },
            { op: 'effect', duration: { d: 'endOfNextTurn', whose: R5REFS_CTRL }, effects: [{ s: 'permit', who: R5REFS_CTRL, action: 'play', of: { is: { ref: 'bound', name: 'them' } } }] },
          ],
        }],
      },
    } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: [
      'Whenever a creature is dealt damage, its controller may exile two cards from the top of their library. They may play those cards until the end of their next turn.',
      'Whenever a creature is dealt damage, its controller may exile the top two cards of their library. That player may play them until the end of their next turn.',
    ],
    near: [
      'Whenever a creature is dealt damage, its controller may exile two cards from the top of your library. They may play those cards until the end of their next turn.',
      'Whenever a creature is dealt damage, its controller may exile two cards from the top of their library. You may play those cards until the end of their next turn.',
    ],
  },
});
// Standard round 5, r5-fxz: the families of its readings (render/equivalence.ts)
const R5_FOOD = [{ kind: 'activated', text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.', cost: { mana: [{ kind: 'generic', amount: 2 }], tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 3 }] } }];
const R5_OPP_DIED = { types: ['Creature'], zone: 'graveyard', owner: 'opponent', putThereThisTurn: true, putThereFrom: 'battlefield', isCard: true };
Object.assign(EXAMPLES, {
  'repeat-for-each': {
    def: spell([{ op: 'surveil', who: you, count: 2, as: 'sv' } as EffectStep, { op: 'repeat', times: { q: 'resultCount', step: 'sv', which: { owner: 'you', isCard: true } }, do: [{ op: 'gainLife', who: you, amount: 2 }] } as unknown as EffectStep]),
    readings: ['Surveil 2. Then for each card you put on top of your library, you gain 2 life.', 'Surveil 2. For each card you put on top of your library, you gain 2 life.'],
    near: ['Surveil 2. Then for each card you put into your graveyard, you gain 2 life.', 'Surveil 2. Then for each card you put on top of your library, you gain 3 life.'],
  },
  'who-didnt-discard': {
    def: spell([{ op: 'discard', who: t('t0'), count: 1, as: 'dc' } as EffectStep, { op: 'repeat', times: { q: 'countPlayers', of: t('t0'), didNot: { op: 'discard', step: 'dc', which: { types: ['Land'] } } }, do: [draw(1)] } as unknown as EffectStep],
      [{ id: 't0', kind: 'player', min: 0, max: 'any', text: 'any number of target opponents', players: { who: 'opponent' } } as TargetSpec]),
    readings: ["Any number of target opponents each discard a card. For each of those opponents who didn't discard a land card, draw a card.", 'Any number of target opponents each discard a card. For each of those opponents who did not discard a land card, draw a card.'],
    near: ['Any number of target opponents each discard a card. For each of those opponents who discarded a land card, draw a card.', "Any number of target opponents each discard a card. For each of those opponents who didn't discard a creature card, draw a card."],
  },
  'put-there-this-turn': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } }], [objTarget('c', { types: ['Creature'], zone: 'graveyard', putThereThisTurn: true, isCard: true })]),
    readings: ['Exile target creature card from a graveyard that was put there this turn.', 'Exile target creature card from a graveyard that was put there from anywhere this turn.'],
    near: ['Exile target creature card from a graveyard that was put there from the battlefield this turn.', 'Exile target creature card from a graveyard.'],
  },
  'opponents-graveyards': {
    def: spell([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', owner: 'opponent', isCard: true } }, to: { zone: 'exile' } } as EffectStep]),
    readings: ["Exile all cards from your opponents' graveyards.", "Exile all cards from an opponent's graveyard."],
    near: ['Exile all cards from your graveyard.', 'Exile all cards from all graveyards.'],
  },
  'put-onto-battlefield-first': {
    def: spell([{ op: 'move', what: { ref: 'each', filter: R5_OPP_DIED }, to: { zone: 'battlefield', controller: you } } as unknown as EffectStep]),
    readings: ["Put onto the battlefield under your control all creature cards in your opponents' graveyards that were put there from the battlefield this turn.", "Return all creature cards in your opponents' graveyards that were put there from the battlefield this turn to the battlefield under your control."],
    near: ["Put onto the battlefield all creature cards in your opponents' graveyards that were put there from the battlefield this turn.", "Put onto the battlefield under your control all creature cards in your opponents' graveyards that were put there this turn."],
  },
  'they-are-artifacts-with': {
    def: spell([{ op: 'move', what: { ref: 'each', filter: R5_OPP_DIED }, to: { zone: 'battlefield', controller: you }, as: 'them' } as unknown as EffectStep,
      effectStep([{ s: 'continuous', affects: bound('them'), mods: [{ layer: 4, types: { set: ['Artifact'] }, subtypes: { set: ['Food'] } }, { layer: 6, add: R5_FOOD }] } as unknown as StaticEffect], { d: 'permanent' })]),
    readings: ["Put onto the battlefield under your control all creature cards in your opponents' graveyards that were put there from the battlefield this turn. They are Food artifacts with \"{2}, {T}, Sacrifice this artifact: You gain 3 life.\""],
    near: ["Put onto the battlefield under your control all creature cards in your opponents' graveyards that were put there from the battlefield this turn. They are Food artifacts in addition to their other types with \"{2}, {T}, Sacrifice this artifact: You gain 3 life.\"", "Put onto the battlefield under your control all creature cards in your opponents' graveyards that were put there from the battlefield this turn. They are Clue artifacts with \"{2}, {T}, Sacrifice this artifact: You gain 3 life.\""],
  },
});
Object.assign(EXAMPLES, {
  'colorless-artifact-loses-others': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, types: { set: ['Artifact'] }, subtypes: { set: ['Food'] } }, { layer: 5, colors: { set: [] } }, { layer: 6, removeAll: true, add: R5_FOOD }] } as unknown as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ['Enchanted permanent is a colorless Food artifact with "{2}, {T}, Sacrifice this artifact: You gain 3 life" and loses all other card types and abilities.'],
    near: ['Enchanted permanent is a Food artifact with "{2}, {T}, Sacrifice this artifact: You gain 3 life" and loses all other card types and abilities.', 'Enchanted permanent is a colorless Food artifact with "{2}, {T}, Sacrifice this artifact: You gain 3 life" and loses all other abilities.'],
  },
});
// Standard round F (std-rf): the land form of the family above (render/mods.ts, invented wording)
Object.assign(EXAMPLES, {
  'colorless-land-loses-others': {
    def: statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, types: { set: ['Land'] } }, { layer: 5, colors: { set: [] } }, { layer: 6, removeAll: true, add: [{ kind: 'activated', text: '{T}: Add {C}{C}', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: you, units: [['C'], ['C']] } as EffectStep] } }] }] } as unknown as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ['Enchanted permanent is a colorless land with "{T}: Add {C}{C}" and loses all other card types and abilities.'],
    near: ['Enchanted permanent is a land with "{T}: Add {C}{C}" and loses all other card types and abilities.', 'Enchanted permanent is a colorless land with "{T}: Add {C}{C}" and loses all other abilities.', 'Enchanted permanent is a colorless Forest land with "{T}: Add {C}{C}" and loses all other card types and abilities.'],
  },
});
Object.assign(EXAMPLES, {
  'event-and-at-step': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'becomes', what: 'transformed', object: { self: true } }, { ev: 'step', step: 'upkeep', whose: 'you' }] }, effect: { targets: [], steps: [draw()] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['Whenever Test Card transforms into Test Card and at the beginning of your upkeep, draw a card.', 'When Test Card transforms into Test Card and at the beginning of your upkeep, draw a card.'],
    near: ['Whenever Test Card transforms into Test Card and at the beginning of each upkeep, draw a card.', 'Whenever Test Card enters and at the beginning of your upkeep, draw a card.', 'Whenever Test Card transforms into Test Card and whenever you gain life, draw a card.'],
  },
  'exile-one-of-them': {
    def: spell([{ op: 'look', who: you, at: { ref: 'topCards', player: you, count: 2 }, as: 'looked' } as EffectStep, { op: 'chooseObjects', who: you, from: bound('looked'), min: 1, max: 1, as: 'exiledOne' } as EffectStep,
      { op: 'move', what: bound('exiledOne'), to: { zone: 'exile' } } as EffectStep, { op: 'move', what: { ref: 'each', filter: { is: bound('looked'), zone: 'library' } }, to: { zone: 'hand' } } as EffectStep]),
    readings: ['Look at the top two cards of your library. Exile one of them and put the other into your hand.', 'Look at the top two cards of your library. Exile one of those cards and put the other into your hand.'],
    near: ['Look at the top two cards of your library. Exile one of them and put the other into your graveyard.', 'Look at the top two cards of your library. Put one of them into your hand and exile the other.'],
  },
});
// Standard round C, std-rc (render/abil.ts#withRestrictions, render/stat.ts#countWhereX)
Object.assign(EXAMPLES, {
  'ability-cost-where-x': {
    def: {
      kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 8 }], tap: true }, effect: { targets: [], steps: [draw()] },
      costChange: { kind: 'reduce', generic: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } }, floor: 'zero' },
    } as AbilityDef,
    readings: ['{8}, {T}: Draw a card. This ability costs {1} less to activate for each artifact you control.', '{8}, {T}: Draw a card. This ability costs {X} less to activate, where X is the number of artifacts you control.'],
    near: ['{8}, {T}: Draw a card. This ability costs {X} less to activate, where X is the number of artifacts your opponents control.', '{8}, {T}: Draw a card. This ability costs {X} more to activate, where X is the number of artifacts you control.', '{8}, {T}: Draw a card. This ability costs {X} less to cast, where X is the number of artifacts you control.'],
  },
  'exiled-under-control': {
    def: spell([{ op: 'draw', who: you, count: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'exile' }, scope: 'turn' } } as EffectStep]),
    readings: ["Draw a card for each creature that was exiled under your opponents' control this turn.", "Draw a card for each creature that was exiled under an opponent's control this turn."],
    near: ["Draw a card for each creature that was exiled under your control this turn.", "Draw a card for each creature that was exiled under your opponents' control last turn.", "Draw a card for each creature that died under your opponents' control this turn."],
  },
});
// Standard round 8, std-r8 (render/stat.ts#countWhereX)
Object.assign(EXAMPLES, {
  'cost-where-x': {
    def: { ...statics([{ s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'reduce', generic: { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], zone: 'graveyard', owner: 'you', isCard: true } } }, floor: 'zero' } }]), zone: ['stack'] } as AbilityDef,
    readings: ['This spell costs {1} less to cast for each artifact card in your graveyard.', 'This spell costs {X} less to cast, where X is the number of artifact cards in your graveyard.'],
    near: ['This spell costs {X} less to cast, where X is the number of artifact cards in your hand.', 'This spell costs {X} more to cast, where X is the number of artifact cards in your graveyard.', 'This spell costs {2} less to cast, where X is the number of artifact cards in your graveyard.'],
  },
  'subtype-list-spells': {
    def: statics([{ s: 'costMod', applies: { spells: { subtypes: ['Aura', 'Equipment'], stackKind: 'spell', zone: 'stack' }, caster: 'you' }, change: { kind: 'reduce', generic: 1, floor: 'zero' } }]),
    readings: ['Aura or Equipment spells you cast cost {1} less to cast.', 'Aura and Equipment spells you cast cost {1} less to cast.'],
    near: ['Aura and Vehicle spells you cast cost {1} less to cast.', 'Aura and Equipment spells you cast cost {2} less to cast.', 'Aura and Equipment spells your opponents cast cost {1} less to cast.'],
  },
  'keyword-list-quoted': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: 6, add: [
      { kind: 'keyword', keyword: 'flying', text: 'flying' },
      { kind: 'keyword', keyword: 'haste', text: 'haste' },
      { kind: 'triggered', text: 'At the beginning of your upkeep, draw a card.', trigger: { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } },
    ] as never }] }]),
    readings: ['Creatures you control have flying and haste and "At the beginning of your upkeep, draw a card."', 'Creatures you control have flying, haste, and "At the beginning of your upkeep, draw a card."'],
    near: ['Creatures you control have flying, trample, and "At the beginning of your upkeep, draw a card."', 'Creatures you control have flying, haste, and "At the beginning of your upkeep, draw two cards."', 'Creatures you control have haste and "At the beginning of your upkeep, draw a card."'],
  },
});
// Standard round J (std-rj): the readings of the round's families
const RJ_BATCH: EventPattern = { ev: 'zoneChange', subject: { other: true, types: ['Creature'], controller: 'you' }, to: 'battlefield' };
const RJ_FREE_CAST_IF: EffectStep[] = [
  { op: 'exileUntil', who: you, filter: { notTypes: ['Land'] }, as: 'e' } as EffectStep,
  { op: 'if', cond: { cond: 'compare', left: { q: 'stat', stat: 'manaValue', of: bound('e') }, op: '<', right: { q: 'life', of: you } }, then: [{ op: 'cast', who: you, what: bound('e'), free: true, optional: true, as: 'cast' }] } as EffectStep,
];
Object.assign(EXAMPLES, {
  'some-match-they': {
    def: trig([RJ_BATCH], [draw()], { batch: true, interveningIf: { cond: 'someMatch', object: { ref: 'event', role: 'subject' }, filter: { anyOf: [{ enteredFrom: 'graveyard' }, { castFrom: 'graveyard' }] } } }),
    ctx: creature,
    readings: ['Whenever one or more other creatures you control enter, if they entered or were cast from a graveyard, draw a card.', 'Whenever one or more other creatures you control enter, if one or more of them entered from a graveyard or was cast from a graveyard, draw a card.'],
    near: ['Whenever one or more other creatures you control enter, if they entered or were cast from exile, draw a card.', 'Whenever one or more other creatures you control enter, if they entered from a graveyard, draw a card.'],
  },
  'legendary-and-or': {
    def: spell([
      { op: 'mill', who: you, count: 3, as: 'm' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ anyOf: [{ supertypes: ['Legendary'] }, { types: ['Enchantment'] }] }], is: bound('m'), zone: 'any' } }, min: 0, max: 'any', as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' } } as EffectStep,
    ]),
    readings: ['Mill three cards. You may put any number of legendary and/or enchantment cards from among them into your hand.', 'Mill three cards. You may put any number of legendary cards or enchantment cards from among them into your hand.'],
    near: ['Mill three cards. You may put any number of legendary and/or creature cards from among them into your hand.', 'Mill three cards. You may put any number of legendary and enchantment cards from among them into your hand.'],
  },
  'exiled-cards-group': {
    def: spell([
      { op: 'move', what: { ref: 'topCards', player: you, count: 4 }, to: { zone: 'exile' }, as: 'e' } as EffectStep,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { notTypes: ['Land'], is: bound('e'), zone: 'exile' } }, min: 0, max: 2, as: 'c' } as EffectStep,
      { op: 'cast', who: you, what: bound('c'), free: true } as EffectStep,
    ]),
    readings: ['Exile the top four cards of your library. You may cast up to two spells from among them without paying their mana costs.', 'Exile the top four cards of your library. You may cast up to two spells from among the exiled cards without paying their mana costs.'],
    near: ['Exile the top four cards of your library. You may cast up to three spells from among the exiled cards without paying their mana costs.', 'Exile the top four cards of your library. You may cast up to two spells from among the revealed cards without paying their mana costs.'],
  },
  'cast-free-spell-mv': {
    def: spell(RJ_FREE_CAST_IF),
    readings: ["Exile cards from the top of your library until you exile a nonland card. If that card's mana value is less than your life total, you may cast that card without paying its mana cost.", "Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than your life total."],
    near: ["Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is greater than your life total.", "Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the card's mana value is less than your life total."],
  },
  'lose-life-trailing-if': {
    def: spell([{ op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Zombie'], controller: 'you' } } }, then: [{ op: 'loseLife', who: you, amount: { q: 'life', of: you } }], else: [{ op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: { q: 'life', of: you } }] } as EffectStep]),
    readings: ['You lose life equal to your life total if you control a Zombie. Otherwise, each opponent loses that much life.', 'If you control a Zombie, you lose life equal to your life total. Otherwise, each opponent loses life equal to your life total.'],
    near: ['You lose life equal to your life total if you control a Zombie. Otherwise, each opponent loses twice that much life.', 'You lose life equal to your life total if you control a Goblin. Otherwise, each opponent loses that much life.'],
  },
  'didnt-cast-this-way': {
    def: spell([...RJ_FREE_CAST_IF, { op: 'if', cond: { cond: 'did', step: 'cast', not: true }, then: [{ op: 'move', what: bound('e'), to: { zone: 'hand' } }] } as EffectStep]),
    readings: ["Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than your life total. If you don't cast that card this way, put it into your hand."],
    near: ["Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than your life total. If you don't cast that card this way, put it onto the battlefield.", "Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than your life total. If you cast that card this way, put it into your hand."],
  },
} as Record<string, Example>);
// Standard round H, std-rh (render/cond.ts, mods.ts, qty.ts, refs.ts, stat.ts, steps-zones.ts)
Object.assign(EXAMPLES, {
  'life-above-starting-greater': {
    def: { kind: 'static', text: '', effects: [grow], condition: { cond: 'compare', left: { q: 'life', of: you }, op: '>=', right: { q: 'math', op: '+', args: [{ q: 'startingLife' }, 10] } } } as AbilityDef,
    ctx: creature,
    readings: ['As long as you have at least 10 life more than your starting life total, Test Card gets +1/+1.', 'As long as your life total is at least 10 greater than your starting life total, Test Card gets +1/+1.'],
    near: ['As long as your life total is at least 9 greater than your starting life total, Test Card gets +1/+1.', 'As long as your life total is at least 10 less than your starting life total, Test Card gets +1/+1.'],
  },
  'still-a-land-inline': {
    def: spell([{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: t('c'), mods: [
      { layer: 4, types: { add: ['Creature'] }, subtypes: { add: ['Elemental'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }] }, { layer: '7b', power: 4, toughness: 4 }] }] } as EffectStep],
    [objTarget('c', { types: ['Land'], controller: 'you' })]),
    readings: ["Target land you control becomes a 4/4 Elemental creature with trample. It's still a land.", "Target land you control becomes a 4/4 Elemental creature with trample that's still a land."],
    near: ["Target land you control becomes a 4/4 Elemental creature with haste that's still a land.", "Target land you control becomes a 4/4 Elemental creature with trample that's a land."],
  },
  'cast-spells-from-among-group': {
    def: spell([
      { op: 'move', what: { ref: 'topCards', player: you, count: 2 }, to: { zone: 'exile' }, as: 'them' } as EffectStep,
      { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'permit', who: you, action: 'cast', of: { is: bound('them') } }] } as EffectStep,
    ]),
    readings: ['Exile the top two cards of your library. Until end of turn, you may cast them.', 'Exile the top two cards of your library. Until end of turn, you may cast spells from among those cards.'],
    near: ['Exile the top two cards of your library. Until end of turn, you may cast spells from your hand.', 'Exile the top two cards of your library. Until end of turn, you may play spells from among those cards.'],
  },
  'craft-exiled-card': {
    def: trig([enters], [{ op: 'gainLife', who: you, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'linked', link: 'craft' } } } as EffectStep]),
    ctx: creature,
    readings: ['When Test Card enters, you gain life equal to the mana value of the exiled card used to craft it.'],
    near: ['When Test Card enters, you gain life equal to the power of the exiled card used to craft it.', 'When Test Card enters, you gain life equal to the mana value of the exiled card.'],
  },
  'rest-not-put-onto-battlefield': {
    def: spell([
      { op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 5 }, as: 'them' } as EffectStep,
      { op: 'may', who: you, do: [
        { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Land'], is: bound('them'), zone: 'library' } }, min: 0, max: 'any', as: 'chosen' } as EffectStep,
        { op: 'move', what: bound('chosen'), to: { zone: 'battlefield', controller: you } } as EffectStep,
      ] } as EffectStep,
      { op: 'move', what: { ref: 'each', filter: { is: bound('them'), not: { is: bound('chosen') }, zone: 'library' } }, to: { zone: 'graveyard' } } as EffectStep,
    ]),
    readings: [
      'Reveal the top 5 cards of your library. You may put any number of land cards from among them onto the battlefield. Put the rest into your graveyard.',
      'Reveal the top 5 cards of your library. You may put any number of land cards from among them onto the battlefield. Then put the rest into your graveyard.',
      "Reveal the top 5 cards of your library. You may put any number of land cards from among them onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield into your graveyard.",
    ],
    near: ['Reveal the top 5 cards of your library. You may put any number of land cards from among them onto the battlefield. Then put the rest into your hand.'],
  },
});

// std-rl (precon round L)
Object.assign(EXAMPLES, {
  'with-stat-before-controller': {
    def: spell([{ op: 'destroy', what: t('c') } as EffectStep], [objTarget('c', { types: ['Creature'], power: { op: '>=', value: 4 }, controller: 'opponent' })]),
    readings: ['Destroy target creature an opponent controls with power 4 or greater.', 'Destroy target creature with power 4 or greater an opponent controls.'],
    near: ['Destroy target creature with power 4 or less an opponent controls.', 'Destroy target creature with power 4 or greater you control.'],
  },
  'cast-only-if': {
    def: { kind: 'static', text: '', zone: ['stack'], effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'cast', when: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Wizard'], controller: 'you' } }, atLeast: 2 } }] } as unknown as AbilityDef,
    ctx: creature,
    readings: ["You can't cast Test Card unless you control two or more Wizards.", 'Cast Test Card only if you control two or more Wizards.'],
    near: ['Cast Test Card only if you control three or more Wizards.', 'Cast Test Card only if an opponent controls two or more Wizards.'],
  },
  'counters-equal-without-number': {
    def: spell([{ op: 'putCounters', on: t('c'), kind: '+1/+1', count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } } } as EffectStep], [objTarget('c', { types: ['Creature'] })]),
    readings: ['Put a number of +1/+1 counters on target creature equal to the number of Forests you control.', 'Put +1/+1 counters on target creature equal to the number of Forests you control.'],
    near: ['Put +1/+1 counters on target creature equal to the number of Islands you control.', 'Put -1/-1 counters on target creature equal to the number of Forests you control.'],
  },
});
Object.assign(EXAMPLES, {
  'search-put-it-or-that-card': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } } as EffectStep, { op: 'may', who: { ref: 'controllerOf', object: t('c') }, do: [
      { op: 'search', who: { ref: 'controllerOf', object: t('c') }, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, max: 1, as: 'search' },
      { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'battlefield', controller: { ref: 'controllerOf', object: t('c') }, tapped: true } },
      { op: 'shuffle', who: { ref: 'controllerOf', object: t('c') } }] } as unknown as EffectStep], [objTarget('c', { types: ['Creature'] })]),
    readings: ['Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.', 'Exile target creature. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.'],
    near: ['Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield, then shuffle.', 'Exile target creature. Its controller may search their library for a basic land card, put those cards onto the battlefield tapped, then shuffle.'],
  },
});
// Standard round 9 (std-r9b): the chosen creature type of a group (zz-cloud/std-r9b.json)
Object.assign(EXAMPLES, {
  'chosen-creature-type-in-addition': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], subtypes: ['Vehicle'], controller: 'you' } }, mods: [{ layer: 4, subtypes: { chosen: 'type' } }] } as unknown as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['Vehicle creatures you control are the chosen type in addition to their other types.', 'Vehicle creatures you control are the chosen creature type in addition to their other types.'],
    near: ['Vehicle creatures you control are the chosen color in addition to their other colors.', 'Vehicle creatures you control are the chosen creature type.'],
  },
});
// Standard round B, std-rB (render/steps-flow.ts, the `if` clause: alsoLead)
Object.assign(EXAMPLES, {
  'if-also-imperative': {
    def: spell([draw(), { op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } }, then: [gain(2)] } as EffectStep]),
    readings: ['Draw a card. If you control an Elf, you gain 2 life.', 'Draw a card. If you control an Elf, also gain 2 life.'],
    near: ['Draw a card. If you control an Elf, also gain 3 life.', 'Draw a card. If you control a Goblin, also gain 2 life.', 'Draw a card. Also gain 2 life if you control an Elf.'],
  },
});

// Standard round E, std-re: "that's a <kind> or a <kind>" (parser/holes/filter.ts#thatsKinds)
Object.assign(EXAMPLES, {
  'thats-kinds-after-det': {
    def: spell([{ op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you', anyOf: [{ subtypes: ['Wolf'] }, { subtypes: ['Werewolf'] }] } }, kind: '+1/+1', count: 1 } as EffectStep]),
    readings: ["Put a +1/+1 counter on each Wolf or Werewolf creature you control.", "Put a +1/+1 counter on each creature you control that's a Wolf or a Werewolf."],
    near: ["Put a +1/+1 counter on each creature you control that's a Wolf and a Werewolf.", "Put a +1/+1 counter on each creature you control that's a Wolf or an Elf.", "Put a +1/+1 counter on each creature you control that's a Wolf."],
  },
  'thats-kinds-one-article': {
    def: statics([{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you', other: true, anyOf: [{ subtypes: ['Skeleton'] }, { subtypes: ['Pirate'] }] } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] } as StaticEffect]),
    ctx: creature,
    readings: ["Each other creature you control that's a Skeleton or a Pirate gets +1/+1.", "Each other creature you control that's a Skeleton or Pirate gets +1/+1."],
    near: ["Each other creature you control that's a Skeleton or Zombie gets +1/+1.", "Each other creature you control that's a Skeleton and Pirate gets +1/+1.", "Each creature you control that's a Skeleton or Pirate gets +1/+1."],
  },
});
// card wave 2, std-rx8: "cards equal to <number> from the top of <player>'s library" (refs.ts#topCards; zz-cloud/std-rx8.json)
Object.assign(EXAMPLES, {
  'cards-equal-to-from-top': {
    def: spell([{ op: 'move', what: { ref: 'topCards', player: t('p'), count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } } }, to: { zone: 'exile' } } as unknown as EffectStep], [playerTarget('p')]),
    readings: ["Exile cards equal to the number of Forests you control from the top of target player's library.", "Exile the top X cards of target player's library, where X is the number of Forests you control."],
    near: ["Exile cards equal to the number of Islands you control from the top of target player's library.", "Exile cards equal to the number of Forests you control from the bottom of target player's library.", "Exile cards equal to the number of Forests you control from the top of your library."],
  },
});

// std-ru (card wave 2, slice s5): the attached-to condition (render/cond.ts), "~ can't be attacked" (render/stat.ts#restrict, sharedSubject), the life cost of a
// linked permission (render/stat.ts#permit) and the condition after "you may put ... onto the battlefield" (render/steps-flow.ts)
const RU_LINKED = { s: 'permit', who: you, action: 'play', of: { is: { ref: 'linked', link: 'exiled' } } } as unknown as StaticEffect;
const RU_BAN = { s: 'restrict', subject: { ref: 'each', filter: { types: ['Creature'] } }, mode: 'cant', action: 'attack', other: { self: true } } as unknown as StaticEffect;
const RU_EQUIPMENT = { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] };
Object.assign(EXAMPLES, {
  'attached-to-a': {
    def: { kind: 'static', text: '', condition: { cond: 'matches', object: { ref: 'attachedTo' }, filter: { types: ['Creature'] } }, effects: [{ s: 'continuous', affects: self, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'hexproof', text: 'hexproof' }] }] }] } as unknown as AbilityDef,
    ctx: RU_EQUIPMENT,
    readings: ['As long as Test Card is attached to a creature, Test Card has hexproof.', 'As long as equipped creature is a creature, Test Card has hexproof.'],
    near: ['As long as Test Card is attached to an artifact, Test Card has hexproof.', 'As long as Test Card is attached to a creature, Test Card has shroud.'],
  },
  'cant-be-attacked': {
    def: statics([RU_BAN]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Planeswalker'] },
    readings: ["Test Card can't be attacked.", "Creatures can't attack Test Card."],
    near: ["Test Card can't be blocked.", "Creatures can't block Test Card."],
  },
  'pay-life-rather-than': {
    def: { kind: 'static', text: '', condition: { cond: 'turnOf', whose: 'you' }, effects: [{ ...RU_LINKED, costChange: { kind: 'set', life: 'manaValue' } }] } as unknown as AbilityDef,
    ctx: creature,
    readings: ['During your turn, you may play cards exiled with Test Card. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.', 'During your turn, you may play cards exiled with Test Card. If you cast a spell this way, pay life equal to its mana value rather than paying its mana cost.'],
    near: ['During your turn, you may play cards exiled with Test Card. If you cast a spell this way, pay life equal to its power rather than pay its mana cost.', 'During your turn, you may play cards exiled with Test Card.'],
  },
  'may-put-onto-battlefield-if': {
    def: spell([{ op: 'search', who: you, zone: 'library', filter: { types: ['Enchantment'] }, max: 1, reveal: true, as: 'search' } as EffectStep,
      { op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } }, then: [{ op: 'may', who: you, do: [{ op: 'move', what: bound('search'), to: { zone: 'battlefield', controller: you } }] }] } as unknown as EffectStep]),
    readings: ['Search your library for an enchantment card, reveal it. You may put it onto the battlefield if you control a Forest.', 'Search your library for an enchantment card, reveal it. If you control a Forest, you may put it onto the battlefield.'],
    near: ['Search your library for an enchantment card, reveal it. You may put it onto the battlefield if you control an Island.', 'Search your library for an enchantment card, reveal it. You may put it into your hand if you control a Forest.'],
  },
} satisfies Record<string, Example>);
// std-rx16 (wave 2, slice s11): "the difference between its power and toughness" (render/qty.ts#differenceBetweenPhrase); "Each <spell> you cast with toughness
// greater than its power costs ..." (render/stat.ts#costMod)
Object.assign(EXAMPLES, {
  'difference-between': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: '7c', power: { q: 'math', op: '-', args: [{ q: 'math', op: 'max', args: [{ q: 'stat', stat: 'power', of: t('c') }, { q: 'stat', stat: 'toughness', of: t('c') }] }, { q: 'math', op: 'min', args: [{ q: 'stat', stat: 'power', of: t('c') }, { q: 'stat', stat: 'toughness', of: t('c') }] }] }, toughness: { q: 'math', op: '-', args: [{ q: 'math', op: 'max', args: [{ q: 'stat', stat: 'power', of: t('c') }, { q: 'stat', stat: 'toughness', of: t('c') }] }, { q: 'math', op: 'min', args: [{ q: 'stat', stat: 'power', of: t('c') }, { q: 'stat', stat: 'toughness', of: t('c') }] }] } }] }] } as unknown as EffectStep], [objTarget('c', { types: ['Creature'] })]),
    readings: [
      'Target creature gets +X/+X until end of turn, where X is the difference between its power and toughness.',
      'Target creature gets +X/+X until end of turn, where X is the difference between its power and its toughness.',
    ],
    near: [
      'Target creature gets +X/+X until end of turn, where X is the difference between its power and mana value.',
      'Target creature gets +X/+X until end of turn, where X is its power minus its toughness.',
      'Target creature gets +X/+X until end of turn, where X is the sum of its power and toughness.',
    ],
  },
  'each-spell-toughness-greater': {
    def: statics([{ s: 'costMod', applies: { spells: { types: ['Creature'], stackKind: 'spell', zone: 'stack', toughnessGreaterThanPower: true }, caster: 'you' }, change: { kind: 'reduce', mana: [{ kind: 'generic', amount: 1 }], floor: 'zero' } } as unknown as StaticEffect]),
    ctx: creature,
    readings: ['Each creature spell you cast with toughness greater than its power costs {1} less to cast.', 'Creature spells with toughness greater than their power you cast cost {1} less to cast.'],
    near: [
      'Each creature spell you cast with power greater than its toughness costs {1} less to cast.',
      'Each creature spell you cast with toughness greater than its power costs {2} less to cast.',
      'Each creature spell your opponents cast with toughness greater than its power costs {1} less to cast.',
    ],
  },
});

// std-rx5 (wave-2 slice s22): the X of a "Remove any number of <kind> counters from ~" cost (render/qty.ts)
Object.assign(EXAMPLES, {
  'any-number-that-many': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }], other: [{ kind: 'removeCounters', counter: '+1/+1', count: { q: 'X' }, self: true, anyNumber: true }] },
      effect: { targets: [], steps: [{ op: 'createToken', who: you, count: { q: 'X' }, token: { colors: ['G'], types: ['Creature'], subtypes: ['Insect'], power: 1, toughness: 1 } }] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['{1}, Remove any number of +1/+1 counters from Test Card: Create that many 1/1 green Insect creature tokens.', '{1}, Remove any number of +1/+1 counters from Test Card: Create that much 1/1 green Insect creature tokens.'],
    near: ['{1}, Remove any number of +1/+1 counters from Test Card: Create X 1/1 green Insect creature tokens.', '{1}, Remove X +1/+1 counters from Test Card: Create that many 1/1 green Insect creature tokens.', '{1}, Remove any number of -1/-1 counters from Test Card: Create that many 1/1 green Insect creature tokens.'],
  },
});
// std-rx9 (wave 2, slice s18): the choice and the payment of one entering replacement (render/stat.ts#enters)
Object.assign(EXAMPLES, {
  'chosen-basic-land-type-words': {
    def: statics([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, subtypes: { chosen: 'landType', chosenSets: true } }] } as unknown as StaticEffect]),
    readings: ['Test Card is the chosen type.', 'Test Card is the chosen basic land type.'],
    near: ['Test Card is the chosen type in addition to its other types.', 'Test Card is the chosen color.', 'Test Card is the chosen creature type.'],
  },
  'cast-spells-or-cards-using-their': {
    def: statics([{
      s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true } },
      mods: [{ layer: 6, add: [{ kind: 'static', text: 'You may cast this card from your graveyard using its sneak ability.', effects: [{ s: 'castWith', method: 'sneak', from: 'graveyard' }] }] }],
    } as unknown as StaticEffect]),
    readings: ['You may cast creature spells from your graveyard using their sneak abilities.', 'You may cast creature cards from your graveyard using their sneak abilities.'],
    near: ['You may cast creature spells from your hand using their sneak abilities.', 'You may cast artifact spells from your graveyard using their sneak abilities.', 'You may cast creature spells from your graveyard using their warp abilities.'],
  },
  'enters-choose-then-pay': {
    def: statics([{
      s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' },
      body: { b: 'enters', choose: [{ what: 'landType', link: 'landType', options: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] }], tappedUnlessPay: { other: [{ kind: 'payLife', amount: 2 }] } },
    } as unknown as StaticEffect]),
    readings: [
      "As Test Card enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters tapped.",
      "As Test Card enters, choose a basic land type. As Test Card enters, you may pay 2 life. If you don't, it enters tapped.",
    ],
    near: [
      "As Test Card enters, choose a basic land type. Then you may pay 3 life. If you don't, it enters tapped.",
      "As Test Card enters, choose a basic land type. Then you may pay 2 life. If you do, it enters tapped.",
      "As Test Card enters, choose a color. Then you may pay 2 life. If you don't, it enters tapped.",
    ],
  },
});
// std-rx15 (wave 2, slice s12): a lasting identity with base power and toughness and abilities in one "with" phrase (render/mods.ts); the possessive of the object's
// own keyword abilities in a cost change (render/stat.ts#costMod)
Object.assign(EXAMPLES, {
  'becomes-with-base-and': {
    def: spell([effectStep([{ s: 'continuous', affects: self, mods: [{ layer: 4, subtypes: { set: ['Kithkin', 'Avatar'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'trample', text: 'trample' }] }, { layer: '7b', power: 7, toughness: 8 }] } as unknown as StaticEffect], { d: 'permanent' })]),
    ctx: creature,
    readings: ['Test Card becomes a Kithkin Avatar with base power and toughness 7/8 and trample.', 'Test Card becomes a Kithkin Avatar with base power and toughness 7/8 and gains trample.'],
    near: ['Test Card becomes a Kithkin Avatar with base power and toughness 7/7 and trample.', 'Test Card becomes a Kithkin Avatar with base power and toughness 7/8 and flying.', 'Test Card becomes a Kithkin Avatar with base power and toughness 7/8 and trample until end of turn.'],
  },
  'self-keyword-abilities-possessive': {
    def: statics([{ s: 'costMod', applies: { abilities: { keyword: 'equip', kind: 'activated', source: { self: true } }, caster: 'any' }, change: { kind: 'reduce', mana: [{ kind: 'generic', amount: 2 }] } } as unknown as StaticEffect]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ["Test Card's equip abilities cost {2} less to activate.", 'Equip abilities of Test Card cost {2} less to activate.'],
    near: ["Test Card's equip abilities cost {3} less to activate.", "Test Card's equip abilities cost {2} more to activate.", "Test Card's crew abilities cost {2} less to activate."],
  },
});
// card wave 2, std-rw6: the choice first, then the instruction for each opponent who didn't (render/steps-flow.ts#eachUnlessThey); "target creature or spell"
// (render/refs.ts#specPhrase)
Object.assign(EXAMPLES, {
  'each-may-who-didnt': {
    def: spell([mkmPunisher('opponent', [{ kind: 'discard', count: 1 }, { kind: 'sacrifice', filter: {}, count: 1 }], { op: 'damage', source: self, to: MKM_EACH, amount: 3 } as unknown as EffectStep)]),
    ctx: creature,
    readings: [
      'Each opponent may discard a card or sacrifice a permanent of their choice. Test Card deals 3 damage to each opponent who didn\'t.',
      'Each opponent may discard a card or sacrifice a permanent. Test Card deals 3 damage to each opponent who doesn\'t.',
      'Test Card deals 3 damage to each opponent unless they discard a card or sacrifice a permanent.',
    ],
    near: [
      'Each opponent may discard a card or sacrifice a permanent. Test Card deals 3 damage to each opponent who did.',
      'Each opponent may discard a card or sacrifice a permanent. Test Card deals 2 damage to each opponent who didn\'t.',
      'Each opponent may sacrifice a permanent or discard a card. Test Card deals 3 damage to each opponent who didn\'t.',
      'Each player may discard a card or sacrifice a permanent. Test Card deals 3 damage to each player who didn\'t.',
    ],
  },
  'saddled-or-creature-by-type': {
    def: spell([
      { op: 'if', cond: { cond: 'matches', object: t('c'), filter: { subtypes: ['Mount'] } }, then: [{ op: 'designateObject', what: t('c'), designation: 'saddled' }] } as unknown as EffectStep,
      { op: 'if', cond: { cond: 'matches', object: t('c'), filter: { subtypes: ['Vehicle'] } }, then: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: t('c'), mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] } }] }] }] } as unknown as EffectStep,
    ], [objTarget('c', { subtypes: ['Mount', 'Vehicle'], controller: 'you' })]),
    readings: [
      "Until end of turn, target Mount or Vehicle you control becomes saddled if it's a Mount and becomes an artifact creature if it's a Vehicle.",
      "If target Mount or Vehicle you control is a Mount, it becomes saddled until end of turn. If it's a Vehicle, it becomes an artifact creature until end of turn.",
    ],
    near: [
      "Until end of turn, target Mount or Vehicle you control becomes saddled if it's a Vehicle and becomes an artifact creature if it's a Mount.",
      "Until end of turn, target Mount or Vehicle you control becomes saddled if it's a Mount and becomes an artifact land if it's a Vehicle.",
      "Target Mount or Vehicle you control becomes saddled if it's a Mount and becomes an artifact creature if it's a Vehicle.",
    ],
  },
  'spell-or-permanent-order': {
    def: spell([{ op: 'move', what: t('c'), to: { zone: 'exile' } } as EffectStep], [{ id: 'c', kind: 'object', min: 0, max: 1, filter: { zone: ['stack', 'battlefield'], anyOf: [{ stackKind: 'spell', zone: 'stack' }, { types: ['Creature'], zone: 'battlefield' }], other: true } } as unknown as TargetSpec]),
    ctx: creature,
    readings: ['Exile up to one other target creature or spell.', 'Exile up to one other target spell or creature.'],
    near: ['Exile up to one target creature or spell.', 'Exile up to one other target creature or ability.', 'Exile up to one other target artifact or spell.', 'Exile another target creature or spell.'],
  },
});
// round std-rk (slot K): render/evt.ts (each-of-your-steps)
Object.assign(EXAMPLES, {
  'each-of-your-steps': {
    def: trig([{ ev: 'step', step: 'main2', whose: 'you' }], [draw()]),
    readings: ['At the beginning of your postcombat main phase, draw a card.', 'At the beginning of each of your postcombat main phases, draw a card.'],
    near: ['At the beginning of each of your precombat main phases, draw a card.', 'At the beginning of each of your main phases, draw a card.', "At the beginning of each of your opponents' postcombat main phases, draw a card."],

  },
});
// std-rx6 (wave 2, slice s21): the chosen name of a linked "As ~ enters, choose a card name." (zz-cloud/std-rx6.json)
Object.assign(EXAMPLES, {
  'chosen-name-or-that-name': {
    def: { kind: 'static', text: '', effects: [{ s: 'restrict', subject: { ref: 'each', filter: { zone: 'any', chosen: { link: 'cardName', quality: 'cardName' } } }, mode: 'cant', action: 'activate', exceptMana: true }] } as unknown as AbilityDef,
    readings: ["Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.", "Activated abilities of sources with that name can't be activated unless they're mana abilities."],
    near: ["Activated abilities of sources with the chosen name can't be activated.", "Activated abilities of artifacts with the chosen name can't be activated unless they're mana abilities."],
  },
});
Object.assign(EXAMPLES, {
  'a-or-any-card-name': {
    def: { kind: 'static', text: '', zone: ['stack', 'battlefield'], effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', choose: [{ what: 'cardName', link: 'cardName' }] } }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['As Test Card enters, choose a card name.', 'As Test Card enters, choose any card name.'],
    near: ['As Test Card enters, choose a nonland card name.', 'As Test Card enters, choose a color.'],
  },
});

// std-rx4 (render/cond.ts): "they lost life this turn" of a player named before (parser/holes/cond.ts#anaphorLostLife)
Object.assign(EXAMPLES, {
  'player-lost-life-this-turn': {
    def: spell([
      { op: 'loseLife', who: t('p'), amount: 1 } as EffectStep,
      { op: 'if', cond: { cond: 'compare', left: { q: 'lifeLostThisTurn', of: t('p') }, op: '>=', right: 1 }, then: [draw()] } as EffectStep,
    ], [{ id: 'p', kind: 'player', min: 1, max: 1, text: '', players: { who: 'opponent' } }]),
    readings: ['Target opponent loses 1 life. If that player lost life this turn, draw a card.', 'Target opponent loses 1 life. If they lost life this turn, draw a card.'],
    near: ['Target opponent loses 1 life. If you lost life this turn, draw a card.', 'Target opponent loses 1 life. If that player gained life this turn, draw a card.', 'Target opponent loses 1 life. If that player lost 2 life this turn, draw a card.'],
  },
});

// std-rx19 (render/stat.ts): a permission of every player, "each player may" or "players may" (each-player-or-players)
Object.assign(EXAMPLES, {
  'each-player-or-players': {
    def: statics([{ s: 'permit', who: { ref: 'each', who: 'player' }, action: 'playLand' } as unknown as StaticEffect]),
    readings: ['Each player may play an additional land on each of their turns.', 'Players may play an additional land on each of their turns.'],
    near: ['Opponents may play an additional land on each of their turns.', 'Players may play two additional lands on each of their turns.', 'You may play an additional land on each of your turns.'],
  },
});

// std-rx1 (render/steps-life.ts#statedByIf): "that many" of the count an intervening "if" states
Object.assign(EXAMPLES, {
  'that-many-stated-count': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'step', step: 'end', whose: 'you' }] },
      interveningIf: { cond: 'prime', of: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } },
      effect: { targets: [], steps: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } } as EffectStep] } } as AbilityDef,
    ctx: creature,
    readings: ['At the beginning of your end step, if you control a prime number of lands, put that many +1/+1 counters on Test Card.', 'At the beginning of your end step, if you control a prime number of lands, put a number of +1/+1 counters on Test Card equal to the number of lands you control.'],
    near: ['At the beginning of your end step, if you control a prime number of lands, put that many -1/-1 counters on Test Card.', 'At the beginning of your end step, if you control a prime number of creatures, put that many +1/+1 counters on Test Card.', 'At the beginning of your end step, put that many +1/+1 counters on Test Card.'],
  },
});
// card wave 2 round std-rw8 (render/refs.ts, `costSacrificed`: "that creature" for what a payment sacrificed)
Object.assign(EXAMPLES, {
  'sacrificed-that-noun': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], steps: [
      { op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'sacrifice', filter: { anyOf: [{ types: ['Creature'] }], other: true }, count: 1 }] }, as: 'paid' },
      { op: 'reflexive', when: { did: 'paid' }, targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: '' }], do: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: { q: 'stat', stat: 'power', of: { ref: 'costSacrificed' } } }] },
    ] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ["When Test Card enters, you may sacrifice another creature. When you do, Test Card deals damage equal to that creature's power to target player.", "When Test Card enters, you may sacrifice another creature. When you do, Test Card deals damage equal to the sacrificed creature's power to target player."],
    near: ["When Test Card enters, you may sacrifice another creature. When you do, Test Card deals damage equal to that creature's toughness to target player.", "When Test Card enters, you may sacrifice another creature. When you do, Test Card deals damage equal to its power to target player."],
  },
});

// std-rx11 (card wave 2, slice s16): render/evt.ts (each-with-singular)
Object.assign(EXAMPLES, {
  'each-with-singular': {
    def: trig([{ ev: 'damage', source: { types: ['Creature'], controller: 'you', powerGreaterThanBase: true }, combat: true, recipient: { player: 'any' } }], [draw()], { batch: true }),
    ctx: creature,
    readings: [
      'Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.',
      'Whenever one or more creatures you control with power greater than their base power deal combat damage to a player, draw a card.',
    ],
    near: [
      'Whenever one or more creatures you control each with power greater than its base power deal combat damage to a player, draw a card.',
      'Whenever one or more creatures you control each with toughness greater than its base power deals combat damage to a player, draw a card.',
      'Whenever one or more creatures you control each with power greater than its base power deals combat damage to an opponent, draw a card.',
    ],
  },
});

// std-ry5 (render/cond.ts#turnHistory, render/stat.ts#restrictFor): your discards this turn in two tenses; a group that can't be targeted, the noun in the number of its subject
Object.assign(EXAMPLES, {
  'discarded-this-turn': {
    def: { kind: 'triggered', text: '', trigger: { on: [{ ev: 'step', step: 'end', whose: 'you' }] },
      interveningIf: { cond: 'happened', event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' },
      effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 } as EffectStep] } } as AbilityDef,
    readings: ['At the beginning of your end step, if you discarded a card this turn, draw a card.', "At the beginning of your end step, if you've discarded a card this turn, draw a card."],
    near: ['At the beginning of your end step, if you discarded two cards this turn, draw a card.', 'At the beginning of your end step, if an opponent discarded a card this turn, draw a card.'],
  },
  'targets-plural': {
    def: statics([{ s: 'restrict', subject: { ref: 'each', filter: { zone: 'graveyard', isCard: true } }, mode: 'cant', action: 'beTargeted' } as unknown as StaticEffect]),
    readings: ["Cards in graveyards can't be the targets of spells or abilities.", "All cards in graveyards can't be the target of spells or abilities."],
    near: ["Cards in graveyards can't be the targets of spells.", "Cards in your graveyard can't be the targets of spells or abilities.", "Cards in graveyards can't be the targets of abilities your opponents control."],
  },
});

// std-rx27 (wave 2, Standard lane rx27): cast and play permissions (zz-cloud/std-rx27.json)
const RX27_LINKED = { ref: 'linked', link: 'exiled' };
Object.assign(EXAMPLES, {
  'cards-exiled-with-it': {
    def: spell([
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Instant'] }], notTypes: ['Land'], is: RX27_LINKED, zone: 'any' } }, min: 0, max: 1, as: 'cast' },
      { op: 'cast', who: you, what: { ref: 'bound', name: 'cast' }, graveyardInstead: { to: { zone: 'library', position: 'bottom' } } },
    ] as unknown as EffectStep[]),
    ctx: creature,
    readings: ["You may cast an instant spell from among cards exiled with Test Card. If that spell would be put into a graveyard, put it on the bottom of its owner's library instead.",
      "You may cast an instant spell from among cards exiled with it. If that spell would be put into a graveyard, put it on the bottom of its owner's library instead."],
    near: ["You may cast an instant spell from among cards in exile. If that spell would be put into a graveyard, put it on the bottom of its owner's library instead.",
      "You may cast an instant spell from among cards exiled with them. If that spell would be put into a graveyard, put it on the bottom of its owner's library instead."],
  },
  'additional-counter-rider': {
    def: statics([
      { s: 'permit', who: you, action: 'play', of: { types: ['Land'] }, fromTop: true },
      { s: 'permit', who: you, action: 'cast', of: { subtypes: ['Elf'], stackKind: 'spell', zone: 'stack' }, fromTop: true, entersWith: [{ kind: '+1/+1', count: 1 }], entersWithIf: { types: ['Creature'] } },
    ] as unknown as StaticEffect[]),
    ctx: creature,
    readings: ['You may play lands and cast Elf spells from the top of your library. If you cast a creature spell this way, that creature enters with an additional +1/+1 counter on it.',
      'You may play lands and cast Elf spells from the top of your library. If you cast a creature spell this way, that creature enters with a +1/+1 counter on it.'],
    near: ['You may play lands and cast Elf spells from the top of your library. If you cast a creature spell this way, that creature enters with two +1/+1 counters on it.',
      'You may play lands and cast Elf spells from the top of your library. If you cast a spell this way, that creature enters with a +1/+1 counter on it.'],
  },
  'pay-zero-nothing': {
    def: statics([{ s: 'costMod', applies: { abilities: { kind: 'activated', keyword: 'equip' }, caster: 'you', firstEachTurn: true }, change: { kind: 'set', mana: [] } }] as unknown as StaticEffect[]),
    ctx: creature,
    readings: ['You may pay {0} rather than pay the equip cost of the first equip ability you activate each turn.', 'You may pay nothing rather than pay the equip cost of the first equip ability you activate each turn.'],
    near: ['You may pay {1} rather than pay the equip cost of the first equip ability you activate each turn.', 'You may pay {0} rather than pay the equip cost of each equip ability you activate.'],
  },
  'linked-rider-that-or-it': {
    def: statics([{ s: 'permit', who: you, action: 'cast', of: { anyOf: [{ types: ['Creature'], subtypes: ['Elf'], stackKind: 'spell', zone: 'stack' }], owner: 'you', is: RX27_LINKED }, entersWith: [{ kind: 'finality', count: 1 }] }] as unknown as StaticEffect[]),
    ctx: creature,
    readings: ['You may cast Elf creature spells from among cards you own exiled with Test Card. If you cast a spell this way, that creature enters with a finality counter on it.',
      'You may cast Elf creature spells from among cards you own exiled with Test Card. If you cast a spell this way, it enters with a finality counter on it.'],
    near: ['You may cast Elf creature spells from among cards you own exiled with Test Card. If you cast a spell this way, that artifact enters with a finality counter on it.',
      'You may cast Elf creature spells from among cards you own exiled with Test Card. If you cast a spell this way, that creature enters with two finality counters on it.'],
  },
  // std-mana-2 (family mill-pick-up-to-one-milled): "Mill five cards. Put up to one enchantment card milled this way into your hand." (Terra, Magical Adept)
  'mill-pick-up-to-one-milled': {
    def: spell([
      STD_TLA_MILL,
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: bound('m'), zone: 'any' } }, min: 0, max: 1, as: 'c' } as EffectStep,
      { op: 'move', what: bound('c'), to: { zone: 'hand' } } as EffectStep,
    ]),
    readings: ['Mill three cards. Put up to one creature card milled this way into your hand.', 'Mill three cards. You may put a creature card milled this way into your hand.'],
    near: ['Mill three cards. Put up to two creature cards milled this way into your hand.', 'Mill three cards. Put up to one land card milled this way into your hand.', 'Mill three cards. Put up to one creature card milled this way onto the battlefield.'],
  },
  // std-mana-2 (family mana-and-list): "Add {W}{W}, {U}{U}, {B}{B}, {R}{R}, and {G}{G}." (Esper Terra)
  'mana-and-list': {
    def: spell([{ op: 'addMana', who: you, units: [['W'], ['W'], ['U'], ['U'], ['R'], ['R']] } as EffectStep]),
    readings: ['Add {W}{W}{U}{U}{R}{R}.', 'Add {W}{W}, {U}{U}, and {R}{R}.'],
    near: ['Add {W}{W}, {U}{U}, or {R}{R}.', 'Add {W}{W}, {U}{U}, and {R}.', 'Add {W}{W} and {U}{U}.'],
  },
});

// std-rx31 (wave 2, Standard lane rx31): the round's readings and folds, on the abilities of its golden cards (test/m5/golden/cards/cloud-std-rx31-review.json)
const rx31 = (name: string, i: number, face = 0): AbilityDef => (rx31Golden as { card: string; faces: { abilities: AbilityDef[] }[] }[]).find((g) => g.card === name)!.faces[face]!.abilities[i]!;
const rx31Mode = (name: string, i: number, mode: number): AbilityDef => {
  const a = rx31(name, i) as AbilityDef & { effect: { modes: { options: { program: { targets: TargetSpec[]; steps: EffectStep[] } }[] } } };
  const p = a.effect.modes.options[mode]!.program;
  return spell(p.steps, p.targets);
};
const legend = (types: string) => ({ selfNames: ['Test Card'], selfTypes: types.split(' ') });
const BRE_LEAD = 'At the beginning of your end step, if you gained life this turn, exile cards from the top of your library until you exile a nonland card.';
const BESEECH = 'Search your library for a card, exile it face down, then shuffle. If this spell was bargained, you may cast';
const BREAK = 'Look at the top six cards of your library. You may reveal a creature card from among them. If that card has mana value 2 or less, you may put it onto the battlefield and it gains haste until end of turn.';
const NICK_LEAD = 'Look at the top seven cards of your library.';
const nickDig = (): AbilityDef => { const a = rx31('Nick Fury, Agent of S.H.I.E.L.D.', 0) as AbilityDef & { effect: { steps: EffectStep[] } }; return spell(a.effect.steps.slice(1)); };
const lumarets = (): AbilityDef => { const a = rx31('Follow the Lumarets', 0) as AbilityDef & { effect: { steps: EffectStep[] } }; return spell(a.effect.steps); };
Object.assign(EXAMPLES, {
  'cast-max-mana-value-qty': {
    def: rx31('Bre of Clan Stoutarm', 1), ctx: legend('Legendary Creature'),
    readings: [
      `${BRE_LEAD} You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn. Otherwise, put it into your hand.`,
      `${BRE_LEAD} You may cast that card without paying its mana cost if that spell's mana value is less than or equal to the amount of life you gained this turn. Otherwise, put it into your hand.`,
    ],
    near: [
      `${BRE_LEAD} You may cast that card without paying its mana cost if the spell's mana value is less than the amount of life you gained this turn. Otherwise, put it into your hand.`,
      `${BRE_LEAD} You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you lost this turn. Otherwise, put it into your hand.`,
    ],
  },
  'otherwise-after-cast': {
    def: rx31('Bre of Clan Stoutarm', 1), ctx: legend('Legendary Creature'),
    readings: [
      `${BRE_LEAD} You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn. Otherwise, put it into your hand.`,
      `${BRE_LEAD} You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn. If you don't, put it into your hand.`,
    ],
    near: [
      `${BRE_LEAD} You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn. Otherwise, put it into your graveyard.`,
      `${BRE_LEAD} You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn. If you do, put it into your hand.`,
    ],
  },
  'not-cast-this-way': {
    def: rx31('Beseech the Mirror', 1),
    readings: [
      `${BESEECH} the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way.`,
      `${BESEECH} the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it was not cast this way.`,
    ],
    near: [
      `${BESEECH} the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it was cast this way.`,
      `${BESEECH} the exiled card without paying its mana cost if that spell's mana value is 4 or less. Otherwise, put the exiled card into your hand.`,
    ],
  },
  'exiled-card-participle': {
    def: rx31('Beseech the Mirror', 1),
    readings: [
      `${BESEECH} the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way.`,
      `${BESEECH} that card without paying its mana cost if that spell's mana value is 4 or less. Put that card into your hand if it wasn't cast this way.`,
    ],
    near: [
      `${BESEECH} the revealed card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way.`,
      `${BESEECH} the exiled cards without paying their mana costs if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way.`,
    ],
  },
  'return-under-your-control': {
    def: rx31('Meathook Massacre II', 1), ctx: legend('Legendary Enchantment'),
    readings: [
      'Whenever a creature you control dies, you may pay 3 life. If you do, return that card under your control with a finality counter on it.',
      'Whenever a creature you control dies, you may pay 3 life. If you do, return it to the battlefield under your control with a finality counter on it.',
    ],
    near: [
      "Whenever a creature you control dies, you may pay 3 life. If you do, return that card under its owner's control with a finality counter on it.",
      'Whenever a creature you control dies, you may pay 3 life. If you do, return that card under your control with a stun counter on it.',
    ],
  },
  'they-opponent-of-the-event': {
    def: rx31('Meathook Massacre II', 2), ctx: legend('Legendary Enchantment'),
    readings: [
      "Whenever a creature an opponent controls dies, they may pay 3 life. If they don't, return that card under your control with a finality counter on it.",
    ],
    near: [
      "Whenever a creature an opponent controls dies, you may pay 3 life. If you don't, return that card under your control with a finality counter on it.",
      'Whenever a creature an opponent controls dies, they may pay 3 life. If they do, return that card under your control with a finality counter on it.',
    ],
  },
  'not-put-the-revealed-card': {
    def: rx31('Break Out', 0),
    readings: [
      `${BREAK} If you didn't put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order.`,
      `${BREAK} If you did not put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order.`,
    ],
    near: [
      `${BREAK} If you put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order.`,
      `${BREAK} If you didn't put the revealed card into your hand this way, put it into your hand. Put the rest on the bottom of your library in a random order.`,
    ],
  },
  'reveal-one-from-group': {
    def: rx31('Break Out', 0),
    readings: [`${BREAK} If you didn't put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order.`],
    near: [
      `Look at the top six cards of your library. You may reveal two creature cards from among them. If that card has mana value 2 or less, you may put it onto the battlefield and it gains haste until end of turn. If you didn't put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order.`,
      `Look at the top six cards of your library. You may reveal a land card from among them. If that card has mana value 2 or less, you may put it onto the battlefield and it gains haste until end of turn. If you didn't put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order.`,
    ],
  },
  'self-as-it-left': {
    def: trig([{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }], [draw()], { interveningIf: { cond: 'matches', object: { ref: 'event', role: 'subject' }, filter: { types: ['Creature'] } } }),
    ctx: legend('Legendary Creature'),
    readings: ['When Test Card dies, if Test Card was a creature, draw a card.', 'When Test Card dies, if it was a creature, draw a card.', 'When Test Card dies, if Test Card were a creature, draw a card.'],
    near: ['When Test Card dies, if Test Card was an artifact, draw a card.', 'When Test Card dies, if Test Card wasn\'t a creature, draw a card.'],
  },
  'plural-name-dies': {
    def: trig([{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }], [draw()]),
    ctx: legend('Legendary Creature'),
    readings: ['When Test Card dies, draw a card.', 'When Test Card die, draw a card.'],
    near: ['When Test Card died, draw a card.', 'When Test Card enters, draw a card.'],
  },
  'its-an-artifact': {
    def: trig([{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }], [
      { op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'battlefield', controller: you } } as EffectStep,
      effectStep([{ s: 'continuous', affects: { ref: 'event', role: 'subject' }, mods: [{ layer: 4, types: { set: ['Artifact'] } }] } as StaticEffect], { d: 'permanent' }),
    ]),
    ctx: legend('Legendary Creature'),
    readings: ['When Test Card dies, return it to the battlefield. It\'s an artifact.', 'When Test Card dies, return Test Card to the battlefield. Test Card is an artifact.', 'When Test Card dies, return it to the battlefield. It becomes an artifact.'],
    near: ['When Test Card dies, return it to the battlefield. It\'s an enchantment.', 'When Test Card dies, return it to the battlefield. It\'s an artifact until end of turn.'],
  },
  'return-as-artifact-creature': {
    def: rx31Mode('Brilliance Unleashed', 0, 1),
    readings: [
      "Choose target artifact card in your graveyard. Return it to the battlefield if it's an artifact creature card. Otherwise, return it to the battlefield and it's a 3/3 Robot artifact creature with flying.",
      "Choose target artifact card in your graveyard. Return it to the battlefield if it's an artifact creature card. Otherwise, return it to the battlefield and it is a 3/3 Robot artifact creature with flying.",
    ],
    near: [
      "Choose target artifact card in your graveyard. Return it to the battlefield if it's an artifact creature card. Otherwise, return it to the battlefield and it's a 3/3 Robot artifact creature with vigilance.",
      "Choose target artifact card in your graveyard. Return it to the battlefield if it's an artifact creature card. Otherwise, return it to the battlefield and it's a 2/2 Robot artifact creature with flying.",
    ],
  },
  'a-player-controls-no': {
    def: trig([{ ev: 'step', step: 'end', whose: 'you' } as EventPattern], [draw()], { interveningIf: { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'player' }, controlsIs: { filter: { types: ['Creature'] }, op: '==', n: 0 } }, op: '>=', right: 1 } }),
    readings: ['At the beginning of your end step, if a player controls no creatures, draw a card.'],
    near: ['At the beginning of your end step, if each player controls no creatures, draw a card.', 'At the beginning of your end step, if a player controls no artifacts, draw a card.'],
  },
  'double-faced-card': {
    def: nickDig(),
    readings: [`${NICK_LEAD} You may put a Hero, Equipment, or Vehicle card from among them onto the battlefield. If it's a double-faced card, you may transform it. Put the rest on the bottom of your library in a random order.`],
    near: [
      `${NICK_LEAD} You may put a Hero, Equipment, or Vehicle card from among them onto the battlefield. If it's a transformed card, you may transform it. Put the rest on the bottom of your library in a random order.`,
      `${NICK_LEAD} You may put a Hero, Equipment, or Vehicle card from among them onto the battlefield. If it's a double-faced permanent, you may transform it. Put the rest on the bottom of your library in a random order.`,
    ],
  },
  'put-one-named-later': {
    def: nickDig(),
    readings: [`${NICK_LEAD} You may put a Hero, Equipment, or Vehicle card from among them onto the battlefield. If it's a double-faced card, you may transform it. Put the rest on the bottom of your library in a random order.`],
    near: [
      `${NICK_LEAD} You may put a Hero, Equipment, or Vehicle card from among them into your hand. If it's a double-faced card, you may transform it. Put the rest on the bottom of your library in a random order.`,
      `${NICK_LEAD} You may put a Hero or Vehicle card from among them onto the battlefield. If it's a double-faced card, you may transform it. Put the rest on the bottom of your library in a random order.`,
    ],
  },
  'put-one-instead-of-hand': {
    def: rx31('Back for Seconds', 1),
    readings: ['Return up to two target creature cards from your graveyard to your hand. If this spell was bargained, you may put one of those cards with mana value 4 or less onto the battlefield instead of putting it into your hand.'],
    near: [
      'Return up to two target creature cards from your graveyard to your hand. If this spell was bargained, you may put one of those cards with mana value 3 or less onto the battlefield instead of putting it into your hand.',
      'Return up to two target creature cards from your graveyard to your hand. If this spell was bargained, you may put two of those cards with mana value 4 or less onto the battlefield instead of putting them into your hand.',
    ],
  },
  'instead-reveal-more': {
    def: lumarets(),
    readings: ['Look at the top four cards of your library. You may reveal a creature or land card from among them and put it into your hand. If you gained life this turn, you may instead reveal two creature and/or land cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.'],
    near: [
      'Look at the top four cards of your library. You may reveal a creature or land card from among them and put it into your hand. If you gained life this turn, you may instead reveal three creature and/or land cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.',
      'Look at the top four cards of your library. You may reveal a creature or land card from among them and put it into your hand. If you gained life this turn, you may instead reveal two creature and/or land cards from among them and put them into your graveyard. Put the rest on the bottom of your library in a random order.',
    ],
  },
});

// card wave 2, std-rx20 (Commander lane rx20): two new alt sites (stat.ts, qty.ts)
Object.assign(EXAMPLES, {
  'if-cond-enters-tapped': {
    def: statics([{
      s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' },
      body: { b: 'enters', tapped: true, tappedUnless: { cond: 'not', of: { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Land'], controller: 'you', other: true } } }, op: '>=', right: 2 } } },
    } as unknown as StaticEffect]),
    readings: ['If you control two or more other lands, Test Card enters tapped.'],
    near: ['If you control two or more other lands, Test Card enters untapped.', 'If you control three or more other lands, Test Card enters tapped.'],
  },
  'opponent-you-have': {
    def: spell([{ op: 'createToken', who: you, count: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' } }, token: { predefined: 'Food' } } as EffectStep]),
    readings: ['Create a Food token for each opponent you have.', 'Create a Food token for each opponent.'],
    near: ['Create a Food token for each player you have.', 'Create a Food token for each opponent target player has.'],
  },
});
// std-rx23 (card wave 2, EDHREC lane rx23): a guarded instruction on the attached object after a trigger; "up to" in an additional-land permission (render/steps.ts, stat.ts)
Object.assign(EXAMPLES, {
  'guarded-attached-after-trigger': {
    def: {"kind":"triggered","text":"","trigger":{"on":[{"ev":"step","step":"upkeep","whose":"you"}]},"effect":{"targets":[],"steps":[{"op":"putCounters","on":{"ref":"attachedTo"},"kind":"+1/+1","count":1,"guard":{"cond":"matches","object":{"ref":"attachedTo"},"filter":{"colors":["B"]}}}]}} as unknown as AbilityDef,
    readings: ["At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's black.", 'At the beginning of your upkeep, put a +1/+1 counter on it if equipped creature is black.'],
    near: ["At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's white.", "At the beginning of your upkeep, put two +1/+1 counters on equipped creature if it's black."],
  },
  'up-to-additional-lands': {
    def: {"kind":"spell","text":"","effect":{"targets":[],"steps":[{"op":"effect","duration":{"d":"endOfTurn"},"effects":[{"s":"permit","who":{"ref":"you"},"action":"playLand","count":3}]}]}} as unknown as AbilityDef,
    readings: ['You may play up to three additional lands this turn.', 'You may play three additional lands this turn.'],
    near: ['You may play up to two additional lands this turn.', 'You may play up to three additional lands on each of your turns.'],
  },
} satisfies Record<string, Example>);

// std-rx30 (zz-cloud/std-rx30.json): the readings of its families (synthetic lines, design 6.10); each def is the parse of its first reading, written with the name
const RX30_OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const rx30Def = (type: string, text: string): AbilityDef =>
  parseCard({ name: 'Test Card', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard, RX30_OPTS).faces[0]!.abilities.at(-1)!;
const RX30_CLOAK = 'When Test Card enters, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a creature card from their hand or the chosen creature until Test Card leaves the battlefield.';
Object.assign(EXAMPLES, {
  'plural-name-leaves': {
    def: rx30Def('Creature — Human', 'When Test Card enters, exile target creature an opponent controls until Test Card leaves the battlefield.'), ctx: creature,
    readings: ['When ~ enters, exile target creature an opponent controls until ~ leaves the battlefield.', 'When ~ enters, exile target creature an opponent controls until ~ leave the battlefield.'],
    near: ['When ~ enters, exile target creature an opponent controls until ~ left the battlefield.', 'When ~ enters, exile target creature an opponent controls until ~ dies.'],
  },
  'chooses-one-of-those-nouns': {
    def: rx30Def('Sorcery', "Choose two target artifact creatures controlled by the same opponent. That player chooses one of those creatures. Test Card deals 2 damage to that creature, and the other can't block this turn."),
    readings: ["Choose two target artifact creatures controlled by the same opponent. That player chooses one of those creatures. ~ deals 2 damage to that creature, and the other can't block this turn.",
      "Choose two target artifact creatures controlled by the same opponent. That player chooses one of those artifacts. ~ deals 2 damage to that creature, and the other can't block this turn."],
    near: ["Choose two target artifact creatures controlled by the same opponent. That player chooses one of those lands. ~ deals 2 damage to that creature, and the other can't block this turn.",
      "Choose two target artifact creatures controlled by the same opponent. You choose one of those creatures. ~ deals 2 damage to that creature, and the other can't block this turn."],
  },
  'their-hand-of-chosen-opponent': {
    def: rx30Def('Creature — Human', RX30_CLOAK), ctx: creature,
    readings: ['When ~ enters, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a creature card from their hand or the chosen creature until ~ leaves the battlefield.',
      "When ~ enters, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a creature card from that player's hand or the chosen creature until ~ leaves the battlefield."],
    near: ['When ~ enters, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a creature card from your hand or the chosen creature until ~ leaves the battlefield.',
      'When ~ enters, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a creature card from their graveyard or the chosen creature until ~ leaves the battlefield.'],
  },
  'target-they-control': {
    def: rx30Def('Creature — Human', RX30_CLOAK), ctx: creature,
    readings: ['When ~ enters, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a creature card from their hand or the chosen creature until ~ leaves the battlefield.',
      'When ~ enters, choose target opponent and up to one target creature that player controls. They reveal their hand. You may exile a creature card from their hand or the chosen creature until ~ leaves the battlefield.'],
    near: ['When ~ enters, choose target opponent and up to one target creature you control. They reveal their hand. You may exile a creature card from their hand or the chosen creature until ~ leaves the battlefield.',
      'When ~ enters, choose target opponent and up to two target creatures they control. They reveal their hand. You may exile a creature card from their hand or the chosen creature until ~ leaves the battlefield.'],
  },
  'become-subtype-artifacts-lose-other': {
    def: rx30Def('Creature — Human', 'When Test Card enters, for each player, choose up to one target creature that player controls. For as long as Test Card remains on the battlefield, the chosen permanents become Treasure artifacts with "{T}, Sacrifice this artifact: Add one mana of any color" and lose all other abilities.'), ctx: creature,
    readings: ['When ~ enters, for each player, choose up to one target creature that player controls. For as long as ~ remains on the battlefield, the chosen permanents become Treasure artifacts with "{T}, Sacrifice this artifact: Add one mana of any color" and lose all other abilities.'],
    near: ['When ~ enters, for each player, choose up to one target creature that player controls. For as long as ~ remains on the battlefield, the chosen permanents become Clue artifacts with "{T}, Sacrifice this artifact: Add one mana of any color" and lose all other abilities.',
      'When ~ enters, for each player, choose up to one target creature that player controls. For as long as ~ remains on the battlefield, the chosen permanents become Treasure artifacts with "{T}, Sacrifice this artifact: Add one mana of any color" in addition to their other abilities.'],
  },
  'exiled-card-you-own': {
    def: rx30Def('Sorcery', 'Return target creature card from your graveyard or exiled card with flashback you own to your hand.'),
    readings: ['Return target creature card from your graveyard or exiled card with flashback you own to your hand.'],
    near: ['Return target creature card from your graveyard or exiled card with flashback an opponent owns to your hand.', 'Return target creature card from your graveyard or exiled card with flashback you own to the battlefield.'],
  },
  'owner-puts-on-their-library': {
    def: rx30Def('Sorcery', "Choose target creature. Its owner may put it on top of their library. If they do, Test Card deals 3 damage to them. If they didn't put the card on top of their library, they put it on the bottom."),
    readings: ["Choose target creature. Its owner may put it on top of their library. If they do, ~ deals 3 damage to them. If they didn't put the card on top of their library, they put it on the bottom."],
    near: ["Choose target creature. Its owner may put it on the bottom of their library. If they do, ~ deals 3 damage to them. If they didn't put the card on top of their library, they put it on the bottom.",
      "Choose target creature. Its owner may put it on top of their library. If they do, ~ deals 3 damage to you. If they didn't put the card on top of their library, they put it on the bottom."],
  },
});

const RY8_SURGE = { kind: 'triggered', text: '', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, interveningIf: { cond: 'wasCast', via: 'surge' }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } } as unknown as AbilityDef;
const RY8_ZENDIKON = { kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, types: { add: ['Creature'] }, subtypes: { add: ['Wall'] } }, { layer: 5, colors: { set: ['W'] } }, { layer: 6, add: [{ kind: 'keyword', keyword: 'defender' }] }, { layer: '7b', power: 2, toughness: 6 }] }] } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  // std-ry8 (CR 702.117b): "its surge cost was paid" is the object's own surge cast
  'surge-cost-paid-its': {
    def: RY8_SURGE,
    ctx: creature,
    readings: ['When Test Card enters, if its surge cost was paid, draw a card.', "When Test Card enters, if Test Card's surge cost was paid, draw a card."],
    near: ["When Test Card enters, if its dash cost was paid, draw a card.", "When Test Card enters, if its surge cost wasn't paid, draw a card."],
  },
  // std-ry8 (CR 205.1b, 613.1d-f): the Zendikons' sized identity with "with" abilities and the rider
  'aura-land-creature-with': {
    def: RY8_ZENDIKON,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ["Enchanted land is a 2/6 white Wall creature with defender. It's still a land."],
    near: ["Enchanted land is a 2/6 white Wall creature with flying. It's still a land.", "Enchanted land is a 6/2 white Wall creature with defender. It's still a land."],
  },
});

// std-cardcopy-1 (CR 205.3j; 205.2a, 105.2, 608.2c): a planeswalker type with or without its type word, and the tense of "two cards that share ... milled this way"
Object.assign(EXAMPLES, {
  'planeswalker-type-card': {
    def: rx30Def('Sorcery', 'Exile any number of target instant, sorcery, and/or Gideon planeswalker cards from your graveyard.'),
    readings: ['Exile any number of target instant, sorcery, and/or Gideon planeswalker cards from your graveyard.', 'Exile any number of target instant, sorcery, and/or Gideon cards from your graveyard.'],
    near: ['Exile any number of target instant, sorcery, and/or Jace planeswalker cards from your graveyard.', 'Exile any number of target instant and/or Gideon planeswalker cards from your graveyard.'],
  },
  'share-milled-tense': {
    def: rx30Def('Sorcery', 'Mill two cards. If two cards that share a color were milled this way, draw a card.'),
    readings: ['Mill two cards. If two cards that share a color were milled this way, draw a card.', 'Mill two cards. If two cards that share a color are milled this way, draw a card.'],
    near: ['Mill two cards. If two cards that share a card type were milled this way, draw a card.', 'Mill two cards. If two cards that share a color were exiled this way, draw a card.'],
  },
});

// std-freecast-1 (CR 118.9, 601.2b): "may be cast" and "can be cast" without paying its mana cost (render/stat.ts#alternativePermit)
const FREECAST1_FIRST = { kind: 'static', text: '', effects: [{ s: 'permit', who: { ref: 'active' }, action: 'cast', costChange: { kind: 'set', cost: {} }, firstSpellThisTurn: true }] } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'may-can-be-cast-free': {
    def: FREECAST1_FIRST,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['The first spell each player casts during each of their turns may be cast without paying its mana cost.', 'The first spell each player casts during each of their turns can be cast without paying its mana cost.'],
    near: ['The first spell each player casts during each of their turns must be cast without paying its mana cost.', 'The first spell each player casts during each of your turns may be cast without paying its mana cost.'],
  },
});

// std-cardcopy-3 (CR 614.12a, 201.5): the permanent that enters, "it" or "~", after the exile of the same entering replacement
Object.assign(EXAMPLES, {
  'enters-exile-then-it': {
    def: rx30Def('Creature — Ooze', 'As Test Card enters, exile up to two creature cards from your graveyard. It enters with two +1/+1 counters on it for each creature card exiled this way.'), ctx: creature,
    readings: ['As ~ enters, exile up to two creature cards from your graveyard. It enters with two +1/+1 counters on it for each creature card exiled this way.', 'As ~ enters, exile up to two creature cards from your graveyard. ~ enters with two +1/+1 counters on it for each creature card exiled this way.'],
    near: ['As ~ enters, exile up to three creature cards from your graveyard. It enters with two +1/+1 counters on it for each creature card exiled this way.', 'As ~ enters, exile up to two creature cards from your graveyard. It enters with two +1/+1 counters on it for each creature card destroyed this way.'],
  },
});

// std-combat-1 (CR 603.12, 608.2c): a reflexive trigger on what a move put onto the battlefield, "one or more" and the plural description
const COMBAT1_DIG = 'When Test Card enters, look at the top four cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order.';
Object.assign(EXAMPLES, {
  'put-one-or-more-this-way': {
    def: rx30Def('Creature — Human Samurai', `${COMBAT1_DIG} When you put one or more Equipment onto the battlefield this way, you may attach one of them to a Samurai you control.`), ctx: creature,
    readings: [
      'When ~ enters, look at the top four cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order. When you put one or more Equipment onto the battlefield this way, you may attach one of them to a Samurai you control.',
      'When ~ enters, look at the top four cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order. When you put an Equipment onto the battlefield this way, you may attach one of them to a Samurai you control.',
    ],
    near: [
      'When ~ enters, look at the top four cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order. When you put one or more Auras onto the battlefield this way, you may attach one of them to a Samurai you control.',
      'When ~ enters, look at the top four cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest on the bottom of your library in a random order. When you put one or more Equipment onto the battlefield this way, you may attach one of them to a Knight you control.',
    ],
  },
});

// std-combat-1 (CR 508.1a, 603.2c, 603.4, 508.5): "an opponent attacks with creatures", and "that opponent" for the attacking player
Object.assign(EXAMPLES, {
  'attacks-with-creatures': {
    def: rx30Def('Creature — Human Advisor', 'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, you gain 2 life.'), ctx: creature,
    readings: [
      'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, you gain 2 life.',
      'Whenever one or more creatures your opponents control attack, if two or more of them are attacking you and/or planeswalkers you control, you gain 2 life.',
    ],
    near: [
      'Whenever an opponent attacks with creatures, if three or more of those creatures are attacking you and/or planeswalkers you control, you gain 2 life.',
      'Whenever a player attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, you gain 2 life.',
    ],
  },
  'event-opponent-that-opponent': {
    def: rx30Def('Creature — Human Advisor', 'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, that opponent loses 2 life.'), ctx: creature,
    readings: [
      'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, that opponent loses 2 life.',
      'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, that player loses 2 life.',
    ],
    near: [
      'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, each opponent loses 2 life.',
      'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, that opponent loses 3 life.',
    ],
  },
});

// std-combat-1 (CR 508.1b-c, 611.2a): the creatures a player controls can't attack you or planeswalkers you control, said with the player as the subject
Object.assign(EXAMPLES, {
  'player-cant-attack-you': {
    def: rx30Def('Artifact Creature — Golem', 'Whenever an opponent draws a card during their turn, they can\'t attack you or planeswalkers you control this turn.'), ctx: creature,
    readings: [
      "Whenever an opponent draws a card during their turn, they can't attack you or planeswalkers you control this turn.",
      "Whenever an opponent draws a card during their turn, that player can't attack you or planeswalkers you control this turn.",
    ],
    near: [
      "Whenever an opponent draws a card during their turn, they can't attack you or planeswalkers you control.",
      "Whenever an opponent draws a card during their turn, they can't block you or planeswalkers you control this turn.",
    ],
  },
});

// std-craft-1 (lane std-craft): one of the cards the craft cost exiled, named after the object that has the link or by "it"
Object.assign(EXAMPLES, {
  'used-to-craft-self-or-it': {
    def: trig([{ ev: 'attacks', attacker: { self: true } }], [
      { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: { ref: 'linked', link: 'craft' }, zone: 'exile' } }, min: 0, max: 1, as: 'b0' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'b0' }, to: { zone: 'battlefield', controller: you, tapped: true, attacking: true } } as EffectStep,
    ]),
    ctx: creature,
    readings: [
      'Whenever Test Card attacks, you may put an exiled creature card used to craft Test Card onto the battlefield under your control tapped and attacking.',
      'Whenever Test Card attacks, you may put an exiled creature card used to craft it onto the battlefield under your control tapped and attacking.',
    ],
    near: [
      'Whenever Test Card attacks, you may put an exiled artifact card used to craft it onto the battlefield under your control tapped and attacking.',
      'Whenever Test Card attacks, you may put an exiled creature card onto the battlefield under your control tapped and attacking.',
    ],
  },
});

// std-costs-1 (render/fold-r4refs.ts#searchPlayersZonesForChosenName): the name of the one card exiled before is "that name"
const COSTS1_COVER = [
  { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { zone: 'graveyard', owner: 'opponent', isCard: true } }, min: 1, max: 1, as: 'exiled' },
  { op: 'move', what: bound('exiled'), to: { zone: 'exile' } },
  { op: 'search', who: you, owner: { ref: 'ownerOf', object: bound('exiled') }, zone: 'graveyard', alsoZones: ['hand', 'library'], allZones: true, filter: { sharesWith: { with: bound('exiled'), quality: 'name' } }, min: 0, max: 'any', as: 'search' },
  { op: 'move', what: bound('search'), to: { zone: 'exile' } },
];
Object.assign(EXAMPLES, {
  'search-same-name-that-name': {
    def: r4Spell(COSTS1_COVER),
    readings: [
      "Exile a card from an opponent's graveyard. Then search its owner's graveyard, hand, and library for any number of cards with that name and exile them.",
      "Exile a card from an opponent's graveyard. Search its owner's graveyard, hand and library for any number of cards with the same name as that card and exile them.",
    ],
    near: [
      "Exile a card from an opponent's graveyard. Then search its owner's graveyard, hand, and library for any number of cards with that power and exile them.",
      "Exile a card from an opponent's graveyard. Then search its owner's graveyard and library for any number of cards with that name and exile them.",
    ],
  },
});

// std-exile-play-1-1 (lane std-exile-play-1): the readings of its families (invented wordings, design 6.10)
const XP1_OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const xp1Def = (type: string, text: string): AbilityDef =>
  parseCard({ name: 'Test Card', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard, XP1_OPTS).faces[0]!.abilities.at(-1)!;
const XP1_TOP = 'Until end of turn, you may look at the top card of your library any time and you may play cards from the top of your library.';
const XP1_LOOKER = "Whenever a creature deals combat damage to one of your opponents, its controller looks at the top card of that opponent's library and exiles it face down.";
const XP1_UNTIL = 'Whenever Test Card deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card.';
const XP1_DIG = "When Test Card enters, look at the top four cards of target opponent's library, exile two of them face down, then put the rest on the bottom of their library in a random order.";
Object.assign(EXAMPLES, {
  'top-play-life-cost': {
    def: xp1Def('Sorcery', `${XP1_TOP} If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.`),
    readings: [`${XP1_TOP} If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.`, `${XP1_TOP} If you cast a spell this way, pay life equal to its mana value rather than paying its mana cost.`],
    near: [`${XP1_TOP} If you cast a spell this way, pay life equal to its power rather than pay its mana cost.`, XP1_TOP],
  },
  'any-type-this-way-sentence': {
    def: xp1Def('Sorcery', "Exile the top card of target opponent's library. You may play that card this turn, and mana of any type can be spent to cast that spell."),
    readings: ["Exile the top card of target opponent's library. You may play that card this turn. Mana of any type can be spent to cast spells this way.", "Exile the top card of target opponent's library. You may play that card this turn. Mana of any type can be spent to cast a spell this way."],
    near: ["Exile the top card of target opponent's library. You may play that card this turn. Mana of any color can be spent to cast spells this way.", "Exile the top card of target opponent's library. You may play that card this turn."],
  },
  'any-type-rider-and': {
    def: xp1Def('Creature — Spy', `${XP1_UNTIL} You may cast the exiled card until end of turn, and mana of any type can be spent to cast that spell.`), ctx: creature,
    readings: [`${XP1_UNTIL} You may cast the exiled card until end of turn, and mana of any type can be spent to cast that spell.`, `${XP1_UNTIL} You may cast the exiled card until end of turn and mana of any type can be spent to cast that spell.`],
    near: [`${XP1_UNTIL} You may cast the exiled card until end of turn and mana of any color can be spent to cast that spell.`, `${XP1_UNTIL} You may cast the exiled card until end of turn.`],
  },
  'they-may-play': {
    def: xp1Def('Creature — Rogue', `${XP1_LOOKER} They may play that card for as long as it remains exiled.`), ctx: creature,
    readings: [`${XP1_LOOKER} They may play that card for as long as it remains exiled.`, `${XP1_LOOKER} They may play it for as long as it remains exiled.`],
    near: [`${XP1_LOOKER} That opponent may play that card for as long as it remains exiled.`, `${XP1_LOOKER} You may play that card for as long as it remains exiled.`],
  },
  'event-opponent-noun': {
    def: xp1Def('Creature — Rogue', XP1_LOOKER), ctx: creature,
    readings: [XP1_LOOKER, "Whenever a creature deals combat damage to an opponent, its controller looks at the top card of that opponent's library and exiles that card face down."],
    near: ["Whenever a creature deals combat damage to one of your opponents, its controller looks at the top card of your library and exiles it face down.", "Whenever a creature deals combat damage to one of your opponents, its controller looks at the top card of its controller's library and exiles it face down."],
  },
  'exiled-card-until': {
    def: xp1Def('Creature — Spy', `${XP1_UNTIL} You may cast that card this turn.`), ctx: creature,
    readings: [`${XP1_UNTIL} You may cast that card this turn.`, `${XP1_UNTIL} You may cast the exiled card this turn.`, `${XP1_UNTIL} You may cast the exiled nonland card this turn.`],
    near: [`${XP1_UNTIL} You may cast the exiled land card this turn.`, `${XP1_UNTIL} You may cast the revealed card this turn.`],
  },
  'dig-exiled-cards-named': {
    def: xp1Def('Creature — Cat', `${XP1_DIG} You may play the exiled cards for as long as they remain exiled.`), ctx: creature,
    readings: [`${XP1_DIG} You may play the exiled cards for as long as they remain exiled.`],
    near: [`${XP1_DIG} You may play the revealed cards for as long as they remain exiled.`, `${XP1_DIG} You may play the exiled card for as long as it remains exiled.`],
  },
} satisfies Record<string, Example>);

// std-combat-2 (lane std-combat): the families has-and-doesnt (cond.ts), grant-then-base (mods.ts) and do-the-same-for (fold-stdcombat2.ts)
const COMBAT2_HAS = (kw: string) => ({ op: 'if', cond: { cond: 'all', of: [{ cond: 'matches', object: { ref: 'target', id: 't0' }, filter: { keyword: kw } }, { cond: 'not', of: { cond: 'matches', object: { ref: 'self' }, filter: { keyword: kw } } }] }, then: [{ op: 'putCounters', on: { ref: 'self' }, kind: kw, count: 1 }] });
const COMBAT2_TARGET = { id: 't0', kind: 'object', min: 1, max: 1, text: 'another target creature', filter: { types: ['Creature'], other: true } };
const COMBAT2_ATTACKS = { on: [{ ev: 'attacks', attacker: { self: true } }] };
Object.assign(EXAMPLES, {
  // std-combat-2 (CR 702.2, 122.1b): "that creature has flying and ~ doesn't"
  'has-and-doesnt': {
    def: { kind: 'triggered', text: '', trigger: COMBAT2_ATTACKS, effect: { targets: [COMBAT2_TARGET], steps: [COMBAT2_HAS('flying')] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever Test Card attacks, choose another target creature. If that creature has flying and Test Card doesn't, put a flying counter on Test Card.",
      "Whenever Test Card attacks, choose another target creature. If that creature has flying and Test Card doesn't have flying, put a flying counter on Test Card."],
    near: ["Whenever Test Card attacks, choose another target creature. If that creature has flying and Test Card does, put a flying counter on Test Card.",
      "Whenever Test Card attacks, choose another target creature. If that creature has reach and Test Card doesn't, put a flying counter on Test Card."],
  },
  // std-combat-2 (CR 613.1f, 613.4b, 611.2a): the base power and toughness and the grant in either order
  'grant-then-base': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 2 }] }, effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature you control', filter: { types: ['Creature'], controller: 'you' } }], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flying' }] }, { layer: '7b', power: 4, toughness: 1 }] }] }] } } as unknown as AbilityDef,
    readings: ['{2}: Until end of turn, target creature you control gains flying and has base power and toughness 4/1.', '{2}: Target creature you control has base power and toughness 4/1 and gains flying until end of turn.'],
    near: ['{2}: Until end of turn, target creature you control gains flying and has base power and toughness 1/4.', '{2}: Until end of turn, target creature you control gains reach and has base power and toughness 4/1.'],
  },
  // std-combat-2 (CR 608.2c, 122.1b): one step said again for other keywords
  'do-the-same-for': {
    def: { kind: 'triggered', text: '', trigger: COMBAT2_ATTACKS, effect: { targets: [COMBAT2_TARGET], steps: [COMBAT2_HAS('reach'), COMBAT2_HAS('flying'), COMBAT2_HAS('lifelink')] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ["Whenever Test Card attacks, choose another target creature. If that creature has reach and Test Card doesn't, put a reach counter on Test Card. Do the same for flying and lifelink."],
    near: ["Whenever Test Card attacks, choose another target creature. If that creature has reach and Test Card doesn't, put a reach counter on Test Card. Do the same for lifelink and flying.",
      "Whenever Test Card attacks, choose another target creature. If that creature has reach and Test Card doesn't, put a reach counter on Test Card. Do the same for flying."],
  },
});

// std-exile-play-1-2 (lane std-exile-play-1): the readings of its families (invented wordings, design 6.10)
const XP2_OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const xp2Def = (type: string, text: string, cost = '{0}'): AbilityDef =>
  parseCard({ name: 'Test Card', layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard, XP2_OPTS).faces[0]!.abilities.at(-1)!;
const XP2_REVEAL = 'Target opponent reveals X cards from their hand, where X is the number of artifacts you control. You choose one of those cards.';
const XP2_BURN = 'Test Card deals X damage to target creature. When that creature dies this turn, exile cards from the top of your library equal to its power.';
Object.assign(EXAMPLES, {
  'owner-exiles-chosen-card': {
    def: xp2Def('Sorcery', `${XP2_REVEAL} That player exiles it.`),
    readings: [`${XP2_REVEAL} That player exiles it.`, `${XP2_REVEAL} Exile that card.`],
    near: [`${XP2_REVEAL} You discard it.`, `${XP2_REVEAL} Each player exiles it.`],
  },
  'a-number-of-cards-equal-to': {
    def: xp2Def('Instant', XP2_BURN, '{X}{R}'),
    readings: [XP2_BURN, 'Test Card deals X damage to target creature. When that creature dies this turn, exile a number of cards from the top of your library equal to its power.'],
    near: ['Test Card deals X damage to target creature. When that creature dies this turn, exile a number of cards from the top of your library equal to its toughness.', 'Test Card deals X damage to target creature. When that creature dies this turn, exile a number of cards from your graveyard equal to its power.'],
  },
  'its-power-not-instant': {
    def: xp2Def('Instant', XP2_BURN, '{X}{R}'),
    readings: [XP2_BURN, "Test Card deals X damage to target creature. When that creature dies this turn, exile cards from the top of your library equal to that creature's power."],
    near: ['Test Card deals X damage to target creature. When that creature dies this turn, exile cards from the top of your library equal to its toughness.', "Test Card deals X damage to target creature. When that creature dies this turn, exile cards from the top of your library equal to that land's power."],
  },
} satisfies Record<string, Example>);

// std-typechange-1 (CR 205.1b, 201.2, 613.1d, 613.1f, 613.4b): the two readings of an Aura's identity change beside the loss of every ability
const TC1_TOY = { kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] }, subtypes: { add: ['Toy'] } }, { layer: 6, removeAll: true }, { layer: '7b', power: 0, toughness: 2 }] }] } as unknown as AbilityDef;
const TC1_CLERK = { kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 4, subtypes: { set: ['Citizen'] }, named: 'Dull Clerk' }, { layer: 6, removeAll: true, add: [{ kind: 'activated', text: '{T}: Add {C}.', cost: { tap: true }, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['C']] }] }, isMana: true }] }, { layer: '7b', power: 1, toughness: 1 }] }] } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'loseall-base-add': {
    def: TC1_TOY,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ['Enchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2 in addition to its other types.',
      'Enchanted creature loses all abilities, is a Toy artifact creature in addition to its other types, and has base power and toughness 0/2.'],
    near: ['Enchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 2/0 in addition to its other types.',
      'Enchanted creature loses all abilities and is a Toy artifact creature with base power and toughness 0/2.'],
  },
  'loseall-identity-with-named': {
    def: TC1_CLERK,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] },
    readings: ['Enchanted creature loses all abilities and is a Citizen with base power and toughness 1/1 and "{T}: Add {C}" named Dull Clerk.'],
    near: ['Enchanted creature loses all abilities and is a Citizen with base power and toughness 1/1 and "{T}: Add {C}" named Busy Clerk.',
      'Enchanted creature loses all abilities and is a Citizen with base power and toughness 1/1 named Dull Clerk.'],
  },
});

// p2-typechange-1 (CR 205.1b, 611.2a, 611.3a, 613.1d): "It's still a land" after types added to the land itself, and the "same is true" union
const P2TC1_FACTORY = { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] }, subtypes: { add: ['Golem'] } }, { layer: '7b', power: 2, toughness: 2 }] }] }] } } as unknown as AbilityDef;
const P2TC1_PERM = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];
const P2TC1_UNION = { kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'union', of: [{ ref: 'each', filter: { notTypes: ['Land'], controller: 'you' } }, { ref: 'each', filter: { types: P2TC1_PERM, controller: 'you', zone: ['stack'] } }, { ref: 'each', filter: { types: P2TC1_PERM, notTypes: ['Land'], owner: 'you', isCard: true, zone: ['hand', 'graveyard', 'library', 'exile', 'command', 'stack'] } }] }, mods: [{ layer: 4, types: { add: ['Artifact'] } }] }] } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'still-land-sized-artifact-creature': {
    def: P2TC1_FACTORY,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Land'] },
    readings: ["{1}: This land becomes a 2/2 Golem artifact creature until end of turn. It's still a land."],
    near: ["{1}: This land becomes a 2/2 Golem enchantment creature until end of turn. It's still a land.", "{1}: This land becomes a 3/3 Golem artifact creature until end of turn. It's still a land."],
  },
  'same-is-true-groups': {
    def: P2TC1_UNION,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ["Nonland permanents you control are artifacts in addition to their other types. The same is true for permanent spells you control and nonland permanent cards you own that aren't on the battlefield."],
    near: ['Nonland permanents you control are artifacts in addition to their other types.', "Nonland permanents you control are enchantments in addition to their other types. The same is true for permanent spells you control and nonland permanent cards you own that aren't on the battlefield."],
  },
});

// std-cardcopy-7 (CR 400.7j, 608.2c): the cards an "any number of" cost part exiled, "those exiled cards" or "the exiled cards"
Object.assign(EXAMPLES, {
  'those-or-the-exiled-cards': {
    def: rx30Def('Creature — Human', 'Exile any number of red cards from your graveyard with six or more red mana symbols among their mana costs: Copy those exiled cards. You may cast up to two of the copies without paying their mana costs.'), ctx: creature,
    readings: ['Exile any number of red cards from your graveyard with six or more red mana symbols among their mana costs: Copy those exiled cards. You may cast up to two of the copies without paying their mana costs.', 'Exile any number of red cards from your graveyard with six or more red mana symbols among their mana costs: Copy the exiled cards. You may cast up to two of the copies without paying their mana costs.'],
    near: ['Exile any number of red cards from your graveyard with six or more red mana symbols among their mana costs: Copy those exiled cards. You may cast up to three of the copies without paying their mana costs.', 'Exile any number of red cards from your graveyard with five or more red mana symbols among their mana costs: Copy those exiled cards. You may cast up to two of the copies without paying their mana costs.'],
  },
});

// std-promote-3 (CR 107.14, 118.3, 608.2h): a payment of a computed number of energy counters
Object.assign(EXAMPLES, {
  'pay-energy-equal-to': {
    def: spell([{ op: 'pay', who: you, cost: { other: [{ kind: 'payEnergy', amount: { q: 'stat', stat: 'power', of: { ref: 'self' } } }] }, else: [{ op: 'sacrifice', what: { ref: 'self' } }] } as EffectStep]),
    ctx: creature,
    readings: ["Sacrifice ~ unless you pay an amount of {E} equal to ~'s power.", "Sacrifice ~ unless you pay ~'s power {E}."],
    near: ["Sacrifice ~ unless you pay an amount of {E} equal to ~'s toughness.", "Sacrifice ~ unless you pay life equal to ~'s power."],
  },
});

// p2-copy-perm-1 (CR 707.9b, 205.4a, 613.4b, 611.2a): the clause list of a copy's exceptions (render/copy-except.ts#listText) and a copy that keeps its name (mods.ts)
const P2CP_COPY = (pt: number) => spell([{ op: 'copy', what: t('c'), result: 'token', who: you, count: 2, except: [{ layer: '7b', power: pt, toughness: pt }, { layer: 4, supertypes: { remove: ['Legendary'] } }] } as EffectStep], [objTarget('c', { types: ['Creature'], controller: 'you' })]);
Object.assign(EXAMPLES, {
  'copy-exception-list': {
    def: P2CP_COPY(2),
    readings: [
      "Create two tokens that are copies of target creature you control, except they're 2/2 and they aren't legendary.",
      'Create two tokens that are copies of target creature you control, except the tokens are 2/2 and are not legendary.',
      "Create two tokens that are copies of target creature you control, except they're 2/2, and they aren't legendary.",
    ],
    near: [
      "Create two tokens that are copies of target creature you control, except they're 3/3 and they aren't legendary.",
      "Create two tokens that are copies of target creature you control, except it's 2/2 and it isn't legendary.",
    ],
  },
  'copy-keeps-name-list': {
    def: trig([{ ev: 'step', step: 'beginCombat', whose: 'you' } as EventPattern], [effectStep([{ s: 'continuous', affects: self, mods: [{ layer: '1a', copyOf: t('c'), except: [{ retain: ['name'] }, { layer: 4, supertypes: { add: ['Legendary'] } }] }] } as StaticEffect], { d: 'endOfTurn' })], {}, [objTarget('c', { types: ['Creature'], controller: 'you' })]),
    ctx: creature,
    readings: [
      "At the beginning of combat on your turn, Test Card becomes a copy of target creature you control until end of turn, except its name is Test Card and it's legendary in addition to its other types.",
      "At the beginning of combat on your turn, Test Card becomes a copy of target creature you control, except its name is Test Card and it's legendary in addition to its other types until end of turn.",
    ],
    near: [
      "At the beginning of combat on your turn, Test Card becomes a copy of target creature you control until end of turn, except its name is Test Card and it's a legendary in addition to its other types.",
      "At the beginning of combat on your turn, Test Card becomes a copy of target creature you control until end of turn, except its name is Test Card.",
    ],
  },
});

// std-freecast-5 (CR 702.170a, 702.170f): "the plot cost" and "its plot cost" of the top card of your library (render/stat.ts#permit)
const FREECAST5_HAS_PLOT = { kind: 'static', text: '', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'plot', fromTop: true, plotCost: 'manaCost' }] } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'plot-cost-the-its': {
    def: FREECAST5_HAS_PLOT,
    ctx: creature,
    readings: ['The top card of your library has plot. The plot cost is equal to its mana cost.', 'The top card of your library has plot. Its plot cost is equal to its mana cost.'],
    near: ['The top card of your library has plot. The plot cost is equal to its mana value.', 'The top card of your library has flash. The plot cost is equal to its mana cost.'],
  },
});

// p2-replace-damage-1 (Phase 2 lane p2-replace-damage; CR 615.1a, 615.7, 609.7a, 120.1, 107.3): the readings of damage preventions
const P2RD1_PREVENT = (replaces: unknown, amount: unknown = 'all'): unknown => ({ s: 'replace', replaces, body: { b: 'prevent', amount } });
const P2RD1_STATIC = (...effects: unknown[]): AbilityDef => ({ kind: 'static', text: '', effects } as unknown as AbilityDef);
const P2RD1_SPELL = (steps: unknown[], targets: unknown[] = []): AbilityDef => ({ kind: 'spell', text: '', effect: { targets, steps } } as unknown as AbilityDef);
const P2RD1_TURN = (...effects: unknown[]): unknown => ({ op: 'effect', duration: { d: 'endOfTurn' }, effects });
const P2RD1_T0 = [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } }];
const P2RD1_WALLS = { subtypes: ['Wall'], controller: 'you' };
Object.assign(EXAMPLES, {
  'a-source-would-deal': {
    def: P2RD1_STATIC(P2RD1_PREVENT({ ev: 'damage', recipient: { object: { types: ['Creature'], subtypes: ['Knight'], controller: 'you' } } }, 2)),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['If a source would deal damage to a Knight creature you control, prevent 2 of that damage.', 'If damage would be dealt to a Knight creature you control, prevent 2 of that damage.'],
    near: ['If a red source would deal damage to a Knight creature you control, prevent 2 of that damage.', 'If a source would deal damage to a Knight creature you control, prevent 3 of that damage.'],
  },
  'prevent-x-where': {
    def: P2RD1_STATIC(P2RD1_PREVENT({ ev: 'damage', recipient: { object: { is: { ref: 'self' } } } }, { q: 'count', of: { ref: 'each', filter: { types: ['Artifact'], controller: 'you' } } })),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['If a source would deal damage to Test Card, prevent X of that damage, where X is the number of artifacts you control.'],
    near: ['If a source would deal damage to Test Card, prevent X of that damage, where X is the number of creatures you control.', 'If a source would deal damage to Test Card, prevent X of that damage.'],
  },
  'prevent-object-would-deal': {
    def: P2RD1_SPELL([P2RD1_TURN(P2RD1_PREVENT({ ev: 'damage', combat: true, source: { is: { ref: 'target', id: 't0' } } }))], P2RD1_T0),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Instant'] },
    readings: ['Prevent all combat damage target creature would deal this turn.', 'Prevent all combat damage that would be dealt by target creature this turn.'],
    near: ['Prevent all damage target creature would deal this turn.', 'Prevent all combat damage target creature would deal.'],
  },
  'prevent-by-sources': {
    def: P2RD1_STATIC(P2RD1_PREVENT({ ev: 'damage', source: { not: { controller: 'you' } }, recipient: { player: 'you' } })),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ["Prevent all damage that would be dealt to you by sources you don't control.", "Prevent all damage that would be dealt to you by a source you don't control."],
    near: ['Prevent all damage that would be dealt to you by sources you control.', "Prevent all damage that would be dealt to you by creatures you don't control."],
  },
  'prevent-to-players': {
    def: P2RD1_SPELL([P2RD1_TURN(P2RD1_PREVENT({ ev: 'damage', combat: true, recipient: { player: 'any' } }))]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Instant'] },
    readings: ['Prevent all combat damage that would be dealt to players this turn.'],
    near: ['Prevent all combat damage that would be dealt to opponents this turn.', 'Prevent all combat damage that would be dealt to players.'],
  },
  'combat-to-and-by-group': {
    def: P2RD1_STATIC(P2RD1_PREVENT({ ev: 'damage', combat: true, recipient: { object: P2RD1_WALLS } }), P2RD1_PREVENT({ ev: 'damage', combat: true, source: P2RD1_WALLS })),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['Prevent all combat damage that would be dealt to and dealt by Walls you control.'],
    near: ['Prevent all combat damage that would be dealt to and dealt by Walls.', 'Prevent all damage that would be dealt to and dealt by Walls you control.'],
  },
  'prevent-all-source-of-choice': {
    def: P2RD1_SPELL([
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: ['battlefield', 'stack'] } }, min: 1, max: 1, as: 'b0' },
      P2RD1_TURN(P2RD1_PREVENT({ ev: 'damage', source: { is: { ref: 'bound', name: 'b0' } }, recipient: { player: 'you' } })),
    ]),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Instant'] },
    readings: ['Prevent all damage a source of your choice would deal to you this turn.', 'Prevent all damage that would be dealt to you this turn by a source of your choice.'],
    near: ['Prevent all damage a source of your choice would deal this turn.', 'The next time a source of your choice would deal damage to you this turn, prevent that damage.'],
  },
});

// p2-replace-events-1 (CR 614.1a, 614.5, 111.1): the one more token, "a Food token" or "an additional Food token" (render/stat.ts#tokensPlusOnePassive)
Object.assign(EXAMPLES, {
  'tokens-plus-additional': {
    def: { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'createToken', player: 'you' }, body: { b: 'modify', then: { as: 'created', do: [{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Treasure' } }] } } }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['If one or more tokens would be created under your control, those tokens plus a Treasure token are created instead.',
      'If one or more tokens would be created under your control, those tokens plus an additional Treasure token are created instead.'],
    near: ['If one or more tokens would be created under your control, those tokens plus an additional Clue token are created instead.',
      'If one or more tokens would be created under an opponent\'s control, those tokens plus an additional Treasure token are created instead.'],
  },
});

// p2-replace-events-1 (CR 614.1a, 119.3): the player whose life gain is set to nothing (render/stat.ts, the life branch of a modify body)
Object.assign(EXAMPLES, {
  'gain-no-life-they': {
    def: { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'any' }, body: { b: 'modify', amount: { set: 0 } } }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['If a player would gain life, that player gains no life instead.', 'If a player would gain life, they gain no life instead.'],
    near: ['If a player would gain life, that player loses no life instead.', 'If a player would lose life, they gain no life instead.'],
  },
});

// p2-player-rules-1 (CR 119.7, 119.8, 119.5): "can't gain life or lose life" of you alone is "Your life total can't change"
Object.assign(EXAMPLES, {
  'life-total-cant-change': {
    def: statics([
      { s: 'restrict', subject: { ref: 'you' }, mode: 'cant', action: 'gainLife' },
      { s: 'restrict', subject: { ref: 'you' }, mode: 'cant', action: 'loseLife' },
    ]),
    ctx: unknown,
    readings: ["You can't gain life or lose life.", "Your life total can't change."],
    near: ["Your opponents' life totals can't change.", "Your life total can't increase.", "You can't gain life."],
  },
});

// p2-intervening-1 (lane p2-intervening): the intervening "if" wordings of parser/holes/p2iv1.ts (invented wordings, design 6.10)
const P2IV1 = (type: string, text: string): AbilityDef => xp2Def(type, text);
Object.assign(EXAMPLES, {
  'no-on-battlefield': {
    def: P2IV1('Enchantment', 'At the beginning of your end step, if no artifacts are on the battlefield, draw a card.'),
    readings: ['At the beginning of your end step, if no artifacts are on the battlefield, draw a card.', 'At the beginning of your end step, if there are no artifacts on the battlefield, draw a card.'],
    near: ['At the beginning of your end step, if no creatures are on the battlefield, draw a card.', 'At the beginning of your end step, if no artifacts are in your graveyard, draw a card.'],
  },
  'cards-in-your-graveyard': {
    def: P2IV1('Enchantment', 'At the beginning of your upkeep, if you have three or more land cards in your graveyard, draw a card.'),
    readings: ['At the beginning of your upkeep, if you have three or more land cards in your graveyard, draw a card.', 'At the beginning of your upkeep, if three or more land cards are in your graveyard, draw a card.',
      'At the beginning of your upkeep, if there are three or more land cards in your graveyard, draw a card.'],
    near: ['At the beginning of your upkeep, if you have two or more land cards in your graveyard, draw a card.', 'At the beginning of your upkeep, if you have three or more land cards in your hand, draw a card.'],
  },
  'no-kind-counters-on-self': {
    def: P2IV1('Artifact', 'At the beginning of your upkeep, if there are no charge counters on Test Card, sacrifice it.'),
    readings: ['At the beginning of your upkeep, if there are no charge counters on Test Card, sacrifice it.', "At the beginning of your upkeep, if Test Card doesn't have a charge counter on it, sacrifice it."],
    near: ['At the beginning of your upkeep, if there are no fuse counters on Test Card, sacrifice it.', 'At the beginning of your upkeep, if there are charge counters on Test Card, sacrifice it.'],
  },
  'didnt-lose-life': {
    def: P2IV1('Enchantment', "At the beginning of your end step, if you didn't lose life this turn, draw a card."),
    readings: ["At the beginning of your end step, if you didn't lose life this turn, draw a card.", 'At the beginning of your end step, if you did not lose life this turn, draw a card.',
      "At the beginning of your end step, if you haven't lost life this turn, draw a card."],
    near: ["At the beginning of your end step, if you didn't gain life this turn, draw a card.", 'At the beginning of your end step, if you lost life this turn, draw a card.'],
  },
  'player-no-cards-in-hand': {
    def: P2IV1('Enchantment', "At the beginning of each opponent's upkeep, if that player has no cards in hand, you gain 1 life."),
    readings: ["At the beginning of each opponent's upkeep, if that player has no cards in hand, you gain 1 life."],
    near: ["At the beginning of each opponent's upkeep, if you have no cards in hand, you gain 1 life.", "At the beginning of each opponent's upkeep, if that player has no cards in their graveyard, you gain 1 life."],
  },
  'p2iv1-oracle-wording': {
    def: P2IV1('Enchantment', 'Whenever a land an opponent controls enters, if that player controls more lands than you, you gain 1 life.'),
    readings: ['Whenever a land an opponent controls enters, if that player controls more lands than you, you gain 1 life.',
      'Whenever a land an opponent controls enters, if the number of lands that player controls is greater than the number of lands you control, you gain 1 life.'],
    near: ['Whenever a land an opponent controls enters, if that player controls more creatures than you, you gain 1 life.', 'Whenever a land an opponent controls enters, if that player controls fewer lands than you, you gain 1 life.'],
  },
} satisfies Record<string, Example>);

// p2-replace-damage-2 (Phase 2 lane p2-replace-damage; CR 614.1a, 120.3, 609.7): the readings of damage-increase replacements
const P2RD2_MORE = (replaces: unknown, amount: unknown): AbilityDef => ({ kind: 'static', text: '', effects: [{ s: 'replace', replaces, body: { b: 'modify', amount } }] } as unknown as AbilityDef);
const P2RD2_ENCH = { selfNames: ['Test Card'], selfTypes: ['Enchantment'] };
Object.assign(EXAMPLES, {
  'described-source': {
    def: P2RD2_MORE({ ev: 'damage', source: { types: ['Instant', 'Sorcery'], controller: 'you' } }, { add: 2 }),
    ctx: P2RD2_ENCH,
    readings: ['If an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.', 'If an instant or sorcery source you control would deal damage, it deals 2 more damage instead.'],
    near: ['If an instant or sorcery source you control would deal damage to a permanent or player, it deals that much damage plus 3 to that permanent or player instead.', 'If a creature source you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.'],
  },
  'any-source': {
    def: P2RD2_MORE({ ev: 'damage', amount: { op: '>=', value: 1 } }, { set: 2 }),
    ctx: P2RD2_ENCH,
    readings: ['If any source would deal 1 or more damage to a permanent or player, it deals 2 damage to that permanent or player instead.', 'If a source would deal 1 or more damage to a permanent or player, it deals 2 damage to that permanent or player instead.'],
    near: ['If any source would deal 2 or more damage to a permanent or player, it deals 2 damage to that permanent or player instead.', 'If any source would deal 1 or more damage to a permanent or player, it deals 3 damage to that permanent or player instead.'],
  },
  'double-triple-that-damage': {
    def: P2RD2_MORE({ ev: 'damage', source: { controller: 'you' } }, { mul: 3 }),
    ctx: P2RD2_ENCH,
    readings: ['If a source you control would deal damage to a permanent or player, it deals triple that damage instead.', 'If a source you control would deal damage to a permanent or player, it deals three times that much damage instead.'],
    near: ['If a source you control would deal damage to a permanent or player, it deals double that damage instead.', 'If a source you control would deal damage to a permanent or player, it deals quadruple that damage instead.'],
  },
  'replaced-damage-to-you': {
    def: P2RD2_MORE({ ev: 'damage', source: { types: ['Instant', 'Sorcery'] }, recipient: { player: 'you' }, amount: { op: '>=', value: 3 } }, { set: 2 }),
    ctx: P2RD2_ENCH,
    readings: ['If an instant or sorcery source would deal 3 or more damage to you, it deals 2 damage to you instead.', 'If an instant or sorcery source would deal 3 or more damage to you, it deals 2 damage to that player instead.'],
    near: ['If an instant or sorcery source would deal 3 or more damage to you, it deals 2 damage to an opponent instead.', 'If an instant or sorcery source would deal 3 or more damage to you, it deals 1 damage to you instead.'],
  },
});

// p2-refs-1 (CR 607.2a, 110.2): the plural linked return to the battlefield
Object.assign(EXAMPLES, {
  'linked-exiled-battlefield-plural': {
    def: trig([dies], [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'battlefield', controller: 'owner' } } as EffectStep]),
    ctx: creature,
    readings: ["When this creature dies, return the exiled card to the battlefield under its owner's control.", "When this creature dies, return the exiled cards to the battlefield under their owners' control.", "When this creature dies, return the exiled cards to the battlefield under their owner's control."],
    near: ["When this creature dies, return the exiled cards to the battlefield under your control.", "When this creature dies, return the exiled cards to their owners' hands under their owners' control."],
  },
});
// p2-damage-1 (render/steps-flow.ts#damageEqualToTheirCount)
const P2D_EACH = (amount: Quantity): AbilityDef => spell([{ op: 'forEach', over: { ref: 'each', who: 'player' }, as: 'eachPlayer', do: [{ op: 'damage', source: self, to: bound('eachPlayer'), amount }] } as EffectStep]);
const P2D_COUNT = (extra: Record<string, unknown> = {}): Quantity => ({ q: 'count', of: { ref: 'each', filter: { anyOf: [{ types: ['Land'] }], controller: { ref: 'iterating' }, ...extra } } } as Quantity);
Object.assign(EXAMPLES, {
  'each-player-they-control': {
    def: P2D_EACH(P2D_COUNT()),
    readings: ['Test Card deals damage to each player equal to the number of lands they control.', 'Test Card deals damage to each player equal to the number of lands that player controls.'],
    near: ['Test Card deals damage to each player equal to the number of lands you control.', 'Test Card deals damage to each opponent equal to the number of lands they control.'],
  },
});

// p2-replace-damage-3 (Phase 2 lane p2-replace-damage; CR 614.9, 611.2a): a resolved redirection of all the damage of one recipient
Object.assign(EXAMPLES, {
  'redirect-all-for-duration': {
    def: { kind: 'spell', text: '', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } }], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'damage', recipient: { object: { is: { ref: 'target', id: 't0' } } } }, body: { b: 'redirect', to: { ref: 'you' } } }] }] } } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Instant'] },
    readings: ['All damage that would be dealt to target creature this turn is dealt to you instead.'],
    near: ['All damage that would be dealt to target creature this turn is dealt to an opponent instead.', 'All damage that would be dealt to target creature is dealt to you instead.'],
  },
});

// p2-intervening-2 (lane p2-intervening): the intervening "if" wordings of parser/holes/p2iv2.ts (invented wordings, design 6.10)
Object.assign(EXAMPLES, {
  'p2iv2-oracle-wording': {
    def: xp2Def('Enchantment', "At the beginning of your end step, if you didn't attack with a creature this turn, draw a card."),
    readings: ["At the beginning of your end step, if you didn't attack with a creature this turn, draw a card.", 'At the beginning of your end step, if you did not attack with a creature this turn, draw a card.'],
    near: ["At the beginning of your end step, if you didn't attack with a creature this game, draw a card.", 'At the beginning of your end step, if you attacked with a creature this turn, draw a card.'],
  },
} satisfies Record<string, Example>);

// p2-replace-events-2 (CR 614.1a, 615.7): the once-only replacement of a draw, "the next time you would draw a card this turn" (render/stat.ts#genericReplace)
Object.assign(EXAMPLES, {
  'next-time-would': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }] }, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'draw', player: 'you' }, body: { b: 'instead', do: [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }] }, shield: { uses: 1 } }] }] } } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['{1}: The next time you draw a card this turn, you gain 3 life instead.', '{1}: The next time you would draw a card this turn, you gain 3 life instead.'],
    near: ['{1}: The next time you would draw a card this turn, you gain 4 life instead.', '{1}: The next time an opponent would draw a card this turn, you gain 3 life instead.'],
  },
});

// p2-replace-events-2 (CR 614.1a): a move from the battlefield to anywhere sent to exile (render/stat.ts, the destination of a modify body)
Object.assign(EXAMPLES, {
  'exile-instead-anywhere-else': {
    def: { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }, body: { b: 'modify', destination: { zone: 'exile' } } }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['If Test Card would leave the battlefield, exile it instead.', 'If Test Card would leave the battlefield, exile it instead of putting it anywhere else.'],
    near: ['If Test Card would leave the battlefield, exile it instead of putting it into your hand.', 'If Test Card would die, exile it instead of putting it anywhere else.'],
  },
});

// p2-replace-events-2 (CR 614.1a, 113.6): the object itself put into a graveyard, in a replacement (render/evt.ts)
Object.assign(EXAMPLES, {
  'self-would-be-put-into-graveyard': {
    def: { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }, optional: true, body: { b: 'modify', destination: { zone: 'library', position: 'top' } } }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['If Test Card would be put into a graveyard from the battlefield, you may put it on top of its owner\'s library instead.', 'If Test Card would be put into a graveyard, you may put it on top of its owner\'s library instead.'],
    near: ['If Test Card would be put into a graveyard, you may put it on the bottom of its owner\'s library instead.', 'If Test Card would be put into a graveyard, put it on top of its owner\'s library instead.'],
  },
});

// p2-copy-perm-2 (CR 607.2d, 400.7): the chosen type before "that entered this turn" (render/np.ts)
Object.assign(EXAMPLES, {
  'chosen-before-entered': {
    def: spell([
      { op: 'chooseValue', who: you, what: 'creatureType', as: 'chosenCreatureType', link: 'chosenCreatureType' } as EffectStep,
      { op: 'destroy', what: { ref: 'each', filter: { controller: 'you', token: true, enteredThisTurn: true, chosen: { link: 'chosenCreatureType', quality: 'creatureType' } } } } as EffectStep,
    ]),
    readings: ['Choose a creature type. Destroy each token you control of the chosen type that entered this turn.', 'Choose a creature type. Destroy each token you control that entered this turn of the chosen type.'],
    near: ['Choose a creature type. Destroy each token you control of the chosen type.', 'Choose a creature type. Destroy each token you control of the chosen type that attacked this turn.'],
  },
});

// p2-attack-block-1: leading durations of a ban with "its activated abilities can't be activated", two groups' "can't block this turn", a group's grant with
// "can't be blocked by" (render/stat.ts#lastingCants and the static loop)
Object.assign(EXAMPLES, {
  'lasting-cants-activate': {
    def: spell([{ op: 'effect', duration: { d: 'untilNextTurn', whose: you }, effects: (['attack', 'block', 'activate'] as const).map((action) => ({ s: 'restrict', subject: t('c'), mode: 'cant', action })) } as EffectStep], [objTarget('c')]),
    readings: ["Until your next turn, target creature can't attack or block, and its activated abilities can't be activated.", "Until your next turn, target creature can't attack or block and its activated abilities can't be activated."],
    near: ["Until your next turn, target creature can't attack or block.", "Until end of turn, target creature can't attack or block, and its activated abilities can't be activated."],
  },
  'lasting-two-groups-cant': {
    def: spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: (['G', 'W'] as const).map((c) => ({ s: 'restrict', subject: { ref: 'each', filter: { colors: [c], types: ['Creature'] } }, mode: 'cant', action: 'block' })) } as EffectStep]),
    readings: ["Green creatures and white creatures can't block this turn."],
    near: ["Green creatures and red creatures can't block this turn.", "Green creatures and white creatures can't attack this turn."],
  },
  'group-grant-then-cant-be-blocked-by': {
    def: statics([
      { s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Fish'], controller: 'you' } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste' }] }] },
      { s: 'restrict', subject: { ref: 'each', filter: { subtypes: ['Fish'], controller: 'you' } }, mode: 'cant', action: 'beBlockedBy', other: { subtypes: ['Human'] } },
    ] as StaticEffect[]),
    ctx: creature,
    readings: ["Fish you control have haste and can't be blocked by Humans.", "Fish you control have haste. Fish you control can't be blocked by Humans."],
    near: ["Fish you control have haste and can't be blocked by Goblins.", "Fish you control have flying and can't be blocked by Humans."],
  },
} satisfies Record<string, Example>);

// p2-graveyard-1 (lane p2-graveyard): the readings of its families (invented wordings, design 6.10)
const GY1_OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const gy1Def = (type: string, text: string): AbilityDef =>
  parseCard({ name: 'Test Card', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard, GY1_OPTS).faces[0]!.abilities.at(-1)!;
Object.assign(EXAMPLES, {
  'return-to-zone-first': {
    def: gy1Def('Sorcery', 'Return all artifact cards in your graveyard that were put there from the battlefield this turn to your hand.'),
    readings: ['Return all artifact cards in your graveyard that were put there from the battlefield this turn to your hand.', 'Return to your hand all artifact cards in your graveyard that were put there from the battlefield this turn.'],
    near: ['Return to the battlefield all artifact cards in your graveyard that were put there from the battlefield this turn.', 'Return to your hand all artifact cards in your graveyard.'],
  },
  'color-set-anywhere': {
    def: gy1Def('Creature — Test', 'As long as you control a Forest, Test Card gets +2/+2, is green, and has trample.'),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Creature'] },
    readings: ['As long as you control a Forest, Test Card gets +2/+2, is green, and has trample.', 'As long as you control a Forest, Test Card is green, gets +2/+2, and has trample.', 'As long as you control a Forest, Test Card gets +2/+2, has trample, and is green.'],
    near: ['As long as you control a Forest, Test Card gets +2/+2, is red, and has trample.', 'As long as you control a Forest, Test Card gets +2/+2 and has trample.'],
  },
} satisfies Record<string, Example>);

// p2-intervening-3 (lane p2-intervening): the intervening "if" wordings of parser/holes/p2iv3.ts (invented wordings, design 6.10)
Object.assign(EXAMPLES, {
  'p2iv3-oracle-wording': {
    def: xp2Def('Enchantment', 'At the beginning of your end step, if a permanent was put into your hand from the battlefield this turn, you gain 1 life.'),
    readings: ['At the beginning of your end step, if a permanent was put into your hand from the battlefield this turn, you gain 1 life.',
      "At the beginning of your end step, if a permanent you own was returned to its owner's hand this turn, you gain 1 life."],
    near: ['At the beginning of your end step, if a permanent was put into your graveyard from the battlefield this turn, you gain 1 life.', 'At the beginning of your end step, if a permanent was put into your hand from the battlefield this game, you gain 1 life.'],
  },
} satisfies Record<string, Example>);

// p2-combat-flow-1 (CR 506.2-3, 508.1b, 509.1g-h): the defender named by the attacker's noun, a creature attacking you, blocking or being blocked by ~
Object.assign(EXAMPLES, {
  'attacked-that-creature': {
    def: rx30Def('Enchantment', 'Whenever a creature you control with power 3 or less attacks, Test Card deals 2 damage to the player or planeswalker that creature is attacking.'),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['Whenever a creature you control with power 3 or less attacks, Test Card deals 2 damage to the player or planeswalker that creature is attacking.',
      "Whenever a creature you control with power 3 or less attacks, Test Card deals 2 damage to the player or planeswalker it's attacking."],
    near: ['Whenever a creature you control with power 3 or less attacks, Test Card deals 2 damage to the player that creature is attacking.',
      'Whenever a creature you control with power 3 or less attacks, Test Card deals 3 damage to the player or planeswalker that creature is attacking.'],
  },
  'attacking-you-relative': {
    def: rx30Def('Creature — Spider', "{2}: Test Card deals 2 damage to target creature with flying that's attacking you."), ctx: creature,
    readings: ["{2}: Test Card deals 2 damage to target creature with flying that's attacking you.", '{2}: Test Card deals 2 damage to target creature with flying attacking you.',
      '{2}: Test Card deals 2 damage to target creature with flying that is attacking you.'],
    near: ["{2}: Test Card deals 2 damage to target creature with flying that's attacking a planeswalker you control.", "{2}: Test Card deals 2 damage to target creature with flying that's blocking you."],
  },
  'blocking-or-being-blocked': {
    def: rx30Def('Creature — Ox', '{1}: Destroy target creature blocking or blocked by Test Card.'), ctx: creature,
    readings: ['{1}: Destroy target creature blocking or blocked by Test Card.', '{1}: Destroy target creature blocking or being blocked by Test Card.'],
    near: ['{1}: Destroy target creature blocking Test Card.', '{1}: Destroy target creature blocked by Test Card.'],
  },
});

// p2-replace-events-3 (CR 614.1a, 614.10, 500.7): the player whose extra turn is skipped (render/stat.ts#extraTurnSkipped)
Object.assign(EXAMPLES, {
  'extra-turn-skip-they': {
    def: { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'beginTurn', whose: 'any', extra: true }, body: { b: 'skip' } }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['If a player would begin an extra turn, that player skips that turn instead.', 'If a player would begin an extra turn, they skip that turn instead.'],
    near: ['If an opponent would begin an extra turn, they skip that turn instead.', 'If a player would begin a turn, they skip that turn instead.'],
  },
});

// p2-pt-1 (CR 205.3m, 613.4c): each other creature that shares a creature type with the object modified (Coat of Arms)
const P2PT1_KIN = { kind: 'static', text: '', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: '7c',
  power: { q: 'math', op: '*', args: [1, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], sharesWith: { with: { ref: 'subject' }, quality: 'creatureType', other: true } } } }] },
  toughness: { q: 'math', op: '*', args: [1, { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], sharesWith: { with: { ref: 'subject' }, quality: 'creatureType', other: true } } } }] } }] }] } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'shares-type-with-subject': {
    def: P2PT1_KIN,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Artifact'] },
    readings: ['Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.',
      'Each creature gets +1/+1 for each other creature that shares a creature type with it.'],
    near: ['Each creature gets +1/+1 for each creature on the battlefield that shares at least one creature type with it.',
      'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one color with it.'],
  },
});

// p2-misc-1 (CR 602.5b, 702.142a, 500.1): boasting twice during each of your turns (abil.ts, during-turn group)
Object.assign(EXAMPLES, {
  'boast-twice': {
    def: { kind: 'static', text: '', condition: { cond: 'turnOf', whose: 'you' }, effects: [{ s: 'rule', rule: 'additionalActivation', keyword: 'boast', of: { types: ['Creature'], controller: 'you' } }] } as unknown as AbilityDef,
    readings: ['Creatures you control can boast twice during each of your turns rather than once.', 'During your turn, each boast ability of creatures you control can be activated an additional time.'],
    near: ['Creatures you control can boast twice during each turn rather than once.', 'Creatures your opponents control can boast twice during each of your turns rather than once.'],
  },
});

// p2-refs-2 (CR 701.19c, 608.2c): a destroy that can't be regenerated, its objects named by the participle
Object.assign(EXAMPLES, {
  'destroyed-this-way-no-regen': {
    def: spell([{ op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'] } }, regeneration: 'cant' } as EffectStep]),
    readings: ["Destroy all creatures. They can't be regenerated.", "Destroy all creatures. Creatures destroyed this way can't be regenerated."],
    near: ["Destroy all creatures. Artifacts destroyed this way can't be regenerated.", "Destroy all creatures. Creatures destroyed this way can be regenerated."],
  },
});

// p2-group-actions-1 (CR 119.1): the highest life total among a set of players (render/qty.ts)
Object.assign(EXAMPLES, {
  'life-total-highest-greatest': {
    def: spell([{ op: 'setLife', who: { ref: 'each', who: 'player' }, value: { q: 'life', of: { ref: 'each', who: 'player' }, agg: 'max' } } as EffectStep]),
    readings: ["Each player's life total becomes the highest life total among all players.", "Each player's life total becomes the greatest life total among all players."],
    near: ["Each player's life total becomes the lowest life total among all players.", "Each player's life total becomes the highest life total among your opponents."],
  },
});

// p2-cost-parts-1 (CR 118.3, 602.2b): counters removed from ~ and ~ itself sacrificed, exiled or returned, said with "it"
const P2CP1_COST = (second: Record<string, unknown>): AbilityDef => ({ kind: 'activated', text: '', cost: { other: [{ kind: 'removeCounters', counter: 'quest', count: 3, self: true }, second] }, effect: { targets: [], steps: [draw()] } } as unknown as AbilityDef);
Object.assign(EXAMPLES, {
  'remove-counters-and-self-it': {
    def: P2CP1_COST({ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }),
    readings: ['Remove three quest counters from Test Card and sacrifice it: Draw a card.', 'Remove three quest counters from Test Card, Sacrifice Test Card: Draw a card.'],
    near: ['Remove three quest counters from Test Card and exile it: Draw a card.', 'Remove two quest counters from Test Card and sacrifice it: Draw a card.',
      'Remove three quest counters from Test Card and sacrifice a creature: Draw a card.'],
  },
} satisfies Record<string, Example>);

// p2-copy-spell-1 (CR 608.2c, 608.2d, 707.10c): "they" as the subject of an option; the copier's own "and may choose new targets / a new target for the copy"
const P2CS_CTL: PlayerRef = { ref: 'controllerOf', object: t('c') };
const p2csCopy = (who: PlayerRef): AbilityDef => spell([
  { op: 'discard', who: { ref: 'target', id: 'p' }, count: 1 } as EffectStep,
  { op: 'may', who, do: [{ op: 'copy', what: self, result: 'spell', who, newTargets: 'may' }] } as EffectStep,
], [playerTarget('p')]);
Object.assign(EXAMPLES, {
  'they-may': {
    def: spell([
      { op: 'tap', what: t('c') } as EffectStep,
      { op: 'pay', who: P2CS_CTL, cost: { mana: [{ kind: 'generic', amount: 2 }] }, then: [{ op: 'may', who: P2CS_CTL, do: [draw(1, P2CS_CTL)] }] } as EffectStep,
    ], [objTarget('c')]),
    readings: ["Tap target creature. Then that creature's controller may pay {2}. If the player does, they may draw a card.",
      "Tap target creature. Then that creature's controller may pay {2}. If the player does, that player may draw a card."],
    near: ["Tap target creature. Then that creature's controller may pay {2}. If the player does, you may draw a card.",
      "Tap target creature. Then that creature's controller may pay {2}. If the player does, they draw a card."],
  },
  'copy-and-may-choose-new-target': {
    def: p2csCopy({ ref: 'target', id: 'p' }),
    readings: ['Target player discards a card. That player may copy this spell and may choose a new target for that copy.',
      'Target player discards a card. That player may copy this spell and may choose new targets for the copy.'],
    near: ['Target player discards a card. That player may copy this spell. You may choose new targets for the copy.',
      'Target player discards a card. That player may copy this spell and may choose new targets for the copies.'],
  },
});

// p2-exile-play-1 (Phase 2 lane p2-exile-play): "During your turn, if <condition>, ..." (family during-turn-if; Theater of Horrors)
Object.assign(EXAMPLES, {
  'during-turn-if': {
    def: { ...statics([{ s: 'permit', who: you, action: 'play', of: { is: { ref: 'linked', link: 'exiled' } } } as unknown as StaticEffect]),
      condition: { cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent' }, scope: 'turn' }] } } as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['During your turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with Test Card.',
      'During your turn, as long as an opponent lost life this turn, you may play cards exiled with Test Card.'],
    near: ['During your turn, if an opponent gained life this turn, you may play lands and cast spells from among cards exiled with Test Card.',
      "During each opponent's turn, if an opponent lost life this turn, you may play lands and cast spells from among cards exiled with Test Card."],
  },
} satisfies Record<string, Example>);

// p2-attack-block-2: "defending player has N or more cards in their graveyard" (render/cond.ts, zoneSize)
Object.assign(EXAMPLES, {
  'defending-graveyard-has': {
    def: statics([{ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'attack', when: { cond: 'compare', left: { q: 'zoneSize', zone: 'graveyard', of: { ref: 'defending' } }, op: '>=', right: 7 } } as StaticEffect]),
    ctx: creature,
    readings: ["~ can't attack unless defending player has seven or more cards in their graveyard."],
    near: ["~ can't attack unless defending player has six or more cards in their graveyard.", "~ can't attack unless you have seven or more cards in your graveyard."],
  },
} satisfies Record<string, Example>);

// p2-dig-2 (CR 701.20a, 608.2c): the one card a reveal of the top card revealed, of a description
const P2DIG2_REVEAL: EffectStep = { op: 'may', who: you, do: [{ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, as: 'them' }] } as EffectStep;
Object.assign(EXAMPLES, {
  'revealed-this-way-cond': {
    def: spell([P2DIG2_REVEAL, { op: 'if', cond: { cond: 'matches', object: bound('them'), filter: { types: ['Creature'], isCard: true } }, then: [draw()] } as EffectStep]),
    readings: [
      'You may reveal the top card of your library. If a creature card is revealed this way, draw a card.',
      "You may reveal the top card of your library. If it's a creature card, draw a card.",
    ],
    near: ['You may reveal the top card of your library. If a land card is revealed this way, draw a card.', 'You may reveal the top card of your library. If a creature card is milled this way, draw a card.'],
  },
});

// p2-combat-flow-2 (CR 509.1h): "unblocked attacking" in either order
Object.assign(EXAMPLES, {
  'unblocked-attacking-order': {
    def: rx30Def('Creature — Human Soldier', '{2}, {T}: Tap target unblocked attacking creature.'), ctx: creature,
    readings: ['{2}, {T}: Tap target unblocked attacking creature.', '{2}, {T}: Tap target attacking unblocked creature.'],
    near: ['{2}, {T}: Tap target blocked attacking creature.', '{2}, {T}: Tap target unblocked creature.'],
  },
});

// p2-group-actions-2 (CR 102.3, 101.4): each opponent / each other player may put a card from their hand onto the battlefield (render/fold-p2ga2.ts)
Object.assign(EXAMPLES, {
  'each-other-player-may-put': {
    def: spell([
      { op: 'chooseObjects', who: { ref: 'iterating' }, perPlayer: { ref: 'each', who: 'opponent' }, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], zone: 'hand', owner: { ref: 'iterating' }, isCard: true } }, min: 0, max: 1, as: 'put' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'put' }, to: { zone: 'battlefield', controller: 'owner' } } as EffectStep,
    ]),
    readings: ['Each opponent may put a creature card from their hand onto the battlefield.', 'Each other player may put a creature card from their hand onto the battlefield.'],
    near: ['Each opponent may put an artifact card from their hand onto the battlefield.', 'Each player may put a creature card from their hand onto the battlefield.'],
  },
});

// p2-graveyard-2 (lane p2-graveyard): the readings of its family (invented wordings, design 6.10)
const GY2_OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const gy2Def = (text: string): AbilityDef =>
  parseCard({ name: 'Test Card', layout: 'normal', mana_cost: '{0}', type_line: 'Artifact', oracle_text: text, colors: [] } as OracleCard, GY2_OPTS).faces[0]!.abilities.at(-1)!;
Object.assign(EXAMPLES, {
  'cards-in-zones-plural': {
    def: gy2Def("Artifact cards in graveyards and libraries can't enter the battlefield."),
    readings: ["Artifact cards in graveyards and libraries can't enter the battlefield."],
    near: ["Artifact cards in graveyards can't enter the battlefield.", "Artifact cards in graveyards and hands can't enter the battlefield."],
  },
  'keyword-card-before-zone': {
    def: gy2Def('Return target creature card with flying from your graveyard to your hand.'),
    readings: ['Return target creature card with flying from your graveyard to your hand.'],
    near: ['Return target creature card with reach from your graveyard to your hand.', 'Return target creature card with flying from your hand to your graveyard.'],
  },
  'cast-this-way-spell': {
    def: gy2Def('Once during each of your turns, you may cast an artifact spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead.'),
    readings: ['Once during each of your turns, you may cast an artifact spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead.',
      'Once during each of your turns, you may cast an artifact spell from your graveyard. If that spell would be put into your graveyard, exile it instead.'],
    near: ['Once during each of your turns, you may cast an artifact spell from your graveyard. If a spell cast this way would be put into a graveyard, exile it instead.',
      'Once during each of your turns, you may cast an artifact spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it.'],
  },
} satisfies Record<string, Example>);

// p2-pt-2 (CR 611.2a, 613.1f, 613.4c): a grant and a counted pump of one resolved effect, said with the grant first (Fists of Flame)
const P2PT2_FISTS = { kind: 'spell', text: '', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } }], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' },
  mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'trample' }] }, { layer: '7c', power: { q: 'math', op: '*', args: [1, { q: 'cardsDrawnThisTurn' }] }, toughness: { q: 'math', op: '*', args: [0, { q: 'cardsDrawnThisTurn' }] } }] }] }] } } as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'grant-then-pump-for-each': {
    def: P2PT2_FISTS,
    readings: ["Until end of turn, target creature gains trample and gets +1/+0 for each card you've drawn this turn.", "Target creature gets +1/+0 for each card you've drawn this turn and gains trample until end of turn."],
    near: ["Until end of turn, target creature gains trample and gets +0/+1 for each card you've drawn this turn.", "Until end of turn, target creature gains flying and gets +1/+0 for each card you've drawn this turn."],
  },
});

// p2-modal-1 (CR 700.2, 601.2b): "choose any number instead" over three or more modes is one up to all of them (render/program.ts#modes)
Object.assign(EXAMPLES, {
  'any-number-instead': {
    def: { kind: 'spell', text: '', effect: { targets: [], steps: [], modes: { min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: true }, min: 1, max: 3 },
      options: [{ text: '', program: { targets: [], steps: [draw(1)] } }, { text: '', program: { targets: [], steps: [{ op: 'gainLife', who: you, amount: 2 } as EffectStep] } },
        { text: '', program: { targets: [], steps: [draw(2)] } }] } } } as AbilityDef,
    readings: ['Choose one. If this spell was kicked, choose any number instead. • Draw a card. • You gain 2 life. • Draw two cards.',
      'Choose one. If this spell was kicked, choose one or more instead. • Draw a card. • You gain 2 life. • Draw two cards.'],
    near: ['Choose one. If this spell was kicked, choose two instead. • Draw a card. • You gain 2 life. • Draw two cards.',
      'Choose one. If this spell was kicked, choose any number. • Draw a card. • You gain 2 life. • Draw two cards.'],
  },
});

// p2-cost-statics-2 (Phase 2 lane p2-cost-statics): two new alt sites in render/stat.ts (#costMod: spells that target objects of a description)
Object.assign(EXAMPLES, {
  'target-a-or-one-or-more': {
    def: statics([{ s: 'costMod', applies: { spells: { targets: { ref: 'each', filter: { subtypes: ['Goblin'], controller: 'you' } } }, caster: 'opponent' }, change: { kind: 'increase', mana: [{ kind: 'generic', amount: 2 }] } } as unknown as StaticEffect]),
    readings: ['Spells your opponents cast that target a Goblin you control cost {2} more to cast.', 'Spells your opponents cast that target one or more Goblins you control cost {2} more to cast.'],
    near: ['Spells your opponents cast that target two or more Goblins you control cost {2} more to cast.', 'Spells your opponents cast that target a Goblin cost {2} more to cast.', 'Spells your opponents cast that target a Goblin you control cost {2} less to cast.'],
  },
  'spells-you-cast-control': {
    def: statics([{ s: 'costMod', applies: { spells: { targets: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, caster: 'you' }, change: { kind: 'reduce', mana: [{ kind: 'generic', amount: 1 }], floor: 'zero' } } as unknown as StaticEffect]),
    readings: ['Spells you cast that target a creature you control cost {1} less to cast.', 'Spells you control that target a creature you control cost {1} less to cast.'],
    near: ['Spells you own that target a creature you control cost {1} less to cast.', 'Spells your opponents cast that target a creature you control cost {1} less to cast.', 'Spells you control that target a creature you control cost {1} more to cast.'],
  },
});

// p2-counters-move-1 (CR 122.5, 115.3, 701.34a): counters of any kind moved from one target onto "a second target ..." (render/steps-life.ts#moveCounters, family
// move-counters-second-target), every counter moved is also "move all counters from ... onto ..." (family move-all-counters), proliferating twice is also
// "proliferate, then proliferate again" (render/steps-lasting.ts, family proliferate-then-again)
const p2cm1Targets = [
  { id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } },
  { id: 't1', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } },
];
const p2cm1Move = (extra: Record<string, unknown>): AbilityDef => ({ kind: 'spell', text: '', effect: { targets: p2cm1Targets, steps: [{ op: 'moveCounters', from: { ref: 'target', id: 't0' }, to: { ref: 'target', id: 't1' }, kind: 'any', ...extra }] } }) as unknown as AbilityDef;
Object.assign(EXAMPLES, {
  'move-counters-second-target': {
    def: p2cm1Move({ count: 1 }),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Sorcery'] },
    readings: ['Move a counter from target creature onto target creature.', 'Move a counter from target creature onto a second target creature.', 'Move a counter from target creature to a second target creature.'],
    near: ['Move a +1/+1 counter from target creature onto a second target creature.', 'Move two counters from target creature onto a second target creature.', 'Move a counter from target creature onto a third target creature.'],
  },
  'move-all-counters': {
    def: p2cm1Move({ count: 'all' }),
    ctx: { selfNames: ['Test Card'], selfTypes: ['Sorcery'] },
    readings: ['Move all counters from target creature onto a second target creature.', 'Move all counters from target creature onto target creature.'],
    near: ['Move all +1/+1 counters from target creature onto a second target creature.', 'Move a counter from target creature onto a second target creature.', 'Move all but one counter from target creature onto target creature.'],
  },
  'proliferate-then-again': {
    def: { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'action', action: 'proliferate', who: { ref: 'you' }, n: 2 }] } } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Sorcery'] },
    readings: ['Proliferate twice.', 'Proliferate, then proliferate again.'],
    near: ['Proliferate, then proliferate twice.', 'Proliferate.', 'Proliferate, then investigate again.'],
  },
});

// p2-c-dieroll-1 (CR 706.1, unverified cite): a d6 is also "a six-sided die"
Object.assign(EXAMPLES, {
  'six-sided-die': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 2 }] }, effect: { targets: [], steps: [{ op: 'rollDie', who: you, sides: 6 } as EffectStep, { op: 'gainLife', who: you, amount: { q: 'dieResult' } } as unknown as EffectStep] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['{2}: Roll a d6. You gain life equal to the result.', '{2}: Roll a six-sided die. You gain life equal to the result.'],
    near: ['{2}: Roll a d4. You gain life equal to the result.', '{2}: Roll a four-sided die. You gain life equal to the result.', '{2}: Roll two six-sided dice. You gain life equal to the result.'],
  },
});

// p2-copy-spell-3 (CR 707.10c): the controller of the target spell copies it, with the target inside the subject
Object.assign(EXAMPLES, {
  'controller-of-target-copies-it': {
    def: {
      kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 1 }], tap: true },
      effect: { targets: [objTarget('s', { types: ['Sorcery'] }, { kind: 'spell' })], steps: [{ op: 'copy', what: t('s'), result: 'spell', who: { ref: 'controllerOf', object: t('s') } } as EffectStep] },
    } as unknown as AbilityDef,
    readings: ['{1}, {T}: The controller of target sorcery spell copies it.', '{1}, {T}: Its controller copies target sorcery spell.'],
    near: ['{1}, {T}: The controller of target instant spell copies it.', '{1}, {T}: The owner of target sorcery spell copies it.', '{1}, {T}: The controller of target sorcery spell copies it twice.'],
  },
});

// p2-cost-statics-1 (Phase 2 lane p2-cost-statics): two new alt sites in render/cond.ts (#existsPhrase's counted status, #exactlyOneAttacking) and a reading added
// to the existing cast-history group of render/cond.ts#happenedPhrase (has-cast-or-cast)
Object.assign(EXAMPLES, {
  'exists-counted-are-status': {
    def: spell([{ op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], attacking: true } }, atLeast: 3 }, then: [draw()] } as unknown as EffectStep]),
    readings: ['If three or more creatures are attacking, draw a card.', 'If there are three or more attacking creatures on the battlefield, draw a card.'],
    near: ['If three or more creatures are blocking, draw a card.', 'If two or more creatures are attacking, draw a card.', 'If three or more creatures are attacking, draw two cards.'],
  },
  'exactly-one-attacking': {
    def: spell([{ op: 'if', cond: { cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], attacking: true } } }, op: '==', right: 1 }, then: [draw()] } as unknown as EffectStep]),
    readings: ['If exactly one creature is attacking, draw a card.', 'If the number of attacking creatures is one, draw a card.'],
    near: ['If exactly two creatures are attacking, draw a card.', 'If exactly one creature is blocking, draw a card.', 'If one or more creatures are attacking, draw a card.'],
  },
  'has-cast-or-cast': {
    def: spell([{ op: 'if', cond: { cond: 'happened', event: { ev: 'cast', player: 'opponent', spell: { colors: ['U'] } }, scope: 'turn', times: { op: '>=', value: 1 } }, then: [draw()] } as unknown as EffectStep]),
    readings: ['If an opponent cast a blue spell this turn, draw a card.', 'If an opponent has cast a blue spell this turn, draw a card.'],
    near: ['If an opponent cast a red spell this turn, draw a card.', 'If you cast a blue spell this turn, draw a card.', 'If an opponent cast a blue spell last turn, draw a card.'],
  },
});

// p2-replace-damage-4 (Phase 2 lane p2-replace-damage; CR 615.1a, 615.7): the one-use shield on the damage of one object
Object.assign(EXAMPLES, {
  'prevent-next-time-object': {
    def: { kind: 'spell', text: '', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } }], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'damage', source: { is: { ref: 'target', id: 't0' } } }, body: { b: 'prevent', amount: 'all' }, shield: { uses: 1 } }] }] } } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Instant'] },
    readings: ['The next time target creature would deal damage this turn, prevent that damage.'],
    near: ['The next time target creature would be dealt damage this turn, prevent that damage.', 'The next time target creature would deal damage, prevent that damage.'],
  },
});
Object.assign(EXAMPLES, {
  'prevent-during-your-turn': {
    def: { kind: 'static', text: '', effects: [{ s: 'replace', replaces: { ev: 'damage', recipient: { player: 'you' } }, body: { b: 'prevent', amount: 'all' }, condition: { cond: 'turnOf', whose: 'you' } }] } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Enchantment'] },
    readings: ['During your turn, prevent all damage that would be dealt to you.', 'Prevent all damage that would be dealt to you during your turn.'],
    near: ["During each opponent's turn, prevent all damage that would be dealt to you.", 'Prevent all damage that would be dealt to you.'],
  },
});

// p2-refs-3 (CR 601.3, 101.2): a "can't cast" ban for every player, said of the spells
Object.assign(EXAMPLES, {
  'spells-cant-be-cast': {
    def: { kind: 'static', text: '', effects: [{ s: 'restrict', subject: { ref: 'each', who: 'player' }, mode: 'cant', action: 'cast', other: { types: ['Creature'] } }] } as AbilityDef,
    readings: ["Each player can't cast creature spells.", "Creature spells can't be cast."],
    near: ["Creature spells can't be countered.", "Your opponents can't cast creature spells."],
  },
});

// p2-coinflip-3 (CR 404.1, 705.2, 508.4): "at least three ... cards in your graveyard"; "For each flip you win, create ... that's tapped and attacking"
Object.assign(EXAMPLES, {
  'at-least-cards-in-your-graveyard': {
    def: P2IV1('Enchantment', 'At the beginning of your upkeep, if there are at least three land cards in your graveyard, draw a card.'),
    readings: ['At the beginning of your upkeep, if there are at least three land cards in your graveyard, draw a card.', 'At the beginning of your upkeep, if there are three or more land cards in your graveyard, draw a card.'],
    near: ['At the beginning of your upkeep, if there are at least two land cards in your graveyard, draw a card.', 'At the beginning of your upkeep, if there are at least three land cards in your hand, draw a card.'],
  },
  'token-for-each-flip-won-lead': {
    def: spell([
      { op: 'flipCoin', who: you, count: 3, called: true, as: 'flips' } as EffectStep,
      { op: 'createToken', who: you, token: { power: 1, toughness: 1, colors: ['R'], types: ['Creature'], subtypes: ['Goblin'] }, count: { q: 'resultCount', step: 'flips' }, tapped: true, attacking: true } as EffectStep,
    ]),
    readings: ["Flip three coins. For each flip you win, create a 1/1 red Goblin creature token that's tapped and attacking.", "Flip three coins. Create a 1/1 red Goblin creature token that's tapped and attacking for each flip you win."],
    near: ["Flip three coins. For each flip you win, create a 1/1 red Goblin creature token.", "Flip three coins. For each coin that comes up heads, create a 1/1 red Goblin creature token that's tapped and attacking.",
      "Flip two coins. For each flip you win, create a 1/1 red Goblin creature token that's tapped and attacking."],
  },
} satisfies Record<string, Example>);

// p2-counters-move-3 (CR 613.4c, 608.2h): a resolved pump counted "for each" with the count said first (render/mods.ts, family count-before-pump)
Object.assign(EXAMPLES, {
  'count-before-pump': {
    def: { kind: 'spell', text: '', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, filter: { types: ['Creature'] } }], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: { q: 'math', op: '*', args: [2, { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } }] }, toughness: { q: 'math', op: '*', args: [0, { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } }] } }] }] }] } } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Sorcery'] },
    readings: ['Target creature gets +2/+0 until end of turn for each Elf you control.', 'For each Elf you control, target creature gets +2/+0 until end of turn.'],
    near: ['For each Elf you control, target creature gets +2/+0.', 'For each Elf you control, target creature gets +0/+2 until end of turn.', 'For each Goblin you control, target creature gets +2/+0 until end of turn.'],
  },
});

// p2-c-cast-zone-1 (CR 603.4, 702.33d): "if it was kicked" in a cast trigger of the spell itself
Object.assign(EXAMPLES, {
  'cast-self-it-was-kicked': {
    def: { kind: 'triggered', text: '', zone: ['stack'], trigger: { on: [{ ev: 'cast', player: 'you', spell: { self: true } }] }, interveningIf: { cond: 'wasCast', kicked: true },
      effect: { targets: [objTarget('l', { types: ['Land'] })], steps: [{ op: 'move', what: t('l'), to: { zone: 'exile' } } as EffectStep] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['When you cast ~, if it was kicked, exile target land.', 'When you cast ~, if ~ was kicked, exile target land.'],
    near: ['When you cast ~, if it was kicked, exile target creature.', 'When you cast ~, if it was not kicked, exile target land.'],
  },
});

// p2-c-dieroll-2 (CR 706.2, 608.2h, unverified cites): "that much" after one roll is its result
Object.assign(EXAMPLES, {
  'die-result-that-much': {
    def: { kind: 'activated', text: '', cost: { mana: [{ kind: 'generic', amount: 3 }] }, effect: { targets: [], steps: [{ op: 'rollDie', who: you, sides: 20 } as EffectStep, { op: 'loseLife', who: you, amount: { q: 'dieResult' } } as unknown as EffectStep] } } as unknown as AbilityDef,
    ctx: creature,
    readings: ['{3}: Roll a d20. You lose life equal to the result.', '{3}: Roll a d20. You lose that much life.'],
    near: ['{3}: Roll a d20. You lose 1 life.', '{3}: Roll a d20. You gain that much life.'],
  },
});

// p2-c-dieroll-2 (CR 115.1, 601.2c, 706.3a, unverified cites): a target announced, then a die roll whose rows name it
Object.assign(EXAMPLES, {
  'choose-then-roll': {
    def: trig([enters], [{ op: 'rollDie', who: you, sides: 20, table: [{ min: 1, max: 10, do: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] }, { min: 11, max: 20, do: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] }] } as EffectStep], {}, [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature an opponent controls', filter: { types: ['Creature'], controller: 'opponent' } } as TargetSpec]),
    ctx: creature,
    readings: ['When ~ enters, choose target creature an opponent controls, then roll a d20. 1—10 | Tap that creature. 11—20 | Destroy that creature.', 'When ~ enters, choose target creature an opponent controls. Roll a d20. 1—10 | Tap that creature. 11—20 | Destroy that creature.'],
    near: ['When ~ enters, choose target creature an opponent controls, then roll a d20. 1—10 | Tap that creature. 11—20 | Exile that creature.', 'When ~ enters, choose target creature you control, then roll a d20. 1—10 | Tap that creature. 11—20 | Destroy that creature.'],
  },
});

// p2-counters-state-3 (lane p2-counters-state; CR 601.2c, 107.3): a calculated number of targets said with "where X is" (render/program.ts#targetCountWhereX)
Object.assign(EXAMPLES, {
  'target-count-where-x': {
    def: { kind: 'spell', text: '', effect: { targets: [{ id: 't0', kind: 'object', min: 0, max: { q: 'counters', on: { ref: 'self' }, kind: 'gloom' }, filter: { types: ['Land'] } }], steps: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] } } as unknown as AbilityDef,
    ctx: { selfNames: ['Test Card'], selfTypes: ['Sorcery'] },
    readings: ['Destroy up to X target lands, where X is the number of gloom counters on Test Card.', 'Destroy up to the number of gloom counters on Test Card target lands.'],
    near: ['Destroy up to X target lands, where X is the number of charge counters on Test Card.', 'Destroy up to X target creatures, where X is the number of gloom counters on Test Card.', 'Destroy X target lands, where X is the number of gloom counters on Test Card.'],
  },
} satisfies Record<string, Example>);
