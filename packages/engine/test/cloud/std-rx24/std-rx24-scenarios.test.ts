/**
 * std-rx24 (wave 2, EDH lane rx24): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 122.1f              "as long as an opponent has three or more poison counters" (a static), "activate only if ..." (an activation restriction), "if defending
 *                          player is poisoned" (an intervening "if"): two poison counters are not enough, three are; zero is not poisoned, one is
 *   CR 702.89a, 702.12b    umbra armor: the enchanted creature is not destroyed, its damage is removed and the Aura is destroyed; an indestructible creature is not
 *                          destroyed at all, so the Aura stays; another creature is destroyed as usual
 *   CR 702.133a            jump-start: cast from the graveyard by discarding a card, then exiled; cast from the hand it goes to the graveyard
 *   CR 702.72a, 607.2k     champion: the championed Goblin is exiled and comes back when the champion leaves; with nothing to champion, the champion is sacrificed
 *   CR 614.12a, 122.1b     "enters with your choice of a trample counter or a menace counter on it": one counter of the chosen kind only
 *   CR 614.10a, 502.1      "you skip your next untap step": the land stays tapped in that untap step and untaps in the one after
 */
import { describe, expect, it } from 'vitest';
import { getChars, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { act, advanceTo, find, legal, scenario } from '../../m3/scenario';
import { attackWith, card, cast, counters, full, inYard, pt, resolveAll, settle } from '../cmd3/helpers';
import { toDeclareAttackers } from '../../m4/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);
const withPoison = (s0: GameState, n: number, player = 'p2'): GameState => {
  const s = clone(s0);
  s.players.find((p) => p.id === player)!.poison = n;
  return s;
};
const exiled = (s: GameState, defId: string): boolean => s.zones.exile.some((id) => s.objects[id]!.defId === defId);

const BRUTE = card('Test Brute', 'Creature — Horror', 'As long as an opponent has three or more poison counters, this creature gets +2/+2.', ['2', '2']);
const IDOL = card('Test Idol', 'Artifact', '{T}: You gain 1 life. Activate only if an opponent has three or more poison counters.');
const RATLING = card('Test Ratling', 'Creature — Rat', 'Whenever this creature attacks, if defending player is poisoned, it gets +1/+1 until end of turn.', ['2', '2']);
const SHELL = card('Test Shell', 'Enchantment — Aura', 'Enchant creature\nUmbra armor');
const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
const RECALL = card('Test Recall', 'Sorcery', 'You gain 2 life.\nJump-start');
const CHAMP = card('Test Champ', 'Creature — Goblin Warrior', 'Champion a Goblin', ['4', '4']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const APE = card('Test Ape', 'Creature — Ape', 'This creature enters with your choice of a trample counter or a menace counter on it.', ['3', '3']);
const DOZE = card('Test Doze', 'Sorcery', 'You gain 3 life. You skip your next untap step.');
const STALKER = card('Test Stalker', 'Creature — Horror', "This creature can't attack unless defending player is poisoned.", ['3', '3']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const TITAN = card('Test Titan', 'Creature — Giant', 'Indestructible', ['5', '5']);
const DEFS: CardDef[] = [BRUTE, IDOL, RATLING, SHELL, SMITE, RECALL, CHAMP, GOBLIN, APE, DOZE, STALKER, BEAR, TITAN];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 122.1f: the poison counters of players in conditions', () => {
  it('a static: "as long as an opponent has three or more poison counters" applies at three, not at two', () => {
    const s = scenario(['Plains'], { p1: { battlefield: ['Test Brute'] }, defs: DEFS });
    const brute = find(s, 'Test Brute', 'battlefield');
    expect(pt(withPoison(s, 2), brute)).toBe('2/2');
    expect(pt(withPoison(s, 3), brute)).toBe('4/4');
    // the controller's own poison counters are not an opponent's
    expect(pt(withPoison(s, 5, 'p1'), brute)).toBe('2/2');
  });
  it('an activation restriction (CR 602.5b): "activate only if an opponent has three or more poison counters"', () => {
    const s = scenario(['Plains'], { p1: { battlefield: ['Test Idol'] }, defs: DEFS });
    const idol = find(s, 'Test Idol', 'battlefield');
    const can = (x: GameState): boolean => legal(x, 'p1', 'activate').some((a) => a.object === idol);
    expect(can(withPoison(s, 2))).toBe(false);
    expect(can(withPoison(s, 3))).toBe(true);
  });
  it('an intervening "if" (CR 603.4): "if defending player is poisoned": not with no poison counter, yes with one', () => {
    for (const [n, want] of [[0, '2/2'], [1, '3/3']] as const) {
      let s = withPoison(scenario(['Plains'], { p1: { battlefield: ['Test Ratling'] }, defs: DEFS }), n);
      s = advanceTo(s, 3, 'main1');
      const rat = find(s, 'Test Ratling', 'battlefield');
      s = resolveAll(attackWith(s, [rat]));
      expect(pt(s, rat), `${n} poison counters`).toBe(want);
    }
  });
});

describe('CR 122.1f, 508.1c: "can\'t attack unless defending player is poisoned" (a static restriction reads the player\'s poison counters, statics/match.ts)', () => {
  it('not offered as an attacker while the opponent has no poison counter; offered once they have one', () => {
    for (const [n, offered] of [[0, false], [1, true]] as const) {
      let s = withPoison(scenario(['Plains'], { p1: { battlefield: ['Test Stalker', 'Test Bear'] }, defs: DEFS }), n);
      s = toDeclareAttackers(advanceTo(s, 3, 'main1'));
      const stalker = find(s, 'Test Stalker', 'battlefield');
      const d = s.pending as { kind: string; candidates?: { id: ObjectId }[] };
      expect((d.candidates ?? []).map((c) => c.id), `${n} poison counters`).toContain(find(s, 'Test Bear', 'battlefield'));
      expect((d.candidates ?? []).some((c) => c.id === stalker), `${n} poison counters`).toBe(offered);
    }
  });
});

describe('CR 702.89a: umbra armor', () => {
  it('the enchanted creature is not destroyed: its damage is removed and the Aura is destroyed instead; it stays untapped', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Shell', 'Test Smite'], battlefield: ['Test Bear', 'Test Ape'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Shell', { targets: [obj(bear)] }));
    s = clone(s);
    s.objects[bear]!.damage = 1;
    s = resolveAll(cast(s, 'Test Smite', { targets: [obj(bear)] }));
    expect(s.zones.battlefield).toContain(bear);
    expect(s.objects[bear]!.damage).toBe(0);
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(inYard(s, 'Test Shell')).toBe(true);
  });
  it('another creature, not enchanted, is destroyed as usual', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Shell', 'Test Smite'], battlefield: ['Test Bear', 'Test Goblin'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    const goblin = find(s, 'Test Goblin', 'battlefield');
    s = resolveAll(cast(s, 'Test Shell', { targets: [obj(bear)] }));
    s = resolveAll(cast(s, 'Test Smite', { targets: [obj(goblin)] }));
    expect(inYard(s, 'Test Goblin')).toBe(true);
    expect(s.zones.battlefield).toContain(find(s, 'Test Shell', 'battlefield'));
  });
  it('CR 702.12b: an indestructible creature would not be destroyed, so umbra armor does not apply and the Aura stays', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Shell', 'Test Smite'], battlefield: ['Test Titan'] }, defs: DEFS });
    const titan = find(s, 'Test Titan', 'battlefield');
    s = resolveAll(cast(s, 'Test Shell', { targets: [obj(titan)] }));
    s = resolveAll(cast(s, 'Test Smite', { targets: [obj(titan)] }));
    expect(s.zones.battlefield).toContain(titan);
    expect(inYard(s, 'Test Shell')).toBe(false);
  });
});

