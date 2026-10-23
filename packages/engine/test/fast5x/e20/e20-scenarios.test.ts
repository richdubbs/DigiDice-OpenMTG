/**
 * FAST5X E20 (MX23): player-action events, played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented,
 * design 6.10).
 *
 *   CR 700.13    a player commits a crime as they cast a spell, activate an ability or put a triggered ability on the stack that targets an opponent, a
 *                permanent, spell or ability an opponent controls, or a card in an opponent's graveyard: once per spell or ability; a copy commits none
 *   CR 700.12    an outlaw is an Assassin, Mercenary, Pirate, Rogue and/or Warlock; 700.12a "outlaws you control" are permanents
 *   CR 700.14    "whenever you expend N": the mana spent this turn to cast spells crosses N with a payment (abilities don't count)
 *   CR 702.177a  "whenever you activate an exhaust ability"; CR 606.3 "whenever you / an opponent activate(s) a loyalty ability"
 *   CR 701.26a   "whenever you tap an untapped creature an opponent controls" (the controller of the tapping effect)
 *   CR 603.2c    "one or more" triggers once per batch; CR 603.4, 611.3a: conditions and statics that read "you've committed a crime this turn"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { tweak } from '../../m4/helpers';
import { act, advanceTo, answer, find, legal, life, passBoth, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...extra } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id });
/** Activate a mana ability of `id` (CR 605.3b: no stack); a color choice is answered with green. */
function activateMana(s: GameState, id: ObjectId, player = 'p1'): GameState {
  const la = legal(s, player, 'activate').find((a) => a.object === id && a.isMana);
  if (!la) throw new Error('no mana ability');
  let r = act(s, la.action);
  if (r.pending?.kind === 'chooseColor') r = answer(r, { kind: 'chooseColor', color: 'G' });
  return drive(r);
}
function activate(s: GameState, id: ObjectId, script?: Script, player = 'p1', which = 0): GameState {
  const la = legal(s, player, 'activate').filter((a) => a.object === id && !a.isMana)[which];
  if (!la) throw new Error('no activated ability');
  return drive(act(s, la.action), script);
}
const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const plains = (n: number): string[] => Array(n).fill('Plains') as string[];
/** Destroy a creature with a fresh Test Kill from p1's hand (put there for the test), and resolve. */
function tweakDestroy(s0: GameState, id: ObjectId): GameState {
  const s = structuredClone(s0);
  put(s, 'p1', 'hand', 'Test Kill');
  return resolveAll(cast(s, 'Test Kill', { targets: [[obj(id)]] }));
}
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power ?? 0);

