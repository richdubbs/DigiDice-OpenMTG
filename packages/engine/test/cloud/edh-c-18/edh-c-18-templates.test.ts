/**
 * Commander EDHREC ranks 17,501-18,125, round edh-c-18 (third pass): the template data of parser/templates/zz-cloud/edh-c-18.json (a player discards, mills and loses life; creatures and lands one player controls
 * don't untap during their next untap step; a player untaps a land they control; "you skip your draw step this turn"; "it becomes the creature type of your choice"; draw a card for each of that spell's colors;
 * damage unless the player has exactly two hand sizes) and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-18-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-18-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC18 from '../../../src/parser/templates/zz-cloud/edh-c-18.json';
import review18 from '../../m5/golden/cards/edh-c-18-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC18 as Template[];
/** The round's golden entries. */
const review = review18 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv18.player.discard.mill.loselife': ["Demogorgon's Clutches"],
  'eff.edhv18.group.nountap.theirNext': ['Exhaustion'],
  'eff.edhv18.player.untaps.one.theyControl': ['Rising Waters'],
  'eff.edhv18.you.skip.drawStep.thisTurn': ['Elfhame Sanctuary'],
  'eff.edhv18.becomes.creatureType.choice.permanent': ['Proteus Machine'],
  'eff.edhv18.draw.perColorOf.imp': ['Moonveil Regent'],
  'eff.edhv18.damage.unlessTheyHaveExactlyEither': ['Skullcage'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-18 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-18.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-18.json');
    expect(files.indexOf('zz-cloud/edh-c-18.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv18.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv18\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
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

describe('edh-c-18 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-18 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-18 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-c-18 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-18 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const enchantment = (text: string) => parseCard(card('Example Plan', 'Enchantment', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;

describe('edh-c-18 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/filter.ts, rules/history.ts, render/np.ts (CR 509.1h, 506.4): "creatures that blocked or were blocked this turn" is a creature that was declared as a blocker or became blocked; the one-sided wordings and other turns are other readings', () => {
    const ok = enchantment('At end of combat, destroy each creature that blocked or was blocked this turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"anyOf":[{"blockedThisTurn":true},{"wasBlockedThisTurn":true}]');
    const one = enchantment('At end of combat, destroy each creature that was blocked this turn.');
    expect(JSON.stringify(one.abilities)).toContain('"wasBlockedThisTurn":true');
    expect(JSON.stringify(one.abilities)).not.toContain('"blockedThisTurn"');
    for (const bad of ['At end of combat, destroy each creature that blocked or was blocked last turn.', 'At end of combat, destroy each creature that blocked or was dealt damage this turn.', 'At end of combat, destroy each creature that blocked or was blocked this combat.']) {
      const f = enchantment(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"wasBlockedThisTurn":true'), bad).toBe(false);
    }
  });
  it('render/fold-edhv18.ts: "untaps a land they control" is for one player; "each player" and "each opponent" are not this reading (one shared pool of choices)', () => {
    expect(fullyAutomated(sorcery('Target player untaps a land they control.'))).toBe(true);
    for (const bad of ['Each player untaps a land they control.', 'Each opponent untaps a land they control.']) expect(fullyAutomated(sorcery(bad)), bad).toBe(false);
  });
  it('rules/history.ts#HISTORY_FILTER_FIELDS and the capability list name wasBlockedThisTurn (a filter that reads the history needs the history)', () => {
    expect(ENGINE_CAPABILITIES).toContain('filter:wasBlockedThisTurn');
  });
  it('render/steps.ts#unlessTheyControl (CR 608.2c, 402.1): "unless they have exactly N or exactly M cards in hand" keeps the two numbers in the printed order; one number, "if" and a different player are not this reading', () => {
    const ok = creature('At the beginning of each opponent\'s upkeep, this creature deals 2 damage to that player unless they have exactly three or exactly four cards in hand.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"any"');
    for (const bad of [
      'At the beginning of each opponent\'s upkeep, this creature deals 2 damage to that player unless they have exactly three cards in hand.',
      'At the beginning of each opponent\'s upkeep, this creature deals 2 damage to that player unless they have exactly three or four cards in hand.',
      'At the beginning of each opponent\'s upkeep, this creature deals 2 damage to that player unless you have exactly three or exactly four cards in hand.',
      'At the beginning of each opponent\'s upkeep, this creature deals 2 damage to that player if they have exactly three or exactly four cards in hand.',
    ]) expect(fullyAutomated(creature(bad)), bad).toBe(false);
  });
  it('render/steps-lasting.ts#WHERE_X_ACTIONS (CR 701.39a, 107.3): "bolster X, where X is a count" is read and said that way; a plain number is still "bolster 2"', () => {
    const ok = creature('At the beginning of your end step, bolster X, where X is the number of tapped creatures you control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, bolster 2.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, bolster X, where X is the number of tapped creatures you control, then bolster 1.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, bolster X, where Y is the number of tapped creatures you control.'))).toBe(false);
  });
  it('render/stat.ts (CR 614.10, 500.11): a skip that lasts this turn is said "you skip your <step> this turn"; another step, another player and "next" are other wordings', () => {
    const ok = sorcery('Draw a card. You skip your draw step this turn.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"b":"skip"');
    for (const bad of ['Draw a card. You skip your upkeep step this turn.', 'Draw a card. Target opponent skips their draw step this turn.', 'Draw a card. You skip your draw step.']) expect(fullyAutomated(sorcery(bad)) && JSON.stringify(sorcery(bad).abilities).includes('"step":"draw"'), bad).toBe(false);
  });
  it('the group restriction lasts through the targeted player\'s untap step and its group stays live (CR 502.3, 611.2c): the duration names the player; "you control" and "each opponent controls" are not this reading', () => {
    const ok = sorcery("Creatures and lands target opponent controls don't untap during their next untap step.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"d":"throughNextUntap","whose"');
    for (const bad of ["Creatures you control don't untap during their next untap step.", "Creatures each opponent controls don't untap during their next untap step."]) expect(fullyAutomated(sorcery(bad)), bad).toBe(false);
  });
  it('parser/templates edh-c-18: the permanent creature-type choice is not the "until end of turn" one (G5: one reading for each wording)', () => {
    const ok = artifact('When this artifact enters, it becomes the creature type of your choice.');
    expect(ok.templatesUsed).toContain('eff.edhv18.becomes.creatureType.choice.permanent');
    const timed = sorcery('Target creature becomes the creature type of your choice until end of turn.');
    expect(timed.templatesUsed).not.toContain('eff.edhv18.becomes.creatureType.choice.permanent');
    expect(fullyAutomated(timed)).toBe(true);
  });
});
