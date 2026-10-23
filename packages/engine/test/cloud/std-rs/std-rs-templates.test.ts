/**
 * Standard round S (std-rs, card wave 2 slice s3): the template data of parser/templates/zz-cloud/std-rs.json ("<player> exiles cards from the top of their library
 * until they exile <card>", "you may cast a card exiled with ~ without paying its mana cost", "as long as C, you may cast the exiled card, and mana of any type can
 * be spent to cast that spell", "<player> exiles the top N cards of their library face down", "you may look at and play <them> for as long as they remain exiled",
 * the rider "If you cast a spell this way, you may spend mana as though it were mana of any type to cast it.", a token copy that is a N/N <subtypes> artifact
 * creature in addition to its other types) and the parser, engine and renderer changes of the round. Guard G9 (design 6.8): every example lowers with its
 * template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against
 * the local index when it is present. The behavior is in std-rs-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import stdRs from '../../../src/parser/templates/zz-cloud/std-rs.json';
import review from '../../m5/golden/cards/cloud-std-rs-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRs as Template[];
const MECH_COUNT = 9;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rs template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rs.json, after std-rp.json, before std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rs.json');
    expect(files.indexOf('zz-cloud/std-rs.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rs.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    expect(files.indexOf('zz-cloud/std-rs.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff|sta|rid.stdrs.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid)\.stdrs\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
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

describe('std-rs guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\buntil they exile\b/, 'until you exile'], [/\bnonland\b/, 'land'], [/\bface down\b/, 'face up'], [/\bremain exiled\b/, 'remain tapped'], [/\bremains exiled\b/, 'remains tapped'],
    [/\bmana of any type\b/, 'mana of any color'], [/\bwithout paying\b/, 'by paying'], [/\bartifact creature\b/, 'enchantment creature'], [/\bin addition to\b/, 'instead of'],
    [/\beach opponent\b/, 'each player'], [/\btop two\b/, 'bottom two'], [/\byou control an artifact\b/, 'an opponent controls an artifact'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rs guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rs guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole)
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rs design 6.10 (local index): synthetic examples', () => {
  it('no std-rs line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- the parser, engine and renderer changes of the round, one test each -------------------------------------------------------------------------------------

const faceOf = (type: string, text: string, pt0: boolean) => parseCard(card('Example Brute', type, text, pt0 ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const creature = (text: string) => faceOf('Creature — Elf Warrior', text, true);
const sorcery = (text: string) => faceOf('Sorcery', text, false);
const isFull = (f: ReturnType<typeof creature>): boolean => fullyAutomated(f);
const json = (f: ReturnType<typeof creature>): string => JSON.stringify(bare(f.abilities));

describe('std-rs parser (CR 608.2c, 101.4): the card another player\'s exile-until stopped at', () => {
  it('after "target opponent exiles ... until they exile a nonland card", "that card" is the one card it stopped at', () => {
    const f = creature('When this creature enters, target opponent exiles cards from the top of their library until they exile a nonland card. You may cast that card this turn.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('after "each opponent exiles ...", the cards it stopped at are several: "that card" is not read (manual)', () => {
    expect(isFull(creature('When this creature enters, each opponent exiles cards from the top of their library until they exile a nonland card. You may cast that card this turn.'))).toBe(false);
  });
});

describe('std-rs parser (CR 607.2a): exile-until is the instruction that exiles for "a card exiled with ~"', () => {
  it('the exile-until step of the other ability gets the link "exiled"', () => {
    const f = creature('When this creature enters, each opponent exiles cards from the top of their library until they exile a nonland card.\n{2}: You may cast a card exiled with this creature without paying its mana cost.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (bare(f.abilities) as { effect?: { steps: Record<string, unknown>[] } }[]).flatMap((a) => a.effect?.steps ?? []);
    expect(steps.find((x) => x['op'] === 'exileUntil')?.['link']).toBe('exiled');
  });
  it('with a second instruction that exiles on the face, the reader does not know which one it reads (manual, CR 607.2a)', () => {
    expect(isFull(creature('When this creature enters, each opponent exiles cards from the top of their library until they exile a nonland card.\nWhen this creature dies, exile target card from a graveyard.\n{2}: You may cast a card exiled with this creature without paying its mana cost.'))).toBe(false);
  });
});

describe('std-rs renderer (CR 406.3; family player-exiles-top): "target opponent exiles the top N cards of their library face down"', () => {
  it('the face-down move of another player\'s top cards is said with that player as the subject', () => {
    expect(isFull(sorcery('Target opponent exiles the top two cards of their library face down.'))).toBe(true);
    expect(isFull(sorcery("Exile the top two cards of target opponent's library face down."))).toBe(true);
  });
  it('face up and face down are different JSON', () => {
    const a = sorcery('Target opponent exiles the top two cards of their library face down.');
    const b = sorcery('Target opponent exiles the top two cards of their library.');
    expect(jsonKey(a.abilities)).not.toBe(jsonKey(b.abilities));
  });
});

describe('std-rs engine (CR 607.2a, 609.4b): a static linked cast permission with "mana of any type can be spent"', () => {
  it('the capability is installed (statics/play-permits.ts) and the walker asks for it', () => {
    expect(ENGINE_CAPABILITIES.has('feature:permit.cast.linked.anyManaType')).toBe(true);
    const f = creature('When this creature enters, exile target card from a graveyard.\nAs long as you control an artifact, you may cast the exiled card, and mana of any type can be spent to cast that spell.');
    expect(capabilitiesOfDef(f.abilities[1] as never)).toContain('feature:permit.cast.linked.anyManaType');
    expect(capabilitiesOfDef(f.abilities[1] as never)).toContain('permit:cast.linked');
  });
  it('the same rider on a play permission is a form nothing registers (fail closed)', () => {
    const def = { kind: 'static', text: '', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'linked', link: 'exiled' } }, anyManaType: true }] };
    expect(capabilitiesOfDef(def as never).some((c) => !ENGINE_CAPABILITIES.has(c))).toBe(true);
  });
});

describe('std-rs renderer (CR 400.7, 608.2c; family exiled-card-of-this-ability): "the exiled card" after the ability exiled one', () => {
  it('a card chosen and exiled by the ability is "the exiled card" afterwards', () => {
    expect(isFull(creature("At the beginning of combat on your turn, you may exile a creature card from your hand. If you do, create a token that's a copy of the exiled card."))).toBe(true);
  });
  it('a card exiled face down is not called so (no reading)', () => {
    expect(isFull(creature("At the beginning of combat on your turn, you may exile a creature card from your hand face down. If you do, create a token that's a copy of the exiled card."))).toBe(false);
  });
});
