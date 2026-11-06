/**
 * edh-next-124 (must-finish round, group planeswalkers): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites
 * were checked against the 2026-09-25 Comprehensive Rules text; the rulings were fetched from Scryfall.
 *
 *   CR 606.1, 606.3, 613.1f   "~ has all loyalty abilities of all other planeswalkers on the battlefield." (Nicol Bolas, Dragon-God, rulings 2024-01-12)
 *   CR 101.4, 608.2d, 406.1   "Each opponent exiles a card from their hand or a permanent they control." (Nicol Bolas, Dragon-God, ruling 2024-01-12)
 *   CR 115.1, 608.2b, 701.26  "Choose up to one target artifact, up to one target creature, and up to one target land. Untap the chosen permanents you control. Tap the chosen
 *                             permanents you don't control. You gain 2 life." (Teferi, Who Slows the Sunset, ruling 2021-09-24)
 *   CR 602.2, 601.2f, 605.1a  "The first activated ability of an artifact you activate each turn costs {2} less to activate." (Tezzeret, Betrayer of Flesh, rulings 2022-02-18)
 *   CR 603.12, 107.3, 608.2h  "Sacrifice a creature. When you do, ~ deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Hamster, draw X
 *                             cards." (Minsc & Boo, Timeless Heroes, ruling 2022-06-10)
 *   CR 502.3, 504.1, 114.4    the emblem "Untap all permanents you control during each opponent's untap step" and "You draw a card during each opponent's draw step." (ruling 2021-09-24)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; loyalty?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const loyaltyOf = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;

interface Script { yes?: boolean; targets?: TargetChoice[][]; pick?: (s: GameState, options: ObjectId[], player: PlayerId) => ObjectId[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.pick ? script.pick(s, p.options as ObjectId[], p.player as PlayerId) : p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
/** The activate actions offered for one object, with the text of each ability. */
const offeredOn = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): { key: string; text: string }[] =>
  legalActions(s, player).filter((l) => l.kind === 'activate' && l.object === id).map((l) => ({ key: (l.action as { ability: string }).ability, text: l.label }));
const activateText = (s: GameState, id: ObjectId, text: RegExp, script: Script = {}, player: PlayerId = 'p1'): GameState => {
  const hit = offeredOn(s, id, player).find((x) => text.test(x.text));
  if (!hit) throw new Error(`no ability ${text} offered on ${id}: ${JSON.stringify(offeredOn(s, id, player))}`);
  return settle(drive(act(s, { type: 'activate', player, source: id, ability: hit.key } as never), script), script);
};

// ---- Nicol Bolas, Dragon-God: all loyalty abilities of the other planeswalkers ------------------------------------------------------------------------------------

