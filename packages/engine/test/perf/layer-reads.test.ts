/**
 * Review 2026-10-26 (performance): the volatile layer inputs (statics/layer-reads.ts). The characteristics cache leaves the fields the layers never read and the
 * volatile ones a computation did not read out of its key (rules/characteristics.ts `NEVER_READ_BY_LAYERS`, `VOLATILE`), so a step, a tapped land or a
 * declared attacker no longer recomputes every object. Checked here:
 *  - each volatile part, read by an effect, is in the key: an edit in place is seen at once (the answer agrees with a fresh computation);
 *  - not read, an edit of it (or of a never-read field) is answered from the cache;
 *  - the rule effects kept with a characteristics map (statics/rule-sources.ts) see a volatile part their conditions read;
 *  - the read sites of the layer code note what they read, and never read the never-read fields (a source pin);
 *  - cached against uncached over real games (`LAYER_READS_VERIFY`: every cache hit is computed again and compared).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getChars, type AbilityDef, type GameState, type Modification, type ObjectFilter, type Quantity, type StaticEffect } from '../../src/index';
import { CHARS_CACHE_STATS, NEVER_READ_BY_LAYERS, VOLATILE, allChars } from '../../src/rules/characteristics';
import { computeAll } from '../../src/statics/layers';
import { LAYER_READS_VERIFY } from '../../src/statics/layer-reads';
import { ruleContext } from '../../src/statics/rule-sources';
import { board, continuous, creature, each, enchantment, nth, SELF, staticOf } from '../m5/statics/fixtures';
import { measureReal, measureSoak } from './harness';
import { describeSlow } from '../slow';

const ANTHEM = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
const BEAR = creature('Test Bear', '2', '2');
/** A creature whose power is set by a quantity ("This creature's power is equal to ..."), a characteristic-defining ability. */
const counting = (q: Quantity): AbilityDef => staticOf('Its power is a number.', [continuous(SELF, [{ layer: '7b', power: q } as Modification])]);
const pumpOf = (filter: ObjectFilter): AbilityDef => staticOf('Some creatures get +1/+1.', [continuous(each(filter), [{ layer: '7c', power: 1, toughness: 1 }])]);

const agrees = (s: GameState): void => {
  const fresh = computeAll(s);
  for (const id of Object.keys(s.objects)) expect(getChars(s, id), id).toEqual(fresh.get(id));
};
/** Reads the characteristics, edits the state in place, reads again: was the second read a miss? The answers agree with fresh computations either way. */
function editInPlace(s: GameState, edit: (s: GameState) => void): boolean {
  allChars(s);
  agrees(s);
  const misses = CHARS_CACHE_STATS.misses;
  edit(s);
  allChars(s);
  const missed = CHARS_CACHE_STATS.misses > misses;
  agrees(s);
  return missed;
}

describe('volatile layer inputs: in the key when read, out of it when not', () => {
  const plain = (): GameState => board([ANTHEM, BEAR], ['Test Anthem', 'Test Bear'], ['Test Bear']);

  it('never-read fields (damage, lands played, main phases, combats begun) and unread volatile parts are answered from the cache', () => {
    const edits: ((s: GameState) => void)[] = [
      (s) => { s.objects[nth(s, 'Test Bear')]!.damage = 1; },
      (s) => { s.players[0]!.landsPlayedThisTurn++; },
      (s) => { s.turn.mains = (s.turn.mains ?? 0) + 1; s.turn.combats = (s.turn.combats ?? 0) + 1; },
      (s) => { s.turn.step = s.turn.step === 'upkeep' ? 'draw' : 'upkeep'; },
      (s) => { s.objects[nth(s, 'Test Bear')]!.tapped = true; },
      (s) => { s.players[0]!.manaPool.push({ type: 'G' }); },
      (s) => { s.players[0]!.turnStats.cardsDrawn++; s.players[0]!.life -= 3; },
      (s) => { s.combat = { number: 1, attacked: true, attackers: [{ id: nth(s, 'Test Bear'), defender: 'p2', defendingPlayer: 'p2', blocked: false, blockedBy: [] } as never], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] }; },
    ];
    for (const [i, edit] of edits.entries()) expect(editInPlace(plain(), edit), `edit ${i}`).toBe(false);
  });

  const cases: { name: string; ability: AbilityDef; edit: (s: GameState) => void }[] = [
    { name: 'the step ("during your upkeep")', ability: staticOf('During your upkeep, creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])], { condition: { cond: 'turnOf', whose: 'you', step: 'upkeep' } }), edit: (s) => { s.turn.step = 'upkeep'; } },
    { name: 'tapped ("tapped creatures get +1/+1")', ability: pumpOf({ types: ['Creature'], tapped: true }), edit: (s) => { s.objects[nth(s, 'Test Bear')]!.tapped = true; } },
    { name: 'the combat ("attacking creatures get +1/+1")', ability: pumpOf({ types: ['Creature'], attacking: true }), edit: (s) => { s.combat = { number: 1, attacked: true, attackers: [{ id: nth(s, 'Test Bear'), defender: 'p2', defendingPlayer: 'p2', blocked: false, blockedBy: [] } as never], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] }; } },
    { name: 'the mana pool (unspent mana)', ability: counting({ q: 'unspentMana' }), edit: (s) => { s.players[0]!.manaPool.push({ type: 'G' }); } },
    { name: 'the counts of the turn (cards drawn this turn)', ability: counting({ q: 'cardsDrawnThisTurn' }), edit: (s) => { s.players[0]!.turnStats.cardsDrawn += 2; } },
    { name: 'the life total', ability: counting({ q: 'life', of: { ref: 'you' } } as Quantity), edit: (s) => { s.players[0]!.life -= 5; } },
  ];
  for (const c of cases) {
    it(`${c.name}: read by an effect, an edit in place is seen at once`, () => {
      const READER = creature('Test Reader', '0', '4', [c.ability]);
      const s = board([ANTHEM, BEAR, READER], ['Test Anthem', 'Test Bear', 'Test Reader'], ['Test Bear']);
      if (c.name.startsWith('the step')) s.turn.step = 'draw';
      const before = JSON.stringify([...computeAll(s)]);
      expect(editInPlace(s, c.edit)).toBe(true);
      expect(JSON.stringify([...computeAll(s)]), 'the edit changes the characteristics').not.toBe(before);
    });
  }
});