describe('CR 702.133a: jump-start', () => {
  it('cast from the graveyard by discarding a card; the spell is exiled after it resolves', () => {
    let s = scenario(['Plains'], { p1: { graveyard: ['Test Recall'], hand: ['Test Bear'] }, defs: DEFS });
    const lifeBefore = s.players.find((p) => p.id === 'p1')!.life;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Recall', 'graveyard') });
    s = resolveAll(settle(s));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(lifeBefore + 2);
    expect(exiled(s, 'Test Recall')).toBe(true);
    expect(inYard(s, 'Test Bear')).toBe(true); // the discarded card
  });
  it('with no card to discard it can\'t be cast from the graveyard; cast from the hand it goes to the graveyard', () => {
    let s = scenario(['Plains'], { p1: { graveyard: ['Test Recall'] }, defs: DEFS });
    expect(legal(s, 'p1', 'cast').some((a) => (a.action as { card?: ObjectId }).card === find(s, 'Test Recall', 'graveyard'))).toBe(false);
    s = scenario(['Plains'], { p1: { hand: ['Test Recall'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Recall'));
    expect(inYard(s, 'Test Recall')).toBe(true);
    expect(exiled(s, 'Test Recall')).toBe(false);
  });
});

describe('CR 702.72a, 607.2k: champion', () => {
  it('the championed Goblin is exiled, and returns to the battlefield when the champion leaves', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Champ', 'Test Smite'], battlefield: ['Test Goblin'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Champ'), { yes: true });
    const champ = find(s, 'Test Champ', 'battlefield');
    expect(exiled(s, 'Test Goblin')).toBe(true);
    s = resolveAll(cast(s, 'Test Smite', { targets: [obj(champ)] }));
    expect(inYard(s, 'Test Champ')).toBe(true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Goblin')).toBe(true);
  });
  it('with no other Goblin (it can\'t champion itself), the champion is sacrificed', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Champ'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Champ'), { yes: true });
    expect(inYard(s, 'Test Champ')).toBe(true);
    expect(s.zones.battlefield).toContain(find(s, 'Test Bear', 'battlefield'));
  });
  it('declining to exile sacrifices it, and the Goblin stays', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Champ'], battlefield: ['Test Goblin'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Champ'), { yes: false });
    expect(inYard(s, 'Test Champ')).toBe(true);
    expect(exiled(s, 'Test Goblin')).toBe(false);
  });
});