const OVERLORD = card('Test Overlord', 'Legendary Planeswalker — Testy', 'Test Overlord has all loyalty abilities of all other planeswalkers on the battlefield.\n+1: You gain 1 life.', { loyalty: '4' });
const SAGE = card('Test Sage', 'Legendary Planeswalker — Sagey', 'Creatures you control get +1/+0.\n{1}: You gain 5 life.\n+1: You gain 3 life.\n−2: Return Test Sage to its owner\'s hand.', { loyalty: '5' });
const RIVAL = card('Test Rival', 'Legendary Planeswalker — Rivaly', '−1: Test Rival deals 2 damage to target creature.', { loyalty: '3' });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 606.1, 613.1f: "~ has all loyalty abilities of all other planeswalkers on the battlefield."', () => {
  const setup = (): GameState => mpScenario({
    defs: [OVERLORD, SAGE, RIVAL, BEAR],
    zones: {
      p1: { battlefield: [{ name: 'Test Overlord', counters: { loyalty: 4 } }, { name: 'Test Sage', counters: { loyalty: 5 } }, 'Test Bear'] },
      p2: { battlefield: [{ name: 'Test Rival', counters: { loyalty: 3 } }, 'Test Bear'] },
    },
  } as never);
  it('is automated', () => { expect(full(OVERLORD)).toBe(true); expect(full(SAGE)).toBe(true); expect(full(RIVAL)).toBe(true); });
  it('gains the loyalty abilities of every other planeswalker (yours and an opponent\'s), keeps its own, and the others keep theirs (ruling: they lose nothing)', () => {
    const s = setup();
    const me = find(s, 'Test Overlord', 'battlefield', 'p1');
    const texts = offeredOn(s, me).map((x) => x.text).join(' | ');
    expect(texts).toMatch(/\+1: You gain 1 life/);
    expect(texts).toMatch(/\+1: You gain 3 life/);
    expect(texts).toMatch(/Return .* to its owner's hand/);
    expect(texts).toMatch(/deals 2 damage to target creature/);
    expect(offeredOn(s, find(s, 'Test Sage', 'battlefield', 'p1')).map((x) => x.text).join(' | ')).toMatch(/\+1: You gain 3 life/);
  });
  it('negative (ruling 2024-01-12): no static ability and no activated ability that is not a loyalty ability is gained', () => {
    const s = setup();
    const me = find(s, 'Test Overlord', 'battlefield', 'p1');
    expect(offeredOn(s, me).map((x) => x.text).join(' | ')).not.toMatch(/\{1\}: You gain 5 life/);
    const c = getChars(s, me);
    expect(c.abilities.filter((a) => a.def.kind === 'static').length).toBe(1); // its own only, never the Sage's "Creatures you control get +1/+0"
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(Number(getChars(s, bear).power)).toBe(3); // the Sage's own static ability (one +1/+0, not two)
  });
  it('a gained ability uses this planeswalker\'s loyalty, and "Test Sage" in it means this planeswalker (ruling 2024-01-12, CR 201.5)', () => {
    let s = setup();
    const me = find(s, 'Test Overlord', 'battlefield', 'p1');
    const sage = find(s, 'Test Sage', 'battlefield', 'p1');
    s = activateText(s, me, /Return .* to its owner's hand/);
    expect(s.objects[me]?.zone === 'battlefield').toBe(false); // the Overlord went back to the hand
    expect(s.zones.hand.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Overlord')).toBe(true);
    expect(s.objects[sage]!.zone).toBe('battlefield');
    expect(loyaltyOf(s, sage)).toBe(5);
  });
  it('the damage of a gained ability is dealt by this planeswalker; the loyalty is paid from it', () => {
    let s = setup();
    const me = find(s, 'Test Overlord', 'battlefield', 'p1');
    const theirBear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = activateText(s, me, /deals 2 damage to target creature/, { targets: [[obj(theirBear)]] });
    expect(loyaltyOf(s, me)).toBe(3);
    expect(loyaltyOf(s, find(s, 'Test Rival', 'battlefield', 'p2'))).toBe(3);
    expect(s.objects[theirBear]?.zone === 'battlefield').toBe(false);
  });
  it('negative (CR 606.3, ruling 2024-01-12): only ONE loyalty ability of this planeswalker each turn, however many it has', () => {
    let s = setup();
    const me = find(s, 'Test Overlord', 'battlefield', 'p1');
    const before = lifeOf(s, 'p1');
    s = activateText(s, me, /\+1: You gain 3 life/);
    expect(lifeOf(s, 'p1')).toBe(before + 3);
    expect(loyaltyOf(s, me)).toBe(5);
    expect(offeredOn(s, me).length).toBe(0);
    // the Sage itself may still activate one of its own
    expect(offeredOn(s, find(s, 'Test Sage', 'battlefield', 'p1')).some((x) => /\+1: You gain 3 life/.test(x.text))).toBe(true);
  });
  it('negative: once the other planeswalker leaves, its abilities are gone', () => {
    let s = setup();
    const me = find(s, 'Test Overlord', 'battlefield', 'p1');
    s = activateText(s, find(s, 'Test Sage', 'battlefield', 'p1'), /Return .* to its owner's hand/);
    const texts = offeredOn(s, me).map((x) => x.text).join(' | ');
    expect(texts).not.toMatch(/You gain 3 life/);
    expect(texts).toMatch(/deals 2 damage/);
  });
});

// ---- Nicol Bolas, Dragon-God: each opponent exiles a card from their hand or a permanent they control ---------------------------------------------------------------

const EXILER = card('Test Exiler', 'Legendary Planeswalker — Testy', '+1: You draw a card. Each opponent exiles a card from their hand or a permanent they control.', { loyalty: '4' });
const ROCK = card('Test Rock', 'Artifact', '');

describe('CR 101.4, 608.2d, 406.1: "Each opponent exiles a card from their hand or a permanent they control."', () => {
  const setup = (): GameState => mpScenario({
    defs: [EXILER, ROCK, BEAR],
    zones: {
      p1: { battlefield: [{ name: 'Test Exiler', counters: { loyalty: 4 } }, 'Test Rock'], hand: ['Test Bear'] },
      p2: { battlefield: ['Test Rock'], hand: ['Test Bear'] },
      p3: { battlefield: ['Test Bear'] },
      p4: {},
    },
  } as never);
  it('is automated', () => expect(full(EXILER)).toBe(true));
  it('each opponent, in turn order, chooses one of their own cards in hand or permanents; all are exiled; you draw; your own things are never offered', () => {
    let s = setup();
    const seen: { player: PlayerId; options: ObjectId[] }[] = [];
    const handBefore = s.zones.hand.p1!.length;
    const p2Hand = s.zones.hand.p2![0]!;
    s = activateText(s, find(s, 'Test Exiler', 'battlefield', 'p1'), /exiles/, {
      pick: (st, options, player) => {
        for (const id of options) expect(st.objects[id]!.owner).toBe(player);
        seen.push({ player, options });
        // p2 exiles the card in their hand, p3 their creature
        return [options.find((id) => (player === 'p2' ? st.objects[id]!.zone === 'hand' : true))!];
      },
    });
    expect(seen.map((x) => x.player)).toEqual(['p2']); // p3 has one thing only and p4 nothing: no choice to make (CR 608.2d)
    expect(seen[0]!.options.length).toBe(2); // p2: the Bear in hand and the Rock on the battlefield
    expect(s.zones.hand.p1!.length).toBe(handBefore + 1);
    expect(s.zones.exile.length).toBe(2);
    expect(s.zones.hand.p2!.includes(p2Hand)).toBe(false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.controller === 'p3')).toBe(false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.controller === 'p2')).toBe(true); // p2 kept the Rock
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(2); // yours stay
  });
  it('negative: a player with only a permanent must exile that permanent (one is required, not "may")', () => {
    let s = setup();
    s = activateText(s, find(s, 'Test Exiler', 'battlefield', 'p1'), /exiles/);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.controller === 'p3')).toBe(false);
  });
});

