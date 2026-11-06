/**
 * Commander lane edh-c (EDHREC ranks 28,001-28,500), round edh-c-40: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler, in 4-player games. CR cites checked against the Comprehensive Rules of 2026-09-25 (media.wizards.com).
 *
 *   CR 701.21a, 118.3, 602.2b  "Sacrifice a black creature, a red creature, and a green creature" (three different creatures; a multicolored one pays any one part, ruling 2008-10-01)
 *   CR 404.1, 604.1, 611.3a    "~ has flying as long as an artifact card is in your graveyard", "... as long as an instant card and a sorcery card are in your graveyard"
 *   CR 611.2a, 613.1f          "{0}: ~ loses flying." (no duration)
 *   CR 402.1, 102.3, 602.5b    "Activate only if you have more cards in hand than each opponent."
 *   CR 508.1c, 506.2, 509.1b   "~ can't attack if defending player controls an untapped land.", "~ can't block if you control an untapped land."
 *   CR 603.5, 611.2a, 613.4c   "Whenever you cast an artifact spell, you may have target creature get +2/+0 and gain deathtouch until end of turn."
 *   CR 701.3d, 301.5           "Unattach all Equipment from target creature."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const activations = (s: GameState, player: PlayerId, source: ObjectId) => legal(s, player, 'activate').filter((a) => a.action.type === 'activate' && a.action.source === source);
const activate = (s: GameState, source: ObjectId, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, activations(s, player, source)[0]!.action), script), script);
const onBf = (s: GameState, name: string, p?: PlayerId): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name && (p === undefined || s.objects[id]!.controller === p));
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

describe('CR 701.21a, 118.3, 602.2b: "Sacrifice a black creature, a red creature, and a green creature" (three different creatures)', () => {
  const HERALD = card('Test Three Herald', 'Creature — Goblin Shaman', '{T}, Sacrifice a black creature, a red creature, and a green creature: Draw a card.', { pt: ['1', '1'], colors: ['U'], cost: '{U}' });
  const B = card('Test Black Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['B'], cost: '{B}' });
  const R = card('Test Red Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['R'], cost: '{R}' });
  const G = card('Test Green Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['G'], cost: '{G}' });
  const BR = card('Test Two Color Imp', 'Creature — Imp', '', { pt: ['1', '1'], colors: ['B', 'R'], cost: '{B}{R}' });
  const start = (names: string[]) => mpScenario({ defs: [HERALD, B, R, G, BR], zones: { p1: { battlefield: ['Test Three Herald', ...names] } } });
  it('is automated, as three sacrifice parts', () => {
    expect(full(HERALD)).toBe(true);
    expect(JSON.stringify(HERALD.faces)).toContain('"kind":"sacrifice"');
  });
  it('one creature of each color: all three are sacrificed and a card is drawn', () => {
    const s0 = start(['Test Black Imp', 'Test Red Imp', 'Test Green Imp']);
    const s = activate(s0, find(s0, 'Test Three Herald', 'battlefield', 'p1'));
    expect(onBf(s, 'Test Black Imp')).toBe(false);
    expect(onBf(s, 'Test Red Imp')).toBe(false);
    expect(onBf(s, 'Test Green Imp')).toBe(false);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') + 1);
  });
  it('negative: a missing color means no activation', () => {
    const s0 = start(['Test Black Imp', 'Test Green Imp']);
    expect(activations(s0, 'p1', find(s0, 'Test Three Herald', 'battlefield', 'p1'))).toEqual([]);
  });
  it('negative: one three-colored creature is not three creatures; a black-red creature and a green one are only two (ruling 2008-10-01)', () => {
    const s0 = start(['Test Two Color Imp', 'Test Green Imp']);
    expect(activations(s0, 'p1', find(s0, 'Test Three Herald', 'battlefield', 'p1'))).toEqual([]);
  });
  it('a multicolored creature pays one part: black-red, black, and green creatures can pay (black-red for red); all three go', () => {
    const s0 = start(['Test Two Color Imp', 'Test Black Imp', 'Test Green Imp']);
    const s = activate(s0, find(s0, 'Test Three Herald', 'battlefield', 'p1'));
    expect(onBf(s, 'Test Two Color Imp')).toBe(false);
    expect(onBf(s, 'Test Black Imp')).toBe(false);
    expect(onBf(s, 'Test Green Imp')).toBe(false);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') + 1);
  });
});

describe('CR 404.1, 604.1: "~ has <keyword> as long as <a card> is in your graveyard"', () => {
  const FLY = card('Test Scrap Flyer', 'Creature — Bird', 'This creature has flying as long as an artifact card is in your graveyard.', { pt: ['1', '1'] });
  const HASTE = card('Test Fallen Warrior Fan', 'Creature — Human', 'This creature has haste as long as a Warrior card is in your graveyard.', { pt: ['1', '1'] });
  const TWIN = card('Test Spell Pair', 'Creature — Human Wizard', 'This creature has first strike and trample as long as an instant card and a sorcery card are in your graveyard.', { pt: ['2', '2'] });
  const ART = card('Test Old Gizmo', 'Artifact', '');
  const WAR = card('Test Dead Warrior', 'Creature — Human Warrior', '', { pt: ['1', '1'] });
  const INST = card('Test Quick Spell', 'Instant', '');
  const SORC = card('Test Slow Spell', 'Sorcery', '');
  const defs = [FLY, HASTE, TWIN, ART, WAR, INST, SORC];
  it('are automated', () => { for (const d of [FLY, HASTE, TWIN]) expect(full(d), d.name).toBe(true); });
  it('flying with an artifact card in your graveyard, not without it, not with it in an opponent\'s graveyard', () => {
    const has = (zones: Parameters<typeof mpScenario>[0] extends infer O ? O : never): boolean => {
      const s = mpScenario(zones as never);
      return hasKeyword(getChars(s, find(s, 'Test Scrap Flyer', 'battlefield', 'p1')), 'flying');
    };
    expect(has({ defs, zones: { p1: { battlefield: ['Test Scrap Flyer'], graveyard: ['Test Old Gizmo'] } } })).toBe(true);
    expect(has({ defs, zones: { p1: { battlefield: ['Test Scrap Flyer'] } } })).toBe(false);
    expect(has({ defs, zones: { p1: { battlefield: ['Test Scrap Flyer'] }, p2: { graveyard: ['Test Old Gizmo'] } } })).toBe(false);
    expect(has({ defs, zones: { p1: { battlefield: ['Test Scrap Flyer'], graveyard: ['Test Dead Warrior'] } } })).toBe(false); // a creature card is no artifact card
  });
  it('haste with a Warrior card in your graveyard only', () => {
    const has = (z: Record<string, string[]>): boolean => {
      const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Fallen Warrior Fan'], ...z } } });
      return hasKeyword(getChars(s, find(s, 'Test Fallen Warrior Fan', 'battlefield', 'p1')), 'haste');
    };
    expect(has({ graveyard: ['Test Dead Warrior'] })).toBe(true);
    expect(has({ graveyard: ['Test Old Gizmo'] })).toBe(false);
  });
  it('first strike and trample need an instant card AND a sorcery card: one of each, not two instants, not one alone', () => {
    const kw = (graveyard: string[]): [boolean, boolean] => {
      const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Spell Pair'], graveyard } } });
      const id = find(s, 'Test Spell Pair', 'battlefield', 'p1');
      return [hasKeyword(getChars(s, id), 'first strike'), hasKeyword(getChars(s, id), 'trample')];
    };
    expect(kw(['Test Quick Spell', 'Test Slow Spell'])).toEqual([true, true]);
    expect(kw(['Test Quick Spell', 'Test Quick Spell'])).toEqual([false, false]);
    expect(kw(['Test Slow Spell'])).toEqual([false, false]);
    expect(kw([])).toEqual([false, false]);
  });
});

describe('CR 611.2a, 613.1f: "{0}: ~ loses flying." (no duration)', () => {
  const DRAKE = card('Test Mist Drake', 'Creature — Drake', 'Flying\n{0}: This creature loses flying.', { pt: ['2', '2'] });
  const OTHER = card('Test Other Drake', 'Creature — Drake', 'Flying', { pt: ['2', '2'] });
  it('is automated; the drake loses flying for good, another flyer keeps it', () => {
    expect(full(DRAKE)).toBe(true);
    const s0 = mpScenario({ defs: [DRAKE, OTHER], zones: { p1: { battlefield: ['Test Mist Drake', 'Test Other Drake'] } } });
    const id = find(s0, 'Test Mist Drake', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s0, id), 'flying')).toBe(true);
    const s = activate(s0, id);
    expect(hasKeyword(getChars(s, id), 'flying')).toBe(false);
    expect(hasKeyword(getChars(s, find(s, 'Test Other Drake', 'battlefield', 'p1')), 'flying')).toBe(true);
    expect(getChars(s, id).power).toBe('2');
  });
});

describe('CR 402.1, 102.3, 602.5b: "Activate only if you have more cards in hand than each opponent."', () => {
  const MEDIC = card('Test Careful Medic', 'Creature — Human Cleric', '{T}: You gain 1 life. Activate only if you have more cards in hand than each opponent.', { pt: ['1', '1'] });
  const hand = (n: number): string[] => Array.from({ length: n }, () => 'Plains');
  /** `h` are the hand sizes once the game is at the first main phase: the active player drew for the turn (4 players), so p1 is given one card fewer. */
  const can = (h: { p1: number; p2: number; p3: number; p4: number }): boolean => {
    const s = mpScenario({ defs: [MEDIC], zones: { p1: { battlefield: ['Test Careful Medic'], hand: hand(h.p1 - 1) }, p2: { hand: hand(h.p2) }, p3: { hand: hand(h.p3) }, p4: { hand: hand(h.p4) } } });
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => handSize(s, p as PlayerId))).toEqual([h.p1, h.p2, h.p3, h.p4]);
    return activations(s, 'p1', find(s, 'Test Careful Medic', 'battlefield', 'p1')).length > 0;
  };
  it('is automated', () => { expect(full(MEDIC)).toBe(true); });
  it('legal only when every opponent has fewer cards in hand than you do', () => {
    expect(can({ p1: 3, p2: 2, p3: 1, p4: 2 })).toBe(true);
    expect(can({ p1: 3, p2: 2, p3: 3, p4: 2 })).toBe(false); // a tie with one opponent
    expect(can({ p1: 3, p2: 2, p3: 2, p4: 4 })).toBe(false); // one opponent has more
    expect(can({ p1: 1, p2: 1, p3: 1, p4: 1 })).toBe(false);
    expect(can({ p1: 1, p2: 0, p3: 0, p4: 0 })).toBe(true);
  });
});