// ---- cards -------------------------------------------------------------------------------------------------------------------------------------------
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const ROGUE = card('Test Rogue', 'Creature — Human Rogue', '', '{0}', ['1', '1']);
const PIRATE = card('Test Pirate', 'Creature — Human Pirate', '', '{0}', ['1', '1']);
const SNEAK = card('Test Sneak', 'Creature — Elf', 'Whenever you commit a crime, you gain 1 life.', '{0}', ['1', '1']);
const ONCE = card('Test Once', 'Creature — Elf', 'Whenever you commit a crime, draw a card. This ability triggers only once each turn.', '{0}', ['1', '1']);
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 1 damage to any target.');
const FORK = card('Test Fork', 'Sorcery', 'Test Fork deals 1 damage to each of up to two targets.');
const RAKE = card('Test Rake', 'Sorcery', 'Exile target card from a graveyard.');
const NIP = card('Test Nip', 'Creature — Goblin', '{0}: Target creature gets -1/-0 until end of turn.', '{0}', ['1', '1']);
const LURKER = card('Test Lurker', 'Creature — Goblin', 'When this creature enters, it deals 1 damage to target opponent.', '{0}', ['1', '1']);
const TWIN = card('Test Twin', 'Instant', 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.');
const VAULT = card('Test Vault', 'Creature — Human', 'This creature gets +2/+0 as long as you\'ve committed a crime this turn.', '{0}', ['1', '4']);
const SLIP = card('Test Slip', 'Creature — Human', 'This creature can\'t be blocked if you\'ve committed a crime this turn.', '{0}', ['1', '3']);
const SECRET = card('Test Secret', 'Sorcery', 'This spell costs {2} less to cast if you\'ve committed a crime this turn.\nDraw a card.', '{2}{W}');
const MUSCLE = card('Test Muscle', 'Creature — Ogre', 'Whenever you commit a crime during your turn, this creature gains indestructible until end of turn.', '{0}', ['5', '4']);
// outlaws
const BOSS = card('Test Boss', 'Creature — Lizard Rogue', 'Other outlaws you control have haste.', '{0}', ['2', '4']);
const RAIDER = card('Test Raider', 'Creature — Human Rogue', 'When this creature enters, if you control another outlaw, you gain 3 life.', '{0}', ['3', '2']);
const FALL = card('Test Fall', 'Instant', 'Target creature gets -1/-0 until end of turn. It gets -4/-0 until end of turn instead if you control an outlaw.');
const CREW = card('Test Crew', 'Enchantment', 'When this enchantment enters, create a 1/1 red Mercenary creature token with "{T}: Target creature you control gets +1/+0 until end of turn. Activate only as a sorcery."\nWhenever an outlaw you control dies, each opponent loses 1 life and you gain 1 life.', '{0}');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const BRUTE = card('Test Brute', 'Creature — Minotaur Mercenary', 'Affinity for outlaws\nTrample', '{4}{W}', ['5', '4']);
// expend
const BOXER = card('Test Boxer', 'Creature — Raccoon', 'Whenever you expend 4, you gain 3 life.', '{0}', ['3', '2']);
const HOARD = card('Test Hoard', 'Enchantment', 'When this enchantment enters and whenever you expend 4, put a charge counter on it.', '{0}');
const TWO = card('Test Two', 'Sorcery', 'Draw a card.', '{2}');
const ONE = card('Test One', 'Sorcery', 'Draw a card.', '{1}');
const BANK = card('Test Bank', 'Artifact', '{3}: You gain 1 life.', '{0}');
// exhaust and loyalty
const HIVE = card('Test Hive', 'Artifact', 'Whenever you activate an exhaust ability, draw a card.', '{0}');
const BURNER = card('Test Burner', 'Creature — Goblin', 'Exhaust — {0}: Put a +1/+1 counter on this creature.\n{0}: This creature gets +1/+0 until end of turn.', '{0}', ['2', '2']);
// an exhaust mana ability (CR 605.1a, 702.177a): a fixed one and one decided as it resolves (Loot, the Pathfinder's wording)
const GROVE = card('Test Grove', 'Creature — Elf', 'Exhaust — {T}: Add {G}{G}{G}.', '{0}', ['1', '1']);
const LOOT = card('Test Loot', 'Creature — Beast', 'Exhaust — {0}, {T}: Add three mana of any one color.', '{0}', ['1', '1']);
const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.\n−1: Draw a card.', '{0}', undefined, { loyalty: '3' });
const PARADOX = card('Test Paradox', 'Enchantment', 'Whenever you activate a loyalty ability, you gain 2 life.', '{0}');
const OATH = card('Test Oath', 'Creature — Human Mercenary', 'Whenever an opponent activates a loyalty ability, this creature deals 1 damage to that player.', '{0}', ['3', '3']);
// tapping
const SENTRY = card('Test Sentry', 'Creature — Elemental', 'Whenever you tap an untapped creature an opponent controls, you gain 2 life.', '{0}', ['2', '3']);
const SHARAE = card('Test Numbing', 'Creature — Merfolk', 'Whenever you tap one or more untapped creatures your opponents control, draw a card. This ability triggers only once each turn.', '{0}', ['2', '3']);
const FREEZE = card('Test Freeze', 'Instant', 'Tap target creature.');
const MEND = card('Test Mend', 'Instant', 'Regenerate target creature.');
const FROST = card('Test Frost', 'Sorcery', 'Tap all creatures your opponents control.');

const DEFS = [
  BEAR, ROGUE, PIRATE, SNEAK, ONCE, SHOCK, FORK, RAKE, NIP, LURKER, TWIN, VAULT, SLIP, SECRET, MUSCLE, BOSS, RAIDER, FALL, BRUTE, CREW, KILL, BOXER, HOARD, TWO, ONE, BANK,
  HIVE, BURNER, GROVE, LOOT, WALKER, PARADOX, OATH, SENTRY, SHARAE, FREEZE, FROST, MEND,
];

describe('the synthetic cards are automated (FAST5X E20)', () => {
  it('every card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 700.13: committing a crime', () => {
  it('a spell that targets an opponent is a crime: "whenever you commit a crime" triggers once', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock'], battlefield: ['Test Sneak'] } });
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Shock', { targets: [[plr('p2')]] }));
    expect(life(s, 'p1')).toBe(l0 + 1);
    expect(life(s, 'p2')).toBe(19);
  });

  it('targeting yourself or your own creature is no crime', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock', 'Test Shock'], battlefield: ['Test Sneak', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Shock', { targets: [[plr('p1')]] }));
    s = resolveAll(cast(s, 'Test Shock', { targets: [[obj(bear)]] }));
    expect(life(s, 'p1')).toBe(l0 - 1);
  });

  it('one crime per spell, however many of its targets are an opponent\'s (two targets, one trigger)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Fork'], battlefield: ['Test Sneak'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Fork', { targets: [[plr('p2'), obj(bear)]] }));
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(l0 + 1);
  });

  it('a card in an opponent\'s graveyard is a crime target; a card in your own graveyard is not', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Rake', 'Test Rake'], battlefield: ['Test Sneak'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Rogue'] } });
    const mine = find(s, 'Test Bear', 'graveyard', 'p1');
    const theirs = find(s, 'Test Rogue', 'graveyard', 'p2');
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Rake', { targets: [[obj(mine)]] }));
    expect(life(s, 'p1')).toBe(l0);
    s = resolveAll(cast(s, 'Test Rake', { targets: [[obj(theirs)]] }));
    expect(life(s, 'p1')).toBe(l0 + 1);
  });

  it('activating an ability that targets an opponent\'s creature is a crime', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sneak', 'Test Nip'] }, p2: { battlefield: ['Test Bear'] } });
    const nip = find(s, 'Test Nip', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const l0 = life(s, 'p1');
    s = resolveAll(activate(s, nip, { targets: [[obj(bear)]] }));
    expect(life(s, 'p1')).toBe(l0 + 1);
    s = resolveAll(activate(s, nip, { targets: [[obj(nip)]] }));
    expect(life(s, 'p1')).toBe(l0 + 1);
  });

  it('putting a triggered ability that targets an opponent on the stack is a crime', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Lurker'], battlefield: ['Test Sneak'] } });
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Lurker'), { targets: [[plr('p2')]] });
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(l0 + 1);
  });

  it('CR 707.10: a copy of a spell is not cast, so it commits no crime (only the original did)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock', 'Test Twin'], battlefield: ['Test Sneak'] } });
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Shock', { targets: [[plr('p2')]] });
    const shock = s.zones.stack.find((id) => s.objects[id]!.defId === 'Test Shock')!;
    // the crime trigger is on the stack above the Shock; the Twin copies the Shock (keeping its target, an opponent)
    s = cast(s, 'Test Twin', { targets: [[obj(shock)]], yes: [false] });
    s = resolveAll(s, { yes: [false] });
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(l0 + 1);
  });

  it('an opponent\'s crime is not yours', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sneak'] }, p2: { hand: ['Test Shock'] } });
    const l0 = life(s, 'p1');
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Shock', 'hand', 'p2') }), { targets: [[plr('p1')]] });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(l0 - 1);
  });

  it('CR 603.2h: "This ability triggers only once each turn"', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock', 'Test Shock'], battlefield: ['Test Once'] } });
    const h0 = hand(s);
    s = resolveAll(cast(s, 'Test Shock', { targets: [[plr('p2')]] }));
    s = resolveAll(cast(s, 'Test Shock', { targets: [[plr('p2')]] }));
    expect(hand(s)).toBe(h0 - 2 + 1);
  });

  it('CR 611.3a: "gets +2/+0 as long as you\'ve committed a crime this turn" reads this turn only', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock'], battlefield: ['Test Vault'] } });
    const vault = find(s, 'Test Vault', 'battlefield');
    expect(power(s, vault)).toBe(1);
    s = resolveAll(cast(s, 'Test Shock', { targets: [[plr('p2')]] }));
    expect(power(s, vault)).toBe(3);
    s = advanceTo(s, 2, 'main1');
    expect(power(s, vault)).toBe(1);
  });

  it('CR 601.2f: "costs {2} less to cast if you\'ve committed a crime this turn"', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock', 'Test Secret'], battlefield: plains(1) } });
    expect(legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Secret', 'hand'))).toBe(false);
    s = resolveAll(cast(s, 'Test Shock', { targets: [[plr('p2')]] }));
    expect(legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Secret', 'hand'))).toBe(true);
  });

  it('"can\'t be blocked if you\'ve committed a crime this turn" and "during your turn" triggers', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Shock'], battlefield: ['Test Slip', 'Test Muscle'] } });
    const slip = find(s, 'Test Slip', 'battlefield');
    const muscle = find(s, 'Test Muscle', 'battlefield');
    const restricted = (t: GameState): boolean => getChars(t, slip)!.abilities.some((a) => a.def.kind === 'static');
    expect(restricted(s)).toBe(true);
    s = resolveAll(cast(s, 'Test Shock', { targets: [[plr('p2')]] }));
    expect(hasKeyword(getChars(s, muscle)!, 'indestructible')).toBe(true);
  });
});

