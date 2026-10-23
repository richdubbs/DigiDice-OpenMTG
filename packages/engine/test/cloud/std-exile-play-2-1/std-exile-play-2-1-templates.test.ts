/**
 * std-exile-play-2-1 (lane std-exile-play-2): the template data of parser/templates/zz-cloud/std-exile-play-2-1.json and the round's engine, lowering and
 * renderer support: "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" as a rider of a resolved permission for
 * named objects (`CostChange.life` honored by statics/play-permits.ts#isObjectPermit and #namedLifeCost, actions/cast.ts; capability
 * `feature:permit.<action>.named.lifeCost`; render/stat.ts); "<players> exiles cards from the top of their library until they have exiled cards with total mana
 * value N or greater this way" (the std-rx31 `exileUntil` total for another player, render/steps-cards.ts) whose cards are "cards exiled this way"
 * (parser/lower/mentions.ts); an additional cost on a static linked cast permission (`addCost`, statics/play-permits.ts#isLinkedRiderPermit, linkedPermitUses,
 * actions/cast.ts; capability `feature:permit.cast.linked.addCost`; render/stat.ts#linkedPermitsText). Guard G9 (design 6.8): every example lowers with its
 * template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the
 * local index when it is present. The behavior is in std-exile-play-2-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import round from '../../../src/parser/templates/zz-cloud/std-exile-play-2-1.json';
import review from '../../m5/golden/cards/std-exile-play-2-1-review.json';
import { automated, card, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TS = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.sxp21.exileUntil.total.eachPlayer': 'Sorcery',
  'sta.sxp21.permit.linked.cast.removeAmong': 'Creature — Elf Warlock',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-exile-play-2-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-exile-play-2-1.json, after zz-cloud/std-eoe.json, before zz-cloud/std-fdn.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-exile-play-2-1.json');
    expect(files.indexOf('zz-cloud/std-exile-play-2-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-eoe.json'));
    expect(files.indexOf('zz-cloud/std-exile-play-2-1.json')).toBeLessThan(files.indexOf('zz-cloud/std-fdn.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(TS.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of TS) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.sxp21\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (each printed on one card of the index): stable on one hand-verified golden card plus these tests and the played scenarios, a 6.9
    // deviation named in the round record
    // Inside Information's rider is std-exile-play-1-1's rid.stdexile1.top.castThisWay.lifeCost since the merge with it (one template, two shapes: "@oneOf")
    expect(goldenUsing('rid.stdexile1.top.castThisWay.lifeCost')).toEqual(['Inside Information']);
    expect(goldenUsing('eff.sxp21.exileUntil.total.eachPlayer')).toEqual(['Dream Harvest']);
    expect(goldenUsing('sta.sxp21.permit.linked.cast.removeAmong')).toEqual(['Dawnhand Dissident']);
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

describe('std-exile-play-2-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmana value rather\b/, 'power rather'], [/\brather than pay(ing)? its mana cost\b/, 'in addition to paying its mana cost'], [/\bthis turn\b/, 'until your next turn'],
    [/\bEach opponent\b/, 'Each player'], [/\b4 or greater\b/, '4 or less'], [/\bthey have exiled\b/, 'you have exiled'],
    [/\bDuring your turn\b/, "During each opponent's turn"], [/\bcards you own\b/, "cards you don't own"], [/\bremoving two counters\b/, 'removing two +1/+1 counters'],
    [/\bin addition to paying\b/, 'rather than paying'], [/\bexiled with ~/, 'exiled with it'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-exile-play-2-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-exile-play-2-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of TS) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is the ability that exiles the cards)
        const start = 0;
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

describe('std-exile-play-2-1 engine, lowering and renderer support', () => {
  it('design 5.2: the life cost on a resolved permission needs feature:permit.play.named.lifeCost, the linked additional cost feature:permit.cast.linked.addCost; both are engine capabilities', () => {
    const life = face('x', "Exile the top four cards of target player's library. You may play those cards this turn. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.");
    expect(life.abilities.flatMap((a) => capabilitiesOfDef(a))).toContain('feature:permit.play.named.lifeCost');
    const add = face('sta.sxp21.permit.linked.cast.removeAmong', TS[1]!.examples[0]!.text);
    expect(add.abilities.flatMap((a) => capabilitiesOfDef(a))).toContain('feature:permit.cast.linked.addCost');
    for (const c of ['feature:permit.play.named.lifeCost', 'feature:permit.cast.named.lifeCost', 'feature:permit.cast.linked.addCost']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
  it('fails closed: the life cost on a static permission for a description (no named objects, no linked cards) has no engine reading', () => {
    const def = { kind: 'static', text: '', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'cast', from: 'exile', of: { types: ['Creature'] }, costChange: { kind: 'set', life: 'manaValue' } }] } as never;
    const caps = capabilitiesOfDef(def);
    expect(caps.some((c) => !ENGINE_CAPABILITIES.has(c)), caps.join(', ')).toBe(true);
  });
  it('the rider attaches to a permission only: after "Destroy target creature." or after two permissions it is not understood', () => {
    expect(understood(face('x', 'Destroy target creature. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.'))).toBe(false);
    expect(understood(face('x', "Exile the top card of target player's library. You may play that card this turn and you may cast spells this turn as though they had flash. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost."))).toBe(false);
  });
  it('CR 608.2c, 400.7: "cards exiled this way" after the exile until a total names every card it exiled (the std-rx31 form for your own library too)', () => {
    const f = face('x', 'Exile cards from the top of your library until you exile cards with total mana value 6 or greater. Until end of turn, you may cast cards exiled this way without paying their mana costs.');
    expect(understood(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"of":{"is":{"ref":"bound","name":"them"}}');
  });
  it('the linked additional cost is never read on a free permission or a non-linked one (statics/play-permits.ts#isLinkedRiderPermit, model/cap-walk.ts)', () => {
    const free = { kind: 'static', text: '', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'cast', of: { is: { ref: 'linked', link: 'exiled' }, types: ['Creature'] }, costChange: { kind: 'set', cost: {} }, addCost: { other: [{ kind: 'payLife', amount: 2 }] } }] } as never;
    const caps = capabilitiesOfDef(free);
    expect(caps.some((c) => !ENGINE_CAPABILITIES.has(c)), caps.join(', ')).toBe(true);
    expect(compileCard(card('Example Relic', 'Artifact', 'You may cast creature spells from the top of your library by removing two counters from among creatures you control in addition to paying their other costs.')).automation.level).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-exile-play-2-1 design 6.10 (local index): synthetic examples', () => {
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

describe('std-exile-play-2-1 parser support: "@oneOf" (parser/lower/riders.ts)', () => {
  it('one rider template reads both shapes: after a top-card permission (std-exile-play-1-1) and after a permission for named cards (Inside Information)', () => {
    const named = face('x', "Exile the top four cards of target player's library. You may play those cards this turn. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.");
    expect(understood(named), JSON.stringify(named.diagnostics)).toBe(true);
    expect(named.templatesUsed).toContain('rid.stdexile1.top.castThisWay.lifeCost');
    expect(JSON.stringify(named.abilities)).toContain('"costChange":{"kind":"set","life":"manaValue"}');
    const top = face('x', 'Until end of turn, you may look at the top card of your library any time and you may play cards from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.');
    expect(understood(top), JSON.stringify(top.diagnostics)).toBe(true);
    expect(top.templatesUsed).toContain('rid.stdexile1.top.castThisWay.lifeCost');
  });
  it('no shape fits: the rider is refused (two permissions that are not the top-card pair)', () => {
    const f = face('x', "Exile the top card of target player's library. You may play that card this turn and you may cast spells this turn as though they had flash. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.");
    expect(understood(f)).toBe(false);
  });
});
