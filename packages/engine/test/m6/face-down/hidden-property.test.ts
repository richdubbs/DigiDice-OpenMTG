/**
 * M6-3 (m6 design 5 M6-3 "hidden-information property test"): random games with morph, megamorph, disguise, manifest and cloak decks (and Clone, whose copy
 * is still resolved by hand until M6-2), played by the seeded random bot of the soak tests. After every action, for every face-down permanent or spell and every
 * player who may not look at it (CR 708.5), `viewFor` never carries what would identify it: its definition, name, card id, cast record or memory, the word
 * "megamorph" (CR 702.37b-c), a log line or history entry naming it, an ability of it on the stack naming it, last known information linked to it; and the
 * events of that action name it only as "a face-down card". Every special action and face-down cast the engine lists is accepted (sampled).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, viewFor, type Action, type GameConfig, type GameEvent, type GameState, type PlayerId } from '../../../src/index';
import { FACE_DOWN_DEF_IDS } from '../../../src/types/card';
import { compiledDefs } from '../../fixtures';
import { Bot } from '../../m3/bot';
import { synthetic } from './support';

const SYNTH = [
  synthetic('Test Shroud Tailor', 'Creature — Human Rogue', '{1}{U}', 'When this creature enters, cloak the top card of your library.', { power: '1', toughness: '1' }),
  synthetic('Test Mask Weaver', 'Creature — Human Wizard', '{1}{U}', '{1}: Turn target face-down creature face up.', { power: '1', toughness: '2' }),
  synthetic('Test Veil Caster', 'Creature — Human Wizard', '{1}{U}', '{2}: Turn target creature face down.', { power: '1', toughness: '2' }),
  synthetic('Test Mist Seer', 'Creature — Human Wizard', '{2}{U}', 'When this creature enters, manifest the top card of your library.', { power: '1', toughness: '1' }),
];

/** Different nonland cards per player (two copies each), so a face-down card's name can appear in a view only by a leak while no other object has that name (`checkable`). */
const ALICE = ['Exalted Angel', 'Den Protector', 'Hooded Hydra', 'Grinning Demon', 'Whisperwood Elemental', 'Test Shroud Tailor', 'Test Veil Caster', 'Lightning Bolt'];
const BOB = ['Willbender', 'Alley Assailant', 'Branchsnap Lorian', 'Clone', 'Test Mask Weaver', 'Test Mist Seer', 'Counterspell', 'Shock'];
const LANDS = ['Plains', 'Forest', 'Island', 'Swamp', 'Mountain'];

function deckOf(cards: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 2; i++) out.push(...cards);
  while (out.length < 40) out.push(LANDS[out.length % LANDS.length]!);
  return out;
}

function config(seed: string): GameConfig {
  return {
    seed,
    players: [
      { name: 'Alice', deck: deckOf(ALICE), stops: { fullControl: true } },
      { name: 'Bob', deck: deckOf(BOB), stops: { fullControl: true } },
    ],
    defs: [...compiledDefs([...new Set([...ALICE, ...BOB, ...LANDS])].filter((n) => !n.startsWith('Test '))), ...SYNTH],
    options: { skipMulligans: true },
  };
}

const PSEUDO = new Set<string>(Object.values(FACE_DOWN_DEF_IDS));

/** The face-down permanents and spells of the state. */
function faceDown(s: GameState): string[] {
  return [...s.zones.battlefield, ...s.zones.stack].filter((id) => s.objects[id]!.faceDown && s.objects[id]!.kind !== 'ability');
}

/** A card name is evidence of a leak only when no other object of that name is public: lands and cards that also appear elsewhere face up are not checked. */
function checkable(s: GameState, id: string): string | null {
  const o = s.objects[id]!;
  const name = s.defs[o.defId]?.name;
  if (!name || LANDS.includes(name)) return null;
  const sameName = Object.values(s.objects).filter((x) => x.id !== id && s.defs[x.defId]?.name === name);
  return sameName.length === 0 ? name : null;
}

