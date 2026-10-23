/**
 * std-exile-play-1-1 (lane std-exile-play-1: play or cast from exile and from the top of a library): the template data of
 * parser/templates/zz-cloud/std-exile-play-1-1.json and the parser, lowering, renderer and engine support they needed. Guard G9 (design 6.8): every example lowers
 * with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations
 * fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked
 * against the local index when it is present. The behavior is in std-exile-play-1-1-scenarios.test.ts. CR cites from memory, unverified (no rules/cr/ in the cloud).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { PLAY_PERMIT_CAPABILITIES } from '../../../src/statics/play-permits';
import stdExile from '../../../src/parser/templates/zz-cloud/std-exile-play-1-1.json';
import review from '../../m5/golden/cards/cloud-std-exile-play-1-1-review.json';
import r4DigReview from '../../m5/golden/cards/cloud-r4-dig-review.json';
import e14Review from '../../m5/golden/cards/fast5x-e14-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const XP = stdExile as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or activated ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if ((t.kind === 'effect' || t.kind === 'rider') && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Heist', 'Sorcery', text);
  return card('Example Rogue', 'Creature — Human Rogue', text, { power: '2', toughness: '2' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Rogue', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const spellFace = (text: string) => parseCard(card('Example Heist', 'Sorcery', text), OPTS).faces[0]!;

describe('std-exile-play-1-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-exile-play-1-1.json, after std-eoe, before std-fdn) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-exile-play-1-1.json');
    expect(files.indexOf('zz-cloud/std-exile-play-1-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-eoe.json'));
    expect(files.indexOf('zz-cloud/std-exile-play-1-1.json')).toBeLessThan(files.indexOf('zz-cloud/std-fdn.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.stdexile1.*', () => {
    expect(XP.length).toBe(4);
    for (const t of XP) {
      expect(t.id, t.id).toMatch(/^(eff|rid|trg)\.stdexile1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (narrow wordings: a deviation named in the record)', () => {
    const golden = [...review, ...r4DigReview, ...e14Review] as { card: string; verified: string; expect?: string }[];
    for (const t of XP.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of XP) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'whenever']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-exile-play-1-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of XP) {
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
    [/\bmana value\b/, 'power'], [/\bmana of any type\b/, 'mana of any color'], [/\buntil end of turn\b/, 'until your next turn'], [/\bthis turn\b/, 'this game'],
    [/\bdon't own\b/, 'own'], [/\bThey may\b/, 'You may'], [/\bplay\b/, 'look at'], [/\bspells this way\b/, 'creature spells this way'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-exile-play-1-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of XP) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-exile-play-1-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of XP) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-exile-play-1-1 parser, lowering, renderer and engine support', () => {
  const json = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);
  it('CR 118.9: the life cost rides a top-card permission (`feature:permit.<action>.top.lifeCost`); after an impulse exile it rides the permission for the named cards (std-exile-play-2-1, "@oneOf")', () => {
    expect(PLAY_PERMIT_CAPABILITIES).toContain('feature:permit.play.top.lifeCost');
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.top.lifeCost')).toBe(true);
    const f = spellFace('Until end of turn, you may look at the top card of your library any time and you may play cards from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.');
    expect(json(f)).toContain('"fromTop":true,"costChange":{"kind":"set","life":"manaValue"}');
    // std-exile-play-2-1: the same rider on the permission for named objects (statics/play-permits.ts#namedLifeCost, `feature:permit.<action>.named.lifeCost`)
    const impulse = spellFace('Exile the top card of your library. You may play that card this turn. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.');
    expect(fullyAutomated(impulse)).toBe(true);
    expect(json(impulse)).not.toContain('"fromTop":true');
    expect(json(impulse)).toContain('"costChange":{"kind":"set","life":"manaValue"}');
  });
  it('CR 608.2c, 406.3: "exile two of them face down, then put the rest ..." names the exiled cards "the exiled cards" later (render/fold.ts#putOfThemAndRest)', () => {
    const f = face('Creature — Cat', "When ~ enters, look at the top five cards of target opponent's library, exile two of them face down, then put the rest on the bottom of their library in a random order. You may play the exiled cards for as long as they remain exiled.");
    expect(fullyAutomated(f)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(JSON.stringify(steps[4])).toContain(`"of":{"is":{"ref":"bound","name":"${String(steps[1]!['as'])}"}}`);
    // the cards only looked at are never "the exiled cards": a dig that exiles nothing leaves the reference unresolved
    expect(fullyAutomated(face('Creature — Cat', "When ~ enters, look at the top five cards of target opponent's library, put two of them into your hand, then put the rest on the bottom of their library in a random order. You may play the exiled cards for as long as they remain exiled."))).toBe(false);
  });
  it('CR 608.2c: after "its controller looks at the top card of that opponent\'s library and exiles it face down", "They" is the looker (the impulse idiom), never the damaged opponent', () => {
    const f = face('Creature — Rogue', "Whenever a creature deals combat damage to one of your opponents, its controller looks at the top card of that opponent's library and exiles it face down. They may play that card for as long as it remains exiled.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"s":"permit","who":{"ref":"controllerOf","object":{"ref":"event","role":"source"}}');
    // a look by you: "They" names nobody the idiom knows, and stays manual
    expect(fullyAutomated(face('Creature — Rogue', "Whenever a creature deals combat damage to one of your opponents, look at the top card of that player's library and exile it face down. They may play that card for as long as it remains exiled."))).toBe(false);
  });
  it('CR 108.3, 601.2a: "Whenever a player casts a spell they don\'t own" is the cast pattern `notOwnedByCaster` (`feature:ev.cast.notOwnedByCaster`)', () => {
    const f = face('Creature — Rogue', "Whenever a player casts a spell they don't own, that player creates a Treasure token.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"trigger":{"on":[{"ev":"cast","player":"any","notOwnedByCaster":true}]}');
    expect(ENGINE_CAPABILITIES.has('feature:ev.cast.notOwnedByCaster')).toBe(true);
  });
  it('CR 400.7, 608.2c: "the exiled nonland card" names the card an exile until stopped at; "the exiled land card" is no reading of it', () => {
    const base = 'Whenever ~ deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card.';
    const f = face('Creature — Spy', `${base} You may cast the exiled nonland card this turn.`);
    expect(fullyAutomated(f)).toBe(true);
    expect(jsonKey(f.abilities)).toBe(jsonKey(face('Creature — Spy', `${base} You may cast that card this turn.`).abilities));
    expect(fullyAutomated(face('Creature — Spy', `${base} You may cast the exiled land card this turn.`))).toBe(false);
    expect(fullyAutomated(face('Creature — Spy', `${base} You may cast the exiled nonland creature card this turn.`))).toBe(false);
  });
  it('CR 609.4b: the any-type rider without the comma ("... until end of turn and mana of any type ...") is the same permission as with it', () => {
    const base = 'Whenever ~ deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card.';
    const a = face('Creature — Spy', `${base} You may cast the exiled card until end of turn and mana of any type can be spent to cast that spell.`);
    const b = face('Creature — Spy', `${base} You may cast the exiled card until end of turn, and mana of any type can be spent to cast that spell.`);
    expect(fullyAutomated(a)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-exile-play-1-1 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = XP.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
