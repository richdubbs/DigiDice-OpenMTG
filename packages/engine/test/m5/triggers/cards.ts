/**
 * Synthetic cards with triggered abilities for the WP8 tests: hand-built ability JSON, exactly the shapes of design section 13.3. No Oracle text is parsed
 * (that is WP17-WP23); each card is named after the rules question it asks. Effects are real steps; resolving them is WP10-WP15, so these tests go as far as
 * the stack and the events.
 */
import type { AbilityDef, CardDef, EffectProgram, EventPattern, TargetSpec, TriggeredAbilityDef } from '../../../src/index';
import { synth, targetCreature, targetPlayer } from '../helpers';

type TriggerExtra = Partial<Omit<TriggeredAbilityDef, 'kind' | 'text' | 'trigger' | 'effect'>> & { batch?: boolean };

/** A triggered ability. */
export function trig(text: string, on: EventPattern[], effect: Partial<EffectProgram> = {}, extra: TriggerExtra = {}): TriggeredAbilityDef {
  const { batch, ...rest } = extra;
  return {
    kind: 'triggered', text, trigger: { on, ...(batch ? { batch } : {}) },
    effect: { targets: effect.targets ?? [], steps: effect.steps ?? [], ...(effect.modes ? { modes: effect.modes } : {}) },
    ...rest,
  };
}

const you = { ref: 'you' } as const;
const t0 = (): TargetSpec => ({ ...targetPlayer });
const gain1 = { op: 'gainLife', who: you, amount: 1 } as const;

export const creatureDies: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
export const entersSelf: EventPattern = { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' };

function creature(name: string, pt: [string, string], abilities: AbilityDef[], cost = '{1}', type = 'Creature — Test'): CardDef {
  return synth({ name, cost, type, pt, abilities });
}

/** CR 603.10a: "Whenever ~ or another creature dies, target player loses 1 life and you gain 1 life." */
export const bloodArtist = (): CardDef => creature('Test Blood Artist', ['0', '1'], [
  trig('Whenever ~ or another creature dies, target player loses 1 life and you gain 1 life.', [creatureDies], {
    targets: [t0()], steps: [{ op: 'loseLife', who: { ref: 'target', id: 't0' }, amount: 1 }, gain1],
  }),
]);

/** CR 603.6a: "When ~ enters, it deals 4 damage to target creature." */
export const flametongue = (): CardDef => creature('Test Flametongue', ['4', '2'], [
  trig('When ~ enters, it deals 4 damage to target creature.', [entersSelf], {
    targets: [{ ...targetCreature, id: 't0' }], steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 4 }],
  }),
], '{R}');

/** CR 607.2a: Fiend Hunter, the two linked abilities of the race. */
export const fiendHunter = (): CardDef => creature('Test Fiend Hunter', ['1', '3'], [
  trig('When ~ enters, you may exile another target creature.', [entersSelf], {
    targets: [{ ...targetCreature, id: 't0', filter: { types: ['Creature'], other: true }, text: 'another target creature' }],
    steps: [{ op: 'may', who: you, do: [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, link: 'exiled' }] }],
  }),
  trig('When ~ leaves the battlefield, return the exiled card to the battlefield under its owner\'s control.', [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }], {
    steps: [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'battlefield', controller: 'owner' } }],
  }),
], '{1}{W}');

/** CR 400.7e: an Aura-like enchantment: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." (Rancor). */
export const rancor = (): CardDef => synth({
  name: 'Test Rancor', cost: '{G}', type: 'Enchantment',
  abilities: [trig('When ~ is put into a graveyard from the battlefield, return ~ to its owner\'s hand.', [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }], {
    steps: [{ op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'hand' } }],
  })],
});

/** CR 603.2d: "If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time." */
export const panharmonicon = (): CardDef => synth({
  name: 'Test Panharmonicon', cost: '{3}', type: 'Artifact',
  abilities: [{
    kind: 'static', text: 'If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
    effects: [{ s: 'triggerMod', cause: { ev: 'zoneChange', subject: { types: ['Artifact', 'Creature'] }, to: 'battlefield' }, abilitiesOf: { controller: 'you' }, additional: 1 }],
  }],
});

/** CR 603.6a: "Whenever another creature enters, you gain 1 life." (Soul Warden). */
export const soulWarden = (name = 'Test Soul Warden'): CardDef => creature(name, ['1', '1'], [
  trig('Whenever another creature enters, you gain 1 life.', [{ ev: 'zoneChange', subject: { types: ['Creature'], other: true }, to: 'battlefield' }], { steps: [gain1] }),
]);

/** CR 603.2c: "Whenever one or more creatures die, you gain 1 life." */
export const batchWatcher = (): CardDef => synth({
  name: 'Test Batch Watcher', cost: '{1}', type: 'Enchantment',
  abilities: [trig('Whenever one or more creatures die, you gain 1 life.', [creatureDies], { steps: [gain1] }, { batch: true })],
});

/** CR 603.2c: "Whenever a land is put into a graveyard from the battlefield, you gain 1 life." (once per land). */
export const landWatcher = (): CardDef => synth({
  name: 'Test Land Watcher', cost: '{1}', type: 'Enchantment',
  abilities: [trig('Whenever a land is put into a graveyard from the battlefield, you gain 1 life.', [{ ev: 'zoneChange', subject: { types: ['Land'] }, from: 'battlefield', to: 'graveyard' }], { steps: [gain1] })],
});

/** CR 603.2b: "At the beginning of your upkeep, you gain 1 life." */
export const upkeepGainer = (name = 'Test Upkeep Gainer'): CardDef => synth({
  name, cost: '{1}', type: 'Enchantment',
  abilities: [trig('At the beginning of your upkeep, you gain 1 life.', [{ ev: 'step', step: 'upkeep', whose: 'you' }], { steps: [gain1] })],
});

