/**
 * std-rn (parallel slot N, Commander precon cards, tuning half): the template data of parser/templates/zz-cloud/std-rn.json ("each player shuffles their
 * [hand and] graveyard into their library[, then draws N cards]"; its phase-out templates were dropped for std-rm's, which reached main first) and the parser and renderer changes of the round:
 * activation restrictions "during the <step>" (parser/lower/activation.ts, render/abil.ts), the Cond "you cast ~ during your main phase" (parser/holes/cond.ts,
 * render/cond.ts) and the fold of each player's shuffle (render/fold.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of
 * any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in std-rn-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRn from '../../../src/parser/templates/zz-cloud/std-rn.json';
import review from '../../m5/golden/cards/cloud-std-rn-review.json';
import { renderAbility, renderGate } from '../../../src/index';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRn as Template[];
const MECH_COUNT = 3;
/**
 * The stable templates with fewer than three golden cards (design 6.9 deviation, named in the record): "Each player shuffles their graveyard into their library" is
 * printed on two cards (Struggle // Survive; the other, Mnemonic Nexus, is in the held-out half), the hand-and-graveyard form alone on Temporal Cascade among the
 * cards that can be full, and with "then draws N cards" on Timetwister and Day's Undoing (Time Spiral and Game Plan keep other manual sentences).
 */