describe('CR 700.12: outlaws', () => {
  it('"Other outlaws you control have haste": Rogues and Pirates you control, not ~, not a Bear, not an opponent\'s Rogue', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Boss', 'Test Rogue', 'Test Pirate', 'Test Bear'] }, p2: { battlefield: ['Test Rogue'] } });
    const boss = find(s, 'Test Boss', 'battlefield');
    expect(hasKeyword(getChars(s, find(s, 'Test Rogue', 'battlefield', 'p1'))!, 'haste')).toBe(true);
    expect(hasKeyword(getChars(s, find(s, 'Test Pirate', 'battlefield'))!, 'haste')).toBe(true);
    expect(hasKeyword(getChars(s, find(s, 'Test Bear', 'battlefield'))!, 'haste')).toBe(false);
    expect(hasKeyword(getChars(s, boss)!, 'haste')).toBe(false);
    expect(hasKeyword(getChars(s, find(s, 'Test Rogue', 'battlefield', 'p2'))!, 'haste')).toBe(false);
  });

  it('CR 603.4: "When this creature enters, if you control another outlaw" (the creature itself does not count)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Raider', 'Test Raider'] } });
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Raider'));
    expect(life(s, 'p1')).toBe(l0);
    s = resolveAll(cast(s, 'Test Raider'));
    expect(life(s, 'p1')).toBe(l0 + 3);
  });

  it('"instead if you control an outlaw"', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Fall', 'Test Fall'], battlefield: ['Test Bear'] }, p2: { battlefield: [{ name: 'Test Boss' }] } });
    const target = find(s, 'Test Boss', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Fall', { targets: [[obj(target)]] }));
    expect(power(s, target)).toBe(1); // no outlaw of p1: -1/-0 (the opponent's Rogue is not "an outlaw you control")
    s = scenario([], { defs: DEFS, p1: { hand: ['Test Fall'], battlefield: ['Test Pirate'] }, p2: { battlefield: ['Test Boss'] } });
    const t2 = find(s, 'Test Boss', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Fall', { targets: [[obj(t2)]] }));
    expect(power(s, t2)).toBe(-2);
  });

  it('CR 702.41a, 700.12a: affinity for outlaws counts outlaw permanents you control', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Brute'], battlefield: ['Test Rogue', 'Test Pirate', 'Test Boss', 'Test Bear', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Rogue'] } });
    // {4}{W} less {3} (three outlaws of p1): {1}{W}, two Plains
    expect(legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Brute', 'hand'))).toBe(true);
    const t = scenario([], { defs: DEFS, p1: { hand: ['Test Brute'], battlefield: ['Test Rogue', 'Test Bear', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Rogue', 'Test Pirate'] } });
    expect(legal(t, 'p1', 'cast').some((a) => a.object === find(t, 'Test Brute', 'hand'))).toBe(false);
  });
});

describe('outlaw tokens and deaths (CR 700.12, 602.5d)', () => {
  it('the quoted ability is activated only as a sorcery; "whenever an outlaw you control dies"', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Crew', 'Test Kill'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Rogue'] } });
    s = resolveAll(cast(s, 'Test Crew'));
    const merc = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(getChars(s, merc)!.subtypes).toContain('Mercenary');
    s = tweak(s, (t) => { t.objects[merc]!.controlledSinceTurn = 0; }); // not summoning sick (CR 302.6)
    // CR 602.5d, 307.1: not while a spell is on the stack
    s = cast(s, 'Test Kill', { targets: [[obj(bear)]] });
    expect(legal(s, 'p1', 'activate').some((a) => a.object === merc && !a.isMana)).toBe(false);
    s = resolveAll(s);
    expect(legal(s, 'p1', 'activate').some((a) => a.object === merc && !a.isMana)).toBe(true);
    const l0 = life(s, 'p1');
    // an opponent's outlaw dying, or a non-outlaw of yours, is not "an outlaw you control"
    expect(life(s, 'p2')).toBe(20);
    s = tweakDestroy(s, merc);
    expect(life(s, 'p1')).toBe(l0 + 1);
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 700.14: expend', () => {
  it('"whenever you expend 4" triggers as the total crosses 4, once a turn', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Two', 'Test Two', 'Test Two'], battlefield: ['Test Boxer', ...plains(6)] } });
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Two'));
    expect(life(s, 'p1')).toBe(l0);
    s = resolveAll(cast(s, 'Test Two'));
    expect(life(s, 'p1')).toBe(l0 + 3);
    s = resolveAll(cast(s, 'Test Two'));
    expect(life(s, 'p1')).toBe(l0 + 3);
    expect(s.players[0]!.turnStats.manaSpentOnSpells).toBe(6);
  });

  it('mana spent on abilities does not count; the count starts again each turn', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test One', 'Test Two', 'Test Two'], battlefield: ['Test Boxer', 'Test Bank', ...plains(4)] } });
    const bank = find(s, 'Test Bank', 'battlefield');
    const l0 = life(s, 'p1');
    s = resolveAll(activate(s, bank));
    s = resolveAll(cast(s, 'Test One'));
    expect(life(s, 'p1')).toBe(l0 + 1); // the Bank's 1 life, no expend 4 (1 mana spent on spells)
    s = advanceTo(s, 3, 'main1');
    expect(s.players[0]!.turnStats.manaSpentOnSpells ?? 0).toBe(0);
    s = resolveAll(cast(s, 'Test Two'));
    s = resolveAll(cast(s, 'Test Two'));
    expect(life(s, 'p1')).toBe(l0 + 1 + 3);
  });

  it('"When this enchantment enters and whenever you expend 4": both events', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Hoard', 'Test Two', 'Test Two'], battlefield: plains(4) } });
    s = resolveAll(cast(s, 'Test Hoard'));
    const hoard = find(s, 'Test Hoard', 'battlefield');
    expect(s.objects[hoard]!.counters['charge']).toBe(1);
    s = resolveAll(cast(s, 'Test Two'));
    s = resolveAll(cast(s, 'Test Two'));
    expect(s.objects[hoard]!.counters['charge']).toBe(2);
  });
});

