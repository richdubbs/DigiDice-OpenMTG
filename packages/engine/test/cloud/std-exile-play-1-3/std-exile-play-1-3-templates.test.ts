/**
 * std-exile-play-1-3 (lane std-exile-play-1: play or cast from exile): the template data of parser/templates/zz-cloud/std-exile-play-1-3.json and the parser,
 * renderer and engine support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-exile-play-1-3-scenarios.test.ts. CR cites from memory, unverified (no rules/cr/ in the cloud).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdExile from '../../../src/parser/templates/zz-cloud/std-exile-play-1-3.json';
import review from '../../m5/golden/cards/cloud-std-exile-play-1-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { isObjectPermit } from '../../../src/statics/play-permits';
import type { PermissionDef } from '../../../src/types/ability';
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

describe('std-exile-play-1-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-exile-play-1-3.json, after std-eoe, before std-fdn) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-exile-play-1-3.json');
    expect(files.indexOf('zz-cloud/std-exile-play-1-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-eoe.json'));
    expect(files.indexOf('zz-cloud/std-exile-play-1-3.json')).toBeLessThan(files.indexOf('zz-cloud/std-fdn.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.stdexile3.*', () => {
    expect(XP.length).toBe(4);
    for (const t of XP) {
      expect(t.id, t.id).toMatch(/^(eff|rid|trg)\.stdexile3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (narrow wordings: a deviation named in the record)', () => {
    const golden = [...review] as { card: string; verified: string; expect?: string }[];
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

describe('std-exile-play-1-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\beach opponent\b/, 'target opponent'], [/\btheir hand\b/, 'your hand'], [/\bmore to cast\b/, 'less to cast'], [/\benters tapped\b/, 'enters untapped'],
    [/\bplayers may\b/, 'you may'], [/\bthey exiled\b/, 'you exiled'], [/\bfrom their hand\b/, 'from their graveyard'], [/\bplay cards they\b/, 'cast spells they'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-exile-play-1-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-exile-play-1-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe('std-exile-play-1-3 parser, lowering, renderer and engine support', () => {
  const json = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);
  const inquisitor = 'When ~ enters, each opponent exiles a card from their hand and may play that card for as long as it remains exiled. Each spell cast this way costs {2} more to cast. Each land played this way enters tapped.';
  it('CR 608.2d, 101.4: each opponent chooses from their own hand, exiles the card, and gets the permission (`who` that opponent, `of` that card)', () => {
    const f = face('Creature — Angel', inquisitor);
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('{"op":"chooseObjects","who":{"ref":"bound","name":"eachOpponent"},"from":{"ref":"each","filter":{"zone":"hand","owner":{"ref":"bound","name":"eachOpponent"}}},"min":1,"max":1,"as":"exiledCard"}');
    expect(json(f)).toContain('"effects":[{"s":"permit","who":{"ref":"bound","name":"eachOpponent"},"action":"play","of":{"is":{"ref":"bound","name":"exiledCard"}},"costChange":{"kind":"increase","mana":[{"kind":"generic","amount":2}]},"landsEnterTapped":true}]');
  });
  it('CR 608.2c: a rider sentence with no permission before it is not merged (manual)', () => {
    expect(fullyAutomated(face('Creature — Angel', 'When ~ enters, each opponent discards a card. Each spell cast this way costs {1} more to cast.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Angel', 'When ~ enters, each opponent discards a card. Each land played this way enters tapped.'))).toBe(false);
  });
  it('CR 400.3: "players may play cards they exiled this way" is a permission of each player for their own cards (`ownOnly`), with both restrictions', () => {
    const f = face('Artifact', "{T}: Each player exiles the top four cards of their library. Until end of turn, players may play cards they exiled this way, and they can't play cards from their hand.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f)).toContain('"ownOnly":true');
    expect(json(f)).toContain('{"s":"restrict","subject":{"ref":"each","who":"player"},"mode":"cant","action":"cast","other":{"castFrom":"hand"}}');
    expect(json(f)).toContain('{"s":"restrict","subject":{"ref":"each","who":"player"},"mode":"cant","action":"playLand","other":{"zone":"hand"}}');
  });
  it('fail closed: a permission for named objects takes only a free cost or a generic increase; ownOnly and landsEnterTapped only as `true`, the latter on play only', () => {
    const base: PermissionDef = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'fixed', objects: [] } as never } };
    expect(isObjectPermit(base)).toBe(true);
    expect(isObjectPermit({ ...base, costChange: { kind: 'increase', mana: [{ kind: 'generic', amount: 1 }] } })).toBe(true);
    expect(isObjectPermit({ ...base, costChange: { kind: 'increase', mana: [{ kind: 'colored', color: 'W' } as never] } })).toBe(false);
    expect(isObjectPermit({ ...base, costChange: { kind: 'reduce', mana: [{ kind: 'generic', amount: 1 }] } as never })).toBe(false);
    expect(isObjectPermit({ ...base, ownOnly: true })).toBe(true);
    expect(isObjectPermit({ ...base, landsEnterTapped: true })).toBe(true);
    expect(isObjectPermit({ ...base, action: 'cast', landsEnterTapped: true })).toBe(false);
  });
  it('design 5.2: the walker names the new fields on a permission for named objects, and a `.other` form elsewhere', () => {
    const step = (p: Record<string, unknown>) => ({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [p] }] } });
    const named = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'bound', name: 'b' } } };
    const caps = capabilitiesOfDef(step({ ...named, ownOnly: true, landsEnterTapped: true, costChange: { kind: 'increase', mana: [{ kind: 'generic', amount: 1 }] } }) as never);
    expect(caps).toEqual(expect.arrayContaining(['feature:permit.play.ownOnly', 'feature:permit.play.landsEnterTapped', 'feature:permit.play.increase']));
    const other = capabilitiesOfDef(step({ ...named, of: { types: ['Land'] }, ownOnly: true }) as never);
    expect(other).toContain('feature:permit.play.ownOnly.other');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-exile-play-1-3 design 6.10 (local index): synthetic examples', () => {
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
