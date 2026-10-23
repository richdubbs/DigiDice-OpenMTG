/**
 * Card wave 2, slice s15 (std-rx12): the template data of parser/templates/zz-cloud/std-rx12.json ("~ has <abilities> as long as it hasn't dealt damage yet") and the
 * parser, renderer and engine changes of the round ("if it's a <type> card with <stat> N or less", "the number of opponents who control <a NP>", "X can't be 0.",
 * "that you've put one or more <kind> counters on this turn", "that token" and the reflexive trigger's own token).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx12-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx12 from '../../../src/parser/templates/zz-cloud/std-rx12.json';
import review from '../../m5/golden/cards/cloud-std-rx12-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx12 as Template[];
const MECH_COUNT = 1;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.stdrx12.self.has.whileNoDamageYet': 'Karakyk Guardian',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx12.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx12.json');
    expect(files.indexOf('zz-cloud/std-rx12.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx12.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.stdrx12.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^sta\.stdrx12\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
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

describe('std-rx12 guard G9 (design 6.8): examples and counter-examples', () => {
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bhasn't\b/, 'has'], [/\bdamage yet\b/, 'combat damage yet'], [/\byet\b/, 'this turn'], [/\bas long as\b/, 'if']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rx12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx12 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});


// ---- render/cond.ts#cardWithStats: "if it's a creature card with mana value 3 or less" ----------------------------------------------------------------------

describe('std-rx12 renderer (CR 608.2h, 202.3; family card-with-stat): "if it\'s a <type> card with <stat> N or less" (render/cond.ts#cardWithStats)', () => {
  it('a card of a type with a mana value, power or toughness comparison is full; the filter keeps every field', () => {
    const f = face('Sorcery', "Reveal the top card of your library. If it's a creature card with mana value 3 or less, put it into your hand.");
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"types":["Creature"],"manaValue":{"op":"<=","value":3},"isCard":true}');
    expect(fullFace(face('Sorcery', "Reveal the top card of your library. If it's a creature card with power 5 or greater, put it into your hand."))).toBe(true);
    expect(fullFace(face('Creature — Human Scout', "Whenever this creature attacks, reveal the top card of your library. If it's an artifact card with mana value 2 or less, put it into your hand. Otherwise, you may put it into your graveyard.", ['2', '2']))).toBe(true);
  });
  it('a plural, or a description with a field the noun phrase does not say (a color), is not read this way', () => {
    expect(fullFace(face('Sorcery', "Reveal the top two cards of your library. If they're creature cards with mana value 3 or less, put them into your hand."))).toBe(false);
  });
});

// ---- countPlayers.controlsIs: "the number of opponents who control an artifact" -----------------------------------------------------------------------------

describe('std-rx12 Qty (CR 102.3, 108.4): "the number of opponents who control <a NP>", "for each opponent who controls <a NP>" (countPlayers.controlsIs)', () => {
  it('both forms are full and write controlsIs (one or more) over each opponent', () => {
    for (const text of ['Draw a card for each opponent who controls an artifact.', 'Draw X cards, where X is the number of opponents who control a creature with power 4 or greater.', 'Create X Map tokens, where X is one plus the number of opponents who control an artifact.']) {
      const f = face('Sorcery', text);
      expect(fullFace(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('"q":"countPlayers","of":{"ref":"each","who":"opponent"},"controlsIs":{');
    }
  });
  it('the engine capability is advertised', () => expect(ENGINE_CAPABILITIES.has('feature:q.countPlayers.controlsIs')).toBe(true));
  it('a description naming a controller, a number of permanents, or players other than opponents is not read so', () => {
    expect(fullFace(face('Sorcery', 'Draw a card for each opponent who controls an artifact you control.'))).toBe(false);
    expect(fullFace(face('Sorcery', 'Draw a card for each opponent who controls two artifacts.'))).toBe(false);
    expect(JSON.stringify(face('Sorcery', 'Draw a card for each player who controls an artifact.').abilities)).not.toContain('controlsIs');
  });
});

// ---- render/cond.ts: "it hasn't dealt damage yet" ------------------------------------------------------------------------------------------------------------

describe('std-rx12 renderer (CR 120.1, 400.7; family self-they): "it hasn\'t dealt damage yet" (no combat field)', () => {
  it('the singular "they" of a card is the same condition', () => {
    const a = face('Creature — Elemental', "This creature has hexproof as long as it hasn't dealt damage yet.", ['2', '2']);
    const b = face('Creature — Elemental', "This creature has hexproof as long as they haven't dealt damage yet.", ['2', '2']);
    expect(fullFace(a), JSON.stringify(a.diagnostics)).toBe(true);
    expect(fullFace(b), JSON.stringify(b.diagnostics)).toBe(true);
    expect(jsonKey(a.abilities)).toBe(jsonKey(b.abilities));
    expect(JSON.stringify(a.abilities)).toContain('"event":{"ev":"damage","source":{"self":true}},"scope":"game"');
  });
  it('FAST5 T68\'s combat form keeps its own JSON (combat: true)', () => {
    expect(JSON.stringify(face('Creature — Elemental', "This creature has hexproof as long as they haven't dealt combat damage yet.", ['2', '2']).abilities)).toContain('"combat":true');
  });
});

// ---- ActivatedAbilityDef.xMin: "X can't be 0." ---------------------------------------------------------------------------------------------------------------

describe('std-rx12 activation (CR 107.3a, 602.2b): "X can\'t be 0." of an activated ability (ActivatedAbilityDef.xMin, parser/lower/activation.ts#restrictionOf)', () => {
  it('is read as xMin 1, said back after the effect and before "Activate only ..."', () => {
    const f = face('Creature — Merfolk', "{X}: Creatures you control have base power and toughness X/X until end of turn. X can't be 0. Activate only during your turn.", ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"xMin":1');
    expect(json).toContain('"onlyIf":{"cond":"turnOf","whose":"you"}');
  });
  it('with no "Activate only" after it too', () => {
    const f = face('Creature — Merfolk', "{X}{U}: Put X +1/+1 counters on target creature. X can't be 0.", ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"xMin":1');
  });
  it('the engine capability is advertised', () => expect(ENGINE_CAPABILITIES.has('feature:activate.xMin')).toBe(true));
  it('"X can\'t be 1." or "X can\'t be greater than 3." is not this reading', () => {
    expect(JSON.stringify(face('Creature — Merfolk', "{X}: Put X +1/+1 counters on target creature. X can't be 1.", ['1', '1']).abilities)).not.toContain('xMin');
    expect(JSON.stringify(face('Creature — Merfolk', "{X}: Put X +1/+1 counters on target creature. X can't be greater than 3.", ['1', '1']).abilities)).not.toContain('xMin');
  });
});

// ---- ObjectFilter.countersPutThisTurn: "that you've put one or more +1/+1 counters on this turn" --------------------------------------------------------------

describe('std-rx12 Filter (CR 122.6, 611.3a): "<objects> that you\'ve put one or more <kind> counters on this turn" (ObjectFilter.countersPutThisTurn)', () => {
  it('is full as a static ability\'s group and writes the kind and "you"', () => {
    const f = face('Creature — Human', "Each creature you control that you've put one or more +1/+1 counters on this turn has hexproof.", ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"countersPutThisTurn":{"kind":"+1/+1","by":"you"}');
    expect(fullFace(face('Creature — Human', "Creatures you control that you've put one or more -1/-1 counters on this turn get +1/+0.", ['1', '1']))).toBe(true);
  });
  it('the engine capability is advertised', () => expect(ENGINE_CAPABILITIES.has('filter:countersPutThisTurn')).toBe(true));
  it('another player, or "this game", is not this reading', () => {
    expect(fullFace(face('Creature — Human', "Each creature you control that an opponent has put one or more +1/+1 counters on this turn has hexproof.", ['1', '1']))).toBe(false);
    expect(fullFace(face('Creature — Human', "Each creature you control that you've put one or more +1/+1 counters on has hexproof.", ['1', '1']))).toBe(false);
  });
});

// ---- parser/lower/anaphora.ts + conditions.ts#foldReflexive: the token a reflexive trigger creates -------------------------------------------------------------

describe('std-rx12 lowering (CR 603.12a, 111.1, 608.2c): "When you do, create a <token>. Put a counter on that token." (anaphora.ts, conditions.ts#foldReflexive)', () => {
  const text = 'At the beginning of combat on your turn, you may sacrifice an artifact. When you do, create a 1/1 white Ally creature token. Put a +1/+1 counter on that token.';
  it('the sentence after the reflexive trigger acts on the token the trigger created, so it is an instruction of the trigger', () => {
    const f = face('Creature — Human', text, ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps;
    const refl = steps.find((s) => s.op === 'reflexive')!;
    expect(refl.do!.map((s) => s.op)).toEqual(['createToken', 'putCounters']);
    expect(steps.some((s) => s.op === 'putCounters')).toBe(false);
  });
  it('"that token" names the one candidate whose words say token, never a target permanent of a description with no token in it', () => {
    const f = face('Creature — Human', 'At the beginning of combat on your turn, you may tap target permanent you control. When you do, create a 1/1 white Ally creature token. Put a +1/+1 counter on that token.', ['2', '2']);
    expect(JSON.stringify(f.abilities)).not.toContain('"putCounters","on":{"ref":"target"');
  });
  it('with two created tokens "that token" stays ambiguous (manual)', () => {
    expect(fullFace(face('Creature — Human', 'At the beginning of combat on your turn, you may sacrifice an artifact. When you do, create a 1/1 white Ally creature token and a Treasure token. Put a +1/+1 counter on that token.', ['2', '2']))).toBe(false);
  });
});
