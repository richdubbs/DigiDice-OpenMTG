/**
 * Random bots play whole games with synthetic cards whose static abilities use every implemented layer (anthems, a lord that grants flying, a
 * characteristic-defining star creature, a color-setter, a Humility-like and an Opalescence-like enchantment, a power/toughness switcher). After EVERY action the
 * cached `getChars` of every object must equal a from-scratch `computeAll`; the engine never throws; and replaying the actions reproduces the final state
 * (the layers are a pure function of the state, so they cannot break determinism).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getChars, legalActions, replay, type Action, type GameConfig, type GameState } from '../../../src/index';
import { readingStable } from '../../../src/rules/characteristics';
import { computeAll } from '../../../src/statics/layers';
import { layerSourcesPresent } from '../../../src/statics/live';
import { compiledDefs } from '../../fixtures';
import { Bot as RandomBot } from '../../m3/bot';
import { describeSlow } from '../../slow';
import { continuous, creature, each, enchantment, SELF, staticOf } from './fixtures';

const count = { q: 'count', of: each({ types: ['Creature'], controller: 'you' }) } as const;
const mv = { q: 'stat', stat: 'manaValue', of: { ref: 'subject' } } as const;

const DEFS = [
  enchantment('Soak Anthem', '{1}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]),
  creature('Soak Skylord', '2', '2', [staticOf('Other creatures you control have flying.', [continuous(each({ types: ['Creature'], controller: 'you', other: true }), [{ layer: 6, add: [{ kind: 'keyword', text: 'Flying', keyword: 'flying' }] }])])], { cost: '{1}{W}' }),
  creature('Soak Star', '*', '*', [staticOf('Soak Star\'s power and toughness are each equal to the number of creatures you control.', [continuous(SELF, [{ layer: '7a', power: count, toughness: count }], true)])], { cost: '{2}' }),
  enchantment('Soak Dye', '{1}{W}', [staticOf('Each creature is blue.', [continuous(each({ types: ['Creature'] }), [{ layer: 5, colors: { set: ['U'] } }])])]),
  enchantment('Soak Humility', '{2}{W}{W}', [staticOf('All creatures lose all abilities and are 1/1.', [continuous(each({ types: ['Creature'] }), [{ layer: 6, removeAll: true }, { layer: '7b', power: 1, toughness: 1 }])])]),
  enchantment('Soak Opalescence', '{2}{W}{W}', [staticOf('Each other non-Aura enchantment is a creature with base P/T equal to its mana value.', [continuous(each({ types: ['Enchantment'], notSubtypes: ['Aura'], other: true }), [{ layer: 4, types: { add: ['Creature'] } }, { layer: '7b', power: mv, toughness: mv }])])]),
  enchantment('Soak Twist', '{2}{W}', [staticOf('Creatures you control have their power and toughness switched.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7d', switchPT: true }])])]),
  creature('Soak Bear', '2', '2', [], { cost: '{1}{W}' }),
  creature('Soak Ogre', '4', '3', [], { cost: '{3}{W}' }),
  creature('Soak Wall', '0', '4', [{ kind: 'keyword', text: 'Defender', keyword: 'defender' }], { cost: '{1}{W}' }),
];
// Two lords and four bodies so that a lord and a creature to give flying to are on the battlefield together in some game (asserted below).
const SPELLS = ['Soak Anthem', 'Soak Skylord', 'Soak Skylord', 'Soak Star', 'Soak Star', 'Soak Dye', 'Soak Humility', 'Soak Opalescence', 'Soak Twist', 'Soak Bear', 'Soak Bear', 'Soak Bear', 'Soak Ogre', 'Soak Wall'];

function config(seed: string): GameConfig {
  const deck = [...Array(20).fill('Plains'), ...SPELLS, ...SPELLS.slice(0, 5)];
  return {
    seed,
    players: [{ name: 'Alice', deck, stops: { fullControl: true } }, { name: 'Bob', deck, stops: { fullControl: true } }],
    defs: [...compiledDefs(['Plains']), ...DEFS],
  };
}

/** The random bot, but it casts spells and plays lands much more often than a uniform pick among the legal actions would (so lords and creatures meet on the battlefield). */
class Bot extends RandomBot {
  override next(s: GameState): Action {
    const d = s.pending!;
    if (d.kind === 'priority' && this.chance(70)) {
      const plays = legalActions(s, d.player).filter((a) => a.action.type === 'cast' || a.action.type === 'playLand');
      if (plays.length > 0) return this.pick(plays).action;
    }
    return super.next(s);
  }
}

function sameAsFresh(s: GameState, where: string): void {
  const fresh = computeAll(s);
  const check = (id: string): void => {
    const a = JSON.stringify(getChars(s, id));
    const b = JSON.stringify(fresh.get(id));
    if (a !== b) throw new Error(`${where}: cached characteristics of ${id} (${s.objects[id]!.defId}, ${s.objects[id]!.zone}) differ from a fresh computation:\n${a}\n${b}`);
  };
  // The first object goes through the per-call path (the cache checked against the state), the others through one stable read of the same state (WP30:
  // `readingStable` checks the cache once for all of them); both must equal the fresh computation.
  const [first, ...rest] = Object.keys(s.objects);
  if (first !== undefined) check(first);
  readingStable(s, () => rest.forEach(check));
}

// QT: about 8 s; a slow suite (npm run test:all)
describeSlow('soak: random games with static abilities in every layer', () => {
  it('8 games x 220 actions: cached = uncached after every action, no exception, replay reproduces the game', () => {
    let layeredStates = 0;
    let permanents = 0;
    let sawFlyingGrant = false;
    let sawStar = false;
    const seen = new Set<string>();
    for (let g = 0; g < 8; g++) {
      const cfg = config(`statics-soak-${g}`);
      const bot = new Bot(`statics-soak-${g}`);
      let s = createGame(cfg);
      const actions: Action[] = [];
      for (let i = 0; i < 220 && !s.result; i++) {
        const action = bot.next(s);
        const r = applyAction(s, action);
        if (r.error) throw new Error(`game ${g}, action ${i}: ${JSON.stringify(action)} was rejected: ${r.error.message}`);
        s = r.state;
        actions.push(action);
        sameAsFresh(s, `game ${g}, action ${i}`);
        if (layerSourcesPresent(s)) layeredStates++;
        permanents += s.zones.battlefield.length;
        for (const id of s.zones.battlefield) {
          const c = getChars(s, id);
          if (c.keywords.some((k) => k.keyword === 'flying') && c.abilities.some((a) => a.origin === 'granted')) sawFlyingGrant = true;
          if (c.name === 'Soak Star' && /^\d+$/.test(c.power ?? '')) sawStar = true;
          seen.add(c.name);
          if (c.name === 'Soak Star' && c.power === '*') throw new Error('a CDA creature on the battlefield kept its "*"');
        }
      }
      const replayed = replay(cfg, actions);
      expect(replayed.errors).toEqual([]);
      expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(s));
    }
    console.log('statics soak:', layeredStates, 'layered states checked;', permanents, 'permanents seen;', 'granted flying seen:', sawFlyingGrant, '; star evaluated:', sawStar, [...seen].join(','));
    expect(layeredStates).toBeGreaterThan(200);
    expect(sawStar).toBe(true);
    expect(sawFlyingGrant).toBe(true); // a layer 6 grant was seen on a creature
  }, 180_000);
});
