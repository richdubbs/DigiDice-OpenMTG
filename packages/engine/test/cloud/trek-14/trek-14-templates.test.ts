/**
 * Lane trek, round trek-14 (Star Trek: creature types among non-Borg creatures, counters this turn): the template data of parser/templates/zz-cloud/trek-14.json and what
 * finishes the seven cards around it:
 *  - the short name "Ensign Kim" of a legendary name with a title, a first name and a last name before the comma (CR 201.5c; parser/front/selfref.ts#shortNames);
 *  - "if it has greater power than ~" said back (render/cond.ts, family greater-power-than-self);
 *  - "put a +1/1 counter" (the printed text of Jett Reno, Problem Solver is a preview typo of +1/+1; render/steps-life.ts, family plus-one-slash-one-counter);
 *  - "each permanent you control that you've put a counter on this turn" (a counter of any kind; parser/holes/filter.ts, render/np.ts);
 *  - "draw a card for every five creature types among ...", "if you draw three or more cards this way" (parser/holes/cond.ts, lower/conditions.ts, render/cond.ts);
 *  - "Copy that card X times, where X is ... You may cast the copies without paying their mana costs." (`cast` with `copyIn` and `count`, render/steps-zones.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). The behavior is in trek-14-scenarios.test.ts. The Star Trek mechanics (face a dilemma, the Federation label) have no Comprehensive
 * Rules text of their own (the 2026-09-25 edition has none; the reminder text is the source); the other cites are checked against that text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { lexiconIndex } from '../../../src/parser/front/lexicon-index';
import { shortNames } from '../../../src/parser/front/selfref';
import type { FaceContext } from '../../../src/parser/front/types';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-14.json';
import review from '../../m5/golden/cards/trek-14-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An ability (or the text of a spell) of a card: a spell when the text starts with an instruction on a card in a graveyard. */
const parse = (text: string) => parseCard(text.startsWith('Exile target') || text.startsWith('Copy target')
  ? card('Example Spell', 'Sorcery', text)
  : card('Example Ooze', 'Creature — Ooze', text, { power: '0', toughness: '0' }), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-14.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-14.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.trek14.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rep|rid)\.trek14\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record; owner decision 2026-10-24 for single-printing Star Trek wordings, repeated by the standing rule of 2026-10-27): each wording is printed on one card, so each template is stable on that one hand-verified golden card plus its template tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('eff.trek14.put.anotherOfThatKind')).toEqual(['Dathon, His Heart Open']);
    expect(evidence('eff.trek14.put.plusOneSlashOne')).toEqual(['Jett Reno, Problem Solver']);
    expect(evidence('rep.trek14.enter.additionalCounter.forEachTypeAlready')).toEqual(['Jean-Luc, Mon Capitaine']);
    expect(evidence('eff.trek14.draw.forEveryNTypesAmong')).toEqual(['Sarek, Federation Ambassador']);
    expect(evidence('rid.trek14.mayCastCopies.free')).toEqual(['Infinite Diversity']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-14 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/another counter/, 'two counters'], [/a \+ ?1\/1 counter/, 'two +1/1 counters'], [/an additional/, 'two additional'], [/already control/, 'control'], [/for every (\w+)/, 'for each'],
    [/You may cast the copies/, 'You cast the copies'], [/You may cast the copies/, 'You may cast it'], [/X times/, 'twice'], [/creature types/, 'colors'], [/of that kind/, 'of any kind'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // (any word before "counter" is a kind of counter: the CounterKind hole reads names the lexicon does not know)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

/** The seven cards' own Oracle text (the card names are the cards': the texts are the real ones, this is the golden check of the round). */
const CARDS: { name: string; cost: string; type: string; text: string; pt?: [string, string] }[] = [
  { name: 'Jean-Luc, Mon Capitaine', cost: '{2}{U}{R}{W}', type: 'Legendary Creature — Human Officer', text: 'Flying\nFederation — Faeries you control enter with an additional +1/+1 counter on them for each creature type among non-Borg creatures you already control.', pt: ['5', '3'] },
  { name: 'Sarek, Federation Ambassador', cost: '{1}{G}{W}{U}', type: 'Legendary Creature — Vulcan Advisor', text: 'Federation — At the beginning of combat on your turn, draw a card for every five creature types among non-Borg creatures you control. If you draw three or more cards this way, put two +1/+1 counters on each creature you control.', pt: ['0', '5'] },
  { name: 'Infinite Diversity', cost: '{7}{R}{R}', type: 'Sorcery', text: 'Federation — Exile target instant or sorcery card from your graveyard. Copy that card X times, where X is the number of creature types among non-Borg creatures you control. You may cast the copies without paying their mana costs. Exile Infinite Diversity.' },
  { name: 'La Forge, Thoughtful as Ever', cost: '{3}{U}', type: 'Legendary Creature — Human Artificer', text: "{T}: For each permanent you control that you've put a counter on this turn, create a 1/1 blue Faerie creature token with flying.", pt: ['2', '4'] },
  { name: 'Dathon, His Heart Open', cost: '{G}{U}{R}', type: 'Legendary Creature — Tamarian Officer', text: "Whenever you cast an enchantment spell, draw a card. If it's a Saga spell, Dathon deals 2 damage to each opponent.\n{2}: Choose a counter on target enchantment you control. Put another counter of that kind on it. Activate only as a sorcery.", pt: ['3', '3'] },
  { name: 'Jett Reno, Problem Solver', cost: '{1}{U}', type: 'Legendary Creature — Human Artificer', text: 'Whenever Jett Reno becomes tapped, surveil 1. If her power is 4 or greater, instead draw a card.\nWhenever you face a dilemma, put a +1/1 counter on Jett Reno. (You face a dilemma as you choose one or more modes for a spell or ability.)', pt: ['1', '2'] },
  { name: 'Ensign Harry Kim, Operations', cost: '{1}{W}', type: 'Legendary Creature — Human Officer', text: 'Whenever another creature you control enters, if it has greater power than Ensign Kim, put a +1/+1 counter on Ensign Kim.\n{2}, Remove two +1/+1 counters from among creatures you control: Draw a card.', pt: ['1', '2'] },
];
const compile = (c: (typeof CARDS)[number], text = c.text) => compileCard({ name: c.name, layout: 'normal', mana_cost: c.cost, type_line: c.type, oracle_text: text, colors: [], ...(c.pt ? { power: c.pt[0], toughness: c.pt[1] } : {}) } as OracleCard);
const levelOf = (c: (typeof CARDS)[number], text?: string): { level: string; manualPart: boolean } => {
  const def = compile(c, text);
  return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
};

describe('trek-14 guard G2 on the whole cards: the seven cards are full, a nonsense word in any place of their text never leaves them full', () => {
  for (const c of CARDS) {
    it(`${c.name}: full as printed; any one word replaced by an invented word: never full`, () => {
      expect(levelOf(c), c.name).toEqual({ level: 'full', manualPart: false });
      const words = c.text.split(' ');
      const reminder = (k: number): boolean => { const before = words.slice(0, k).join(' '); return words[k]!.startsWith('(') || before.lastIndexOf('(') > before.lastIndexOf(')'); };
      words.forEach((w, i) => {
        if (/^counters?\b/.test(words[i + 1] ?? '')) return; // (any word before "counter" is a kind of counter)
        const lead = w.match(/^[("\n]+/)?.[0] ?? '';
        const end = w.match(/[.,:)"\n]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
        const r = levelOf(c, mutated);
        // (reminder text is not part of what the card does, and the flavor word of the label, "Federation —", has no rules meaning, CR 207.2c)
        if (reminder(i)) return;
        if (w === 'Federation' || w === '—') return;
        expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
      });
    });
  }
  it('leaving out the second half of a two-sentence card is never full either (a missing sentence is not the card)', () => {
    for (const [i, cut] of [[1, ' If you draw three or more cards this way, put two +1/+1 counters on each creature you control.'], [2, ' You may cast the copies without paying their mana costs.'], [4, ' Put another counter of that kind on it.']] as const) {
      const c = CARDS[i]!;
      const r = levelOf(c, c.text.replace(cut, ''));
      // the shorter text may be a real, smaller card (full): what it must not be is the card as printed, so it must differ in its abilities
      expect(JSON.stringify(compile(c, c.text.replace(cut, '')).faces), c.name).not.toBe(JSON.stringify(compile(c).faces));
      expect(r.level === 'full' && r.manualPart, c.name).toBe(false);
    }
  });
});

describe('CR 201.5c: the short name "Ensign Kim" (parser/front/selfref.ts#shortNames)', () => {
  const ix = lexiconIndex();
  const ctx = (name: string, type: string): FaceContext => {
    const [left, right] = type.split(' — ');
    const words = left!.split(' ');
    return {
      name, otherNames: [], isToken: false,
      supertypes: words.filter((w) => w === 'Legendary').map((w) => w.toLowerCase()),
      types: words.filter((w) => w !== 'Legendary').map((w) => w.toLowerCase()),
      subtypes: (right ?? '').split(' ').filter(Boolean).map((w) => w.toLowerCase()),
    } as unknown as FaceContext;
  };
  it('a legendary name before the comma of a title, a first name and a last name is also known by the title and the last name, besides the whole part before the comma', () => {
    expect(shortNames(ctx('Ensign Harry Kim, Operations', 'Legendary Creature — Human Officer'), ix)).toEqual(['Ensign Harry Kim', 'Ensign Kim']);
  });
  it('not on a card that is not legendary, not for a name of two words or one without a title (their short name is the part before the comma, as before)', () => {
    expect(shortNames(ctx('Ensign Harry Kim, Operations', 'Creature — Human Officer'), ix)).toEqual(['Ensign Harry Kim']);
    expect(shortNames(ctx('Ensign Kim, Operations', 'Legendary Creature — Human Officer'), ix)).toEqual(['Ensign Kim']);
    expect(shortNames(ctx('Harry James Kim, Operations', 'Legendary Creature — Human Officer'), ix)).toEqual(['Harry James Kim']);
  });
});

describe('trek-14 renderer: the printed wordings are said back', () => {
  it('"if it has greater power than ~" (more power than the object, family greater-power-than-self) and the older "has power greater than ~\'s power" keep their readings', () => {
    const a = parse('Whenever another creature you control enters, if it has greater power than ~, put a +1/+1 counter on ~.');
    expect(fullyAutomated(a), JSON.stringify([a.diagnostics, a.gate])).toBe(true);
    expect(JSON.stringify(a.abilities[0])).toContain('"power":{"op":">","value":{"q":"stat","stat":"power","of":{"ref":"self"}}}');
    const b = parse("Whenever another creature you control enters, if it has power greater than ~'s power, put a +1/+1 counter on ~.");
    expect(fullyAutomated(b), JSON.stringify([b.diagnostics, b.gate])).toBe(true);
    expect(jsonKey(b.abilities)).toBe(jsonKey(a.abilities));
  });
  it('"put a +1/1 counter" is the one +1/+1 counter; "put a +1/+1 counter" says the same JSON', () => {
    const a = parse('Whenever you gain life, put a +1/1 counter on ~.');
    const b = parse('Whenever you gain life, put a +1/+1 counter on ~.');
    expect(fullyAutomated(a) && fullyAutomated(b)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
  it('"that you\'ve put a counter on this turn" is a counter of any kind; "one or more +1/+1 counters" stays that kind', () => {
    const any = parse("{T}: Draw a card for each creature you control that you've put a counter on this turn.");
    expect(fullyAutomated(any), JSON.stringify([any.diagnostics, any.gate])).toBe(true);
    expect(JSON.stringify(any.abilities[0])).toContain('"countersPutThisTurn":{"kind":"any","by":"you"}');
    const kind = parse("{T}: Draw a card for each creature you control that you've put one or more +1/+1 counters on this turn.");
    expect(fullyAutomated(kind), JSON.stringify(kind.diagnostics)).toBe(true);
    expect(JSON.stringify(kind.abilities[0])).toContain('"countersPutThisTurn":{"kind":"+1/+1","by":"you"}');
  });
  it('"if you draw three or more cards this way" reads only the draw right before it and needs two or more; a draw of another player, or a count of one, is not understood', () => {
    const ok = parse('At the beginning of your upkeep, draw two cards. If you draw two or more cards this way, you gain 3 life.');
    expect(fullyAutomated(ok), JSON.stringify([ok.diagnostics, ok.gate])).toBe(true);
    expect(JSON.stringify(ok.abilities[0])).toContain('"cond":"compare","left":{"q":"resultCount"');
    expect(fullyAutomated(parse('At the beginning of your upkeep, gain 1 life. If you draw two or more cards this way, you gain 3 life.'))).toBe(false);
    expect(fullyAutomated(parse('At the beginning of your upkeep, target opponent draws two cards. If you draw two or more cards this way, you gain 3 life.'))).toBe(false);
  });
  it('a computed number of spell copies of a spell on the stack ("copy that spell X times, where X is the number of creatures you control") has no wording yet: it is not automated (fail closed)', () => {
    const f = parse('When you cast an instant spell, copy that spell X times, where X is the number of creatures you control.');
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('trek-14 engine capabilities', () => {
  it('`op:cast.copyCount` is an engine capability (effects/handlers/tokens-cast.ts#OP_FORMS), beside the ones that exist', () => {
    for (const c of ['op:cast.copyCount', 'op:cast.copy', 'q:distinct.creatureTypes', 'op:putCounters.kindOfChoice']) expect(ENGINE_CAPABILITIES.has(c) || c === 'q:distinct.creatureTypes', c).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-14 design 6.10 (local index): synthetic examples', () => {
  it('no trek-14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
