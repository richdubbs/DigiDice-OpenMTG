/**
 * Commander lane edh-c (EDHREC ranks 27,001-27,500), round edh-c-38: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler, in 4-player games. CR cites checked against the Comprehensive Rules of 2026-09-25 (media.wizards.com).
 *
 *   CR 400.3, 402.1, 608.2c    "Return ~ and target creature you control to their owner's hand." (Wizard Mentor, Lady Sun)
 *   CR 701.23a, 201.3, 607.2d  "Choose a nonland card name. Search target player's graveyard, hand, and library for any number of cards with that name and exile them." (Memoricide)
 *   CR 613.1e, 613.4c, 105.3   "Enchanted creature gets +3/+1 and is black." (Sinister Strength)
 *   CR 613.1e, 105.2c          "~ is colorless." in every zone (Ghostfire; CR 604.3)
 *   CR 701.20a, 701.9b         "Target opponent reveals their hand and discards a creature card at random." (Rag Man)
 *   CR 701.40a, 701.40e        "Manifest the top two cards of your library." (Ethereal Ambush)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal } from '../../m3/scenario';
import { mpScenario, namesOn } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;

interface Script { targets?: TargetChoice[][]; name?: string; pickAll?: boolean; }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: script.name ?? 'Plains' });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.pickAll === false ? [] : (p as unknown as { options: ObjectId[] }).options });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const activation = (s: GameState, player: PlayerId, source: ObjectId, index = 0) => legal(s, player, 'activate').filter((a) => a.action.type === 'activate' && a.action.source === source)[index]!.action;
const activate = (s: GameState, source: ObjectId, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, activation(s, player, source)), script), script);
// (the active player has drawn a Plains from the padding of the library at the start of the scenario)
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');
const yardNames = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const libNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => s.objects[id]!.defId);
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
const colorsOf = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.colors];

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });

describe('CR 400.3, 402.1, 608.2c: "Return ~ and target creature you control to their owner\'s hand."', () => {
  const MENTOR = card('Test Mentor', 'Creature — Human Wizard', "{T}: Return ~ and target creature you control to their owner's hand.", { pt: ['1', '1'] });
  const start = () => mpScenario({ defs: [MENTOR, BEAR, ELF], zones: { p1: { battlefield: [{ name: 'Test Mentor', since: 0 }, 'Test Bear'] }, p2: { battlefield: ['Test Elf'] } } });
  it('is automated', () => expect(full(MENTOR)).toBe(true));
  it('~ and the target both go to their owner\'s hand', () => {
    const s0 = start();
    const s = activate(s0, find(s0, 'Test Mentor', 'battlefield', 'p1'), { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(handNames(s, 'p1').sort()).toEqual(['Test Bear', 'Test Mentor']);
    expect(namesOn(s)).toEqual(['Test Elf']);
  });
  it('the target may be ~ itself: it is returned once', () => {
    const s0 = start();
    const s = activate(s0, find(s0, 'Test Mentor', 'battlefield', 'p1'), { targets: [[obj(find(s0, 'Test Mentor', 'battlefield', 'p1'))]] });
    expect(handNames(s, 'p1')).toEqual(['Test Mentor']);
    expect(namesOn(s, 'p1')).toEqual(['Test Bear']);
  });
  it('negative: a creature an opponent controls is refused as the target', () => {
    const s0 = start();
    const s1 = act(s0, activation(s0, 'p1', find(s0, 'Test Mentor', 'battlefield', 'p1')));
    expect(s1.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Elf', 'battlefield', 'p2'))] })).toThrow();
  });
});

describe('CR 400.3, 115.3: "Return ~ and another target creature to their owners\' hands." (any controller)', () => {
  const SUN = card('Test Sun', 'Legendary Creature — Human Advisor', "{T}: Return ~ and another target creature to their owners' hands.", { pt: ['1', '1'] });
  const start = () => mpScenario({ defs: [SUN, BEAR, ELF], zones: { p1: { battlefield: ['Test Sun'] }, p3: { battlefield: ['Test Elf'] } } });
  it('is automated', () => expect(full(SUN)).toBe(true));
  it('an opponent\'s creature goes to its OWNER\'s hand, ~ to its own', () => {
    const s0 = start();
    const s = activate(s0, find(s0, 'Test Sun', 'battlefield', 'p1'), { targets: [[obj(find(s0, 'Test Elf', 'battlefield', 'p3'))]] });
    expect(handNames(s, 'p1')).toEqual(['Test Sun']);
    expect(handNames(s, 'p3')).toEqual(['Test Elf']);
    expect(namesOn(s)).toEqual([]);
  });
  it('negative: ~ itself is not a legal "another" target', () => {
    const s0 = start();
    const s1 = act(s0, activation(s0, 'p1', find(s0, 'Test Sun', 'battlefield', 'p1')));
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(find(s0, 'Test Sun', 'battlefield', 'p1'))] })).toThrow();
  });
});

describe('CR 701.23a, 201.3, 607.2d: "Choose a nonland card name. Search target player\'s graveyard, hand, and library for any number of cards with that name and exile them. Then that player shuffles."', () => {
  const ERASE = card('Test Erase', 'Sorcery', "Choose a nonland card name. Search target player's graveyard, hand, and library for any number of cards with that name and exile them. Then that player shuffles.");
  const start = () => mpScenario({
    defs: [ERASE, BEAR, ELF],
    zones: {
      p1: { hand: ['Test Erase', 'Test Bear'] },
      p2: { hand: ['Test Bear', 'Test Elf'], graveyard: ['Test Bear'], library: ['Test Bear', 'Test Elf'] },
      p3: { hand: ['Test Bear'], graveyard: ['Test Bear'] },
    },
  });
  it('is automated', () => expect(full(ERASE)).toBe(true));
  it('exiles every card with the chosen name from the target player\'s three zones, and only theirs', () => {
    const s0 = start();
    const s = cast(s0, 'Test Erase', { targets: [[pl('p2')]], name: 'Test Bear' });
    expect(handNames(s, 'p2')).toEqual(['Test Elf']);
    expect(yardNames(s, 'p2')).toEqual([]);
    expect(libNames(s, 'p2')).not.toContain('Test Bear');
    expect(libNames(s, 'p2')).toContain('Test Elf');
    expect(exileNames(s).filter((n) => n === 'Test Bear').length).toBe(3);
    expect(handNames(s, 'p1')).toContain('Test Bear');
    expect(handNames(s, 'p3')).toEqual(['Test Bear']);
    expect(yardNames(s, 'p3')).toEqual(['Test Bear']);
  });
  it('"any number": the caster may find none of them', () => {
    const s0 = start();
    const s = cast(s0, 'Test Erase', { targets: [[pl('p2')]], name: 'Test Bear', pickAll: false });
    expect(handNames(s, 'p2').sort()).toEqual(['Test Bear', 'Test Elf']);
    expect(yardNames(s, 'p2')).toEqual(['Test Bear']);
    expect(exileNames(s).filter((n) => n === 'Test Bear')).toEqual([]);
  });
  it('negative: a land card name is refused (nonland)', () => {
    const s0 = start();
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Erase', 'hand', 'p1') }), { targets: [[pl('p2')]] });
    for (let guard = 0; guard < 10 && s.pending?.kind !== 'chooseName'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'cardName' });
    expect(() => answer(s, { kind: 'chooseName', name: 'Plains' })).toThrow();
  });
});

describe('CR 613.1e, 613.4c, 105.3: "Enchanted creature gets +3/+1 and is black." (the colors are replaced, not added to)', () => {
  const STRENGTH = card('Test Strength', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +3/+1 and is black.');
  const start = () => mpScenario({ defs: [STRENGTH, BEAR, ELF], zones: { p1: { hand: ['Test Strength'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Elf'] } } });
  it('is automated', () => expect(full(STRENGTH)).toBe(true));
  it('the creature is 5/3 and only black while enchanted', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Strength', { targets: [[obj(bear)]] });
    expect(colorsOf(s, bear)).toEqual(['B']);
    expect([getChars(s, bear)!.power, getChars(s, bear)!.toughness]).toEqual(['5', '3']);
    expect(colorsOf(s, find(s, 'Test Elf', 'battlefield', 'p2'))).toEqual(['G']);
  });
  it('negative: before the Aura, the creature is green 2/2', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(colorsOf(s0, bear)).toEqual(['G']);
    expect([getChars(s0, bear)!.power, getChars(s0, bear)!.toughness]).toEqual(['2', '2']);
  });
});

describe('CR 604.3, 105.2c: "~ is colorless." works in every zone', () => {
  const FIRE = card('Test Fire', 'Instant', '~ is colorless.\n~ deals 3 damage to any target.', { cost: '{R}', colors: ['R'] });
  const RED = card('Test Red Fire', 'Instant', '~ deals 3 damage to any target.', { cost: '{R}', colors: ['R'] });
  const start = () => mpScenario({ defs: [FIRE, RED], zones: { p1: { hand: ['Test Fire', 'Test Red Fire'], graveyard: ['Test Fire'] } } });
  it('is automated', () => expect(full(FIRE)).toBe(true));
  it('colorless in hand and in the graveyard, while a plain red instant stays red', () => {
    const s = start();
    expect(colorsOf(s, find(s, 'Test Fire', 'hand', 'p1'))).toEqual([]);
    expect(colorsOf(s, findAll(s, 'Test Fire', 'graveyard', 'p1')[0]!)).toEqual([]);
    expect(colorsOf(s, find(s, 'Test Red Fire', 'hand', 'p1'))).toEqual(['R']);
  });
});

describe('CR 701.20a, 701.9b: "Target opponent reveals their hand and discards a creature card at random."', () => {
  const MAN = card('Test Rag', 'Creature — Human', "{T}: Target opponent reveals their hand and discards a creature card at random.", { pt: ['1', '1'] });
  const start = (hand: string[]) => mpScenario({ defs: [MAN, BEAR, ELF], cards: ['Island'], zones: { p1: { battlefield: ['Test Rag'] }, p2: { hand } } });
  it('is automated', () => expect(full(MAN)).toBe(true));
  it('one creature card is discarded, a land stays', () => {
    const s0 = start(['Island', 'Test Bear']);
    const s = activate(s0, find(s0, 'Test Rag', 'battlefield', 'p1'), { targets: [[pl('p2')]] });
    expect(yardNames(s, 'p2')).toEqual(['Test Bear']);
    expect(handNames(s, 'p2')).toEqual(['Island']);
  });
  it('only one of two creature cards goes', () => {
    const s0 = start(['Test Elf', 'Test Bear']);
    const s = activate(s0, find(s0, 'Test Rag', 'battlefield', 'p1'), { targets: [[pl('p2')]] });
    expect(yardNames(s, 'p2').length).toBe(1);
    expect(handNames(s, 'p2').length).toBe(1);
  });
  it('negative: with no creature card in hand nothing is discarded', () => {
    const s0 = start(['Island']);
    const s = activate(s0, find(s0, 'Test Rag', 'battlefield', 'p1'), { targets: [[pl('p2')]] });
    expect(yardNames(s, 'p2')).toEqual([]);
    expect(handNames(s, 'p2')).toEqual(['Island']);
  });
});

describe('CR 701.40a, 701.40e: "Manifest the top two cards of your library."', () => {
  const AMBUSH = card('Test Ambush', 'Instant', 'Manifest the top two cards of your library.');
  const start = (lib: string[]) => mpScenario({ defs: [AMBUSH, BEAR, ELF], zones: { p1: { hand: ['Test Ambush'], library: lib } } });
  it('is automated', () => expect(full(AMBUSH)).toBe(true));
  it('the top two cards become two face-down creatures; the library loses two', () => {
    const s0 = start(['Plains', 'Test Bear', 'Test Elf']); // (the first card is drawn at the start of the scenario)
    const before = s0.zones.library.p1!.length;
    const s = cast(s0, 'Test Ambush');
    const down = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.faceDown);
    expect(down.length).toBe(2);
    expect(s.zones.library.p1!.length).toBe(before - 2);
    expect(down.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Elf']);
    for (const id of down) expect([getChars(s, id)!.power, getChars(s, id)!.toughness]).toEqual(['2', '2']);
  });
  it('negative: a library of one card manifests one card only', () => {
    const s1 = start(['Plains', 'Test Bear']);
    const s0 = structuredClone(s1);
    s0.zones.library.p1 = s0.zones.library.p1!.slice(0, 1);
    const s = cast(s0, 'Test Ambush');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.faceDown).length).toBe(1);
  });
});
