/**
 * FAST5 fix-guards: the two whole-index guards FAST5 left failing (test/m5/parser/review.test.ts SELF contract guard, test/m5/templates-b/corpus.test.ts
 * mana guard), the defect one of them found, and the mana-ability shapes the other flagged that E5's own tests did not play.
 *
 *   CR 201.5, 700.2   a mode's flavor label ("• Kill -- This spell deals 3 damage ...") is structure up to its dash; a body that opens with a reference to the
 *                     object itself keeps the whole reference as its SELF token (parser/segment.ts#bulletMode: the claim ran into the reference's words)
 *   CR 605.3a, 118.3  "{T}, Sacrifice a Food: Add one mana of any color" (Gilded Goose) and "{T}, Remove a charge counter from ~: Add one mana of any
 *                     color" (Vivid lands, Sphere of the Suns): the native mana path pays the other cost parts; not offered when they can't be paid
 *
 * Synthetic wording with the shapes of real cards (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pool, scenario } from '../../m3/scenario';
import { face, segment } from '../../m5/parser/support';
import type { SegmentedFace } from '../../../src/parser/segment';

const modeLabels = (f: SegmentedFace): string[] => f.ledger.filter((e) => e.status === 'structure' && e.by === 'mode-label').map((e) => f.pre.normalized.slice(...e.range));
const selfWords = (f: SegmentedFace): string[] => {
  const out: string[] = [];
  const walk = (ts: readonly { kind: string; range: [number, number]; sub?: readonly unknown[] }[]): void => {
    for (const t of ts) {
      if (t.kind === 'SELF') out.push(f.pre.normalized.slice(...t.range));
      if (t.sub) walk(t.sub as never);
    }
  };
  for (const a of f.abilities) for (const m of a.modal?.modes ?? []) for (const s of m.sentences) walk(s.tokens);
  return out;
};

describe('CR 201.5, 700.2: a mode label never takes the words of a self reference that opens the mode', () => {
  it('"This spell" after a mode label: the label ends at its dash, the SELF token is the whole "This spell"', () => {
    const f = segment(face('Test Phasers', 'Instant', 'Choose one --\n• Stun -- Tap target creature.\n• Kill -- This spell deals 3 damage to target attacking creature.'));
    expect(modeLabels(f)).toEqual(['Stun --', 'Kill --']);
    expect(selfWords(f)).toEqual(['This spell']);
  });

  it('the card\'s name and a legendary short name after a mode label', () => {
    const named = segment(face('Test Spuds', 'Artifact — Food', '{2}, {T}, Sacrifice Test Spuds: Choose one --\n• Boil -- Test Spuds deals 1 damage to any target.\n• Stew -- You gain 3 life.'));
    expect(modeLabels(named)).toEqual(['Boil --', 'Stew --']);
    expect(selfWords(named)).toEqual(['Test Spuds']);
    const short = segment(face('Testra, the Burner', 'Legendary Creature — Dragon', 'Whenever Testra attacks, choose one --\n• Burn the village -- Destroy target land.\n• Burn the peasants -- Testra deals 4 damage to target creature.'));
    expect(modeLabels(short)).toEqual(['Burn the village --', 'Burn the peasants --']);
    expect(selfWords(short)).toEqual(['Testra']);
  });

  it('the ledger of such a mode still tiles: nothing between the label and the mode text is left over', () => {
    const f = segment(face('Test Watch', 'Instant', 'Choose one --\n• Rouse -- Creatures you control get +1/+1 until end of turn.\n• Traps -- This spell deals 5 damage to target attacking creature.'));
    const traps = f.ledger.filter((e) => f.pre.normalized.slice(...e.range).startsWith('This spell'));
    expect(traps).toHaveLength(1);
  });
});

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}

const GOOSE = card('Test Goose', 'Creature — Bird', 'Flying\n{T}, Sacrifice a Food: Add one mana of any color.', { cost: '{G}', colors: ['G'], pt: ['0', '2'] });
const FOOD = card('Test Food', 'Artifact — Food', '{2}, {T}, Sacrifice this artifact: You gain 3 life.', { cost: '{1}' });
const VIVID = card('Test Vivid', 'Land', 'This land enters tapped with two charge counters on it.\n{T}: Add {R}.\n{T}, Remove a charge counter from this land: Add one mana of any color.');
const DEFS = [GOOSE, FOOD, VIVID];

const onField = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name).length;
const activations = (s: GameState, name: string): string[] => {
  const id = find(s, name, 'battlefield');
  return legal(s, 'p1', 'activate').filter((a) => a.object === id).map((a) => a.label);
};
function activate(s: GameState, name: string, index: number, color: Color, choose?: string): GameState {
  const id = find(s, name, 'battlefield');
  const a = legal(s, 'p1', 'activate').filter((x) => x.object === id)[index];
  if (!a) throw new Error(`no activation ${index} of ${name}`);
  let t = act(s, a.action);
  for (let i = 0; i < 4 && t.pending?.kind !== 'priority'; i++) {
    if (t.pending?.kind === 'chooseColor') t = answer(t, { kind: 'chooseColor', color });
    else if (t.pending?.kind === 'chooseObjects' && choose) t = answer(t, { kind: 'chooseObjects', ids: [find(t, choose, 'battlefield')] });
    else break;
  }
  return t;
}

describe('CR 605.3a, 118.3, 602.2b: mana abilities with other cost parts the guard flagged (Gilded Goose, the Vivid lands)', () => {
  it('"{T}, Sacrifice a Food": not offered without a Food; with one, the Food is sacrificed and the mana added', () => {
    const none = scenario([], { p1: { battlefield: ['Test Goose'] }, defs: DEFS });
    expect(activations(none, 'Test Goose')).toEqual([]);
    const s = scenario([], { p1: { battlefield: ['Test Goose', 'Test Food'] }, defs: DEFS });
    expect(activations(s, 'Test Goose')).toHaveLength(1);
    const t = activate(s, 'Test Goose', 0, 'U', 'Test Food');
    expect(pool(t, 'p1')).toBe('U');
    expect(onField(t, 'Test Food')).toBe(0);
    expect(t.objects[find(t, 'Test Goose', 'battlefield')]!.tapped).toBe(true);
  });

  it('"{T}, Remove a charge counter from this land": removes one; with no counter left only {R} is offered', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Vivid', counters: { charge: 1 } }] }, defs: DEFS });
    expect(activations(s, 'Test Vivid')).toHaveLength(2);
    const t = activate(s, 'Test Vivid', 1, 'B');
    expect(pool(t, 'p1')).toBe('B');
    expect(t.objects[find(t, 'Test Vivid', 'battlefield')]!.counters['charge'] ?? 0).toBe(0);
    const empty = scenario([], { p1: { battlefield: [{ name: 'Test Vivid', counters: { charge: 0 } }] }, defs: DEFS });
    expect(activations(empty, 'Test Vivid')).toHaveLength(1);
  });

  it('both cards are full (the native path runs them, CR 605.1a)', () => {
    expect(GOOSE.automation.level).toBe('full');
    expect(VIVID.automation.level).toBe('full');
  });
});
