/**
 * p2-exile-play-1 (Phase 2 lane p2-exile-play): the template data of parser/templates/zz-cloud/p2-exile-play-1.json and the round's parser and renderer support:
 * "the exiled card" of a one-sentence static ability (parser/lower/p2ep1.ts), the Cond reading
 * "an opponent was dealt N or more damage this turn" (parser/holes/cond.ts), the free linked cast with a description (render/fold.ts#castFromLinkedExile), the
 * cost reduction for spells sharing a quality with an object (render/stat.ts), spells cast from exile (render/refs.ts#eachSubjectWordings) and "during your turn,
 * if" (render/abil.ts, family during-turn-if). Guard G9 (design
 * 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in p2-exile-play-1-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/p2-exile-play-1.json';
import review from '../../m5/golden/cards/p2-exile-play-1-review.json';
import { automated, card, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const TS = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.p2ep1.cast.linked.free': 'Artifact',
  'sta.p2ep1.players.cantCast.sameName': 'Enchantment — Aura',
  'sta.p2ep1.costmod.less.shareCardType.exiled': 'Artifact',
  'sta.p2ep1.spells.cast.fromExile.convoke': 'Creature — Lizard Wizard',
  'sta.p2ep1.yourTurn.if.play.linked': 'Enchantment',
  'sta.p2ep1.play.linked.asLongAs': 'Enchantment',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('p2-exile-play-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-exile-play-1.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-exile-play-1.json');
    expect(files.indexOf('zz-cloud/p2-exile-play-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-exile-play-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(TS.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of TS) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.p2ep1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // the free linked cast: three hand-verified golden cards (design 6.9); the other wordings are each printed on one or two cards: stable on one hand-verified
    // golden card plus these tests and the played scenarios, a 6.9 deviation named in the round record
    expect(goldenUsing('eff.p2ep1.cast.linked.free')).toEqual(['Shell of the Last Kappa', "Jeleva, Nephalia's Scourge", 'Kaho, Minamo Historian']);
    expect(goldenUsing('sta.p2ep1.players.cantCast.sameName')).toEqual(['Exclusion Ritual']);
    expect(goldenUsing('sta.p2ep1.costmod.less.shareCardType.exiled')).toEqual(['Semblance Anvil']);
    expect(goldenUsing('sta.p2ep1.spells.cast.fromExile.convoke')).toEqual(['Party Thrasher']);
    expect(goldenUsing('sta.p2ep1.yourTurn.if.play.linked')).toEqual(['Theater of Horrors']);
    expect(goldenUsing('sta.p2ep1.play.linked.asLongAs')).toEqual(['Pick Up the Pace']);
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

describe('p2-exile-play-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bexiled with\b/, 'exiled by'], [/\bwithout paying its mana cost\b/, 'paying {1} less'], [/\bthe same name as\b/, 'a different name than'],
    [/\ba card type\b/, 'a color'], [/\bless\b/, 'more'], [/\bfrom exile\b/, 'from your hand'], [/\bconvoke\b/, 'delve'], [/\byour turn\b/, "an opponent's turn"],
    [/\bas long as\b/, 'until'], [/\bPlayers\b/, 'Creatures'], [/\byou cast\b/, 'your opponents cast'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-exile-play-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('p2-exile-play-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe('p2-exile-play-1 parser and renderer support', () => {
  it('CR 607.2a: "the exiled card" of a static ability is the card the face\'s one exiling instruction exiled; with no such instruction the static stays manual', () => {
    const linked = face('x', "When ~ enters, exile target card from a graveyard.\nYour opponents can't cast spells with the same name as the exiled card.", 'Enchantment');
    expect(understood(linked)).toBe(true);
    expect(JSON.stringify(linked.abilities)).toContain('"with":{"ref":"linked","link":"exiled"}');
    const none = face('x', "Your opponents can't cast spells with the same name as the exiled card.", 'Enchantment');
    expect(understood(none)).toBe(false);
    const two = face('x', "When ~ enters, exile target card from a graveyard.\n{T}: Exile target creature.\nYour opponents can't cast spells with the same name as the exiled card.", 'Enchantment');
    expect(understood(two)).toBe(false);
  });
  it('CR 120.1: "an opponent was dealt N or more damage this turn" is the per-player total of damage to opponents; "a player was dealt" stays any player', () => {
    const opp = face('x', 'At the beginning of your end step, if an opponent was dealt 4 or more damage this turn, draw a card.', 'Enchantment');
    expect(understood(opp)).toBe(true);
    expect(JSON.stringify(opp.abilities)).toContain('"recipient":{"player":"opponent"}');
    const any = face('x', 'At the beginning of your end step, if a player was dealt 4 or more damage this turn, draw a card.', 'Enchantment');
    expect(JSON.stringify(any.abilities)).toContain('"recipient":{"player":"any"}');
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-exile-play-1 design 6.10 (local index): synthetic examples', () => {
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
