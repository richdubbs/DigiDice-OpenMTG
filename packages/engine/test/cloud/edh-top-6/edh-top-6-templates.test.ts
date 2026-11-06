/**
 * Commander lane edh-top, round edh-top-6: the template data of parser/templates/zz-cloud/edh-top-6.json ("They're Zombies in addition to their other types", "for each opponent, you may put
 * / cast up to one target ... from that player's graveyard ...", join forces "Starting with you, each player may pay any amount of mana", "Each player searches their library for up to X
 * basic land cards, where X is ..., puts them onto the battlefield tapped, then shuffles", "Until end of turn, it gains haste and becomes a Pirate in addition to its other types") and the
 * round's engine, parser and renderer changes, tested at the end of this file and in edh-top-6-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-top-6-scenarios.test.ts. CR cites are from the Comprehensive Rules text
 * of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop6 from '../../../src/parser/templates/zz-cloud/edh-top-6.json';
import review from '../../m5/golden/cards/edh-top-6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop6 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on
 * one card (of the EDHREC top 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule
 * 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edht6.theyAre.subtypes.inAddition': ['Afterlife from the Loam'],
  'eff.edht6.forEachOpponent.mayPut.bf': ['Sepulchral Primordial'],
  'eff.edht6.forEachOpponent.mayCast.free': ['Diluvian Primordial'],
  'eff.edht6.joinForces.eachPlayerMayPayAnyAmount': ['Minds Aglow', 'Collective Voyage'],
  'eff.edht6.eachPlayer.searches.upToX.bf.tapped': ['Collective Voyage'],
  'eff.edht6.dur.obj.gains.becomes.subtype.inAddition': ['Coercive Recruiter'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a spell (a sorcery) or, for a triggered line, a creature. */
