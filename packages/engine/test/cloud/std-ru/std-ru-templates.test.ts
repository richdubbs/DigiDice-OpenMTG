/**
 * std-ru (card wave 2, slice s5): the template data of parser/templates/zz-cloud/std-ru.json and the round's parser, lowering and renderer support: the Cond
 * reading "~ is attached to a <permanent>" (parser/holes/cond.ts, render/cond.ts, family attached-to-a); a quoted triggered ability keeps the condition of its
 * trigger event and "for the first time each turn" (parser/lower/quoted.ts); an "exile it instead" replacement as the linked producer of "the cards exiled
 * with ~" (parser/parse.ts#linkExiled, body `modify.link`); the life cost of a linked permission (`CostChange.life`, model/cap-walk.ts); the one-card reveal
 * fold of std-rx31 (render/fold-stdrx31.ts#revealOneFromGroup, whose template eff.stdrx31.dig.reveal.fromAmong now reads the card with the
 * DiscardDesc hole, "a creature card with mana value 3 or less") and the condition after "you may put ... onto the battlefield" (render/steps-flow.ts). Guard G9 (design
 * 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-ru-scenarios.test.ts. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import stdRu from '../../../src/parser/templates/zz-cloud/std-ru.json';
import review from '../../m5/golden/cards/cloud-std-ru-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RU = stdRu as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'eff.stdru.may.put.bf.ifCond': 'Sorcery',
  'sta.stdru.aslong.cantBeAttacked.has': 'Legendary Artifact Planeswalker — Equipment',
  'sta.stdru.duringYourTurn.play.linked.lifeCost': 'Creature — Demon',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Sorcery';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-ru template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ru.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ru.json');
    expect(files.indexOf('zz-cloud/std-ru.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-ru.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RU.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RU) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdru\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings (printed on one to three cards of the index): stable on one hand-verified golden card plus these tests and the played scenarios, a 6.9
    // deviation named in the round record and the PR
    expect(goldenUsing('eff.stdru.may.put.bf.ifCond')).toEqual(['Whiskervale Forerunner']);
    expect(goldenUsing('sta.stdru.aslong.cantBeAttacked.has')).toEqual(['The Aetherspark']);
    expect(goldenUsing('sta.stdru.duringYourTurn.play.linked.lifeCost')).toEqual(['Valgavoth, Terror Eater']);
    const stable = RU.filter((t) => t.status === 'stable').map((t) => t.id);
    expect(stable).toEqual(['eff.stdru.may.put.bf.ifCond', 'sta.stdru.aslong.cantBeAttacked.has', 'sta.stdru.duringYourTurn.play.linked.lifeCost']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RU) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-ru guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RU) {
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
    [/\bYou may reveal\b/, 'Reveal'], [/\bfrom among them\b/, 'from your hand'], [/onto the battlefield if/, 'onto the battlefield tapped if'], [/\bit's your turn\b/, "it's not your turn"],
    [/can't be attacked/, "can't be blocked"], [/\bis attached to a creature\b/, 'is attached to an artifact'], [/\bDuring your turn\b/, "During each opponent's turn"],
    [/\bmana value rather\b/, 'power rather'], [/\bexiled with ~/, 'exiled with it'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-ru guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RU) {
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

describe('std-ru guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RU) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is the ability that exiles the cards)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          if (w === '~' || w === '~.' || w === '~,') return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-ru parser support', () => {
  it('CR 301.5, 303.4: "as long as ~ is attached to a creature [you control]" is the object it is attached to, of that kind (parser/holes/cond.ts)', () => {
    const f = face('x', 'As long as ~ is attached to a creature, ~ has hexproof.', 'Artifact — Equipment');
    expect(understood(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"condition":{"cond":"matches","object":{"ref":"attachedTo"},"filter":{"types":["Creature"]}}');
    const yours = face('x', 'As long as ~ is attached to a creature you control, ~ has hexproof.', 'Artifact — Equipment');
    expect(JSON.stringify(yours.abilities)).toContain('"filter":{"types":["Creature"],"controller":"you"}');
  });
  it('the reading is for the source only: "as long as target creature is attached to a creature" and "is attached to two creatures" are not it', () => {
    expect(understood(face('x', 'As long as enchanted creature is attached to a creature, ~ has hexproof.', 'Artifact — Equipment'))).toBe(false);
    expect(understood(face('x', 'As long as ~ is attached to two creatures, ~ has hexproof.', 'Artifact — Equipment'))).toBe(false);
  });
  it('CR 603.1, 603.2: a quoted triggered ability keeps "during your turn" (it was dropped before, and the gate refused the card)', () => {
    const f = face('x', 'Equipped creature has "Whenever this creature deals combat damage during your turn, you gain 1 life."\nEquip {2}', 'Artifact — Equipment');
    expect(understood(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"while":{"cond":"turnOf","whose":"you"}');
  });
  it('CR 607.2a, 614.1a: an "exile it instead" replacement is the producer of "the cards exiled with ~" when the face has no instruction that exiles', () => {
    const text = "If a nonland card would be put into a graveyard from anywhere, exile it instead.\nDuring your turn, you may play lands and cast spells from among cards exiled with ~. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.";
    const f = face('sta.stdru.duringYourTurn.play.linked.lifeCost', text);
    expect(understood(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"body":{"b":"modify","destination":{"zone":"exile"},"link":"exiled"}');
  });
  it('an instruction that exiles stays the producer (the replacement gets no link), and two exiling replacements leave the reader unlinked (manual)', () => {
    const both = face('sta.stdru.duringYourTurn.play.linked.lifeCost', "When ~ enters, exile the top card of target opponent's library.\nIf a nonland card would be put into a graveyard from anywhere, exile it instead.\nDuring your turn, you may play lands and cast spells from among cards exiled with ~. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.");
    expect(JSON.stringify(both.abilities)).not.toContain('"link":"exiled"}}]');
    expect(JSON.stringify(both.abilities)).toContain('"to":{"zone":"exile"},"link":"exiled"');
    const two = face('sta.stdru.duringYourTurn.play.linked.lifeCost', "If a nonland card would be put into a graveyard from anywhere, exile it instead.\nIf an artifact or creature card would be put into a graveyard from anywhere, exile it instead.\nDuring your turn, you may play lands and cast spells from among cards exiled with ~. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.");
    expect(understood(two)).toBe(false);
  });
  it('design 5.2: the replacement\'s link needs body:modify.link, the life cost feature:permit.play.linked.lifeCost; both are engine capabilities', () => {
    const f = face('sta.stdru.duringYourTurn.play.linked.lifeCost', "If a nonland card would be put into a graveyard from anywhere, exile it instead.\nDuring your turn, you may play lands and cast spells from among cards exiled with ~. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.");
    const caps = f.abilities.flatMap((a) => capabilitiesOfDef(a));
    expect(caps).toContain('body:modify.link');
    expect(caps).toContain('feature:permit.play.linked.lifeCost');
    expect(ENGINE_CAPABILITIES.has('body:modify.link')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.linked.lifeCost')).toBe(true);
  });
  it('fails closed: the life cost on any other permission (a graveyard, cards a resolving effect names) has no engine reading', () => {
    // (the top card of a library: std-exile-play-1-1 reads it, `feature:permit.<action>.top.lifeCost`)
    const def = { kind: 'static', text: '', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'play', from: 'graveyard', costChange: { kind: 'set', life: 'manaValue' } }] } as never;
    const caps = capabilitiesOfDef(def);
    expect(caps.some((c) => !ENGINE_CAPABILITIES.has(c)), caps.join(', ')).toBe(true);
    expect(compileCard(card('Example Relic', 'Artifact', 'You may look at the top card of your library any time.\nYou may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.')).automation.level).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-ru design 6.10 (local index): synthetic examples', () => {
  it('no std-ru line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RU.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
