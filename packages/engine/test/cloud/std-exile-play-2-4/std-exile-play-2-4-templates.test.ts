/**
 * std-exile-play-2-4 (lane std-exile-play-2): the template data of parser/templates/zz-cloud/std-exile-play-2-4.json and the round's support: a resolved play or
 * cast permission whose objects an `each` filter picks, locked as the effect begins with every value of the filter fixed then (effects/handlers/lasting.ts;
 * capability feature:permit.<action>.lockedSet; render/stat.ts#yoursAndLesserPermit), and "for each of those colors, you may exile a card of that color from among
 * the revealed cards" (one guarded optional choice per color, then one exile of the union; render/fold.ts#exileOneOfEachColorFromRevealed; the union is "the exiled
 * cards" afterwards, parser/lower/mentions.ts#groupOf). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-exile-play-2-4-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import round from '../../../src/parser/templates/zz-cloud/std-exile-play-2-4.json';
import review from '../../m5/golden/cards/std-exile-play-2-4-review.json';
import { automated, card, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TS = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.sxp24.permit.play.yoursAndLesserMv.free': 'Artifact',
  'eff.sxp24.forEachColor.mayExileOfThatColor.fromRevealed': 'Artifact',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-exile-play-2-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-exile-play-2-4.json, after zz-cloud/std-eoe.json, before zz-cloud/std-fdn.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-exile-play-2-4.json');
    expect(files.indexOf('zz-cloud/std-exile-play-2-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-eoe.json'));
    expect(files.indexOf('zz-cloud/std-exile-play-2-4.json')).toBeLessThan(files.indexOf('zz-cloud/std-fdn.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(TS.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of TS) {
      expect(t.id, t.id).toMatch(/^eff\.sxp24\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (both printed on one card of the index): stable on one hand-verified golden card plus these tests and the played scenarios, a 6.9
    // deviation named in the round record
    expect(goldenUsing('eff.sxp24.permit.play.yoursAndLesserMv.free')).toEqual(['Triple Triad']);
    expect(goldenUsing('eff.sxp24.forEachColor.mayExileOfThatColor.fromRevealed')).toEqual(['Sanar, Innovative First-Year']);
    expect(TS.filter((t) => t.status === 'stable').map((t) => t.id)).toEqual(Object.keys(TYPE));
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of TS) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-exile-play-2-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of TS) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t.id, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = face(t.id, c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\blesser mana value\b/, 'greater mana value'], [/\bthe card you own\b/, "the card you don't own"], [/\bwithout paying their mana costs\b/, 'paying {1} less'],
    [/\bUntil end of turn\b/, 'Until your next turn'], [/\beach other card\b/, 'one other card'],
    [/\bof that color\b/, 'of any color'], [/\byou may exile a card\b/, 'exile a card'], [/\bthe revealed cards\b/, 'your graveyard'], [/\bnumber of colors\b/, 'number of creatures'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-exile-play-2-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of TS) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(t.id, m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-exile-play-2-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of TS) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is the ability that exiles the cards)
        // the rider's sentence is the last one of its line (the sentences before it are the ones it modifies)
        const start = t.kind === 'rider' ? lines[last]!.lastIndexOf('. ') + 2 : 0;
        const head = lines[last]!.slice(0, start);
        const words = lines[last]!.slice(start).split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          if (w === '~' || w === '~.' || w === '~,') return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), head + [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000); // (long examples: every word mutated, each a whole parse)
  }
});

describe('std-exile-play-2-4 engine, lowering and renderer support', () => {
  it('design 5.2: the locked set is feature:permit.play.lockedSet, an engine capability (with permit:play.object and the free cost)', () => {
    const f = face('eff.sxp24.permit.play.yoursAndLesserMv.free', TS[0]!.examples[1]!.text);
    const caps = f.abilities.flatMap((a) => capabilitiesOfDef(a));
    for (const c of ['feature:permit.play.lockedSet', 'permit:play.object', 'feature:permit.play.free']) expect(caps, c).toContain(c);
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.lockedSet')).toBe(true);
  });
  it('fails closed: a static permission with an `each` filter (never locked) is not a permission for named objects', () => {
    const def = { kind: 'static', text: '', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', of: { is: { ref: 'each', filter: { zone: 'exile', owner: 'you' } } } }] } as never;
    expect(capabilitiesOfDef(def)).not.toContain('feature:permit.play.lockedSet');
    expect(capabilitiesOfDef(def).some((c) => !ENGINE_CAPABILITIES.has(c))).toBe(true);
  });
  it('the color choices render only after "until you reveal X nonland cards, where X is the number of colors among permanents you control" (fail closed otherwise)', () => {
    const other = '{3}, {T}: Reveal cards from the top of your library until you reveal two nonland cards. For each of those colors, you may exile a card of that color from among the revealed cards. Then shuffle.';
    expect(understood(face('eff.sxp24.forEachColor.mayExileOfThatColor.fromRevealed', other))).toBe(false);
  });
  it('CR 608.2c: "the exiled cards" after the color choices names what the one exile moved (parser/lower/mentions.ts#groupOf)', () => {
    const f = face('eff.sxp24.forEachColor.mayExileOfThatColor.fromRevealed', TS[1]!.examples[1]!.text);
    expect(understood(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"of":{"is":{"ref":"bound","name":"exiledByColor"}}');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-exile-play-2-4 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = TS.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
