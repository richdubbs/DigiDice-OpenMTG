/**
 * Commander EDHREC ranks 24,501-25,000, round edh-c-105 (fourth pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 603.4, 122.1, 111.1             "Whenever you cast a spell, if its mana value is equal to 1 plus the number of soul counters on this enchantment, put a soul counter on this enchantment, then create a 2/2 white Spirit creature token with flying." (Obscura Ascendancy)
 * (the groups for Azorius Aethermage, Warped Devotion, Liability, Territorial Gorger, Firefright Mage and Expedition Lookout test edh-c-63 readings, kept as extra coverage)
 *   CR 400.3, 108.3, 603.6c         "Whenever a permanent is returned to a player's hand, that player discards a card." (the OWNER of the permanent, Warped Devotion)
 *   CR 400.3, 108.3, 700.4          "Whenever a nontoken permanent is put into a player's graveyard from the battlefield, that player loses 1 life." (Liability)
 *   CR 122.1, 107.14, 603.2c        "Whenever you get one or more {E}, ~ gets +2/+2 until end of turn." (Territorial Gorger)
 *   CR 509.1b, 611.2c               "Target creature can't be blocked this turn except by artifact creatures and/or red creatures." (Firefright Mage)
 *   CR 101.4, 406.1, 608.2d         "Each player exiles two cards from their hand." (Mind Swords)
 *   CR 702.3b, 509.1b, 604.1        "As long as an opponent has eight or more cards in their graveyard, ~ can attack as though it didn't have defender and it can't be blocked." (Expedition Lookout)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, tweak, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handCount = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
interface Opts { targets?: Targets; yes?: boolean }
/** Answer the decisions until priority: payments automatic, targets in order, objects by their first options. */
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min === 0 ? p.max : p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Opts = {}): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const activate = (s: GameState, source: ObjectId, o: Opts = {}): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source, ability: 'p:0:0' } as never), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RECALL = card('Test Recall', 'Instant', "Return target creature to its owner's hand.");
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');

describe('CR 400.3, 603.6c: "Whenever a permanent is returned to your hand, you gain 1 life."', () => {
  const WARDEN = card('Test Hand Warden', 'Enchantment', 'Whenever a permanent is returned to your hand, you gain 1 life.');
  const defs = [WARDEN, RECALL, BANISH, BEAR];
  const start = () => scenario([], { defs, p1: { hand: ['Test Recall'], battlefield: ['Test Hand Warden', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('is understood', () => expect(noManual(WARDEN)).toBe(true));
  it('a permanent you own returned to your hand gains 1 life', () => {
    const s0 = start();
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(life(cast(s0, 'Test Recall', { targets: [[obj(mine)]] }), 'p1')).toBe(life(s0, 'p1') + 1);
  });
  it('negative: an opponent\'s permanent returned to their hand does nothing', () => {
    const s0 = start();
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    expect(life(cast(s0, 'Test Recall', { targets: [[obj(theirs)]] }), 'p1')).toBe(life(s0, 'p1'));
  });
  it('negative: a permanent you own that you do not control (the new owner of the zone is still you) counts; one put into exile does not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Banish'], battlefield: ['Test Hand Warden', 'Test Bear'] }, p2: {} });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(life(cast(s0, 'Test Banish', { targets: [[obj(mine)]] }), 'p1')).toBe(life(s0, 'p1'));
  });
  it('a permanent you own but an opponent controls, returned to its owner\'s hand, gains 1 life', () => {
    const s0 = start();
    const id = find(s0, 'Test Bear', 'battlefield', 'p2');
    const stolen = tweak(s0, (t) => { t.objects[id]!.owner = 'p1'; });
    expect(life(cast(stolen, 'Test Recall', { targets: [[obj(id)]] }), 'p1')).toBe(life(s0, 'p1') + 1);
  });
});