// ---- Teferi, Who Slows the Sunset: the chosen permanents, by controller -------------------------------------------------------------------------------------------------

const SLOWER = card('Test Slower', 'Legendary Planeswalker — Testy', '+1: Choose up to one target artifact, up to one target creature, and up to one target land. Untap the chosen permanents you control. Tap the chosen permanents you don\'t control. You gain 2 life.\n−7: You get an emblem with "Untap all permanents you control during each opponent\'s untap step" and "You draw a card during each opponent\'s draw step."', { loyalty: '8' });
const FIELD = card('Test Field', 'Land', '');
const SHOCK = card('Test Shock', 'Instant', 'Destroy target creature.');

describe('CR 115.1, 608.2b, 701.26: "Untap the chosen permanents you control. Tap the chosen permanents you don\'t control."', () => {
  const setup = (): GameState => mpScenario({
    defs: [SLOWER, ROCK, BEAR, FIELD, SHOCK],
    zones: {
      p1: { battlefield: [{ name: 'Test Slower', counters: { loyalty: 8 } }, { name: 'Test Rock', tapped: true }, { name: 'Test Field', tapped: true }, { name: 'Test Bear', tapped: true }] },
      p2: { battlefield: ['Test Rock', 'Test Bear', 'Test Field'] },
    },
  } as never);
  it('is automated', () => expect(full(SLOWER)).toBe(true));
  it('untaps the chosen permanents you control, taps the chosen ones you don\'t, and you gain 2 life', () => {
    let s = setup();
    const myRock = find(s, 'Test Rock', 'battlefield', 'p1');
    const myField = find(s, 'Test Field', 'battlefield', 'p1');
    const myBear = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirBear = find(s, 'Test Bear', 'battlefield', 'p2');
    const theirRock = find(s, 'Test Rock', 'battlefield', 'p2');
    const life = lifeOf(s, 'p1');
    s = activateText(s, find(s, 'Test Slower', 'battlefield', 'p1'), /Choose up to one target artifact/, { targets: [[obj(myRock)], [obj(theirBear)], [obj(myField)]] });
    expect(s.objects[myRock]!.tapped).toBe(false);
    expect(s.objects[myField]!.tapped).toBe(false);
    expect(s.objects[theirBear]!.tapped).toBe(true);
    expect(s.objects[myBear]!.tapped).toBe(true); // not chosen: stays tapped
    expect(s.objects[theirRock]!.tapped).toBe(false); // not chosen: stays untapped
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });
  it('negative: an untapped permanent of yours is never tapped, a tapped one of an opponent never untapped', () => {
    let s = setup();
    const theirField = find(s, 'Test Field', 'battlefield', 'p2');
    s = { ...s, objects: { ...s.objects, [theirField]: { ...s.objects[theirField]!, tapped: true } } };
    const myBear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = { ...s, objects: { ...s.objects, [myBear]: { ...s.objects[myBear]!, tapped: false } } };
    s = activateText(s, find(s, 'Test Slower', 'battlefield', 'p1'), /Choose up to one target artifact/, { targets: [[], [obj(myBear)], [obj(theirField)]] });
    expect(s.objects[myBear]!.tapped).toBe(false);
    expect(s.objects[theirField]!.tapped).toBe(true);
  });
  it('with no target chosen it still resolves: you gain 2 life', () => {
    let s = setup();
    const life = lifeOf(s, 'p1');
    s = activateText(s, find(s, 'Test Slower', 'battlefield', 'p1'), /Choose up to one target artifact/, { targets: [[], [], []] });
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });
  it('ruling 2021-09-24: a target that became illegal is not affected; the legal ones still are, and you gain 2 life', () => {
    let s = setup();
    const myRock = find(s, 'Test Rock', 'battlefield', 'p1');
    const theirBear = find(s, 'Test Bear', 'battlefield', 'p2');
    const life = lifeOf(s, 'p1');
    s = drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Slower', 'battlefield', 'p1'), ability: offeredOn(s, find(s, 'Test Slower', 'battlefield', 'p1')).find((x) => /Choose up to one/.test(x.text))!.key } as never), { targets: [[obj(myRock)], [obj(theirBear)], []] });
    // the opponent's creature leaves before the ability resolves
    s = { ...s, zones: { ...s.zones, battlefield: s.zones.battlefield.filter((id) => id !== theirBear), graveyard: { ...s.zones.graveyard, p2: [...s.zones.graveyard.p2!, theirBear] } }, objects: { ...s.objects, [theirBear]: { ...s.objects[theirBear]!, zone: 'graveyard' } } };
    s = settle(s);
    expect(s.objects[myRock]!.tapped).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });
});