describe('CR 702.177a, 606.3: activating exhaust and loyalty abilities', () => {
  it('"whenever you activate an exhaust ability" sees the exhaust ability only', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hive', 'Test Burner'] } });
    const burner = find(s, 'Test Burner', 'battlefield');
    const h0 = hand(s);
    s = resolveAll(activate(s, burner, {}, 'p1', 1));
    expect(hand(s)).toBe(h0);
    s = resolveAll(activate(s, burner, {}, 'p1', 0));
    expect(hand(s)).toBe(h0 + 1);
    expect(s.objects[burner]!.counters['+1/+1']).toBe(1);
  });

  it('CR 605.1a, 702.177a: activating an exhaust MANA ability is activating an exhaust ability; an ordinary mana ability is not', () => {
    for (const name of ['Test Grove', 'Test Loot']) {
      let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hive', { name, since: 0 }, 'Plains'] } });
      const h0 = hand(s);
      s = resolveAll(activateMana(s, find(s, 'Plains', 'battlefield')));
      expect(hand(s), `${name}: a Plains`).toBe(h0);
      s = activateMana(s, find(s, name, 'battlefield'));
      expect(s.players.find((p) => p.id === 'p1')!.manaPool.filter((u) => u.type === 'G').length, name).toBe(3);
      s = resolveAll(s);
      expect(hand(s), name).toBe(h0 + 1);
    }
  });

  it('"whenever you activate a loyalty ability", and "whenever an opponent activates a loyalty ability, ... that player"', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }, 'Test Paradox'] }, p2: { battlefield: ['Test Oath'] } });
    const walker = find(s, 'Test Walker', 'battlefield');
    const l0 = life(s, 'p1');
    s = resolveAll(activate(s, walker));
    expect(life(s, 'p1')).toBe(l0 + 1 + 2 - 1);
  });
});