/** CR 603.4: "Whenever you gain life, if you control a creature, draw a card." (an intervening if on a battlefield fact). */
export const interveningDrawer = (): CardDef => synth({
  name: 'Test Intervening Drawer', cost: '{1}', type: 'Enchantment',
  abilities: [trig('At the beginning of your upkeep, if ~ is tapped, you gain 1 life.', [{ ev: 'step', step: 'upkeep', whose: 'you' }], { steps: [gain1] }, {
    interveningIf: { cond: 'matches', object: { ref: 'self' }, filter: { tapped: true } },
  })],
});

/** CR 603.2h: "Whenever a creature enters, you gain 1 life. Do this only once each turn." */
export const onceEachTurn = (): CardDef => synth({
  name: 'Test Once Each Turn', cost: '{1}', type: 'Enchantment',
  abilities: [trig('Whenever a creature enters, you gain 1 life. Do this only once each turn.', [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }], { steps: [gain1] }, { limit: { per: 'turn', max: 1 } })],
});

/** CR 603.3c: a modal trigger: "At the beginning of your end step, choose one -- target player gains 3 life; or target creature gets +1/+1; or you draw a card." */
export const modalTrigger = (): CardDef => synth({
  name: 'Test Modal Trigger', cost: '{1}', type: 'Enchantment',
  abilities: [trig('At the beginning of your end step, choose one --', [{ ev: 'step', step: 'end', whose: 'you' }], {
    modes: {
      min: 1, max: 1,
      options: [
        { text: 'Target player gains 3 life.', program: { targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }], steps: [{ op: 'gainLife', who: { ref: 'target', id: 't0' }, amount: 3 }] } },
        { text: 'Target creature gets +1/+1.', program: { targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }], steps: [] } },
        { text: 'You draw a card.', program: { targets: [], steps: [{ op: 'draw', who: you, count: 1 }] } },
      ],
    },
  })],
});

/** CR 603.3d: a trigger with a required target that may have no legal choice: "At the beginning of your upkeep, destroy target artifact." */
export const artifactHater = (): CardDef => synth({
  name: 'Test Artifact Hater', cost: '{1}', type: 'Enchantment',
  abilities: [trig('At the beginning of your upkeep, destroy target artifact.', [{ ev: 'step', step: 'upkeep', whose: 'you' }], {
    targets: [{ id: 't0', kind: 'object', filter: { types: ['Artifact'] }, min: 1, max: 1, text: 'target artifact' }], steps: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }],
  })],
});

/** CR 603.8: "When you control no creatures, sacrifice ~." */
export const stateTrigger = (): CardDef => synth({
  name: 'Test State Trigger', cost: '{1}', type: 'Enchantment',
  abilities: [trig('When you control no creatures, sacrifice ~.', [{ ev: 'state', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } }], {
    steps: [{ op: 'sacrifice', what: { ref: 'self' } }],
  })],
});

/** An attack trigger: "Whenever ~ attacks, you gain 1 life." */
export const attackTrigger = (): CardDef => creature('Test Attack Trigger', ['2', '2'], [
  trig('Whenever ~ attacks, you gain 1 life.', [{ ev: 'attacks', attacker: { self: true } }], { steps: [gain1] }),
]);

/** "Whenever ~ deals combat damage to a player, you gain 1 life." */
export const damageTrigger = (): CardDef => creature('Test Damage Trigger', ['2', '2'], [
  trig('Whenever ~ deals combat damage to a player, you gain 1 life.', [{ ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }], { steps: [gain1] }),
]);

/** "Whenever you cast a spell, you gain 1 life." */
export const castWatcher = (): CardDef => synth({
  name: 'Test Cast Watcher', cost: '{1}', type: 'Enchantment',
  abilities: [trig('Whenever you cast a spell, you gain 1 life.', [{ ev: 'cast', player: 'you' }], { steps: [gain1] })],
});

/** A Saga-like card: chapter I and II when lore counters reach them (CR 714.2). */
export const saga = (): CardDef => synth({
  name: 'Test Saga', cost: '{1}', type: 'Enchantment — Saga',
  abilities: [{ kind: 'chapter', text: 'I, II -- You gain 1 life.', chapters: [1, 2], effect: { targets: [], steps: [gain1] } }],
});

/** A plain creature to put on the battlefield. */
export const vanilla = (name = 'Test Vanilla', pt: [string, string] = ['2', '2']): CardDef => creature(name, pt, []);

/** A creature with one ordinary trigger on a pattern of your choice, for matcher tests. */
export const watcherOf = (name: string, on: EventPattern[], extra: TriggerExtra = {}): CardDef => synth({
  name, cost: '{1}', type: 'Enchantment', abilities: [trig(`Watches ${name}.`, on, { steps: [gain1] }, extra)],
});

/** CR 603.3c: every mode needs a creature target: with no creature on the battlefield no mode can be chosen. */
export const modalCreatureOnly = (): CardDef => synth({
  name: 'Test Modal Creatures', cost: '{1}', type: 'Enchantment',
  abilities: [trig('At the beginning of your end step, choose one --', [{ ev: 'step', step: 'end', whose: 'you' }], {
    modes: {
      min: 1, max: 1,
      options: [
        { text: 'Target creature gets +1/+1.', program: { targets: [{ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }], steps: [] } },
        { text: 'Destroy target creature.', program: { targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' }], steps: [{ op: 'destroy', what: { ref: 'target', id: 't1' } }] } },
      ],
    },
  })],
});