describe('CR 614.12a, 122.1b: "enters with your choice of a trample counter or a menace counter on it"', () => {
  for (const [option, kind, other] of [['1', 'menace', 'trample'], ['0', 'trample', 'menace']] as const) {
    it(`choosing ${kind}: one ${kind} counter and the keyword, no ${other} counter`, () => {
      let s = scenario(['Plains'], { p1: { hand: ['Test Ape'] }, defs: DEFS });
      s = resolveAll(cast(s, 'Test Ape'), { option });
      const ape = find(s, 'Test Ape', 'battlefield');
      expect(counters(s, ape, kind)).toBe(1);
      expect(counters(s, ape, other)).toBe(0);
      expect(keywords(s, ape)).toContain(kind);
    });
  }
});

describe('CR 614.10a, 502.1: "you skip your next untap step"', () => {
  it('the tapped land stays tapped in your next untap step and untaps in the one after; the opponent untaps as usual', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Doze'], battlefield: [{ name: 'Plains', tapped: true }] }, p2: { battlefield: [{ name: 'Plains', tapped: true }] }, defs: DEFS });
    const land = find(s, 'Plains', 'battlefield', 'p1');
    const theirs = find(s, 'Plains', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Doze'));
    s = advanceTo(s, 2, 'main1');
    expect(s.objects[theirs]!.tapped).toBe(false);
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[land]!.tapped).toBe(true);
    s = advanceTo(s, 5, 'main1');
    expect(s.objects[land]!.tapped).toBe(false);
  });
});