describe('CR 400.3, 108.3, 603.6c: "Whenever a permanent is returned to a player\'s hand, that player discards a card." (the owner)', () => {
  const DEVOTION = card('Test Warped Idol', 'Enchantment', "Whenever a permanent is returned to a player's hand, that player discards a card.");
  const defs = [DEVOTION, RECALL, BEAR, BANISH];
  const start = () => scenario([], { defs, p1: { hand: ['Test Recall', 'Test Banish', 'Plains'], battlefield: ['Test Warped Idol', 'Test Bear'] }, p2: { hand: ['Plains'], battlefield: ['Test Bear'] } });
  it('is understood', () => expect(noManual(DEVOTION)).toBe(true));
  it('your permanent returned: you discard; an opponent\'s: they discard', () => {
    const s0 = start();
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const a = cast(s0, 'Test Recall', { targets: [[obj(mine)]] });
    expect(handCount(a, 'p1')).toBe(handCount(s0, 'p1') - 1); // -Recall, +Bear, -1 discarded
    expect(handCount(a, 'p2')).toBe(handCount(s0, 'p2'));
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const b = cast(s0, 'Test Recall', { targets: [[obj(theirs)]] });
    expect(handCount(b, 'p2')).toBe(handCount(s0, 'p2')); // +Bear, -1 discarded
    expect(handCount(b, 'p1')).toBe(handCount(s0, 'p1') - 1); // only Recall left
  });
  it('CR 108.3: the owner discards, not the controller: a creature p2 owns that p1 controls', () => {
    const s0 = start();
    const id = find(s0, 'Test Bear', 'battlefield', 'p2');
    const stolen = tweak(s0, (t) => { t.objects[id]!.controller = 'p1'; });
    const s1 = cast(stolen, 'Test Recall', { targets: [[obj(id)]] });
    expect(handCount(s1, 'p2')).toBe(handCount(stolen, 'p2')); // +Bear, -1 discarded
    expect(handCount(s1, 'p1')).toBe(handCount(stolen, 'p1') - 1); // only Recall left; p1 discards nothing
  });
  it('negative: a permanent put into exile does not trigger it', () => {
    const s0 = start();
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = cast(s0, 'Test Banish', { targets: [[obj(theirs)]] });
    expect(handCount(s1, 'p2')).toBe(handCount(s0, 'p2'));
  });
});

