/**
 * FXH, audit 2026-10-12 C3 (CR 400.2, 701.23e): the card a search puts into a hand is named only to the players who may see it. Every FULL search-to-hand
 * card the audit lists is played for real (cast or activated, paid, resolved, the card chosen), and the other player's view of the log must not name it.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { legalActions, viewFor, type GameState, type ObjectId } from '../../src/index';
import { act, answer, find, pass, scenario, type PutOptions } from '../m3/scenario';
import { TUTORS, tutor } from './cards';

const SOUGHT = 'Lightning Bolt';
const plains = (n: number): string[] => Array(n).fill('Plains') as string[];

/** p1 with plenty of mana, a creature to sacrifice, two cards to discard, and the sought card deep in the library (Demonic Bargain exiles thirteen). */
function board(name: string): GameState {
  const d = tutor(name);
  const isPermanent = !d.faces[0]!.types.includes('Sorcery');
  const lands = [...Array(9).fill('Swamp'), 'Mountain'] as string[];
  const onField: PutOptions[] = isPermanent ? [{ name, counters: name === 'Ring of Three Wishes' ? { wish: 3 } : {} }] : [];
  return scenario(['Swamp', 'Mountain', 'Grizzly Bears', 'Island', SOUGHT, 'Plains'], {
    defs: [d],
    p1: {
      battlefield: [...lands, 'Grizzly Bears', ...onField],
      hand: [...(isPermanent ? [] : [name]), 'Island', 'Island'],
      library: [...plains(30), SOUGHT, ...plains(30)],
    },
  });
}

/** Answer p1's decisions: pay automatically, pick the sought card in a search, otherwise the first legal choice (the creature, the cards to discard). */
function decide(s: GameState): GameState {
  for (let guard = 0; guard < 50; guard++) {
    const d = s.pending;
    if (!d || d.kind === 'priority' || d.player !== 'p1') return s;
    switch (d.kind) {
      case 'payCost':
        s = answer(s, { kind: 'payCost', auto: true });
        break;
      case 'chooseObjects': {
        const hit = d.options.find((id) => s.defs[s.objects[id]?.defId ?? '']?.name === SOUGHT);
        s = answer(s, { kind: 'chooseObjects', ids: hit ? [hit] : d.options.slice(0, d.min) });
        break;
      }
      case 'yesNo':
        s = answer(s, { kind: 'yesNo', yes: false });
        break;
      case 'chooseOption':
        s = answer(s, { kind: 'chooseOption', ids: d.options.filter((o) => !o.disabled).slice(0, Math.max(1, d.min)).map((o) => o.id) });
        break;
      case 'order':
        s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
        break;
      default:
        throw new Error(`Unexpected decision ${d.kind}: ${d.prompt}`);
    }
  }
  throw new Error('Too many decisions');
}

/** Cast the tutor (or activate its search ability) and resolve it. */
function play(name: string): GameState {
  let s = board(name);
  const own = tutor(name);
  const isPermanent = !own.faces[0]!.types.includes('Sorcery');
  const card: ObjectId = find(s, name, isPermanent ? 'battlefield' : 'hand', 'p1');
  const la = legalActions(s, 'p1').find((a) => a.object === card && (isPermanent ? a.kind === 'activate' : a.kind === 'cast'));
  expect(la, `${name}: no ${isPermanent ? 'activation' : 'cast'} offered`).toBeDefined();
  s = decide(act(s, la!.action));
  for (let guard = 0; s.zones.stack.length > 0 && guard < 20; guard++) s = decide(pass(s));
  expect(s.zones.stack, name).toEqual([]);
  return s;
}

describe('C3: the card a tutor puts into a hand is named only to its owner (CR 400.2, 701.23e)', () => {
  it.each(Object.keys(TUTORS))('%s compiles FULL', (name) => {
    expect(tutor(name).automation?.level).toBe('full');
  });

  it.each(Object.keys(TUTORS))('%s: the other player reads "a card", the searcher reads its name', (name) => {
    const s = play(name);
    const sought = s.zones.hand['p1']!.concat(s.zones.graveyard['p1']!).find((id) => s.defs[s.objects[id]!.defId]?.name === SOUGHT);
    expect(sought, `${name}: the sought card left the library`).toBeDefined();
    const theirs = viewFor(s, 'p2').log.map((e) => e.text);
    const mine = viewFor(s, 'p1').log.map((e) => e.text);
    expect(theirs).toContain("A card is put into Alice's hand.");
    expect(mine).toContain(`${SOUGHT} is put into its owner's hand.`);
    expect(theirs.filter((t) => t.includes(`${SOUGHT} is put into`) && t.includes('hand'))).toEqual([]);
    // Gamble's random discard may reveal the sought card by putting it into the graveyard (a public zone); otherwise nothing ever names it to p2.
    if (s.objects[sought!]!.zone === 'hand') expect(theirs.filter((t) => t.includes(SOUGHT))).toEqual([]);
    // A spectator sees no more than the other player.
    expect(viewFor(s, null).log.map((e) => e.text).filter((t) => t.includes(`${SOUGHT} is put into its owner's hand`))).toEqual([]);
  });

  const cache = process.env['OPENMTG_CACHE_DIR'];
  const jsonl = cache ? path.join(cache, 'cards.jsonl') : '';
  it.runIf(jsonl !== '' && existsSync(jsonl))('the inline Oracle fields equal the local index', () => {
    const want = new Set(Object.keys(TUTORS));
    for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
      if (!line || want.size === 0) continue;
      const c = JSON.parse(line) as Record<string, unknown>;
      const name = c['name'] as string;
      if (!want.has(name)) continue;
      want.delete(name);
      const o = TUTORS[name]! as unknown as Record<string, unknown>;
      for (const k of ['mana_cost', 'type_line', 'power', 'toughness', 'oracle_text']) expect(c[k], `${name}.${k}`).toEqual(o[k]);
    }
    expect([...want]).toEqual([]);
  });
});