describe('CR 701.26a: "whenever you tap an untapped creature an opponent controls"', () => {
  it('your effect tapping an opponent\'s untapped creature triggers; your own creature, or one already tapped, does not', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Freeze', 'Test Freeze', 'Test Freeze'], battlefield: ['Test Sentry', 'Test Bear'] }, p2: { battlefield: ['Test Rogue', { name: 'Test Pirate', tapped: true }] } });
    const mine = find(s, 'Test Bear', 'battlefield');
    const theirs = find(s, 'Test Rogue', 'battlefield');
    const tapped = find(s, 'Test Pirate', 'battlefield');
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Freeze', { targets: [[obj(mine)]] }));
    expect(life(s, 'p1')).toBe(l0);
    s = resolveAll(cast(s, 'Test Freeze', { targets: [[obj(tapped)]] }));
    expect(life(s, 'p1')).toBe(l0);
    s = resolveAll(cast(s, 'Test Freeze', { targets: [[obj(theirs)]] }));
    expect(life(s, 'p1')).toBe(l0 + 2);
  });

  it('CR 603.2c: "one or more untapped creatures your opponents control" triggers once for a batch', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Frost'], battlefield: ['Test Numbing', 'Test Sentry'] }, p2: { battlefield: ['Test Rogue', 'Test Pirate', 'Test Bear'] } });
    const h0 = hand(s);
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Frost'));
    expect(hand(s)).toBe(h0 - 1 + 1);
    expect(life(s, 'p1')).toBe(l0 + 6); // the singular form triggers once per creature
  });

  it('CR 701.19a: a regenerated permanent is tapped by its own controller, so your shield on an opponent creature is not "you tap"', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Mend', 'Test Kill'], battlefield: ['Test Sentry'] }, p2: { battlefield: ['Test Rogue'] } });
    const rogue = find(s, 'Test Rogue', 'battlefield');
    const l0 = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Mend', { targets: [[obj(rogue)]] }));
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(rogue)]] }));
    expect(s.objects[rogue]!.zone).toBe('battlefield');
    expect(s.objects[rogue]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(l0); // "its controller taps it" (CR 701.19a): p2 taps their own creature
  });

  it('an opponent tapping their own creature for a cost, or attacking with it, is not "you tap"', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sentry'] }, p2: { battlefield: [{ name: 'Test Bear', since: 0 }] } });
    const l0 = life(s, 'p1');
    s = advanceTo(s, 2, 'declareAttackers');
    expect(life(s, 'p1')).toBe(l0);
  });
});