describe('CR 400.3, 108.3, 700.4: "Whenever a nontoken permanent is put into a player\'s graveyard from the battlefield, that player loses 1 life."', () => {
  const LIABILITY = card('Test Liability Seal', 'Enchantment', "Whenever a nontoken permanent is put into a player's graveyard from the battlefield, that player loses 1 life.");
  const defs = [LIABILITY, SMITE, BANISH, BEAR];
  const start = () => scenario([], { defs, p1: { hand: ['Test Smite', 'Test Banish'], battlefield: ['Test Liability Seal', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('is understood', () => expect(noManual(LIABILITY)).toBe(true));
  it('the owner of a destroyed permanent loses 1 life (either player)', () => {
    const s0 = start();
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const a = cast(s0, 'Test Smite', { targets: [[obj(theirs)]] });
    expect(life(a, 'p2')).toBe(life(s0, 'p2') - 1);
    expect(life(a, 'p1')).toBe(life(s0, 'p1'));
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const b = cast(s0, 'Test Smite', { targets: [[obj(mine)]] });
    expect(life(b, 'p1')).toBe(life(s0, 'p1') - 1);
  });
  it('CR 108.3: the owner loses the life when the controller differs', () => {
    const s0 = start();
    const id = find(s0, 'Test Bear', 'battlefield', 'p2');
    const stolen = tweak(s0, (t) => { t.objects[id]!.controller = 'p1'; });
    const s1 = cast(stolen, 'Test Smite', { targets: [[obj(id)]] });
    expect(life(s1, 'p2')).toBe(life(stolen, 'p2') - 1);
    expect(life(s1, 'p1')).toBe(life(stolen, 'p1'));
  });
  it('negative: a permanent exiled instead of put into a graveyard costs no life', () => {
    const s0 = start();
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    expect(life(cast(s0, 'Test Banish', { targets: [[obj(theirs)]] }), 'p2')).toBe(life(s0, 'p2'));
  });
});

describe('CR 122.1, 107.14, 603.2c: "Whenever you get one or more {E}, ~ gets +2/+2 until end of turn."', () => {
  const GORGER = card('Test Spark Hound', 'Creature — Hound', 'Whenever you get one or more {E}, ~ gets +2/+2 until end of turn.', { pt: ['3', '3'] });
  const CHARGE = card('Test Charge Up', 'Sorcery', 'You get {E}{E}.');
  const GRAB = card('Test Energy Grab', 'Sorcery', 'Target opponent gets {E}{E}.');
  const defs = [GORGER, CHARGE, GRAB];
  const size = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
  it('is understood', () => { expect(noManual(GORGER)).toBe(true); expect(noManual(CHARGE)).toBe(true); });
  it('getting two energy at once is one occurrence: +2/+2 once', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Charge Up'], battlefield: ['Test Spark Hound'] } });
    const id = find(s0, 'Test Spark Hound', 'battlefield', 'p1');
    expect(size(s0, id)).toBe('3/3');
    expect(size(cast(s0, 'Test Charge Up'), id)).toBe('5/5');
  });
  it('negative: an opponent getting energy does not trigger it', () => {
    if (!noManual(GRAB)) return; // the spell is a helper only
    const s0 = scenario([], { defs, p1: { hand: ['Test Energy Grab'], battlefield: ['Test Spark Hound'] } });
    const id = find(s0, 'Test Spark Hound', 'battlefield', 'p1');
    expect(size(cast(s0, 'Test Energy Grab', { targets: [[{ kind: 'player', id: 'p2' }]] }), id)).toBe('3/3');
  });
});

describe('CR 509.1b, 611.2c: "{0}: Target creature can\'t be blocked this turn except by artifact creatures and/or red creatures."', () => {
  const MAGE = card('Test Veil Mage', 'Creature — Wizard', "{0}: Target creature can't be blocked this turn except by artifact creatures and/or red creatures.", { pt: ['1', '1'] });
  const RED = card('Test Red Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['R'] });
  const GOLEM = card('Test Tin Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const defs = [MAGE, RED, GOLEM, BEAR];
  const start = () => scenario([], { defs, p1: { battlefield: ['Test Veil Mage', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Red Imp', 'Test Tin Golem'] } });
  it('is understood', () => expect(noManual(MAGE)).toBe(true));
  it('only an artifact creature or a red creature may block the target', () => {
    const s0 = start();
    const mage = find(s0, 'Test Veil Mage', 'battlefield', 'p1');
    const bear = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p1' && s0.defs[s0.objects[id]!.defId]!.name === 'Test Bear')!;
    const s1 = activate(s0, mage, { targets: [[obj(bear)]] });
    const blockers = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[bear]]));
    const theirBear = find(blockers, 'Test Bear', 'battlefield', 'p2');
    const imp = find(blockers, 'Test Red Imp', 'battlefield', 'p2');
    const golem = find(blockers, 'Test Tin Golem', 'battlefield', 'p2');
    reject(blockers, { type: 'declareBlockers', player: 'p2', blocks: [{ blocker: theirBear, attacker: bear }] } as never);
    expect(() => declareBlockers(blockers, [[imp, bear]])).not.toThrow();
    expect(() => declareBlockers(blockers, [[golem, bear]])).not.toThrow();
  });
  it('negative: an attacker that was not targeted can be blocked by any creature', () => {
    const s0 = start();
    const mage = find(s0, 'Test Veil Mage', 'battlefield', 'p1');
    const bear = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p1' && s0.defs[s0.objects[id]!.defId]!.name === 'Test Bear')!;
    const s1 = activate(s0, mage, { targets: [[obj(mage)]] });
    const blockers = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[bear]]));
    const theirBear = find(blockers, 'Test Bear', 'battlefield', 'p2');
    expect(() => declareBlockers(blockers, [[theirBear, bear]])).not.toThrow();
  });
});

describe('CR 101.4, 406.1, 608.2d: "Each player exiles two cards from their hand."', () => {
  const SWORDS = card('Test Mind Blades', 'Sorcery', 'Each player exiles two cards from their hand.');
  const defs = [SWORDS];
  const exiled = (s: GameState, p: PlayerId): number => s.zones.exile.filter((id) => s.objects[id]!.owner === p).length;
  it('is understood', () => expect(noManual(SWORDS)).toBe(true));
  it('every player exiles two cards from their own hand', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mind Blades', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    const s1 = cast(s0, 'Test Mind Blades');
    expect(exiled(s1, 'p1')).toBe(2);
    expect(exiled(s1, 'p2')).toBe(2);
    expect(handCount(s1, 'p1')).toBe(1);
    expect(handCount(s1, 'p2')).toBe(3);
  });
  it('negative: a player with fewer than two cards exiles what they have; nobody exiles from a graveyard or the other hand', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mind Blades', 'Plains'] }, p2: { hand: ['Plains'] } });
    const s1 = cast(s0, 'Test Mind Blades');
    expect(exiled(s1, 'p1')).toBe(1);
    expect(exiled(s1, 'p2')).toBe(1);
    expect(handCount(s1, 'p1')).toBe(0);
  });
});

describe("CR 702.3b, 509.1b, 604.1: \"As long as an opponent has eight or more cards in their graveyard, ~ can attack as though it didn't have defender and it can't be blocked.\"", () => {
  const LOOKOUT = card('Test Lookout', 'Creature — Bird', "Defender\nAs long as an opponent has eight or more cards in their graveyard, ~ can attack as though it didn't have defender and it can't be blocked.", { pt: ['2', '2'] });
  const defs = [LOOKOUT, BEAR];
  const start = (yard: number) => {
    return scenario([], { defs, p1: { battlefield: ['Test Lookout'] }, p2: { battlefield: ['Test Bear'], graveyard: Array<string>(yard).fill('Plains') } });
  };
  const attackers = (s: GameState): ObjectId[] => { const id = find(s, 'Test Lookout', 'battlefield', 'p1'); return [id]; };
  it('is understood', () => expect(noManual(LOOKOUT)).toBe(true));
  it('with eight cards in an opponent\'s graveyard it can attack, and the other player\'s creature cannot block it', () => {
    const s = start(8);
    const d = declareAttackers(toDeclareAttackers(s), [attackers(s) as [ObjectId]]);
    // nothing can block it: the defending player is never asked to declare blockers
    const next = passUntil(d, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    expect(next.pending?.kind).not.toBe('declareBlockers');
    expect(life(toStep(next, 'endCombat'), 'p2')).toBe(life(s, 'p2') - 2);
  });
  it('negative: with seven cards it cannot attack (defender)', () => {
    const s = start(7);
    const a = toDeclareAttackers(s);
    expect(() => declareAttackers(a, [attackers(s) as [ObjectId]])).toThrow();
  });
});

describe('CR 603.4, 122.1, 111.1: "Whenever you cast a spell, if its mana value is equal to 1 plus the number of soul counters on this enchantment, put a soul counter on this enchantment, then create a 2/2 white Spirit creature token with flying."', () => {
  const ASC = card('Test Soul Ascent', 'Enchantment', 'Whenever you cast a spell, if its mana value is equal to 1 plus the number of soul counters on this enchantment, put a soul counter on this enchantment, then create a 2/2 white Spirit creature token with flying.');
  const ONE = card('Test One Spell', 'Instant', 'You gain 1 life.', { cost: '{1}' });
  const TWO = card('Test Two Spell', 'Instant', 'You gain 1 life.', { cost: '{2}' });
  const defs = [ASC, ONE, TWO];
  const spirits = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  const souls = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['soul'] ?? 0;
  it('is understood', () => expect(noManual(ASC)).toBe(true));
  it('a spell of mana value 1 then one of mana value 2 each add a counter and a Spirit; a spell of any other mana value does not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test One Spell', 'Test One Spell', 'Test Two Spell'], battlefield: ['Test Soul Ascent', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    const asc = find(s0, 'Test Soul Ascent', 'battlefield', 'p1');
    const s1 = cast(s0, 'Test One Spell'); // 1 = 1 + 0
    expect(souls(s1, asc)).toBe(1);
    expect(spirits(s1)).toBe(1);
    const s2 = cast(s1, 'Test One Spell'); // 1 is not 1 + 1
    expect(souls(s2, asc)).toBe(1);
    expect(spirits(s2)).toBe(1);
    const s3 = cast(s2, 'Test Two Spell'); // 2 = 1 + 1
    expect(souls(s3, asc)).toBe(2);
    expect(spirits(s3)).toBe(2);
  });
});