describe('volatile layer inputs: the rule effects kept with a characteristics map', () => {
  it('a rule effect whose condition reads the step is collected again when the step changes in place', () => {
    const NOBLOCK: StaticEffect = { s: 'restrict', subject: each({ types: ['Creature'] }), mode: 'cant', action: 'block' } as StaticEffect;
    const WARDEN = creature('Test Warden', '1', '1', [staticOf('During your upkeep, creatures can\'t block.', [NOBLOCK as never], { condition: { cond: 'turnOf', whose: 'you', step: 'upkeep' } })]);
    const s = board([ANTHEM, BEAR, WARDEN], ['Test Anthem', 'Test Warden'], ['Test Bear']); // the anthem makes the state layered (the cached path)
    s.turn.step = 'draw';
    expect(ruleContext(s)?.sources.length ?? 0).toBe(0);
    s.turn.step = 'upkeep';
    expect(ruleContext(s)?.sources.length).toBe(1);
    s.turn.step = 'draw';
    expect(ruleContext(s)?.sources.length ?? 0).toBe(0);
  });
});

/** The layer code: what statics/layers.ts#computeAll runs, and the rule effects' collection that shares its entries (statics/rule-sources.ts). */
const SRC = join(__dirname, '../../src');
const LAYER_FILES = [
  ...['layers', 'live', 'match', 'mods', 'copy', 'face-down', 'text-change', 'merge', 'suspect', 'hone', 'abilities', 'while-object', 'levels', 'seats',
    'attached-player', 'commander', 'party', 'links', 'subtypes', 'rule-sources'].map((f) => `statics/${f}.ts`),
  'rules/base-chars.ts', 'rules/registries.ts', ...readdirSync(join(SRC, 'rules/base-parts')).map((f) => `rules/base-parts/${f}`),
];
const codeLines = (file: string): string[] => readFileSync(join(SRC, file), 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '')).filter((l) => !/^\s*(\*|\/\*\*)/.test(l));

describe('volatile layer inputs: the read sites (a source pin)', () => {
  it('the layer code never reads a never-read field', () => {
    const fields = [...NEVER_READ_BY_LAYERS.turn, ...NEVER_READ_BY_LAYERS.players, ...NEVER_READ_BY_LAYERS.objects];
    const re = new RegExp(`\\.(${fields.join('|')})\\b`);
    for (const f of LAYER_FILES) for (const l of codeLines(f)) expect(re.test(l), `${f}: ${l.trim()}`).toBe(false);
  });

  it('every read of a volatile part in the layer code is noted on its line or a few lines before it', () => {
    const volatile = /\.turn\.step\b|\.tapped\b|\.manaPool\b|\.turnStats\b|\.life\b|\.combat\b|historyCounter\(/;
    const filterField = /\bf\.tapped\b/; // the filter's own field, not the object's
    let reads = 0;
    for (const f of LAYER_FILES) {
      const lines = codeLines(f);
      lines.forEach((l, i) => {
        if (!volatile.test(l.replace(filterField, ''))) return;
        reads++;
        const near = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
        expect(/noteLayerRead\(/.test(near), `${f}: ${l.trim()}`).toBe(true);
      });
    }
    expect(reads).toBeGreaterThan(10);
    expect(Object.keys(VOLATILE).sort()).toEqual(['combat', 'objects', 'players', 'turn']);
  });
});

// About a minute (three whole games with every cache hit computed twice); a slow suite (npm run test:all).
describeSlow('volatile layer inputs over real games: every cached answer equals a fresh computation', () => {
  it('soak game 3 and two M4 real games run with LAYER_READS_VERIFY on, and play exactly as with it off', () => {
    const plain = measureSoak(1, undefined, 3);
    LAYER_READS_VERIFY.on = true;
    let checked: ReturnType<typeof measureSoak>;
    let real: ReturnType<typeof measureReal>;
    try {
      checked = measureSoak(1, undefined, 3);
      real = measureReal(2);
    } finally {
      LAYER_READS_VERIFY.on = false;
    }
    expect(checked.fingerprint).toBe(plain.fingerprint);
    expect(real.fingerprint).toBe(measureReal(2).fingerprint);
  }, 600_000);
});