const parsedWith = (t: Template, text: string) =>
  parseCard(/^When/.test(text) ? card('Example Plan', 'Creature \u2014 Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-top-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-6.json, path order: after edh-top-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-6.json');
    expect(files.indexOf('zz-cloud/edh-top-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples (or one with a second sentence) and two counter-examples, a status, and is of version 8; ids are *.edht6.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-top-6 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bThey're\b/, "It's"], [/\bZombies\b/, 'Zombie'], [/\bfor each opponent\b/, 'for each player'], [/\bthat player's\b/, "your"], [/\bStarting with you\b/, 'Starting with target opponent'],
    [/\beach player may\b/, 'each opponent may'], [/\bany amount of mana\b/, 'any amount of life'], [/\bonto the battlefield tapped\b/, 'onto the battlefield'], [/\bgains haste\b/, 'gains flying'],
    [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bup to one\b/, 'up to two'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-top-6 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;

describe('edh-top-6 engine, parser and renderer changes (one test each)', () => {
  it('pay.startingWith is a capability (effects/handlers/pay.ts#OP_FORMS, model/cap-walk.ts) and the step is in the generated schema', () => {
    expect(ENGINE_CAPABILITIES.has('op:pay.eachStartingWith')).toBe(true);
  });
  it('parser/holes/qty.ts: "the total amount of mana paid this way" counts the payment of a group in turn before it; with no such payment (or after another kind of step) the sentence is not automated (fail closed)', () => {
    const ok = sorcery('Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"resultCount"');
    expect(fullyAutomated(sorcery('Each player draws X cards, where X is the total amount of mana paid this way.'))).toBe(false);
    expect(fullyAutomated(sorcery('Draw a card. Each player draws X cards, where X is the total amount of mana paid this way.'))).toBe(false); // (another step is no payment)
  });
  it('render/steps-flow.ts#payClause: a payment of a group in turn is said only as "Starting with you, each player may pay any amount of mana" (any other shape has no wording)', () => {
    expect(fullyAutomated(sorcery('Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.'))).toBe(true);
    expect(fullyAutomated(sorcery('Starting with you, each opponent may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.'))).toBe(false);
    expect(fullyAutomated(sorcery('Starting with you, each player may pay any amount of {R}. Each player draws X cards, where X is the total amount of mana paid this way.'))).toBe(false);
  });
  it('parser/holes/object.ts#perPlayerTarget: "in that player\'s graveyard" is the graveyard of each player (perPlayer, owner of a card there), only after "for each player"; "for each opponent" keeps "from that player\'s graveyard"', () => {
    const t = sorcery("For each player, choose up to one target creature card in that player's graveyard. Put those cards onto the battlefield under your control.");
    expect(fullyAutomated(t)).toBe(true);
    expect(JSON.stringify(t.abilities)).toContain('"perPlayer":true');
    expect(JSON.stringify(t.abilities)).not.toContain('"owner"'); // a card in a graveyard is its owner's: the spec names no owner of its own
    expect(fullyAutomated(sorcery("For each opponent, choose up to one target creature card in that player's graveyard. Put those cards onto the battlefield under your control."))).toBe(false);
    expect(fullyAutomated(sorcery("For each player, choose up to one target creature card in your graveyard. Put those cards onto the battlefield under your control."))).toBe(false);
  });
  it('parser/holes/object.ts#theyAre: "They\'re" names the group an earlier sentence moved ("It\'s" would name one object); with no group before it the sentence is manual', () => {
    expect(fullyAutomated(sorcery("Return up to two target creature cards from your graveyard to the battlefield. They're Zombies in addition to their other types."))).toBe(true);
    expect(fullyAutomated(sorcery("Draw a card. They're Zombies in addition to their other types."))).toBe(false);
  });
  it('parser/lower/anaphora.ts (Mention.enteredObject): after a target, "that creature" is the target, not the creature that entered; alone, it is the creature that entered; ', () => {
    const target = creature('Whenever another Pirate you control enters, gain control of target creature until end of turn. Untap that creature.');
    expect(fullyAutomated(target)).toBe(true);
    expect(JSON.stringify(target.abilities)).toContain('"op":"untap","what":{"ref":"target","id":"t0"}');
    const alone = creature('Whenever another Pirate you control enters, untap that creature.');
    expect(fullyAutomated(alone)).toBe(true);
    expect(JSON.stringify(alone.abilities)).toContain('"op":"untap","what":{"ref":"event","role":"subject"}');
  });
  it('Mention.enteredObject yields only to a target that is a permanent: a creature CARD that is exiled, returned to hand, or in a graveyard is not "that creature" (the unit stays manual)', () => {
    expect(fullyAutomated(creature('Whenever another creature you control enters, exile target creature card from a graveyard. Put a +1/+1 counter on that creature.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever another creature you control enters, return up to one target creature card from your graveyard to your hand. That creature gains lifelink until end of turn.'))).toBe(false);
  });
  it('parser/lower/scope.ts: the opponents a batch of damage was dealt to are "those opponents", (a damage trigger to opponents only; with another recipient the sentence is manual)', () => {
    const ok = creature("Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"player":{"ref":"event","role":"recipient"}');
    expect(fullyAutomated(creature("Whenever one or more Pirates you control deal damage to a player, exile the top card of each of those opponents' libraries."))).toBe(false);
    expect(fullyAutomated(creature("Whenever ~ enters, exile the top card of each of those opponents' libraries."))).toBe(false);
  });
  it('std-rx27 rider rid.rx27.forEachCast.exileInstead also attaches to a cast step ("If a spell cast this way would be put into a graveyard, exile it instead"); after anything else it is not automated', () => {
    const ok = creature("When ~ enters, for each opponent, you may cast up to one target instant card from that player's graveyard without paying its mana cost. If a spell cast this way would be put into a graveyard, exile it instead.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"graveyardInstead":{"to":{"zone":"exile"}}');
    expect(fullyAutomated(creature('When ~ enters, draw a card. If a spell cast this way would be put into a graveyard, exile it instead.'))).toBe(false);
  });
});
