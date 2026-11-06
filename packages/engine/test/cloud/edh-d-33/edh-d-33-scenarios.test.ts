/**
 * Coordinator D, round edh-d-33 (lane name-hand, second pass): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case. CR cites are from the
 * Comprehensive Rules of 2026-09-25 (unverified from memory where the cloud session could not fetch them).
 *
 *   CR 101.2, 615.12, 604.1          "If you have no cards in hand, ~ can't be countered and the damage can't be prevented." (Demonfire)
 *   CR 701.20a, 201.4, 608.2c        "Choose a nonland card name, then reveal the top four cards of your library. Put all cards with the chosen name from among them into your hand and the rest into your graveyard." (Tamiyo, Collector of Tales)
 *   CR 701.20a, 608.2d, 400.3        "Reveal any number of green cards in your hand. Return an enchantment card from your graveyard to your hand for each card revealed this way." (Rofellos's Gift)
 *   CR 701.20a, 402.3, 608.2c        "Choose a card name. Target player reveals their hand. If a card with the chosen name is revealed this way, search your library for a creature card ..." (Isperia the Inscrutable)
 *   CR 406.1, 608.2c                 "Target player reveals their hand. You choose a card from it. That player exiles that card." (Ghastlord of Fugue)
 *   CR 508.1b, 118.12, 107.3a        "that opponent may pay {X}, where X is the number of cards in their hand. If they don't, they can't attack you this combat." (Champions of Minas Tirith)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { answer, find, pass, scenario } from '../../m3/scenario';
import { cast, full, resolveAll } from '../cmd3/helpers';
import { attackDenial, getChars } from '../../../src/index';
import { passUntil } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: string): string[] => ((s.zones[zone] as Record<string, ObjectId[]>)[p] ?? []).map((id) => nameOf(s, id));
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id));

/** Answer every decision until priority: objects by `pick` (default the first `min`), a card name from `chosen`, yes/no by `yes`. */
function drive(s0: GameState, o: { chosen?: string; yes?: boolean; pick?: (options: ObjectId[], min: number, max: number) => ObjectId[]; targets?: string[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80; guard++) {
    const p = s.pending;
    if (p && p.kind !== 'priority') {
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: o.chosen ?? p.options![0]! });
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, p.min, p.max) : p.options.slice(0, p.min) });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (o.targets ?? ['p2']).map((id) => ({ kind: 'player' as const, id })) });
      else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
    } else if (s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const castDrive = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => drive(cast(s0, name, o.targets ? { targets: o.targets.map((id) => ({ kind: 'player' as const, id })) } : {}), o);

// ---- Demonfire: Hellbent can't be countered ------------------------------------------------------------------------------------------------------------------------
const FIRE = card('Test Hell Fire', 'Sorcery', "~ deals 3 damage to any target.\nIf you have no cards in hand, ~ can't be countered and the damage can't be prevented.");
const CANCEL = card('Test Cancel', 'Instant', 'Counter target spell.');
const FILLER = card('Test Filler', 'Instant', 'You gain 1 life.');
describe('CR 101.2, 615.12: "If you have no cards in hand, ~ can\'t be countered and the damage can\'t be prevented." (Demonfire)', () => {
  const play = (extra: string[]): GameState => {
    let s = scenario([], { defs: [FIRE, CANCEL, FILLER], p1: { hand: ['Test Hell Fire', ...extra] }, p2: { hand: ['Test Cancel'] } });
    s = cast(s, 'Test Hell Fire', { targets: [{ kind: 'player', id: 'p2' }] });
    s = pass(s); // p1 passes: p2 may respond
    s = cast(s, 'Test Cancel', { targets: [{ kind: 'object', id: s.zones.stack[0]! }] }, 'p2');
    return resolveAll(s);
  };
  it('is automated', () => { expect(full(FIRE)).toBe(true); });
  it('with no other card in hand the counterspell does nothing and the spell deals its damage', () => { expect(life(play([]), 'p2')).toBe(17); });
  it('negative: with another card in hand the spell is countered', () => { expect(life(play(['Test Filler']), 'p2')).toBe(20); });
});

// ---- Tamiyo, Collector of Tales: choose a name, reveal the top four, keep the named cards ---------------------------------------------------------------------------
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const OWL = card('Test Owl', 'Creature — Bird', '', { pt: ['1', '1'] });
const TOME = card('Test Tome', 'Sorcery', 'Choose a nonland card name, then reveal the top four cards of your library. Put all cards with the chosen name from among them into your hand and the rest into your graveyard.');
describe('CR 701.20a, 201.4, 608.2c: "Put all cards with the chosen name from among them into your hand and the rest into your graveyard." (Tamiyo, Collector of Tales)', () => {
  const play = (chosen: string): GameState => {
    const s0 = scenario([], { defs: [TOME, ELF, OWL], p1: { hand: ['Test Tome'], library: ['Test Elf', 'Test Owl', 'Test Elf', 'Test Owl', 'Test Elf'] } });
    return castDrive(s0, 'Test Tome', { chosen });
  };
  it('is automated', () => { expect(full(TOME)).toBe(true); });
  it('both named cards of the top four go to the hand, the other two to the graveyard, the fifth card stays', () => {
    const s = play('Test Elf');
    expect(names(s, 'hand', 'p1').sort()).toEqual(['Test Elf', 'Test Elf']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Owl', 'Test Owl', 'Test Tome']);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Elf');
  });
  it('negative: naming the other card keeps that one instead, and the Elves go to the graveyard', () => {
    const s = play('Test Owl');
    expect(names(s, 'hand', 'p1').sort()).toEqual(['Test Owl', 'Test Owl']);
    expect(names(s, 'graveyard', 'p1').filter((n) => n === 'Test Elf').length).toBe(2);
  });
});

// ---- Rofellos's Gift ----------------------------------------------------------------------------------------------------------------------------------------------
const GIFT = card('Test Green Gift', 'Sorcery', 'Reveal any number of green cards in your hand. Return an enchantment card from your graveyard to your hand for each card revealed this way.');
const GREEN_A = card('Test Green Cub', 'Creature — Bear', '', { pt: ['1', '1'], colors: ['G'] });
const BLUE_A = card('Test Blue Cub', 'Creature — Bear', '', { pt: ['1', '1'], colors: ['U'] });
const RITE = (n: number): CardDef => card(`Test Rite ${n}`, 'Enchantment', 'You gain 1 life.');
describe('CR 701.20a, 608.2d, 400.3: "Return an enchantment card from your graveyard to your hand for each card revealed this way." (Rofellos\'s Gift)', () => {
  const play = (reveal: number, yard: number): GameState => {
    const rites = [1, 2, 3].map(RITE);
    const s0 = scenario([], { defs: [GIFT, GREEN_A, BLUE_A, ...rites], p1: { hand: ['Test Green Gift', 'Test Green Cub', 'Test Green Cub', 'Test Blue Cub'], graveyard: rites.slice(0, yard).map((r) => r.name) } });
    let first = true;
    return drive(cast(s0, 'Test Green Gift', {}), { pick: (options, min, max) => { const k = first ? reveal : Math.min(max, options.length); first = false; return options.slice(0, k); } });
  };
  it('is automated', () => { expect(full(GIFT)).toBe(true); });
  it('revealing both green cards returns two enchantments; the blue card is not offered', () => {
    const s = play(2, 3);
    expect(names(s, 'hand', 'p1').filter((n) => n.startsWith('Test Rite')).length).toBe(2);
    expect(names(s, 'graveyard', 'p1').filter((n) => n.startsWith('Test Rite')).length).toBe(1);
  });
  it('negative: revealing none returns nothing; and with only one enchantment in the graveyard only that one returns', () => {
    expect(names(play(0, 3), 'hand', 'p1').filter((n) => n.startsWith('Test Rite')).length).toBe(0);
    expect(names(play(2, 1), 'hand', 'p1').filter((n) => n.startsWith('Test Rite')).length).toBe(1);
  });
});

// ---- Isperia the Inscrutable ----------------------------------------------------------------------------------------------------------------------------------------
const SPHINX = card('Test Sphinx', 'Creature — Sphinx', '', { pt: ['1', '1'] });
const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', { pt: ['1', '1'] });
const SEER = card('Test Seer', 'Sorcery', 'Choose a card name. Target player reveals their hand. If a card with the chosen name is revealed this way, search your library for a creature card with flying, reveal it, put it into your hand, then shuffle.');
describe('CR 701.20a, 402.3, 608.2c: "If a card with the chosen name is revealed this way, search your library ..." (Isperia the Inscrutable)', () => {
  const play = (chosen: string): GameState => {
    const s0 = scenario([], { defs: [SEER, SPHINX, FLIER], p1: { hand: ['Test Seer'], library: ['Test Sphinx', 'Test Flier'] }, p2: { hand: ['Test Sphinx'] } });
    return castDrive(s0, 'Test Seer', { chosen, targets: ['p2'], pick: (o, min) => o.slice(0, Math.max(min, 1)) });
  };
  it('is automated', () => { expect(full(SEER)).toBe(true); });
  it('naming a card in the revealed hand lets the caster search for the flier', () => { expect(names(play('Test Sphinx'), 'hand', 'p1')).toContain('Test Flier'); });
  it('negative: naming a card that is not in the revealed hand finds nothing', () => { expect(names(play('Test Flier'), 'hand', 'p1')).not.toContain('Test Flier'); });
});

// ---- Ghastlord of Fugue -------------------------------------------------------------------------------------------------------------------------------------------------
const MIND = card('Test Mind Rot', 'Sorcery', 'Target player reveals their hand. You choose a card from it. That player exiles that card.');
describe('CR 406.1, 608.2c: "Target player reveals their hand. You choose a card from it. That player exiles that card." (Ghastlord of Fugue)', () => {
  it('is automated, and the chosen card (not another one) leaves the hand for exile', () => {
    expect(full(MIND)).toBe(true);
    const s0 = scenario([], { defs: [MIND, ELF, OWL], p1: { hand: ['Test Mind Rot'] }, p2: { hand: ['Test Elf', 'Test Owl'] } });
    const s = castDrive(s0, 'Test Mind Rot', { targets: ['p2'], pick: (o) => [o.find((id) => nameOf(s0, id) === 'Test Owl')!] });
    expect(exiled(s)).toEqual(['Test Owl']);
    expect(names(s, 'hand', 'p2')).toEqual(['Test Elf']);
  });
});

// ---- Champions of Minas Tirith ------------------------------------------------------------------------------------------------------------------------------------
const WARDEN = card('Test Warden', 'Enchantment', "At the beginning of combat on each opponent's turn, that opponent may pay {X}, where X is the number of cards in their hand. If they don't, they can't attack you this combat.");
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
describe('CR 508.1b, 118.12, 107.3a: "that opponent may pay {X}, where X is the number of cards in their hand. If they don\'t, they can\'t attack you this combat." (Champions of Minas Tirith)', () => {
  const play = (hand: string[], battlefield: string[], pay: boolean): GameState => {
    const s0 = scenario([], { defs: [WARDEN, BEAR, FILLER], p1: { hand, battlefield: ['Test Bear', ...battlefield] }, p2: { battlefield: ['Test Warden'] } });
    let s = passUntil(s0, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length > 0, 'the trigger');
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending;
      if (p && p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: pay });
      else if (p && p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p && p.kind !== 'priority') throw new Error(`unexpected ${p.kind}`);
      else s = pass(s);
    }
    return s;
  };
  const canAttackP2 = (s: GameState): boolean => {
    const bear = s.objects[find(s, 'Test Bear', 'battlefield')]!;
    return attackDenial(s, bear, getChars(s, bear.id), ['p2']) === null;
  };
  it('is automated', () => { expect(full(WARDEN)).toBe(true); });
  it('an opponent with two cards in hand and no mana to pay {2} can not attack the Warden\'s controller this combat', () => {
    const s = play(['Test Filler', 'Test Filler'], [], false);
    expect(canAttackP2(s)).toBe(false);
  });
  it('negative: an opponent with two cards in hand and two lands pays {2} and may attack; declining the payment leaves the ban', () => {
    expect(canAttackP2(play(['Test Filler', 'Test Filler'], ['Plains', 'Plains'], true))).toBe(true);
    expect(canAttackP2(play(['Test Filler', 'Test Filler'], ['Plains', 'Plains'], false))).toBe(false);
  });
  it('negative: an opponent with no cards in hand pays {0} and may attack', () => {
    const s = play([], [], true);
    expect(canAttackP2(s)).toBe(true);
  });
});