describe('CR 502.3, 504.1: the emblem "Untap all permanents you control during each opponent\'s untap step" and "You draw a card during each opponent\'s draw step."', () => {
  const setup = (): GameState => {
    let s = mpScenario({
      defs: [SLOWER, ROCK, BEAR, FIELD],
      zones: { p1: { battlefield: [{ name: 'Test Slower', counters: { loyalty: 8 } }, 'Test Rock', 'Test Field'] }, p2: { battlefield: ['Test Rock'] } },
    } as never);
    s = activateText(s, find(s, 'Test Slower', 'battlefield', 'p1'), /emblem/);
    return s;
  };
  const handOf = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  it('the emblem is in the command zone with both abilities', () => {
    const s = setup();
    expect(s.zones.command.some((id) => s.objects[id]!.kind === 'emblem' && s.objects[id]!.controller === 'p1')).toBe(true);
  });
  it('during an opponent\'s untap step your permanents untap; theirs untap as usual', () => {
    let s = setup();
    const rock = find(s, 'Test Rock', 'battlefield', 'p1');
    const field = find(s, 'Test Field', 'battlefield', 'p1');
    s = advanceTo(s, 2, 'upkeep');
    s = { ...s, objects: { ...s.objects, [rock]: { ...s.objects[rock]!, tapped: true }, [field]: { ...s.objects[field]!, tapped: true } } };
    s = advanceTo(s, 3, 'upkeep'); // p3's turn: its untap step untaps p1's permanents
    expect(s.turn.activePlayer).toBe('p3');
    expect(s.objects[rock]!.tapped).toBe(false);
    expect(s.objects[field]!.tapped).toBe(false);
  });
  it('during an opponent\'s draw step that player draws, then you draw a card (no priority in between); in your own draw step you draw one card only', () => {
    let s = setup();
    s = advanceTo(s, 2, 'upkeep');
    const mine = handOf(s, 'p1');
    const theirs = handOf(s, 'p2');
    s = advanceTo(s, 2, 'draw');
    expect(handOf(s, 'p2')).toBe(theirs + 1);
    expect(handOf(s, 'p1')).toBe(mine + 1);
    const i2 = s.log.findIndex((l) => /draws a card during/.test(l.text));
    expect(i2).toBeGreaterThanOrEqual(0);
    // the next opponents too
    s = advanceTo(s, 3, 'main1');
    expect(handOf(s, 'p1')).toBe(mine + 2);
    // and NOT in your own draw step (turn 5 is p1's again): only the normal draw
    s = advanceTo(s, 5, 'upkeep');
    const before = handOf(s, 'p1');
    s = advanceTo(s, 5, 'main1');
    expect(handOf(s, 'p1')).toBe(before + 1);
  });
  it('negative: without the emblem nobody draws in another player\'s draw step', () => {
    let s = mpScenario({ defs: [SLOWER, ROCK], zones: { p1: { battlefield: [{ name: 'Test Slower', counters: { loyalty: 8 } }] } } } as never);
    s = advanceTo(s, 2, 'upkeep');
    const mine = handOf(s, 'p1');
    s = advanceTo(s, 2, 'main1');
    expect(handOf(s, 'p1')).toBe(mine);
  });
});