describe('CR 508.1c, 506.2, 509.1b: "~ can\'t attack if defending player controls an untapped land." / "~ can\'t block if you control an untapped land."', () => {
  const BRAWL = card('Test Land Brawler', 'Creature — Human', "This creature can't attack if defending player controls an untapped land.\nThis creature can't block if you control an untapped land.", { pt: ['2', '2'] });
  const LAND = card('Test Plain Field', 'Land', '');
  it('is automated', () => { expect(full(BRAWL)).toBe(true); });
  it('attacks the opponent whose lands are all tapped; may not attack one with an untapped land', () => {
    const s0 = mpScenario({
      defs: [BRAWL, LAND],
      zones: { p1: { battlefield: [{ name: 'Test Land Brawler', since: 0 }] }, p2: { battlefield: ['Test Plain Field'] }, p3: { battlefield: [{ name: 'Test Plain Field', tapped: true }] }, p4: {} },
    });
    const brawler = find(s0, 'Test Land Brawler', 'battlefield', 'p1');
    const s1 = toDeclareAttackers(s0);
    expect(() => declareAttackers(s1, [[brawler, 'p2']])).toThrow();
    expect(() => declareAttackers(s1, [[brawler, 'p3']])).not.toThrow();
    expect(() => declareAttackers(s1, [[brawler, 'p4']])).not.toThrow(); // no lands at all
  });
  it('blocks only while its controller has no untapped land', () => {
    const attackBlock = (lands: (string | { name: string; tapped: boolean })[]): boolean => {
      const s0 = mpScenario({ defs: [BRAWL, LAND, card('Test Raider', 'Creature — Human', '', { pt: ['1', '1'] })], zones: { p1: { battlefield: ['Test Raider'] }, p2: { battlefield: ['Test Land Brawler', ...lands] } } });
      const raider = find(s0, 'Test Raider', 'battlefield', 'p1');
      const brawler = find(s0, 'Test Land Brawler', 'battlefield', 'p2');
      let s = declareAttackers(toDeclareAttackers(s0), [[raider, 'p2']]);
      // no creature of p2's can block: the engine goes on without asking (the next decision is another turn's)
      for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareBlockers' && s.turn.activePlayer === 'p1'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
      if (s.pending?.kind !== 'declareBlockers') return false;
      try {
        answer(s, { kind: 'declareBlockers', blocks: [{ blocker: brawler, attacker: raider }] } as never);
        return true;
      } catch {
        return false;
      }
    };
    expect(attackBlock([])).toBe(true);
    expect(attackBlock([{ name: 'Test Plain Field', tapped: true }])).toBe(true);
    expect(attackBlock(['Test Plain Field'])).toBe(false);
  });
});

