/**
 * FAST5X-4: speed (Aetherdrift) played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 704.5aa, 702.179a   a player who controls a permanent with start your engines! and has no speed gets speed 1 (state-based action)
 *   CR 702.179b           a player without such a permanent has no speed; speed stays when the permanent leaves
 *   CR 702.179d, 603.4    "Whenever one or more opponents lose life during your turn, if your speed is less than 4, your speed increases by 1. This ability
 *                         triggers only once each turn." (no source; intervening "if" checked when it triggers and as it resolves)
 *   CR 702.179e-f         max speed is speed 4; no speed counts as 0 ("where X is your speed")
 *   CR 702.178a-b, 113.6c "Max speed -- [Ability]": as long as your speed is 4 this object has [Ability], from the zones that ability names (the graveyard)
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, compileCard, hasKeyword, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { toDeclareAttackers, toStep, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full';

const RACER = card('Test Racer', 'Creature — Goblin', 'Start your engines!\nMax speed — This creature has double strike.', ['2', '2']);
const PINGER = card('Test Pinger', 'Artifact', '{0}: Each opponent loses 1 life.');
const SELF_PING = card('Test Self Pinger', 'Artifact', '{0}: You lose 1 life.');
const SCOUT = card('Test Scout', 'Creature — Cat Scout', 'Start your engines!\nMax speed — {1}, Exile this card from your graveyard: Draw a card.', ['2', '1'], '{1}');
const SHRINE = card('Test Shrine', 'Artifact', 'Start your engines!\nMax speed — At the beginning of your end step, create a 2/2 black Zombie creature token.');
const RACEWAY = card('Test Raceway', 'Land', 'Start your engines!\n{T}: Add {C}.\nMax speed — {T}: Add {C}{C}.');
const BOARD = card('Test Board', 'Artifact', 'Start your engines!\nMax speed — Spells you cast cost {1} less to cast.');
const TOME = card('Test Tome', 'Artifact', 'Start your engines!\n{0}: Draw a card.\nMax speed — If you would draw a card, draw two cards instead.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const GOD = card('Test God', 'Legendary Creature — God', 'Start your engines!\nTest God can\'t attack or block unless you have max speed.', ['5', '3']);
const SNARE = card('Test Snare', 'Enchantment', 'Start your engines!\n{0}, Sacrifice this enchantment: It deals 2 damage to each player who doesn\'t have max speed.');
const CAPTAIN = card('Test Captain', 'Creature — Human', 'Start your engines!\nOther creatures you control get +X/+0, where X is your speed.\nNoncreature spells you cast cost {X} less to cast, where X is your speed.', ['3', '3']);
const PATH = card('Test Path', 'Enchantment', 'Start your engines!\n{0}, Sacrifice this enchantment: Search your library for up to X basic land cards, where X is your speed. Put those cards onto the battlefield tapped, then shuffle.');
const DEFS = [RACER, PINGER, SELF_PING, SCOUT, SHRINE, RACEWAY, BOARD, TOME, BEAR, GOD, SNARE, CAPTAIN, PATH];

const speed = (s: GameState, p: string): number | undefined => s.designations.speed?.[p];
const setSpeed = (s: GameState, p: string, n: number): GameState => tweak(s, (t) => { t.designations.speed = { ...(t.designations.speed ?? {}), [p]: n }; });
/** Activate the (non-mana) ability of a permanent and let it resolve (and whatever triggers then), back to p1's priority with an empty stack. */
function ping(s0: GameState, name: string): GameState {
  const id = find(s0, name, 'battlefield', 'p1');
  const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no ability of ${name}`);
  let s = act(s0, la.action);
  for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = pass(pass(s));
  return s;
}

describe('the speed cards compile to full automation', () => {
  it('start your engines! and the max speed lines are automated', () => {
    for (const d of [RACER, SCOUT, SHRINE, RACEWAY, BOARD]) expect(automated(d), d.name).toBe(true);
  });
});

describe('CR 704.5aa, 702.179a-b: speed begins at 1', () => {
  it('a player who controls a permanent with start your engines! gets speed 1; the other player has no speed', () => {
    const s = scenario([], { p1: { battlefield: ['Test Racer'] }, defs: DEFS });
    expect(speed(s, 'p1')).toBe(1);
    expect(speed(s, 'p2')).toBeUndefined();
    expect(s.log.some((l) => /speed becomes 1/.test(l.text) && l.rules?.includes('CR 704.5aa'))).toBe(true);
  });
  it('speed does not go away when the permanent leaves (CR 702.179b)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Racer'] }, defs: DEFS });
    const gone = tweak(s0, (t) => {
      const id = find(t, 'Test Racer', 'battlefield', 'p1');
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.zones.graveyard['p1']!.push(id);
      t.objects[id]!.zone = 'graveyard';
    });
    expect(speed(pass(pass(gone)), 'p1')).toBe(1);
  });
});

describe('CR 702.179d: the inherent triggered ability of speed', () => {
  it('an opponent losing life during your turn increases your speed by 1, only once each turn', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Racer', 'Test Pinger'] }, defs: DEFS });
    const once = ping(s0, 'Test Pinger');
    expect(life(once, 'p2')).toBe(19);
    expect(speed(once, 'p1')).toBe(2);
    expect(once.log.some((l) => /speed ability triggers/.test(l.text) && l.rules?.includes('CR 702.179d'))).toBe(true);
    const twice = ping(once, 'Test Pinger');
    expect(life(twice, 'p2')).toBe(18);
    expect(speed(twice, 'p1')).toBe(2); // "This ability triggers only once each turn."
  });
  it('it triggers again on a later turn of the same player', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Racer', 'Test Pinger'] }, defs: DEFS });
    const t1 = ping(s0, 'Test Pinger');
    const s = advanceTo(t1, 3, 'main1'); // p1's next turn
    expect(speed(s, 'p1')).toBe(2);
    expect(speed(ping(s, 'Test Pinger'), 'p1')).toBe(3);
  });
  it('life you lose yourself does not trigger it, and the non-active player\'s ability does not trigger ("during your turn")', () => {
    const s0 = setSpeed(scenario([], { p1: { battlefield: ['Test Self Pinger'] }, defs: DEFS }), 'p2', 1);
    const s = ping(setSpeed(s0, 'p1', 1), 'Test Self Pinger');
    expect(life(s, 'p1')).toBe(19);
    expect(speed(s, 'p1')).toBe(1);
    expect(speed(s, 'p2')).toBe(1);
  });
  it('a player with no speed has no such ability', () => {
    const s = ping(scenario([], { p1: { battlefield: ['Test Pinger'] }, defs: DEFS }), 'Test Pinger');
    expect(life(s, 'p2')).toBe(19);
    expect(speed(s, 'p1')).toBeUndefined();
  });
  it('CR 603.4: at speed 4 it does not trigger (and speed never goes beyond 4 this way)', () => {
    const s0 = setSpeed(scenario([], { p1: { battlefield: ['Test Racer', 'Test Pinger'] }, defs: DEFS }), 'p1', 4);
    const s = ping(s0, 'Test Pinger');
    expect(speed(s, 'p1')).toBe(4);
    expect(s.log.some((l) => /speed ability triggers/.test(l.text))).toBe(false);
    expect(s.designations.speedTriggered?.['p1']).toBeUndefined();
  });
  it('CR 603.4: the intervening "if" is checked again as it resolves', () => {
    const s0 = setSpeed(scenario([], { p1: { battlefield: ['Test Racer', 'Test Pinger'] }, defs: DEFS }), 'p1', 3);
    const id = find(s0, 'Test Pinger', 'battlefield', 'p1');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === id)!;
    let s = pass(pass(act(s0, la.action))); // the pinger's ability resolves; the speed ability is put on the stack
    expect(s.zones.stack.length).toBe(1);
    s = pass(pass(setSpeed(s, 'p1', 4)));
    expect(s.zones.stack.length).toBe(0);
    expect(speed(s, 'p1')).toBe(4);
    expect(s.log.some((l) => /its "if" condition is no longer true/.test(l.text))).toBe(true);
  });
});

describe('CR 702.178a: "Max speed -- [Ability]" is had only as long as your speed is 4', () => {
  it('a static ability: double strike at speed 4, not at 3', () => {
    const s3 = setSpeed(scenario([], { p1: { battlefield: ['Test Racer'] }, defs: DEFS }), 'p1', 3);
    const id = find(s3, 'Test Racer', 'battlefield', 'p1');
    expect(hasKeyword(charsOfObject(s3, s3.objects[id]!), 'double strike')).toBe(false);
    const s4 = setSpeed(s3, 'p1', 4);
    expect(hasKeyword(charsOfObject(s4, s4.objects[id]!), 'double strike')).toBe(true);
  });
  it('the opponent\'s speed does not count', () => {
    const s = setSpeed(setSpeed(scenario([], { p1: { battlefield: ['Test Racer'] }, defs: DEFS }), 'p1', 1), 'p2', 4);
    const id = find(s, 'Test Racer', 'battlefield', 'p1');
    expect(hasKeyword(charsOfObject(s, s.objects[id]!), 'double strike')).toBe(false);
  });
  it('CR 702.178b: an ability that works from the graveyard is had there ("{1}, Exile this card from your graveyard: Draw a card.")', () => {
    const s3 = setSpeed(scenario([], { p1: { graveyard: ['Test Scout'], battlefield: ['Plains'] }, defs: DEFS }), 'p1', 3);
    const id = find(s3, 'Test Scout', 'graveyard', 'p1');
    expect(legal(s3, 'p1', 'activate').some((a) => a.object === id)).toBe(false);
    const s4 = setSpeed(s3, 'p1', 4);
    const la = legal(s4, 'p1', 'activate').find((a) => a.object === id);
    expect(la).toBeDefined();
    let s = act(s4, la!.action);
    for (let i = 0; i < 6 && s.pending?.kind === 'payCost'; i++) s = answer(s, { kind: 'payCost', auto: true });
    const hand = zoneNames(s4, 'hand', 'p1').length;
    s = pass(pass(s));
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand + 1);
    expect(s.zones.exile.map((x) => s.objects[x]!.defId)).toContain('Test Scout');
  });
  it('the ability is not had on the battlefield (it works only from the graveyard)', () => {
    const s = setSpeed(scenario([], { p1: { battlefield: ['Test Scout'] }, defs: DEFS }), 'p1', 4);
    const id = find(s, 'Test Scout', 'battlefield', 'p1');
    expect(legal(s, 'p1', 'activate').some((a) => a.object === id)).toBe(false);
  });
  it('a triggered ability: "At the beginning of your end step, create a 2/2 black Zombie creature token."', () => {
    const tokens = (s: GameState): number => s.zones.battlefield.filter((x) => s.objects[x]!.kind === 'token').length;
    const slow = toStep(setSpeed(scenario([], { p1: { battlefield: ['Test Shrine'] }, defs: DEFS }), 'p1', 3), 'end');
    expect(tokens(pass(pass(slow)))).toBe(0);
    const fast = toStep(setSpeed(scenario([], { p1: { battlefield: ['Test Shrine'] }, defs: DEFS }), 'p1', 4), 'end');
    let s = fast;
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = pass(pass(s));
    expect(tokens(s)).toBe(1);
  });
  it('a cost modifier: "Spells you cast cost {1} less to cast." (CR 601.2f)', () => {
    const tryCast = (s: GameState): GameState | null => {
      try {
        let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') });
        for (let i = 0; i < 4 && t.pending?.kind === 'payCost'; i++) t = answer(t, { kind: 'payCost', auto: true });
        return t.zones.stack.length === 1 ? t : null;
      } catch { return null; }
    };
    const s3 = setSpeed(scenario([], { p1: { battlefield: ['Test Board'], hand: ['Test Bear'] }, defs: DEFS }), 'p1', 3);
    expect(tryCast(s3)).toBeNull(); // {1} and no mana
    expect(tryCast(setSpeed(s3, 'p1', 4))).not.toBeNull(); // {1} less: free
  });
  it('a replacement effect: "If you would draw a card, draw two cards instead." (CR 614.1a)', () => {
    const hand = (s: GameState): number => zoneNames(s, 'hand', 'p1').length;
    const s3 = setSpeed(scenario([], { p1: { battlefield: ['Test Tome', 'Test Pinger'] }, defs: DEFS }), 'p1', 3);
    const drawn = (s0: GameState): number => {
      const id = find(s0, 'Test Tome', 'battlefield', 'p1');
      const la = legal(s0, 'p1', 'activate').find((a) => a.object === id)!;
      return hand(pass(pass(act(s0, la.action)))) - hand(s0);
    };
    expect(drawn(s3)).toBe(1);
    expect(drawn(setSpeed(s3, 'p1', 4))).toBe(2);
  });
  it('a mana ability: "{T}: Add {C}{C}."', () => {
    const manaOf = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Raceway', 'battlefield', 'p1') && a.isMana).length;
    const s3 = setSpeed(scenario([], { p1: { battlefield: ['Test Raceway'] }, defs: DEFS }), 'p1', 3);
    const s4 = setSpeed(s3, 'p1', 4);
    expect(manaOf(s4)).toBe(manaOf(s3) + 1);
  });
});

describe('CR 702.179e-f: the template shapes that read speed', () => {
  it('the template shapes are automated', () => {
    for (const d of [TOME, GOD, SNARE, CAPTAIN, PATH]) expect(automated(d), d.name).toBe(true);
  });
  it('"~ can\'t attack or block unless you have max speed" (CR 508.1c)', () => {
    const attackers = (s: GameState): string[] => {
      const d = toDeclareAttackers(s).pending as { candidates: { id: string }[] };
      return d.candidates.map((c) => c.id);
    };
    const s3 = setSpeed(scenario([], { p1: { battlefield: ['Test God', 'Test Bear'] }, defs: DEFS }), 'p1', 3);
    const god = find(s3, 'Test God', 'battlefield', 'p1');
    expect(attackers(s3)).not.toContain(god);
    expect(attackers(setSpeed(s3, 'p1', 4))).toContain(god);
  });
  it('"it deals 2 damage to each player who doesn\'t have max speed" (checked for each player as it resolves)', () => {
    const s0 = setSpeed(setSpeed(scenario([], { p1: { battlefield: ['Test Snare'] }, defs: DEFS }), 'p1', 4), 'p2', 2);
    const s = ping(s0, 'Test Snare');
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(18);
    const both = ping(setSpeed(s0, 'p1', 1), 'Test Snare');
    expect(life(both, 'p1')).toBe(18);
    expect(life(both, 'p2')).toBe(18);
  });
  it('"Other creatures you control get +X/+0, where X is your speed" follows the speed; no speed is 0 (CR 702.179f, 611.3a)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Captain', 'Test Bear'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const cap = find(s0, 'Test Captain', 'battlefield', 'p1');
    const power = (s: GameState, id: string): number | undefined => Number(charsOfObject(s, s.objects[id]!).power);
    expect(speed(s0, 'p1')).toBe(1);
    expect(power(s0, bear)).toBe(3);
    expect(power(setSpeed(s0, 'p1', 3), bear)).toBe(5);
    expect(power(setSpeed(s0, 'p1', 3), cap)).toBe(3); // "other"
  });
  it('"Search your library for up to X basic land cards, where X is your speed" may find up to that many (CR 107.3, 608.2h)', () => {
    const s0 = setSpeed(scenario([], { p1: { battlefield: ['Test Path'] }, defs: DEFS }), 'p1', 3);
    const id = find(s0, 'Test Path', 'battlefield', 'p1');
    let s = act(s0, legal(s0, 'p1', 'activate').find((a) => a.object === id)!.action);
    s = pass(pass(s));
    const d = s.pending as { kind: string; max?: number; min?: number };
    expect(d.kind).not.toBe('priority');
    expect(d.max).toBe(3);
  });
});