const NARROW: Readonly<Record<string, number>> = {
  'eff.stdrn.eachPlayer.shuffle.graveyard': 1,
  'eff.stdrn.eachPlayer.shuffle.handGraveyard': 1,
  'eff.stdrn.eachPlayer.shuffle.handGraveyard.draw': 2,
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rn template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rn.json, after zz-cloud/std-r9.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rn.json');
    expect(files.indexOf('zz-cloud/std-rn.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-rn.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrn.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrn\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards of the tuning half that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      // design 6.9 asks for three; NARROW lists the wordings printed on fewer cards of the tuning half (a deviation the record names for the owner)
      expect(evidence(t.id).length, t.id).toBeGreaterThanOrEqual(NARROW[t.id] ?? 3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('every template of the file is stable (the phase-out templates were dropped for std-rm\'s, which reached main first)', () => {
    expect(MECH.filter((t) => t.status === 'experimental').map((t) => t.id)).toEqual([]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rn guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rn guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rn guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const labelEnd = words.indexOf('--'); // a flavor word before "--" has no rules meaning (CR 207.2d): any words may stand there
        words.forEach((w, i) => {
          if (i <= labelEnd) return;
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();


describe.skipIf(index === null)('std-rn design 6.10 (local index): synthetic examples', () => {
  it('no std-rn line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


// ---- the parser and renderer changes of the round ----------------------------------------------------------------------------------------------------------

const RCTX = { selfNames: ['Test Card'], selfTypes: ['Artifact'] };
const lowered = (text: string, type = 'Artifact') => parseCard(card('Test Card', type, text), OPTS).faces[0]!;

describe('std-rn parser (CR 602.5b): "Activate only during <the step of any turn>" and "during an opponent\'s turn"', () => {
  const cases: [string, unknown][] = [
    ['during the declare attackers step', { cond: 'turnOf', whose: 'any', step: 'declareAttackers' }],
    ['during the declare blockers step', { cond: 'turnOf', whose: 'any', step: 'declareBlockers' }],
    ['during the combat damage step', { cond: 'turnOf', whose: 'any', step: 'combatDamage' }],
    ['during the end of combat step', { cond: 'turnOf', whose: 'any', step: 'endCombat' }],
    ['during any upkeep step', { cond: 'turnOf', whose: 'any', step: 'upkeep' }],
    ["during an opponent's turn", { cond: 'turnOf', whose: 'opponent' }],
    ["during an opponent's upkeep", { cond: 'turnOf', whose: 'opponent', step: 'upkeep' }],
  ];
  it.each(cases)('"Activate only %s." is that turn condition, automated, and passes the render gate', (words, cond) => {
    const f = lowered(`{T}: Draw a card. Activate only ${words}.`);
    expect(automated(f.abilities), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    expect((f.abilities[0] as { onlyIf?: unknown }).onlyIf).toEqual(cond);
  });
  it('other words stay a restriction the controller attests (never a dropped one)', () => {
    for (const words of ['during the end step of combat', 'during each combat damage step', 'during the declare attackers step of your turn']) {
      const f = lowered(`{T}: Draw a card. Activate only ${words}.`);
      expect(fullyAutomated(f), words).toBe(false);
    }
  });
});

describe('std-rn renderer (family activation-any-step, CR 602.5b): the end of combat step and the upkeep of any turn are named with "step"', () => {
  const def = (step: string) => ({ kind: 'activated', cost: { tap: true }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }, onlyIf: { cond: 'turnOf', whose: 'any', step } }) as never;
  it('"during the end of combat step" and "during end of combat" are accepted for the end of combat step; the upkeep is "any upkeep step" or "each upkeep"', () => {
    expect(renderGate(def('endCombat'), ['{T}: Draw a card. Activate only during the end of combat step.'], RCTX).ok).toBe(true);
    expect(renderGate(def('endCombat'), ['{T}: Draw a card. Activate only during end of combat.'], RCTX).ok).toBe(true);
    expect(renderGate(def('upkeep'), ['{T}: Draw a card. Activate only during any upkeep step.'], RCTX).ok).toBe(true);
    expect(renderGate(def('upkeep'), ['{T}: Draw a card. Activate only during each upkeep.'], RCTX).ok).toBe(true);
  });
  it('near misses: another step, or your own step, is refused', () => {
    expect(renderGate(def('endCombat'), ['{T}: Draw a card. Activate only during the end step.'], RCTX).ok).toBe(false);
    expect(renderGate(def('upkeep'), ['{T}: Draw a card. Activate only during your upkeep.'], RCTX).ok).toBe(false);
    expect(renderGate(def('declareBlockers'), ['{T}: Draw a card. Activate only during any declare blockers step.'], RCTX).ok).toBe(false);
  });
});

describe('std-rn Cond (CR 601.2i, 505.1): "you cast ~ during your main phase" is an "as you cast" condition', () => {
  const ADDENDUM = 'Target creature gets +1/+1 until end of turn. If you cast this spell during your main phase, that creature gets +3/+3 until end of turn instead.';
  it('lowers to asCast of a main phase of your turn and passes the render gate', () => {
    const f = lowered(ADDENDUM, 'Instant');
    expect(automated(f.abilities), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain(JSON.stringify({ cond: 'asCast', held: { cond: 'turnOf', whose: 'you', step: ['main1', 'main2'] } }));
  });
  it('near misses are not read: another phase, another player, or the present tense', () => {
    for (const text of [
      ADDENDUM.replace('during your main phase', 'during your end step'),
      ADDENDUM.replace('during your main phase', "during an opponent's main phase"),
      ADDENDUM.replace('If you cast this spell during your main phase', "If it's your main phase"),
    ]) {
      const f = lowered(text, 'Instant');
      expect(JSON.stringify(f.abilities).includes('"asCast"') && fullyAutomated(f), text).toBe(false);
    }
  });
  it('the renderer says it back; an asCast condition of another turn condition still has no renderer', () => {
    const spell = (held: unknown) => ({ kind: 'spell', effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'asCast', held }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } }) as never;
    const SCTX = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
    expect(renderGate(spell({ cond: 'turnOf', whose: 'you', step: ['main1', 'main2'] }), ['If you cast this spell during your main phase, draw a card.'], SCTX).ok).toBe(true);
    expect(renderGate(spell({ cond: 'turnOf', whose: 'you', step: ['main1'] }), ['If you cast this spell during your main phase, draw a card.'], SCTX).ok).toBe(false);
    expect(renderGate(spell({ cond: 'turnOf', whose: 'you' }), ['If you cast this spell during your turn, draw a card.'], SCTX).ok).toBe(false);
  });
});

describe('std-rn renderer (render/fold.ts#eachPlayerShufflesZones, CR 701.24a): each player\'s shuffle of their zones', () => {
  const each = { ref: 'bound', name: 'each' };
  const loop = (zone: unknown, extra: unknown[] = []) => ({ kind: 'spell', effect: { targets: [], steps: [{ op: 'forEach', over: { ref: 'each', who: 'player' }, as: 'each', do: [
    { op: 'move', what: { ref: 'each', filter: { zone, owner: each } }, to: { zone: 'library', owner: each } }, { op: 'shuffle', who: each }, ...extra,
  ] }] } }) as never;
  const SCTX = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
  it('says the three forms Oracle prints', () => {
    expect(renderAbility(loop('graveyard'), SCTX).join(' ')).toBe('Each player shuffles their graveyard into their library.');
    expect(renderAbility(loop(['hand', 'graveyard']), SCTX).join(' ')).toBe('Each player shuffles their hand and graveyard into their library.');
    expect(renderAbility(loop(['hand', 'graveyard'], [{ op: 'draw', who: each, count: 7 }]), SCTX).join(' ')).toBe('Each player shuffles their hand and graveyard into their library, then draws seven cards.');
  });
  it('another shape is not folded (a draw after the graveyard alone, a hand alone, a dynamic draw): the gate refuses the folded wording', () => {
    expect(renderGate(loop('graveyard', [{ op: 'draw', who: each, count: 2 }]), ['Each player shuffles their graveyard into their library, then draws two cards.'], SCTX).ok).toBe(false);
    expect(renderGate(loop('hand'), ['Each player shuffles their hand into their library.'], SCTX).ok).toBe(false);
    expect(renderGate(loop(['hand', 'graveyard'], [{ op: 'draw', who: each, count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } }]), ['Each player shuffles their hand and graveyard into their library, then draws a card for each creature you control.'], SCTX).ok).toBe(false);
  });
});

// ---- the try step on real cards of the tuning half (local index): each one reads its line with the named template and passes the render gate --------------

describe.skipIf(index === null)('std-rn real cards (tuning half)', () => {
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdrn.eachPlayer.shuffle.graveyard': ['Struggle // Survive'],
    'eff.stdrn.eachPlayer.shuffle.handGraveyard': ['Temporal Cascade'],
    'eff.stdrn.eachPlayer.shuffle.handGraveyard.draw': ['Timetwister', "Day's Undoing"],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')}`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});