describe('CR 603.5, 611.2a, 613.4c: "Whenever you cast an artifact spell, you may have target creature get +2/+0 and gain deathtouch until end of turn."', () => {
  const SMITH = card('Test Spark Smith', 'Creature — Human Artificer', 'Whenever you cast an artifact spell, you may have target creature get +2/+0 and gain deathtouch until end of turn.', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const SPELL = card('Test Plain Spell', 'Sorcery', '');
  const start = () => mpScenario({ defs: [SMITH, BEAR, TRINKET, SPELL], zones: { p1: { battlefield: ['Test Spark Smith', 'Test Bear'], hand: ['Test Trinket', 'Test Plain Spell'] } } });
  it('is automated', () => { expect(full(SMITH)).toBe(true); });
  it('yes: the target creature gets +2/+0 and deathtouch; no: nothing happens', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const yes = cast(s0, 'Test Trinket', { yes: [true], targets: [[obj(bear)]] });
    expect(getChars(yes, bear).power).toBe('4');
    expect(hasKeyword(getChars(yes, bear), 'deathtouch')).toBe(true);
    const no = cast(start(), 'Test Trinket', { yes: [false], targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(getChars(no, find(no, 'Test Bear', 'battlefield', 'p1')).power).toBe('2');
  });
  it('negative: a non-artifact spell does not trigger it', () => {
    const s = cast(start(), 'Test Plain Spell', { yes: [true], targets: [[]] });
    expect(getChars(s, find(s, 'Test Bear', 'battlefield', 'p1')).power).toBe('2');
  });
});

describe('CR 701.3d, 301.5: "Unattach all Equipment from target creature."', () => {
  const DISARM = card('Test Disarm', 'Sorcery', 'Unattach all Equipment from target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}');
  const CURSE = card('Test Curse', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -1/-0.');
  it('is automated; every Equipment on the target is unattached, other Equipment and the Aura are not', () => {
    expect(full(DISARM)).toBe(true);
    const s0 = mpScenario({
      defs: [DISARM, BEAR, BLADE, CURSE],
      zones: { p1: { hand: ['Test Disarm'], battlefield: ['Test Bear', 'Test Blade', 'Test Blade', 'Test Curse'] }, p2: { battlefield: ['Test Bear', 'Test Blade'] } },
      setup: (x) => {
        const mine = find(x, 'Test Bear', 'battlefield', 'p1');
        for (const id of x.zones.battlefield) if (x.objects[id]!.controller === 'p1' && x.defs[x.objects[id]!.defId]!.name !== 'Test Bear') x.objects[id]!.attachedTo = mine;
        x.objects[find(x, 'Test Blade', 'battlefield', 'p2')]!.attachedTo = find(x, 'Test Bear', 'battlefield', 'p2');
      },
    });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(getChars(s0, bear).power).toBe('3'); // +1 +1 -1
    const s = cast(s0, 'Test Disarm', { targets: [[obj(bear)]] });
    const attached = (st: GameState, p: PlayerId, n: string): (ObjectId | null | undefined)[] => st.zones.battlefield.filter((id) => st.objects[id]!.controller === p && st.defs[st.objects[id]!.defId]!.name === n).map((id) => st.objects[id]!.attachedTo);
    expect(attached(s, 'p1', 'Test Blade').every((a) => a === null || a === undefined)).toBe(true);
    expect(attached(s, 'p1', 'Test Blade')).toHaveLength(2); // they stay on the battlefield
    expect(attached(s, 'p1', 'Test Curse')).toEqual([bear]);
    expect(attached(s, 'p2', 'Test Blade')).toEqual([find(s, 'Test Bear', 'battlefield', 'p2')]);
  });
});
