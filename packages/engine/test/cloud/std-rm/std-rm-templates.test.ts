/**
 * Commander precon lane M (std-rm): the template data of parser/templates/zz-cloud/std-rm.json ("<object> phases out", "<group> phase out", "<object> gets
 * +N/+N for each <kind> counter you have", "~ costs {N} less to cast for each card you've drawn this turn") and the hole readings and renderer changes of the
 * round: a player's counters as a quantity, the counts of the turn after "for each", "from anywhere other than their hand", "you created a token this turn"
 * (the life-loss conditions the round also built are Standard round P's, on main). Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of
 * any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in std-rm-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRm from '../../../src/parser/templates/zz-cloud/std-rm.json';
import review from '../../m5/golden/cards/cloud-std-rm-review.json';
import { renderAbility, renderGate } from '../../../src/index';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRm as Template[];
const MECH_COUNT = 4;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rm template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rm.json, after zz-cloud/std-r9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rm.json');
    expect(files.indexOf('zz-cloud/std-rm.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-rm.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrm.*, sta.stdrm.* or cm.stdrm.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|cm)\.stdrm\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards of the tuning half that use it (the review file pins each card as full)', () => {
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

describe('std-rm guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rm guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rm guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const labelEnd = words.indexOf('--'); // a flavor word before "--" has no rules meaning (CR 207.2d): any words may stand there
        words.forEach((w, i) => {
          if (i <= labelEnd) return;
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rm design 6.10 (local index): synthetic examples', () => {
  it('no std-rm line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- hole readings (parser/holes/qty.ts, event.ts, cond.ts) -------------------------------------------------------------------------------------------------

const creature = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const sorcery = (text: string): OracleCard => card('Example Volley', 'Sorcery', text);
const parsed = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;
const json = (c: OracleCard): string => JSON.stringify(parsed(c).abilities);

describe('std-rm Qty (CR 122.1, 122.1f): the counters of one kind a player has', () => {
  it('"the number of experience counters you have" and "for each experience counter you have" are `counters` on the player', () => {
    const where = sorcery('Put X +1/+1 counters on target creature, where X is the number of experience counters you have.');
    expect(fullyAutomated(parsed(where))).toBe(true);
    expect(json(where)).toContain('{"q":"counters","on":{"ref":"you"},"kind":"experience"}');
    const each = sorcery('Draw a card for each poison counter you have.');
    expect(fullyAutomated(parsed(each))).toBe(true);
    expect(json(each)).toContain('{"q":"counters","on":{"ref":"you"},"kind":"poison"}');
  });
  it('fail closed: no kind ("counters you have"), or counters a player put somewhere, are not read as the player\'s counters', () => {
    expect(fullyAutomated(parsed(sorcery('Draw a card for each counter you have.')))).toBe(false);
    expect(json(sorcery('Put X +1/+1 counters on target creature, where X is the number of counters you have.'))).not.toContain('"on":{"ref":"you"},"kind":"any"');
  });
  it('the static template reads the player\'s counters and multiplies the P/T change by them (layer 7c, CR 613.4c)', () => {
    const f = parsed(creature('This creature gets +2/+1 for each experience counter you have.'));
    expect(f.templatesUsed).toContain('sta.stdrm.pump.foreach.playerCounters');
    expect(JSON.stringify(f.abilities)).toContain('"power":{"q":"math","op":"*","args":[2,{"q":"counters","on":{"ref":"you"},"kind":"experience"}]}');
  });
});

describe('std-rm Qty after "for each" (CR 121.1, 601.2a, 601.2i): the counts of the turn', () => {
  it('"for each card you\'ve drawn this turn", "for each spell you\'ve cast this turn", "... from anywhere other than your hand"', () => {
    expect(json(sorcery("You gain 1 life for each card you've drawn this turn."))).toContain('{"q":"cardsDrawnThisTurn"}');
    expect(json(sorcery("You gain 1 life for each spell you've cast this turn."))).toContain('{"q":"spellsCastThisTurn"}');
    const nh = sorcery("Draw a card for each spell you've cast this turn from anywhere other than your hand.");
    expect(fullyAutomated(parsed(nh))).toBe(true);
    expect(json(nh)).toContain('"event":{"ev":"cast","player":"you","notFrom":"hand"}');
  });
  it('fail closed: "from anywhere other than their hand" after "you\'ve cast" is not read', () => {
    expect(fullyAutomated(parsed(sorcery("Draw a card for each spell you've cast this turn from anywhere other than their hand.")))).toBe(false);
  });
  it('the cost template reduces the generic cost by the cards its controller drew this turn (CR 601.2f, 118.7)', () => {
    const f = parsed(card('Example Volley', 'Instant', "This spell costs {1} less to cast for each card you've drawn this turn.\nExample Volley deals 2 damage to any target."));
    expect(f.templatesUsed).toContain('cm.stdrm.self.less.foreach.drawnThisTurn');
    expect(fullyAutomated(f)).toBe(true);
  });
});

describe('std-rm Event (CR 601.2a): "an opponent casts a spell from anywhere other than their hand"', () => {
  it('is a cast by an opponent of a spell not cast from a hand', () => {
    const c = creature('Whenever an opponent casts a spell from anywhere other than their hand, you gain 1 life.');
    expect(fullyAutomated(parsed(c))).toBe(true);
    expect(json(c)).toContain('{"ev":"cast","player":"opponent","spell":{"not":{"castFrom":"hand"}}}');
  });
  it('fail closed: "you cast ... from anywhere other than their hand" and "an opponent casts ... other than your hand" are not read', () => {
    expect(fullyAutomated(parsed(creature('Whenever you cast a spell from anywhere other than their hand, you gain 1 life.')))).toBe(false);
    expect(fullyAutomated(parsed(creature('Whenever an opponent casts a spell from anywhere other than your hand, you gain 1 life.')))).toBe(false);
  });
});

describe('std-rm Cond (CR 111.1, 603.4): the token history of the turn', () => {
  it('"you created a token this turn" is a createToken by you this turn', () => {
    const c = creature('At the beginning of your end step, if you created a token this turn, you gain 1 life.');
    expect(fullyAutomated(parsed(c))).toBe(true);
    expect(json(c)).toContain('{"cond":"happened","event":{"ev":"createToken","player":"you"},"scope":"turn"}');
  });
});

// ---- renderers (render/qty.ts, render/stat.ts, render/steps-zones.ts, render/evt.ts, render/cond.ts) ---------------------------------------------------------

const RCTX = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
const step = (s: unknown, targets: unknown[] = []) => ({ kind: 'spell', effect: { targets, steps: [s] } }) as never;

describe('std-rm renderers say exactly the Oracle wordings', () => {
  it('phaseOut: a described set as the subject in each wording, the verb agreeing (CR 702.26b)', () => {
    const def = step({ op: 'phaseOut', what: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } });
    for (const ok of ['Creatures you control phase out.', 'All creatures you control phase out.', 'Each creature you control phases out.']) expect(renderGate(def, [ok], RCTX).ok, ok).toBe(true);
    for (const bad of ['Each creature you control phase out.', 'Creatures you control phases out.', 'Creatures an opponent controls phase out.']) expect(renderGate(def, [bad], RCTX).ok, bad).toBe(false);
  });
  it('a player\'s counters after "for each" and in "the number of" (CR 122.1)', () => {
    const def = step({ op: 'draw', who: { ref: 'you' }, count: { q: 'counters', on: { ref: 'you' }, kind: 'experience' } });
    expect(renderGate(def, ['Draw a card for each experience counter you have.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['Draw cards equal to the number of experience counters you have.'], RCTX).ok).toBe(true);
    expect(renderGate(def, ['Draw a card for each experience counter an opponent has.'], RCTX).ok).toBe(false);
    expect(renderGate(def, ['Draw a card for each poison counter you have.'], RCTX).ok).toBe(false);
  });
  it('the counts of the turn after "for each" (CR 121.1, 601.2i)', () => {
    const drawn = step({ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'cardsDrawnThisTurn' } });
    expect(renderGate(drawn, ["You gain 1 life for each card you've drawn this turn."], RCTX).ok).toBe(true);
    expect(renderGate(drawn, ["You gain 1 life for each card you've discarded this turn."], RCTX).ok).toBe(false);
    const nh = step({ op: 'draw', who: { ref: 'you' }, count: { q: 'happenedCount', event: { ev: 'cast', player: 'you', notFrom: 'hand' }, scope: 'turn' } });
    expect(renderGate(nh, ["Draw a card for each spell you've cast this turn from anywhere other than your hand."], RCTX).ok).toBe(true);
    expect(renderGate(nh, ["Draw a card for each spell you've cast this turn."], RCTX).ok).toBe(false);
    const nhGraveyard = step({ op: 'draw', who: { ref: 'you' }, count: { q: 'happenedCount', event: { ev: 'cast', player: 'you', notFrom: 'hand', from: 'graveyard' }, scope: 'turn' } });
    expect(renderGate(nhGraveyard, ["Draw a card for each spell you've cast this turn from anywhere other than your hand."], RCTX).ok).toBe(false);
  });
  it('the opponent\'s cast from anywhere other than their hand (CR 601.2a)', () => {
    const trig = { kind: 'triggered', trigger: { on: [{ ev: 'cast', player: 'opponent', spell: { not: { castFrom: 'hand' } } }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } } as never;
    expect(renderGate(trig, ['Whenever an opponent casts a spell from anywhere other than their hand, draw a card.'], RCTX).ok).toBe(true);
    expect(renderGate(trig, ['Whenever an opponent casts a spell from anywhere other than your hand, draw a card.'], RCTX).ok).toBe(false);
    expect(renderAbility(trig, RCTX).join(' ')).toContain('other than their hand');
  });
});
