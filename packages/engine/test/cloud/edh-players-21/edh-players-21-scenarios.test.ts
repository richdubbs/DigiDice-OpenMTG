/**
 * edh-players-21 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 608.2d, 101.4, 400.3          "Each opponent chooses a creature with the greatest mana value among creatures they control. Return those creatures to their owners' hands."
 *   CR 608.2d, 101.4, 402.1          "Each player chooses a nonland permanent they control. Return all nonland permanents not chosen this way ... Then you draw a card for each opponent who has more cards in their hand than you."
 *   CR 122.1f, 611.2c, 613.4c        "Each opponent gets a poison counter. Then each creature your opponents control gets -1/-1 until end of turn for each poison counter its controller has."
 *   CR 608.2d, 608.2h, 406.1, 120.3  "Each opponent exiles a creature with the greatest power among creatures that player controls. If ..., ~ deals damage to each opponent equal to the power of the creature they exiled."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const namesIn = (s: GameState, zone: 'battlefield' | 'exile' | 'hand', p: PlayerId): string[] => {
  const ids = zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === p) : zone === 'exile' ? s.zones.exile.filter((id) => s.objects[id]!.owner === p) : s.zones.hand[p]!;
  return ids.map((id) => nameOf(s, id)).sort();
};

/** What each chooser was offered, in order, and who chose. */
interface Seen { player: PlayerId; options: string[] }
/** Answer decisions: a chooseObjects is answered with the option named by `pick[player]` (or the first offered). */
function drive(s0: GameState, pick: Partial<Record<PlayerId, string>>, seen: Seen[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as { kind: string; player: PlayerId; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'chooseObjects') {
      const opts = p.options ?? [];
      seen.push({ player: p.player, options: opts.map((id) => nameOf(s, id)).sort() });
      const want = pick[p.player];
      const chosen = want === undefined ? opts.slice(0, p.min ?? 1) : opts.filter((id) => nameOf(s, id) === want).slice(0, 1);
      s = answer(s, { kind: 'chooseObjects', ids: chosen } as never);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function cast(s0: GameState, name: string, pick: Partial<Record<PlayerId, string>> = {}): { s: GameState; seen: Seen[] } {
  const seen: Seen[] = [];
  let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), pick, seen);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), pick, seen);
  return { s, seen };
}

// ---- Summon: Valefor's chapter I: each opponent chooses their own greatest mana value creature -----------------------------------------------------------------------------------

const SHAKE = card('Test Shake', 'Sorcery', "Each opponent chooses a creature with the greatest mana value among creatures they control. Return those creatures to their owners' hands.");
const BIG = card('Test Big Bear', 'Creature — Bear', '', { cost: '{3}', pt: ['3', '3'] });
const BIG2 = card('Test Big Wolf', 'Creature — Wolf', '', { cost: '{3}', pt: ['2', '2'] });
const MID = card('Test Mid Cat', 'Creature — Cat', '', { cost: '{2}', pt: ['2', '2'] });
const SMALL = card('Test Small Rat', 'Creature — Rat', '', { cost: '{1}', pt: ['1', '1'] });

describe('CR 608.2d, 101.4: "Each opponent chooses a creature with the greatest mana value among creatures they control. Return those creatures to their owners\' hands."', () => {
  const setup = (): GameState => mpScenario({
    defs: [SHAKE, BIG, BIG2, MID, SMALL],
    zones: { p1: { hand: ['Test Shake'], battlefield: ['Test Big Bear'] }, p2: { battlefield: ['Test Big Bear', 'Test Big Wolf', 'Test Small Rat'] }, p3: { battlefield: ['Test Mid Cat', 'Test Small Rat'] } },
  });
  it('is automated', () => expect(full(SHAKE)).toBe(true));
  it('each opponent chooses for themselves among their own tied greatest creatures only; the chosen ones (one each) return to their owners\' hands, nothing else moves', () => {
    const { s, seen } = cast(setup(), 'Test Shake', { p2: 'Test Big Wolf' });
    expect(seen.find((x) => x.player === 'p2')!.options).toEqual(['Test Big Bear', 'Test Big Wolf']); // the Rat is not offered; p1's and p3's creatures are not p2's
    expect(seen.find((x) => x.player === 'p3')).toBeUndefined(); // one greatest creature: no choice to make (CR 608.2d)
    expect(namesIn(s, 'hand', 'p2')).toEqual(['Test Big Wolf']);
    expect(namesIn(s, 'battlefield', 'p2')).toEqual(['Test Big Bear', 'Test Small Rat']);
    expect(namesIn(s, 'hand', 'p3')).toEqual(['Test Mid Cat']);
    expect(namesIn(s, 'battlefield', 'p3')).toEqual(['Test Small Rat']);
    expect(namesIn(s, 'battlefield', 'p1')).toEqual(['Test Big Bear']); // you are not an opponent
    expect(namesIn(s, 'hand', 'p4')).toEqual([]); // an opponent with no creature chooses nothing
  });
});