// ---- Tezzeret, Betrayer of Flesh: the first activated ability of an artifact you activate each turn ------------------------------------------------------------------

const TINKERER = card('Test Tinkerer', 'Legendary Planeswalker — Testy', 'The first activated ability of an artifact you activate each turn costs {2} less to activate.\n+1: You gain 1 life.', { loyalty: '4' });
const LENS = card('Test Lens', 'Artifact', '{2}, {T}: You gain 3 life.');
const SIGNET = card('Test Signet', 'Artifact', '{1}, {T}: Add {C}{C}.');
const PEBBLE = card('Test Pebble', 'Artifact', '{T}: Add {C}.');
const PUMPER = card('Test Pumper', 'Creature — Bear', '{2}: You gain 1 life.', { pt: ['2', '2'] });

describe('CR 602.2, 601.2f, 605.1a: "The first activated ability of an artifact you activate each turn costs {2} less to activate."', () => {
  const setup = (extra: string[] = []): GameState => mpScenario({
    defs: [TINKERER, LENS, SIGNET, PEBBLE, PUMPER],
    zones: {
      p1: { battlefield: [{ name: 'Test Tinkerer', counters: { loyalty: 4 } }, 'Test Lens', 'Test Lens', 'Plains', 'Plains', 'Plains', 'Plains', ...extra] },
      p2: { battlefield: ['Test Lens', 'Plains', 'Plains'] },
    },
  } as never);
  const untappedLands = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Plains' && !s.objects[id]!.tapped).length;
  const lenses = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Test Lens');
  it('is automated', () => expect(full(TINKERER)).toBe(true));
  it('the first costs {2} less (free here); the second artifact ability that turn costs its full {2}', () => {
    let s = setup();
    const [a, b] = lenses(s, 'p1');
    const life = lifeOf(s, 'p1');
    s = activateText(s, a!, /gain 3 life/);
    expect(lifeOf(s, 'p1')).toBe(life + 3);
    expect(untappedLands(s, 'p1')).toBe(4);
    s = activateText(s, b!, /gain 3 life/);
    expect(lifeOf(s, 'p1')).toBe(life + 6);
    expect(untappedLands(s, 'p1')).toBe(2);
  });
  it('ruling 2022-02-18: a mana ability of an artifact counts as the first (the discount is spent on it); the next artifact ability costs full', () => {
    let s = setup(['Test Pebble']);
    const pebble = find(s, 'Test Pebble', 'battlefield', 'p1');
    const mana = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === pebble && l.isMana)!;
    s = act(s, mana.action as never);
    expect(s.objects[pebble]!.tapped).toBe(true);
    const [a] = lenses(s, 'p1');
    s = activateText(s, a!, /gain 3 life/);
    // {2}: the {C} in the pool and one Plains
    expect(untappedLands(s, 'p1')).toBe(3);
  });
  it('a mana ability with a mana cost can be the first: the Signet\'s {1} is reduced to nothing', () => {
    let s = setup(['Test Signet']);
    const signet = find(s, 'Test Signet', 'battlefield', 'p1');
    const mana = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === signet && l.isMana)!;
    s = drive(act(s, mana.action as never));
    expect(untappedLands(s, 'p1')).toBe(4);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.length).toBe(2);
  });
  it('negative: an ability of a permanent that is not an artifact is not reduced and does not use up the first', () => {
    let s = setup(['Test Pumper']);
    s = activateText(s, find(s, 'Test Pumper', 'battlefield', 'p1'), /gain 1 life/);
    expect(untappedLands(s, 'p1')).toBe(2);
    s = activateText(s, lenses(s, 'p1')[0]!, /gain 3 life/);
    expect(untappedLands(s, 'p1')).toBe(2); // still the first artifact ability: free
  });
  it('negative: an opponent\'s artifact ability is not reduced ("you activate"); a new turn has its own first', () => {
    let s = setup();
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    s = activateText(s, lenses(s, 'p2')[0]!, /gain 3 life/, {}, 'p2');
    expect(untappedLands(s, 'p2')).toBe(0);
  });
  it('review fix: the auto-payer plans artifact mana abilities at their full cost (it never counts on the first-of-the-turn reduction, so a payment it starts never fails midway)', () => {
    const MID = card('Test Mid Spell', 'Sorcery', 'You gain 3 life.', { cost: '{4}' });
    const BIG = card('Test Big Spell', 'Sorcery', 'You gain 4 life.', { cost: '{5}' });
    const mk = (): GameState => mpScenario({ defs: [TINKERER, SIGNET, MID, BIG], zones: { p1: { battlefield: [{ name: 'Test Tinkerer', counters: { loyalty: 4 } }, 'Test Signet', 'Test Signet', 'Plains', 'Plains'], hand: ['Test Mid Spell', 'Test Big Spell'] } } } as never);
    let s = mk();
    const life = lifeOf(s, 'p1');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mid Spell', 'hand', 'p1') } as never)));
    expect(lifeOf(s, 'p1')).toBe(life + 3);
    // {5} needs the reduction on the first Signet: the auto-payer does not offer it on its own; the player activates that Signet first (free), then the payer pays the rest
    let t = mk();
    expect(legalActions(t, 'p1').some((l) => l.kind === 'cast' && l.object === find(t, 'Test Big Spell', 'hand', 'p1'))).toBe(false);
    const signet = find(t, 'Test Signet', 'battlefield', 'p1');
    t = drive(act(t, legalActions(t, 'p1').find((l) => l.kind === 'activate' && l.object === signet && l.isMana)!.action as never));
    t = settle(drive(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Big Spell', 'hand', 'p1') } as never)));
    expect(lifeOf(t, 'p1')).toBe(life + 4);
  });
  it('the first one was activated before this permanent arrived: no discount for the second', () => {
    let s = mpScenario({ defs: [TINKERER, LENS], zones: { p1: { battlefield: ['Test Lens', 'Test Lens', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Tinkerer'] } } } as never);
    s = activateText(s, lenses(s, 'p1')[0]!, /gain 3 life/);
    expect(untappedLands(s, 'p1')).toBe(2);
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tinkerer', 'hand', 'p1') } as never)));
    s = activateText(s, lenses(s, 'p1')[1]!, /gain 3 life/);
    expect(untappedLands(s, 'p1')).toBe(0);
  });
});

// ---- Minsc & Boo, Timeless Heroes: sacrifice, then the reflexive damage and draw ------------------------------------------------------------------------------------

const RANGER = card('Test Ranger', 'Legendary Planeswalker — Testy', 'When Test Ranger enters and at the beginning of your upkeep, you may create Boo, a legendary 1/1 red Hamster creature token with trample and haste.\n+1: Put three +1/+1 counters on up to one target creature with trample or haste.\n−2: Sacrifice a creature. When you do, Test Ranger deals X damage to any target, where X is that creature\'s power. If the sacrificed creature was a Hamster, draw X cards.', { loyalty: '3' });
const HAMSTER = card('Test Hamster', 'Creature — Hamster', '', { pt: ['3', '3'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const SPEEDY = card('Test Speedy', 'Creature — Cat', 'Haste', { pt: ['1', '1'] });

describe('CR 603.12, 107.3, 608.2h: "Sacrifice a creature. When you do, ~ deals X damage ..., where X is that creature\'s power. If the sacrificed creature was a Hamster, draw X cards."', () => {
  const setup = (mine: (string | { name: string; counters: Record<string, number> })[]): GameState => mpScenario({
    defs: [RANGER, HAMSTER, OGRE, SPEEDY, BEAR],
    zones: { p1: { battlefield: [{ name: 'Test Ranger', counters: { loyalty: 3 } }, ...mine] }, p2: { battlefield: ['Test Ogre'] } },
  } as never);
  const pickNamed = (name: string) => (st: GameState, options: ObjectId[]): ObjectId[] => [options.find((id) => st.defs[st.objects[id]!.defId]!.name === name)!];
  it('is automated', () => expect(full(RANGER)).toBe(true));
  it('a Hamster sacrificed: X damage (its power as it last existed, counters included) and you draw X cards', () => {
    let s = setup([{ name: 'Test Hamster', counters: { '+1/+1': 2 } }, 'Test Bear']);
    const hand = s.zones.hand.p1!.length;
    const life = lifeOf(s, 'p2');
    s = activateText(s, find(s, 'Test Ranger', 'battlefield', 'p1'), /Sacrifice a creature/, { pick: pickNamed('Test Hamster'), targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Hamster')).toBe(false);
    expect(lifeOf(s, 'p2')).toBe(life - 5);
    expect(s.zones.hand.p1!.length).toBe(hand + 5);
  });
  it('review fix (CR 608.2h, 400.7): Boo, the TOKEN Hamster, sacrificed: it ceased to exist, yet it was a Hamster: X damage and X cards (its last known information)', () => {
    let s = mpScenario({ defs: [RANGER, BEAR], zones: { p1: { hand: ['Test Ranger'] } } } as never);
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ranger', 'hand', 'p1') } as never), { yes: true }), { yes: true }); // the enters trigger: yes, create Boo
    const boo = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(boo).toBeDefined();
    const ranger = find(s, 'Test Ranger', 'battlefield', 'p1');
    s = { ...s, objects: { ...s.objects, [boo]: { ...s.objects[boo]!, counters: { '+1/+1': 3 } } } }; // as the +1 would have it (one loyalty ability a turn)
    const hand = s.zones.hand.p1!.length;
    const life = lifeOf(s, 'p2');
    s = activateText(s, ranger, /Sacrifice a creature/, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(s.objects[boo]).toBeUndefined();
    expect(lifeOf(s, 'p2')).toBe(life - 4);
    expect(s.zones.hand.p1!.length).toBe(hand + 4);
  });
  it('negative: a creature that is not a Hamster: the damage only, no card', () => {
    let s = setup(['Test Hamster', { name: 'Test Bear', counters: {} }]);
    const hand = s.zones.hand.p1!.length;
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = activateText(s, find(s, 'Test Ranger', 'battlefield', 'p1'), /Sacrifice a creature/, { pick: pickNamed('Test Bear'), targets: [[obj(ogre)]] });
    expect(s.objects[ogre]!.damage).toBe(2);
    expect(s.zones.hand.p1!.length).toBe(hand);
  });
  it('ruling 2022-06-10: the target became illegal: no damage and no card, even for a Hamster', () => {
    let s = setup(['Test Hamster']);
    const hand = s.zones.hand.p1!.length;
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const ranger = find(s, 'Test Ranger', 'battlefield', 'p1');
    const key = offeredOn(s, ranger).find((x) => /Sacrifice a creature/.test(x.text))!.key;
    s = drive(act(s, { type: 'activate', player: 'p1', source: ranger, ability: key } as never));
    // the loyalty ability resolves: the Hamster is sacrificed and the reflexive trigger targets the Ogre
    for (let guard = 0; guard < 20 && s.zones.stack.length > 0 && !(s.zones.stack.length === 1 && s.objects[s.zones.stack[0]!]!.stack?.targets?.length); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player } as never), { targets: [[obj(ogre)]] });
    expect(s.zones.stack.length).toBe(1);
    // the Ogre leaves before the reflexive trigger resolves
    s = { ...s, zones: { ...s.zones, battlefield: s.zones.battlefield.filter((id) => id !== ogre), graveyard: { ...s.zones.graveyard, p2: [...s.zones.graveyard.p2!, ogre] } }, objects: { ...s.objects, [ogre]: { ...s.objects[ogre]!, zone: 'graveyard' } } };
    s = settle(s);
    expect(s.zones.hand.p1!.length).toBe(hand);
  });
  it('negative: with no creature to sacrifice nothing triggers ("when you do")', () => {
    let s = setup([]);
    const life = lifeOf(s, 'p2');
    s = activateText(s, find(s, 'Test Ranger', 'battlefield', 'p1'), /Sacrifice a creature/, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(lifeOf(s, 'p2')).toBe(life);
  });
  it('+1: three +1/+1 counters on up to one target creature with trample or haste; a creature without either is no legal target', () => {
    let s = setup(['Test Speedy', 'Test Bear']);
    const speedy = find(s, 'Test Speedy', 'battlefield', 'p1');
    s = activateText(s, find(s, 'Test Ranger', 'battlefield', 'p1'), /three \+1\/\+1 counters/, { targets: [[obj(speedy)]] });
    expect(s.objects[speedy]!.counters['+1/+1']).toBe(3);
    let t = setup(['Test Bear']);
    const bear = find(t, 'Test Bear', 'battlefield', 'p1');
    try { t = activateText(t, find(t, 'Test Ranger', 'battlefield', 'p1'), /three \+1\/\+1 counters/, { targets: [[obj(bear)]] }); } catch { /* the choice is refused */ }
    expect(t.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