function checkHidden(s: GameState, events: readonly GameEvent[], firstSeen: Map<string, number>, where: string): number {
  let checks = 0;
  for (const id of faceDown(s)) {
    const o = s.objects[id]!;
    for (const p of s.players.map((x) => x.id as PlayerId).filter((x) => x !== o.controller)) {
      const v = viewFor(s, p);
      const seen = v.objects[id];
      if (!seen) continue; // another player's cancellable action is shown from the state it started from (CR 733.1): the object does not exist there yet
      const fail = (what: string): never => { throw new Error(`${where}: ${p} can learn ${o.defId} (${id}) through ${what}`); };
      if (!PSEUDO.has(seen.defId)) fail(`its defId ${seen.defId}`);
      for (const k of ['cardId', 'cast', 'chosen', 'links', 'faceUpX', 'commanderMoved'] as const) if (seen[k] !== undefined) fail(k);
      if (JSON.stringify(seen).toLowerCase().includes('megamorph')) fail('the word megamorph');
      if (JSON.stringify(seen).includes(o.defId)) fail('its object');
      for (const l of Object.values(v.lki)) if (l.newId === id) fail('last known information linked to it');
      for (const h of v.history) if (h.subject === id && Object.keys(h.facts ?? {}).length > 0) fail('a history entry');
      const name = checkable(s, id);
      if (name) {
        const since = firstSeen.get(id) ?? 0;
        for (const l of v.log) if (l.seq >= since && l.text.includes(name)) fail(`the log line "${l.text}"`);
        for (const sid of v.zones.stack) if (v.objects[sid]!.stack?.sourceId === id && JSON.stringify(v.objects[sid]).includes(name)) fail('an ability of it on the stack');
      }
      checks++;
    }
    for (const e of events) if (e.type === 'zoneChanged' && e.newId === id && e.name !== 'a face-down card') throw new Error(`${where}: the zoneChanged event of ${id} names "${e.name}"`);
  }
  return checks;
}

function play(seed: string, budget: number): { checks: number; faceDowns: number; specials: number } {
  const bot = new Bot(seed);
  let s = createGame(config(seed));
  const firstSeen = new Map<string, number>();
  let checks = 0;
  let specials = 0;
  const everFaceDown = new Set<string>();
  for (let i = 0; i < budget && !s.result; i++) {
    const d = s.pending!;
    if (d.kind === 'priority' && i % 7 === 0) {
      // the listed special actions and face-down casts are accepted (CR 116.2b; actions/cast-opt/face-down.ts)
      for (const la of legalActions(s, d.player)) {
        const a = la.action as Action & { method?: string };
        if (la.kind !== 'special' && !(la.kind === 'cast' && (a.method === 'morph' || a.method === 'disguise'))) continue;
        const r = applyAction(s, la.action);
        if (r.error) throw new Error(`${seed} #${i}: listed "${la.label}" was rejected: ${r.error.message}`);
        if (la.kind === 'special') specials++;
      }
    }
    const r = applyAction(s, bot.next(s));
    if (r.error) throw new Error(`${seed} #${i}: ${r.error.message}`);
    s = r.state;
    for (const id of faceDown(s)) {
      if (!firstSeen.has(id)) firstSeen.set(id, s.counters.log);
      everFaceDown.add(id);
    }
    checks += checkHidden(s, r.events, firstSeen, `${seed} #${i}`);
  }
  return { checks, faceDowns: everFaceDown.size, specials };
}

describe('M6-3: hidden information of face-down objects (property, random games)', () => {
  it('viewFor(opponent), the log and the events never identify a face-down permanent or spell', () => {
    let checks = 0;
    let faceDowns = 0;
    for (let g = 0; g < 8; g++) {
      const r = play(`m6-3-hidden-${g}`, 500);
      checks += r.checks;
      faceDowns += r.faceDowns;
    }
    expect(faceDowns).toBeGreaterThan(20); // the games did put cards face down
    expect(checks).toBeGreaterThan(500);
  }, 300_000);
});