// ---- Consuming Tide: each player chooses a nonland permanent; the rest return; draw for opponents with bigger hands -----------------------------------------------------------------

const TIDE = card('Test Tide', 'Sorcery', "Each player chooses a nonland permanent they control. Return all nonland permanents not chosen this way to their owners' hands. Then you draw a card for each opponent who has more cards in their hand than you.");
const TRINKET = card('Test Trinket', 'Artifact', '');
const TRINKET2 = card('Test Trinket Two', 'Artifact', '');
const MARSH = card('Test Marsh', 'Land', '');

describe('CR 608.2d, 101.4, 402.1: "Each player chooses a nonland permanent they control. Return all nonland permanents not chosen this way ... draw a card for each opponent who has more cards in their hand than you."', () => {
  const setup = (): GameState => mpScenario({
    defs: [TIDE, TRINKET, TRINKET2, MARSH, SMALL, MID],
    zones: {
      p1: { hand: ['Test Tide'], battlefield: ['Test Small Rat', 'Test Mid Cat', 'Test Marsh'] },
      p2: { hand: ['Test Marsh', 'Test Marsh', 'Test Marsh'], battlefield: ['Test Trinket', 'Test Trinket Two'] },
      p3: { hand: ['Test Marsh'], battlefield: ['Test Trinket'] },
    },
  });
  it('is automated', () => expect(full(TIDE)).toBe(true));
  it('every player (you too) keeps the one permanent they chose; all other nonland permanents return to their owners\' hands; lands stay; then one card for each opponent whose hand is bigger than yours', () => {
    const s0 = setup();
    const held = s0.zones.hand['p1']!.length - 1; // (the turn's draw may already be in hand)
    const { s, seen } = cast(s0, 'Test Tide', { p1: 'Test Mid Cat', p2: 'Test Trinket Two' });
    expect(seen.map((x) => x.player)).toEqual(['p1', 'p2']); // p3 has one permanent: no choice
    expect(namesIn(s, 'battlefield', 'p1')).toEqual(['Test Marsh', 'Test Mid Cat']);
    expect(namesIn(s, 'battlefield', 'p2')).toEqual(['Test Trinket Two']);
    expect(namesIn(s, 'battlefield', 'p3')).toEqual(['Test Trinket']);
    expect(namesIn(s, 'hand', 'p2')).toEqual(['Test Marsh', 'Test Marsh', 'Test Marsh', 'Test Trinket']);
    // (counted as the instruction is performed, after the return)
    expect(s.zones.hand['p1']!.length).toBe(held + 1 + 1); // the cards held besides the spell + the returned Rat + one drawn (only p2's hand of 4 beats yours of 2)
  });
  it('no opponent with a bigger hand: nothing is drawn', () => {
    const s0 = mpScenario({ defs: [TIDE, TRINKET, SMALL], zones: { p1: { hand: ['Test Tide'], battlefield: ['Test Small Rat'] }, p2: { battlefield: ['Test Trinket'] } } });
    const held = s0.zones.hand['p1']!.length - 1;
    const { s } = cast(s0, 'Test Tide');
    expect(s.zones.hand['p1']!.length).toBe(held); // your Rat is the permanent you chose: nothing returns, and no opponent holds more cards than you: nothing drawn
  });
});

