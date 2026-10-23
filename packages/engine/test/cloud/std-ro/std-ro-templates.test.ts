/**
 * Precon round O (std-ro): the template data of parser/templates/zz-cloud/std-ro.json ("put all <cards> revealed this way into your hand and the rest into your
 * graveyard / on the bottom of your library in any order", the hole RevealedThisWay) and the parser and renderer support of the round: the owner's-graveyard event
 * wording of render/evt.ts and the revealed-this-way group of render/fold.ts. Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of
 * any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in std-ro-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRo from '../../../src/parser/templates/zz-cloud/std-ro.json';
import review from '../../m5/golden/cards/cloud-std-ro-review.json';
import { renderGate } from '../../../src/index';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRo as Template[];
const MECH_COUNT = 2;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-ro template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ro.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ro.json');
    expect(files.indexOf('zz-cloud/std-ro.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-ro.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdro.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdro\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, three hand-verified golden cards of the tuning half that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(3); // design 6.9: three independently verified golden cards
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-ro guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('std-ro guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-ro guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-ro design 6.10 (local index): synthetic examples', () => {
  it('no std-ro line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the hole RevealedThisWay (parser/holes/object.ts#revealedThisWay, lower/mentions.ts) ----------------------------------------------------------------------

const sorcery = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;

describe('std-ro parser (CR 701.20a, 608.2c): "revealed this way" names only the top cards a reveal step revealed', () => {
  it('after a reveal of the top cards: both moves read the revealed group, the hand move only the cards of the description', () => {
    const f = sorcery('Reveal the top three cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps.map((s) => s['op'])).toEqual(['reveal', 'move', 'move']);
    const as = steps[0]!['as'];
    expect(JSON.stringify(steps[1]!['what'])).toContain(`"is":{"ref":"bound","name":"${as}"}`);
    expect(JSON.stringify(steps[2]!['what'])).toContain(`"is":{"ref":"bound","name":"${as}"}`);
  });
  it('after a look (nothing revealed), a reveal until a card is found, or a revealed hand, the sentence stays manual (fail closed)', () => {
    for (const text of [
      'Look at the top three cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.',
      'Reveal cards from the top of your library until you reveal a land card. Put all creature cards revealed this way into your hand and the rest into your graveyard.',
      'Reveal your hand. Put all creature cards revealed this way into your hand and the rest into your graveyard.',
      'Put all creature cards revealed this way into your hand and the rest into your graveyard.',
    ]) expect(fullyAutomated(sorcery(text)), text).toBe(false);
  });
  it('the cards "from among them" keep their own template (eff.fxz.dig.putAll.hand.rest.bottomRandom), the new templates never take that sentence', () => {
    const f = sorcery('Reveal the top three cards of your library. Put all creature cards from among them into your hand and the rest on the bottom of your library in a random order.');
    expect(f.templatesUsed).toContain('eff.fxz.dig.putAll.hand.rest.bottomRandom');
    expect(f.templatesUsed.some((t) => t.startsWith('eff.stdro.'))).toBe(false);
  });
});

// ---- renderer: the owner's graveyard (render/evt.ts#zoneChange; std-rp's family put-into-your-graveyard, the object itself here) -------------------------------------------------------------------------

const CRE = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const trig = (subject: Record<string, unknown>): never => ({
  kind: 'triggered', trigger: { on: [{ ev: 'zoneChange', subject, from: 'battlefield', to: 'graveyard' }] }, effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] },
}) as never;

describe('std-ro renderer (CR 700.4, 404.1): a card is put into its owner\'s graveyard', () => {
  const cases: [string, Record<string, unknown>, string[], string[]][] = [
    ['a nontoken creature you own', { types: ['Creature'], owner: 'you', token: false }, ['Whenever a nontoken creature you own dies, you gain 1 life.', 'Whenever a nontoken creature is put into your graveyard from the battlefield, you gain 1 life.'], ['Whenever a nontoken creature is put into a graveyard from the battlefield, you gain 1 life.', 'Whenever a creature is put into your graveyard from the battlefield, you gain 1 life.']],
    ['~ itself, owned by you', { self: true, owner: 'you' }, ['When Test Card is put into your graveyard from the battlefield, you gain 1 life.'], ['When Test Card dies, you gain 1 life.', 'When Test Card is put into a graveyard from the battlefield, you gain 1 life.']],
  ];
  it.each(cases)('%s: the Oracle wordings are accepted, the near misses are not', (_n, subject, readings, near) => {
    for (const r of readings) expect(renderGate(trig(subject), [r], CRE).ok, r).toBe(true);
    for (const n of near) expect(renderGate(trig(subject), [n], CRE).ok, n).toBe(false);
  });
  it('a creature without an owner keeps its readings ("another creature dies", never "is put into your graveyard")', () => {
    const def = trig({ types: ['Creature'], other: true });
    expect(renderGate(def, ['Whenever another creature dies, you gain 1 life.'], CRE).ok).toBe(true);
    expect(renderGate(def, ['Whenever another creature is put into your graveyard from the battlefield, you gain 1 life.'], CRE).ok).toBe(false);
  });
});

// ---- renderer: the rest of the revealed group (render/fold.ts#putAllFromGroupAndRest, family revealed-this-way-group) --------------------------------------------

describe('std-ro renderer (CR 701.20a, 608.2c, 401.4): the cards revealed this way and the rest', () => {
  const def = (first: 'reveal' | 'look', to: Record<string, unknown>): never => ({
    kind: 'spell', effect: { targets: [], steps: [
      first === 'reveal' ? { op: 'reveal', who: { ref: 'you' }, what: { ref: 'topCards', player: { ref: 'you' }, count: 3 }, as: 'g' } : { op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'you' }, count: 3 }, as: 'g' },
      { op: 'move', what: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: { ref: 'bound', name: 'g' }, zone: 'library' } }, to: { zone: 'hand' } },
      { op: 'move', what: { ref: 'each', filter: { is: { ref: 'bound', name: 'g' }, zone: 'library' } }, to },
    ] },
  }) as never;
  const RCTX = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
  it('the rest into your graveyard, on the bottom in any order, or in a random order: each wording for its own destination only', () => {
    const rest: [Record<string, unknown>, string][] = [
      [{ zone: 'graveyard' }, 'into your graveyard'],
      [{ zone: 'library', position: 'bottom', order: 'chosen' }, 'on the bottom of your library in any order'],
      [{ zone: 'library', position: 'bottom', order: 'random' }, 'on the bottom of your library in a random order'],
    ];
    for (const [to, words] of rest) {
      for (const [other, otherWords] of rest) {
        const text = `Reveal the top three cards of your library. Put all creature cards revealed this way into your hand and the rest ${otherWords}.`;
        expect(renderGate(def('reveal', to), [text], RCTX).ok, `${JSON.stringify(to)}: ${text}`).toBe(other === to);
      }
      expect(renderGate(def('reveal', to), [`Reveal the top three cards of your library. Put all creature cards from among them into your hand and the rest ${words}.`], RCTX).ok).toBe(true);
    }
  });
  it('cards only looked at are never "revealed this way" (the reveal binding alone carries the participle)', () => {
    const to = { zone: 'graveyard' };
    expect(renderGate(def('look', to), ['Look at the top three cards of your library. Put all creature cards from among them into your hand and the rest into your graveyard.'], RCTX).ok).toBe(true);
    expect(renderGate(def('look', to), ['Look at the top three cards of your library. Put all creature cards revealed this way into your hand and the rest into your graveyard.'], RCTX).ok).toBe(false);
  });
});

// ---- the promotion of eff.cmd2.copy.forEachCommanderCast (design 6.9) ---------------------------------------------------------------------------------------------

describe('std-ro promotion (design 6.9): eff.cmd2.copy.forEachCommanderCast is stable on its evidence', () => {
  it('the template is stable (its three golden cards, cloud-cmd2-review.json, are checked by cmd2-templates.test.ts)', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'eff.cmd2.copy.forEachCommanderCast')!;
    expect(t.status).toBe('stable');
  });
});

// ---- eff.r4repl.dur.prevent.toYou: the duration after the sentence; "~ was cast from exile" (render/cond.ts) -------------------------------------------------------

describe('std-ro parser (CR 615.1a, 611.2a): "Prevent all damage that would be dealt to you this turn." is the duration-first sentence', () => {
  it('both word orders lower with eff.r4repl.dur.prevent.toYou to the same JSON, and pass the render gate', () => {
    const a = sorcery('Draw a card. Prevent all damage that would be dealt to you this turn.');
    const b = sorcery('Draw a card. This turn, prevent all damage that would be dealt to you.');
    expect(fullyAutomated(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(a.templatesUsed).toContain('eff.r4repl.dur.prevent.toYou');
    if (fullyAutomated(b)) expect(jsonKey(b.abilities)).toBe(jsonKey(a.abilities));
  });
  it('a source restriction ("... this turn by attacking creatures") or another recipient is not this template (stays manual or differs)', () => {
    const base = sorcery('Draw a card. Prevent all damage that would be dealt to you this turn.');
    for (const text of ['Draw a card. Prevent all damage that would be dealt to you this turn by attacking creatures.', 'Draw a card. Prevent all combat damage that would be dealt to you this turn.', 'Draw a card. Prevent all damage that would be dealt to target player this turn.']) {
      const f = sorcery(text);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(base.abilities), text).toBe(false);
    }
  });
});

describe('std-ro renderer (CR 406.1, 601.2a): "if ~ was cast from exile" has no article (exile is one shared zone)', () => {
  it('accepts "from exile", refuses "from a exile"; a graveyard keeps its article', () => {
    const def = (from: string): never => ({ kind: 'spell', effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'wasCast', from }, then: [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }] }] } }) as never;
    const RCTX = { selfNames: ['Test Card'], selfTypes: ['Sorcery'] };
    expect(renderGate(def('exile'), ['If Test Card was cast from exile, you gain 3 life.'], RCTX).ok).toBe(true);
    expect(renderGate(def('exile'), ['If Test Card was cast from a exile, you gain 3 life.'], RCTX).ok).toBe(false);
    expect(renderGate(def('graveyard'), ['If Test Card was cast from a graveyard, you gain 3 life.'], RCTX).ok).toBe(true);
  });
});

describe('std-ro renderer (CR 404.1, 400.7): after "When ~ is put into your graveyard from the battlefield", "~" still names the object itself', () => {
  it('"you may shuffle ~ into your library" is full, as after "When ~ dies"', () => {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', 'When this creature is put into your graveyard from the battlefield, you may shuffle this creature into your library.', { power: '3', toughness: '3' }), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('G10, recorded (Guan Yu, Sainted Warrior): the effect is the "When ~ dies" one, the card that moved is the event subject (CR 400.7), not `self`', () => {
    const brute = (text: string) => parseCard(card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    const put = brute('When this creature is put into your graveyard from the battlefield, you may shuffle this creature into your library.');
    const dies = brute('When this creature dies, you may shuffle this creature into your library.');
    const effectOf = (f: ReturnType<typeof brute>) => JSON.stringify((f.abilities[0] as unknown as { effect: unknown }).effect);
    expect(effectOf(put)).toBe(effectOf(dies));
    expect(effectOf(put)).toContain('"what":{"ref":"event","role":"subject"}');
  });
});
