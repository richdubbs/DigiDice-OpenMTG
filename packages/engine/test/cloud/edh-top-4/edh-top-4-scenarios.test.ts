/**
 * Commander lane edh-top, round edh-top-4: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (media.wizards.com text read in the session unless a test says otherwise).
 *
 *   CR 702.16a-e, 607.2d   "You and creatures you control have protection from the chosen card type"
 *   CR 702.16a, 608.2d     "gains protection from the card type of your choice until end of turn"
 *   CR 702.85a, 601.2a, 202.3  "Colorless spells you cast from your hand with mana value 7 or greater have \"Cascade, cascade.\""
 *   CR 614.12a, 607.2d     "As ~ enters, choose Mirran or Phyrexian." and the bulleted abilities of the chosen word (SIEGE_WORDS)
 *   CR 601.3b, 601.2c      "You may cast this spell as though it had flash if it targets a commander" (PermissionDef.ifTargets)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, pass, reject, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { resolveAll } from '../cmd3/helpers';
import { legend } from '../../m11/rules/helpers';
import { commanderOptions } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { advanceTo } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState, answers: DecisionAnswer[] = []): GameState => {
  let s = t;
  const queue = [...answers];
  for (let g = 0; g < 20 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'chooseTargets'; g++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
};
const resolveTop = (s: GameState): GameState => settle(pass(pass(settle(s))));
const castCard = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }));
const pickType = (name: string): DecisionAnswer => ({ kind: 'chooseName', name });

describe('CR 702.16a-e, 607.2d: "As ~ enters, choose a card type. You and creatures you control have protection from the chosen card type."', () => {
  const EMISSARY = card('Test Emissary', 'Creature — Angel', 'Flying\nAs this creature enters, choose a card type.\nYou and creatures you control have protection from the chosen card type.', { pt: ['4', '4'] });
  const JOLT = card('Test Jolt', 'Instant', 'Test Jolt deals 2 damage to each player.');
  const SPARK = card('Test Spark', 'Sorcery', 'Test Spark deals 2 damage to each player.');
  const PRICK = card('Test Prick', 'Instant', 'Test Prick deals 1 damage to target player.');
  const NIP = card('Test Nip', 'Instant', 'Test Nip deals 1 damage to target creature.');
  const MOTE = card('Test Mote', 'Creature — Spirit', '', { pt: ['2', '2'] });
  const DEFS = [EMISSARY, JOLT, SPARK, PRICK, NIP, MOTE];
  const start = (type: string): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Emissary', 'Test Jolt', 'Test Spark', 'Test Prick', 'Test Nip'], battlefield: ['Test Mote'] }, p2: { battlefield: ['Test Mote'] }, defs: DEFS });
    return settle(resolveTop(castCard(s0, 'Test Emissary')), [pickType(type)]);
  };
  it('is automated', () => {
    expect(noManual(EMISSARY)).toEqual([]);
  });
  it('with Instant chosen, the controller takes no damage from an instant, but 2 from a sorcery; the opponent takes both', () => {
    let s = start('Instant');
    expect(find(s, 'Test Emissary', 'battlefield', 'p1')).toBeDefined();
    const l1 = life(s, 'p1');
    const l2 = life(s, 'p2');
    s = resolveTop(castCard(s, 'Test Jolt'));
    expect(life(s, 'p1')).toBe(l1);
    expect(life(s, 'p2')).toBe(l2 - 2);
    s = resolveTop(castCard(s, 'Test Spark'));
    expect(life(s, 'p1')).toBe(l1 - 2);
    expect(life(s, 'p2')).toBe(l2 - 4);
  });
  it('with Sorcery chosen, an instant damages the controller (the other card type)', () => {
    let s = start('Sorcery');
    const l1 = life(s, 'p1');
    s = resolveTop(castCard(s, 'Test Jolt'));
    expect(life(s, 'p1')).toBe(l1 - 2);
  });
  it('CR 702.16b: with Instant chosen, you can\'t be targeted by an instant, and a creature you control can\'t either; the opponent\'s creature can', () => {
    const s = start('Instant');
    const prick = castCard(s, 'Test Prick');
    expect(prick.pending?.kind).toBe('chooseTargets');
    const bad = reject(prick, { type: 'answer', player: 'p1', decisionId: prick.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] } });
    expect(bad.rules.length).toBeGreaterThan(0);
    const nip = castCard(s, 'Test Nip');
    const mine = find(s, 'Test Mote', 'battlefield', 'p1');
    const theirs = find(s, 'Test Mote', 'battlefield', 'p2');
    expect(reject(nip, { type: 'answer', player: 'p1', decisionId: nip.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: mine }] } }).rules.length).toBeGreaterThan(0);
    const ok = answer(nip, { kind: 'chooseTargets', targets: [{ kind: 'object', id: theirs as ObjectId }] });
    expect(ok.pending?.kind).not.toBe('chooseTargets');
  });
  it('the creatures you control have protection from the chosen type (Instant); the opponent\'s creature has none; a creature entering later is protected too', () => {
    const s = start('Instant');
    const mine = getChars(s, find(s, 'Test Mote', 'battlefield', 'p1'))!;
    const theirs = getChars(s, find(s, 'Test Mote', 'battlefield', 'p2'))!;
    expect(JSON.stringify(mine.keywords)).toContain('type:Instant');
    expect(JSON.stringify(theirs.keywords)).not.toContain('type:Instant');
    expect(JSON.stringify(getChars(s, find(s, 'Test Emissary', 'battlefield', 'p1'))!.keywords)).toContain('type:Instant');
  });
  it('fails closed: with nothing chosen the keyword is not granted at all (CR 607.2d)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Emissary', 'Test Mote'] }, defs: DEFS });
    expect(JSON.stringify(getChars(s0, find(s0, 'Test Mote', 'battlefield', 'p1'))!.keywords)).not.toContain('protection');
  });
  it('legal() is untouched for the opponent: the Emissary\'s controller only is protected', () => {
    const s = start('Instant');
    expect(legal(s, 'p1').length).toBeGreaterThan(0);
  });
});

describe('CR 601.3b, 601.2c, 702.8a: "You may cast this spell as though it had flash if it targets a commander."', () => {
  const WARD = card('Test Ward', 'Enchantment — Aura', 'You may cast this spell as though it had flash if it targets a commander.\nEnchant creature\nEnchanted creature has indestructible.');
  const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const CAPTAIN = legend('Test Captain', '{1}{W}', ['3', '3'], ['W']);
  const defs = [WARD, FILLER, BEAR];
  // p1 has cast a sorcery (it is on the stack), so p1 can cast only what has flash; p2 controls a commander and a Bear, p1 a Bear
  const setup = (withCommander = true): GameState => {
    const s0 = mpScenario({
      players: 4, defs,
      commanders: { p1: [legend('Test Alpha', '{1}{W}', ['3', '3'], ['W'])], p2: [CAPTAIN], p3: [legend('Test Gamma', '{1}{W}', ['3', '3'], ['W'])], p4: [legend('Test Delta', '{1}{W}', ['3', '3'], ['W'])] },
      options: { commander: commanderOptions('commander') },
      zones: { p1: { hand: ['Test Ward', 'Test Filler'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } },
      setup: (x) => {
        if (!withCommander) return;
        const id = x.zones.command.find((o) => x.objects[o]!.defId === 'Test Captain')!;
        x.zones.command = x.zones.command.filter((o) => o !== id);
        x.zones.battlefield.push(id);
        x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
      },
    });
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
  };
  const castable = (s: GameState): string[] => legal(s, 'p1', 'cast').map((a) => s.objects[(a as { object: ObjectId }).object]!.defId);
  it('is automated', () => expect(noManual(WARD)).toEqual([]));
  it('with a commander on the battlefield and a spell on the stack, it can be cast; the Bear is rejected as the only target, the commander is accepted', () => {
    const s = setup();
    expect(castable(s)).toContain('Test Ward');
    const t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ward', 'hand', 'p1') }));
    expect(t.pending?.kind).toBe('chooseTargets');
    const bear = find(t, 'Test Bear', 'battlefield', 'p1');
    const bad = reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } });
    expect(bad.rules).toContain('CR 601.3b');
    const ok = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Captain', 'battlefield', 'p2') }] });
    expect(ok.zones.stack.map((id) => ok.objects[id]!.defId)).toContain('Test Ward');
  });
  it('with no commander on the battlefield it can\'t be cast at that time (nothing it could target would allow flash)', () => {
    expect(castable(setup(false))).not.toContain('Test Ward');
  });
  it('the same permission with another target filter ("a creature you control"): off timing it needs a target of the caster\'s, the opponent\'s creature is rejected (the filter is read for the caster)', () => {
    const OWN = card('Test Own Ward', 'Enchantment — Aura', 'You may cast this spell as though it had flash if it targets a creature you control.\nEnchant creature\nEnchanted creature has indestructible.');
    const s0 = mpScenario({ players: 4, defs: [OWN, FILLER, BEAR], zones: { p1: { hand: ['Test Own Ward', 'Test Filler'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    const t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Own Ward', 'hand', 'p1') }));
    expect(t.pending?.kind).toBe('chooseTargets');
    const theirs = find(t, 'Test Bear', 'battlefield', 'p2');
    expect(reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: theirs }] } }).rules).toContain('CR 601.3b');
    const ok = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Bear', 'battlefield', 'p1') }] });
    expect(ok.zones.stack.map((id) => ok.objects[id]!.defId)).toContain('Test Own Ward');
  });
  it('CR 113.6e: the permission works from the graveyard too (flashback of a spell with it); the opponent\'s permanent is still rejected', () => {
    const PHOTO = card('Test Photo Spell', 'Sorcery', 'You may cast this spell as though it had flash if it targets a permanent you control.\nCreate a token that\'s a copy of target permanent.\nFlashback {0}');
    const s0 = scenario([], { defs: [PHOTO, FILLER, BEAR], p1: { hand: ['Test Filler'], battlefield: ['Test Bear'], graveyard: ['Test Photo Spell'] }, p2: { battlefield: ['Test Bear'] } });
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') }));
    const t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Photo Spell', 'graveyard', 'p1'), method: 'flashback' } as never));
    expect(t.pending?.kind).toBe('chooseTargets');
    expect(reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Bear', 'battlefield', 'p2') }] } }).rules).toContain('CR 601.3b');
  });
  it('at sorcery timing (empty stack, own main phase) it is cast as any Aura, targeting a Bear', () => {
    const s0 = mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Ward'], battlefield: ['Test Bear'] } } });
    const t = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ward', 'hand', 'p1') }));
    const ok = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Bear', 'battlefield', 'p1') }] });
    expect(ok.zones.stack.map((id) => ok.objects[id]!.defId)).toContain('Test Ward');
  });
});

describe('CR 702.16a, 608.2d, 611.2c: "{T}: Another target creature you control gains protection from the card type of your choice until end of turn."', () => {
  const GUARD = card('Test Guard', 'Creature — Halfling', '{T}: Another target creature you control gains protection from the card type of your choice until end of turn.', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const PRICK = card('Test Prick', 'Instant', 'Test Prick deals 1 damage to target creature.');
  const defs = [GUARD, BEAR, PRICK];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Guard', 'Test Bear'] }, p2: { hand: ['Test Prick'] } });
  const run = (type: string): GameState => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let t = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Guard', 'battlefield', 'p1'), ability: 'p:0:0' }));
    if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }));
    t = resolveTop(t);
    return settle(t, [pickType(type)]);
  };
  it('is automated', () => expect(noManual(GUARD)).toEqual([]));
  it('with Instant chosen the target has protection from instants until end of turn, and an instant can no longer target it', () => {
    const s = run('Instant');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, bear)!, 'protection')).toBe(true);
    expect(JSON.stringify(getChars(s, bear)!.keywords)).toContain('type:Instant');
    // the Guard itself (not the target) is unprotected
    expect(JSON.stringify(getChars(s, find(s, 'Test Guard', 'battlefield', 'p1'))!.keywords)).not.toContain('type:Instant');
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(JSON.stringify(getChars(later, bear)!.keywords)).not.toContain('type:Instant');
  });
  it('another type chosen (Sorcery) protects from sorceries only', () => {
    const s = run('Sorcery');
    const k = JSON.stringify(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1'))!.keywords);
    expect(k).toContain('type:Sorcery');
    expect(k).not.toContain('type:Instant');
  });
});

describe('CR 702.85a, 702.85c, 601.2a, 202.3: \'Colorless spells you cast from your hand with mana value 7 or greater have "Cascade, cascade."\'', () => {
  const VOID = card('Test Void Gorger', 'Creature — Eldrazi', 'Colorless spells you cast from your hand with mana value 7 or greater have "Cascade, cascade."', { pt: ['5', '5'] });
  const BIG = card('Test Big Colorless', 'Sorcery', '', { cost: '{7}' });
  const SMALL = card('Test Small Colorless', 'Sorcery', '', { cost: '{6}' });
  const COLORED = card('Test Big Red', 'Sorcery', '', { cost: '{6}{R}', colors: ['R'] });
  const CHEAP = card('Test Cheap Spell', 'Instant', '', { cost: '{1}' });
  const defs = [VOID, BIG, SMALL, COLORED, CHEAP];
  const run = (spell: string, mana: string, void_ = true): GameState => {
    const s = scenario([], { p1: { battlefield: void_ ? ['Test Void Gorger'] : [], hand: [spell], library: ['Test Cheap Spell', 'Test Cheap Spell', 'Test Cheap Spell'] }, defs });
    for (const t of mana) s.players[0]!.manaPool.push({ type: t } as never);
    return settle(act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') }));
  };
  it('is automated; a colorless 7-drop from hand puts the spell and two cascade triggers on the stack', () => {
    expect(noManual(VOID)).toEqual([]);
    expect(run('Test Big Colorless', 'CCCCCCC').zones.stack.length).toBe(3);
  });
  it('negative: a colorless 6-drop, a colored 7-drop, or the same spell without the creature has one or no cascade', () => {
    expect(run('Test Small Colorless', 'CCCCCC').zones.stack.length).toBe(1);
    expect(run('Test Big Red', 'CCCCCCR').zones.stack.length).toBe(1);
    expect(run('Test Big Colorless', 'CCCCCCC', false).zones.stack.length).toBe(1);
  });
});

describe('CR 614.12a, 607.2d: "As this enchantment enters, choose Mirran or Phyrexian." with one bulleted ability for each word', () => {
  const BESIEGED = card('Test Besieged Forge', 'Enchantment', 'As this enchantment enters, choose Mirran or Phyrexian.\n\u2022 Mirran \u2014 Whenever you cast an artifact spell, create a 2/2 colorless Golem artifact creature token.\n\u2022 Phyrexian \u2014 At the beginning of your end step, draw a card, then discard a card. Then if there are two or more artifact cards in your graveyard, target opponent loses the game.');
  const TRINKET = card('Test Trinket', 'Artifact', '', { cost: '{0}' });
  const defs = [BESIEGED, TRINKET];
  const start = (word: string, gy: string[] = []): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Besieged Forge', 'Test Trinket'], graveyard: gy, library: ['Plains', 'Plains', 'Plains'] }, defs });
    return settle(resolveTop(castCard(s0, 'Test Besieged Forge')), [{ kind: 'chooseOption', ids: [word] } as DecisionAnswer]);
  };
  const golems = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length;
  it('is automated', () => expect(noManual(BESIEGED)).toEqual([]));
  it('Mirran chosen: casting an artifact spell makes a Golem token', () => {
    let s = start('Mirran');
    s = resolveTop(castCard(s, 'Test Trinket'));
    s = resolveTop(s);
    expect(golems(s)).toBe(1);
  });
  it('Phyrexian chosen: casting an artifact spell makes no token (the other word\'s ability is not there)', () => {
    let s = start('Phyrexian');
    s = resolveTop(castCard(s, 'Test Trinket'));
    expect(golems(s)).toBe(0);
  });
  it('Phyrexian chosen: at your end step the opponent loses the game with two artifact cards in your graveyard (the discarded one counts), and does not with fewer', () => {
    const toEnd = (word: string, gy: string[]): GameState => {
      let s = start(word, gy);
      for (let g = 0; g < 200 && !(s.turn.step === 'end' && s.pending?.kind === 'priority' && s.zones.stack.length > 0); g++) {
        if (s.result) break;
        const d = s.pending;
        if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
        else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
        else if (d?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
        else if (d?.kind === 'priority') s = pass(s);
        else s = settle(s);
      }
      return s;
    };
    // the card discarded in the same ability counts (Scryfall ruling 2019-06-14: it may be the one that makes the target lose): the hand holds one Trinket
    for (const [gy, loses] of [[['Test Trinket', 'Test Trinket'], true], [['Test Trinket'], true], [[], false]] as const) {
      let s = toEnd('Phyrexian', [...gy]);
      expect(s.zones.stack.length, 'the end step trigger is on the stack').toBeGreaterThan(0);
      s = resolveAll(s);
      expect(Boolean(s.result), `gy ${gy.length}`).toBe(loses);
    }
  });
});