// ---- Phyresis Outbreak: -1/-1 for each poison counter its controller has ---------------------------------------------------------------------------------------------------------

const OUTBREAK = card('Test Outbreak', 'Sorcery', 'Each opponent gets a poison counter. Then each creature your opponents control gets -1/-1 until end of turn for each poison counter its controller has.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });

describe('CR 122.1f, 611.2c, 613.4c: "... gets -1/-1 until end of turn for each poison counter its controller has"', () => {
  const setup = (): GameState => mpScenario({
    defs: [OUTBREAK, OGRE],
    zones: { p1: { hand: ['Test Outbreak'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre'] }, p3: { battlefield: ['Test Ogre'] } },
    setup: (st) => { st.players.find((p) => p.id === 'p2')!.poison = 2; },
  });
  it('is automated', () => expect(full(OUTBREAK)).toBe(true));
  it('each creature is shrunk by its OWN controller\'s poison counters (after the new counter): 3 for p2\'s creatures, 1 for p3\'s, none for yours; the count is not shared', async () => {
    const { s } = cast(setup(), 'Test Outbreak');
    expect(s.players.find((p) => p.id === 'p2')!.poison).toBe(3);
    expect(s.players.find((p) => p.id === 'p3')!.poison).toBe(1);
    const { charsOfObject } = await import('../../../src/index');
    const power = (id: ObjectId): string => String(charsOfObject(s, s.objects[id]!).power);
    const of = (p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map(power);
    expect(of('p2')).toEqual(['2', '2']);
    expect(of('p3')).toEqual(['4']);
    expect(of('p1')).toEqual(['5']);
  });
});

// ---- Olórin's Searing Light: each opponent exiles their own greatest-power creature; damage equals the power of the one they exiled ------------------------------------------------

const LIGHT = card('Test Light', 'Sorcery', 'Each opponent exiles a creature with the greatest power among creatures that player controls. If there are two or more instant and/or sorcery cards in your graveyard, Test Light deals damage to each opponent equal to the power of the creature they exiled.');
const ZAP = card('Test Zap', 'Instant', '');
const BRUTE = card('Test Brute', 'Creature — Giant', '', { pt: ['5', '5'] });
const GRUNT = card('Test Grunt', 'Creature — Goblin', '', { pt: ['2', '2'] });
const CAT3 = card('Test Cat Three', 'Creature — Cat', '', { pt: ['3', '3'] });

describe('CR 608.2d, 608.2h, 406.1, 120.3: "Each opponent exiles a creature with the greatest power ... deals damage to each opponent equal to the power of the creature they exiled."', () => {
  const setup = (yard: string[]): GameState => mpScenario({
    defs: [LIGHT, ZAP, BRUTE, GRUNT, CAT3],
    zones: { p1: { hand: ['Test Light'], graveyard: yard }, p2: { battlefield: ['Test Brute', 'Test Grunt'] }, p3: { battlefield: ['Test Cat Three'] } },
  });
  it('is automated', () => expect(full(LIGHT)).toBe(true));
  it('each opponent exiles their own greatest creature; with two instants in your graveyard each opponent takes damage equal to the power of THEIR creature (5 and 3), an opponent with no creature takes none', () => {
    const { s } = cast(setup(['Test Zap', 'Test Zap']), 'Test Light');
    expect(namesIn(s, 'exile', 'p2')).toEqual(['Test Brute']);
    expect(namesIn(s, 'battlefield', 'p2')).toEqual(['Test Grunt']);
    expect(namesIn(s, 'exile', 'p3')).toEqual(['Test Cat Three']);
    expect(lifeOf(s, 'p2')).toBe(15);
    expect(lifeOf(s, 'p3')).toBe(17);
    expect(lifeOf(s, 'p4')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('only one instant or sorcery in your graveyard: the creatures are still exiled, no damage', () => {
    const { s } = cast(setup(['Test Zap']), 'Test Light');
    expect(namesIn(s, 'exile', 'p2')).toEqual(['Test Brute']);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p3')).toBe(20);
  });
});
