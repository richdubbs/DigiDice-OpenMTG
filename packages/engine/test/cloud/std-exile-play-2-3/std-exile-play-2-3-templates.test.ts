/**
 * std-exile-play-2-3 (lane std-exile-play-2): the template data of parser/templates/zz-cloud/std-exile-play-2-3.json and the round's support: the `CardDesc` hole
 * (parser/holes/sxp23.ts, a singular card description with no article) for "Exile up to one noncreature, nonland card from that player's graveyard" (a choice as it
 * resolves, no target; render/fold.ts#exileUpToOneFromGraveyard); a cast permission for named objects whose alternative cost is "waterbend {X}, where X is its mana
 * value" (statics/play-permits.ts#isWaterbendCost, grantedAlternatives; capability feature:permit.cast.named.waterbend; render/stat.ts#waterbendPermit). Guard G9
 * (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-exile-play-2-3-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import round from '../../../src/parser/templates/zz-cloud/std-exile-play-2-3.json';
import review from '../../m5/golden/cards/std-exile-play-2-3-review.json';
import { automated, card, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TS = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.sxp23.exile.upTo.fromPlayerGraveyard': 'Sorcery',
  'eff.sxp23.permit.cast.duringYourTurn.waterbendManaValue': 'Creature — Human Warlock',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-exile-play-2-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-exile-play-2-3.json, after zz-cloud/std-eoe.json, before zz-cloud/std-fdn.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-exile-play-2-3.json');
    expect(files.indexOf('zz-cloud/std-exile-play-2-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-eoe.json'));
    expect(files.indexOf('zz-cloud/std-exile-play-2-3.json')).toBeLessThan(files.indexOf('zz-cloud/std-fdn.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(TS.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of TS) {
      expect(t.id, t.id).toMatch(/^eff\.sxp23\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (both printed on one card of the index): stable on one hand-verified golden card plus these tests and the played scenarios, a 6.9
    // deviation named in the round record
    expect(goldenUsing('eff.sxp23.exile.upTo.fromPlayerGraveyard')).toEqual(['Hama, the Bloodbender']);
    expect(goldenUsing('eff.sxp23.permit.cast.duringYourTurn.waterbendManaValue')).toEqual(['Hama, the Bloodbender']);
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

describe('std-exile-play-2-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bup to one\b/, 'one'], [/\bthat player's graveyard\b/, 'your graveyard'], [/\bcreature card\b/, 'creature cards'],
    [/\bduring your turn\b/, "during each opponent's turn"], [/\brather than paying\b/, 'in addition to paying'], [/\bits mana value\.$/, 'its power.'],
    [/\bwaterbending \{X\}/, 'waterbending {2}'], [/\bFor as long as you control ~/, 'Until end of turn'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-exile-play-2-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-exile-play-2-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    });
  }
});

describe('std-exile-play-2-3 parser, engine and renderer support', () => {
  it('the CardDesc hole reads a singular card description with no article ("noncreature, nonland card"); a plural is no reading', () => {
    const f = face('eff.sxp23.exile.upTo.fromPlayerGraveyard', "Target player mills two cards. Exile up to one noncreature, nonland card from that player's graveyard.");
    expect(understood(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"notTypes":["Creature","Land"]}]');
    expect(understood(face('x', "Target player mills two cards. Exile up to one creature cards from that player's graveyard."))).toBe(false);
  });
  it('design 5.2: the waterbend cost on a named cast permission needs feature:permit.cast.named.waterbend, an engine capability', () => {
    const f = face('eff.sxp23.permit.cast.duringYourTurn.waterbendManaValue', TS[1]!.examples[0]!.text);
    expect(f.abilities.flatMap((a) => capabilitiesOfDef(a))).toContain('feature:permit.cast.named.waterbend');
    expect(ENGINE_CAPABILITIES.has('feature:permit.cast.named.waterbend')).toBe(true);
  });
  it('fails closed: after "exile target ... card" the permission names the moved card but X would read the target, so the sentence stays manual (render/stat.ts#waterbendPermit)', () => {
    const text = "When ~ enters, exile target instant card from an opponent's graveyard. For as long as you control ~, you may cast that card during your turn by waterbending {X} rather than paying its mana cost, where X is its mana value.";
    expect(understood(face('eff.sxp23.permit.cast.duringYourTurn.waterbendManaValue', text))).toBe(false);
  });
  it('fails closed: a waterbend cost with another part, of another object\'s mana value, or on a play permission has no engine reading', () => {
    const permit = (costChange: unknown, action = 'cast', of: unknown = { ref: 'target', id: 't0' }) => ({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'permit', who: { ref: 'you' }, action, of: { is: of }, costChange }] }] } }) as never;
    const wb = (arg: unknown, more: unknown[] = []) => ({ kind: 'set', cost: { other: [{ kind: 'action', action: 'waterbend', arg }, ...more] } });
    const unread = (def: never) => capabilitiesOfDef(def).some((c) => !ENGINE_CAPABILITIES.has(c));
    expect(unread(permit(wb(3)))).toBe(false);
    expect(unread(permit(wb(3, [{ kind: 'payLife', amount: 2 }])))).toBe(true);
    expect(unread(permit(wb({ q: 'stat', stat: 'manaValue', of: { ref: 'self' } })))).toBe(true);
    expect(unread(permit(wb(3), 'play'))).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-exile-play-2-3 design 6.10 (local index): synthetic examples', () => {
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
