/**
 * FAST5 T70: the template data of parser/templates/zz-fast5/t70.json and the readings it needed (design 6.8 G6):
 *  - impulse play permissions for the cards an instruction just exiled from the top of a library: "You may play those cards this turn" (plural) and
 *    "Until end of turn, you may play that card" (CR 611.2a, 611.2c, 400.7); the anaphors of the holes `Impulse` and `Impulses` are bound by the impulse idiom
 *    (parser/lower/anaphora.ts#impulseFlagged) and by nothing else;
 *  - "Exile the top X cards of your library, where X is one plus the mana value of the sacrificed artifact" (CR 107.3, 202.3, 608.2h): render/qty.ts;
 *  - "Then if an opponent controls more creatures than you, ~ becomes prepared" (CR 722.3a): render/cond.ts#compareIdiom;
 *  - "Then if ~ was cast from anywhere other than your hand, put a +1/+1 counter on each Spirit you control" (CR 601.2a, 707.10): render/cond.ts#castElsewherePhrase;
 *  - "put a +1/+1 counter on each of them for every three cards in your graveyard" (CR 107.1a): render/steps-life.ts;
 *  - "Then if there are three or more landmark counters on it, remove those counters, transform ~, and create three Treasure tokens": render/steps-flow.ts#removeTransformCreate.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10): no example is a line of a real card.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t70 from '../../../src/parser/templates/zz-fast5/t70.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5-t70-review.json';

const T70 = t70 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES }); // the capabilities of the game's compiler: the prepared designation is one (`needs`)

/** A trigger or an activated ability is a creature's; anything else is a sorcery (the coverage harness tries the same type lines, cards/coverage/mutation.ts). */
function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Artifact Creature — Golem' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(typeLine.includes('Creature') ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;
const parsedAs = (text: string, type: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
/**
 * FAST5 batch 9 integration: FAST5X E29 and FAST5 T70 both read the impulse permissions; where the two read one sentence the same way, the one that
 * wins is accepted (the JSON is the same but for the name of the bound cards).
 */
const SAME_SENTENCE_AS: Readonly<Record<string, readonly string[]>> = {
  'eff.t70.permit.play.untilEndOfTurn': ['eff.e29.permit.play.obj.durFirst'],
  'eff.t70.permit.play.untilNextEndStep': ['eff.e29.permit.play.obj.durFirst'],
  'eff.t70.permit.play.thisTurn.group': ['eff.e29.permit.play.group.dur'],
  'eff.t70.permit.play.untilNextEndStep.group': ['eff.e29.permit.play.group.durFirst'],
};
const readsWith = (used: readonly string[], id: string): boolean => used.includes(id) || (SAME_SENTENCE_AS[id] ?? []).some((x) => used.includes(x));

describe('T70 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t70.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t70.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    for (const t of T70) {
      expect(t.id, t.id).toMatch(/^eff\.t70\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T70 template has its evidence: three hand-verified golden cards, or every card of the corpus whose parse uses it', () => {
    const golden = review as { card: string; verified: string }[];
    // the only cards of the local index whose parse uses these templates (npm run cards -- snapshot; checked over the whole index)
    const WHOLE_CORPUS: Record<string, string[]> = {
      'eff.t70.exile.top.whereX.plusManaValue': ['Memorial Vault'],
      'eff.t70.thenIf.castElsewhere.counters': ['Antiquities on the Loose'],
      'eff.t70.ifCastGraveyard.counters.perCards': ['Recursive Recruitment'],
      'eff.t70.thenIf.counters.removeTransformTokens': ['Treasure Map // Treasure Cove'],
      // Ob Nixilis, Captive Kingpin also has the sentence, but in an ability that is manual for another reason (its trigger is not understood), so no automated step uses it there
      'eff.t70.permit.play.untilNextEndStep': ['Wiccan, Young Avenger', 'Yasmin Khan'],
    };
    for (const t of T70.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T70) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T70 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T70) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const head = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(readsWith(f.templatesUsed, t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(head.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bor more\b/, 'or fewer'], [/\bmore\b/, 'fewer'], [/\bplus\b/, 'minus'], [/\bExile\b/, 'Destroy'], [/\bplay\b/, 'cast'], [/\bthis turn\b/, 'until your next turn'],
    [/\bprepared\b/, 'unprepared'], [/\bmana value\b/, 'power'], [/\bgraveyard\b/, 'hand'], [/\bremove\b/, 'put'], [/\btransform\b/, 'exile'], [/\bthree\b/, 'two'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T70 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T70) {
    it(`${t.id}: an appended "unless/instead/at random/twice/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T70 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T70) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?$/.test(words[i + 1] ?? '')) return; // counter names are an open class (design 6.11, CR 122.1)
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T70 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T70.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('T70 lowering: what the shapes mean', () => {
  it('CR 611.2c, 400.7: "those cards" are the cards the exile moved, named by the move, and the permission is for exactly them', () => {
    const f = parsedAs('{T}: Exile the top two cards of your library. You may play those cards this turn.', 'Artifact');
    expect(fullyAutomated(f)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: unknown[] } }).effect.steps as { as?: string }[];
    expect(steps[0]!.as).toBeDefined();
    expect(JSON.stringify(steps[1])).toContain(`"of":{"is":{"ref":"bound","name":"${steps[0]!.as}"}}`);
    expect(JSON.stringify(steps[0])).toContain('"count":2');
  });
  it('CR 611.2c: "them" is the same; a card that is not the top cards of a library (a target, a discard) is no antecedent: the sentence stays manual', () => {
    expect(fullyAutomated(parsedAs('{T}: Exile the top three cards of your library. You may play them this turn.', 'Artifact'))).toBe(true);
    // Cloud std-lci (CR 400.7, 608.2c): several target cards one move put into exile are "those cards" of the permission right after it (parser/lower/anaphora.ts#impulseFlagged,
    // the move's own binding: an illegal target is not moved); a single target ("that card") and a discard stay manual
    expect(fullyAutomated(parsedAs('Exile any number of target cards from your graveyard. You may play those cards this turn.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(parsedAs('Exile target card from a graveyard. Until end of turn, you may play that card.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(parsedAs('Target opponent discards a card. Until end of turn, you may play that card.', 'Sorcery'))).toBe(false);
  });
  it('the number must agree: "that card" after several cards, "those cards" after one card, stay manual', () => {
    expect(fullyAutomated(parsedAs('{T}: Exile the top two cards of your library. Until end of turn, you may play that card.', 'Artifact'))).toBe(false);
    expect(fullyAutomated(parsedAs('{T}: Exile the top card of your library. You may play those cards this turn.', 'Artifact'))).toBe(false);
  });
  it('CR 608.2h, 202.3: X is the number plus the mana value of what the cost sacrificed', () => {
    const f = parsedAs('{T}, Sacrifice another artifact: Exile the top X cards of your library, where X is one plus the mana value of the sacrificed artifact.', 'Artifact');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain(JSON.stringify({ q: 'math', op: '+', args: [1, { q: 'stat', stat: 'manaValue', of: { ref: 'costSacrificed' } }] }));
  });
  it('CR 608.2c, 102.3: "an opponent controls more lands than you" compares the lands of each opponent alone with yours (std-sos review: countPlayers.controlsVs)', () => {
    const f = parsedAs('Draw a card. Then if an opponent controls more lands than you, ~ becomes prepared.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain(JSON.stringify({ cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, controlsVs: { filter: { types: ['Land'] }, op: '>', than: { ref: 'you' } } }, op: '>=', right: 1 }));
  });
  it('CR 601.2a, 707.10: "cast from anywhere other than your hand" is cast from any other zone a card is cast from; a copy was cast from none', () => {
    const f = parsedAs('Create a 1/1 white Spirit creature token. Then if ~ was cast from anywhere other than your hand, put a +1/+1 counter on each Spirit you control.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain(JSON.stringify({ cond: 'any', of: ['graveyard', 'exile', 'library', 'command'].map((from) => ({ cond: 'wasCast', from })) }));
  });
  it('CR 107.1a: "for every three cards in your graveyard" is the size of the graveyard divided by three, rounded down', () => {
    const f = parsedAs('Create two 2/2 colorless Wizard Soldier creature tokens named Cadet. If ~ was cast from a graveyard, put a +1/+1 counter on each of them for every three cards in your graveyard.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain(JSON.stringify({ q: 'math', op: 'floorDiv', args: [{ q: 'zoneSize', zone: 'graveyard', of: { ref: 'you' } }, 3] }));
  });
});

describe('T70 real cards (npm run cards -- try)', () => {
  // r5-dig (CR 611.2a, 607.2a): "until you exile another card with ~" is the duration untilExiledWith since Standard round 5 (core/durations.ts): the card is full
  it('Superior Foes of Spider-Man is full since r5-dig: "until you exile another card with ~" is the duration untilExiledWith', () => {
    const c = (index ?? []).find((x) => x.name === 'Superior Foes of Spider-Man');
    if (c === undefined) return;
    expect(compileCard(c as OracleCard).automation.level).toBe('full');
  });
  it('the fixture cards of the package compile with their templates (full once every template they use is stable)', () => {
    for (const name of ['Memorial Vault', 'Emberheart Challenger', 'Annie Flash, the Veteran', 'Treasure Map // Treasure Cove', 'Antiquities on the Loose', 'Recursive Recruitment', 'Emeritus of Truce // Swords to Plowshares']) {
      expect(['full', 'partial'], name).toContain(compileCard(getCard(name)).automation.level);
    }
  });
});
