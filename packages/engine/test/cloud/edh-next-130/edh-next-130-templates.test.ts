/**
 * edh-next-130 (must-finish round, group copies): the template data of parser/templates/zz-cloud/edh-next-130.json (see the file) and the round's parser, lowering, engine and renderer
 * changes, played in edh-next-130-scenarios.test.ts (Shelob, Shredder, Dino DNA, Hofri, Split Decision, Vesuvan Shapeshifter, Spelltwine, Jaya's Phoenix, Volo, Tempt with Reflections).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the 2026-09-25 Comprehensive Rules.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { FACTS_ANSWERABLE_FIELDS } from '../../../src/model/cap-walk';
import { ANSWERABLE_FIELDS } from '../../../src/rules/history';
import edhN130 from '../../../src/parser/templates/zz-cloud/edh-next-130.json';
import review from '../../m5/golden/cards/edh-next-130-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhN130 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on one golden card because Oracle prints the wording on one card only, with their
 * template tests (G9, G2) and played scenarios. Listed in the round's record (owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn130.copyToken.thatCreature.typesSet': ['Shelob, Child of Ungoliant'],
  'eff.edhn130.eachOtherOpponent.copySelf.attackingThem': ['Shredder, Shadow Master'],
  'eff.edhn130.linked.returnGraveyard': ['Hofri Ghostforge'],
  'eff.edhn130.copyToken.thatCreature.typeAdded.hasLinked': ['Hofri Ghostforge'],
  'sta.edhn130.entersOrFaceUp.mayCopy.untilFaceDown': ['Vesuvan Shapeshifter'],
  'rid.edhn130.castCopiesIfAble.free': ['Spelltwine'],
  'eff.edhn130.next.loyaltyAbility.copy': ["Jaya's Phoenix"],
  'eff.edhn130.eachOpponentMay.copyToken': ['Tempt with Reflections'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Equip ') ? card('Example Plate', 'Artifact — Equipment', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-130 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-130.json, path order: after edh-next-13.json, before edh-next-14.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-130.json');
    expect(files.indexOf('zz-cloud/edh-next-130.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-13.json'));
    expect(files.indexOf('zz-cloud/edh-next-130.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-14.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn130.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn130\./);
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

describe('edh-next-130 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElf\b/, 'Elves'], [/\bflying\b/, 'x'], [/\btwo\b/, 'three'], [/\bexiles\b/, 'gains'], [/\bcounter\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-130 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-130 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-130 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-130 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    // a narrow wording is one card's own line (design 6.9 deviation, NARROW): the lines of the cards that print it are the wording, so they are not held against the examples
    const own = new Set(Object.values(NARROW).flat());
    for (const c of index ?? []) {
      if (own.has(c.name)) continue;
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    // a narrow wording of fixed words (Phyrexian Marauder's tax line, Empty City Ruse's skip line): the line itself is the wording, so its examples carry it
    const fixed = (l: string): boolean => /^You may look at (the )?cards exiled with ~\.$/.test(l); // the fixed words of the look permission (also printed on cards not yet full, so not in NARROW)
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !fixed(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-next-130 parser, lowering and renderer changes (each played in edh-next-130-scenarios.test.ts)', () => {
  const parse = (name: string, type: string, text: string, pt?: [string, string]) => parseCard(card(name, type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
  it('CR 120.1, 400.7 (holes/filter.ts, rules/filter.ts, render/np.ts): "dealt damage this turn by a <Subtype> you controlled" is the source filter of the damage history; the present tense "you control" is not this reading', () => {
    const f = parse('Example Hunter', 'Creature — Goblin', 'Whenever another creature dealt damage this turn by a Goblin you controlled dies, you gain 1 life.', ['2', '2']);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"dealtDamageThisTurnBy":{"subtypes":["Goblin"],"controller":"you"}');
    expect(fullyAutomated(parse('Example Hunter', 'Creature — Goblin', 'Whenever another creature dealt damage this turn by a Goblin you control dies, you gain 1 life.', ['2', '2']))).toBe(false);
  });
  it('CR 707.9b, 205.1a (holes/p2copyperm1.ts, render/copy-except.ts): one token copy "is a 3/3 black Zombie creature with menace" SETS its types, subtypes, color and base power and toughness; "... in addition to its other types" stays the older reading (added)', () => {
    const set = parse('Example Rite', 'Sorcery', "Create a token that's a copy of target creature card in your graveyard, except it's a 3/3 black Zombie creature with menace.");
    expect(fullyAutomated(set), JSON.stringify(set.diagnostics)).toBe(true);
    expect(JSON.stringify(set.abilities)).toContain('"types":{"set":["Creature"]},"subtypes":{"set":["Zombie"]}');
    const added = parse('Example Rite', 'Sorcery', "Create a token that's a copy of target creature card in your graveyard, except it's a 3/3 black Zombie creature with menace in addition to its other types.");
    expect(JSON.stringify(added.abilities)).not.toContain('"types":{"set"');
  });
  it('CR 113.2 (holes/misc.ts#abilitiesFor): a quoted ability whose comma stands inside its closing quote before "and it loses" is read with its period', () => {
    const f = parse('Example Larder', 'Creature — Spider', "Whenever another creature you control dies, create a token that's a copy of that creature, except it's a Clue artifact with \"{2}, {T}, Sacrifice this token: You gain 2 life,\" and it loses all other card types.", ['1', '1']);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"gainLife"');
  });
  it('CR 701.38a, 608.2c (lower/anaphora.ts#voteWorld): after "If A gets more votes, counter the spell.", "If B gets more votes or the vote is tied, copy the spell." copies the TARGET (two sequential results, never nested; the vote words are the ones the vote reading knows)', () => {
    const f = parse('Example Ballot', 'Instant', 'Choose target creature spell. Starting with you, each player votes for denial or duplication. If denial gets more votes, counter the spell. If duplication gets more votes or the vote is tied, copy the spell.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (f.abilities[0] as { effect: { steps: { op: string; then?: { op: string; what?: unknown }[] }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['action', 'if', 'if']);
    expect(steps[2]!.then![0]!.what).toEqual({ ref: 'target', id: 't0' });
  });
  it('CR 608.2c (lower/mentions.ts): a token copy of a target is not named by the target\'s nouns: "that artifact" after it is the target', () => {
    const f = parse('Example Offer', 'Sorcery', "Choose target artifact you control. Create a token that's a copy of that artifact. Each opponent may create a token that's a copy of that artifact.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities).match(/"what":\{"ref":"target","id":"t0"\}/g)?.length).toBe(2);
  });
  it('CR 603.10a, 607.2a (model/cap-walk.ts): the copy forms lastOnBattlefield and linkCopied are capabilities of a token copy only', () => {
    expect(ENGINE_CAPABILITIES.has('op:copy.lastOnBattlefield')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:copy.linkCopied')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:copy.lastOnBattlefield.other')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('filter:dealtDamageThisTurnBy')).toBe(true);
  });
  it('design 5.4 (model/cap-walk.ts#FACTS_ANSWERABLE_FIELDS): the model\'s copy of the history fields the facts answer is the list of rules/history.ts', () => {
    expect([...FACTS_ANSWERABLE_FIELDS].sort()).toEqual([...ANSWERABLE_FIELDS].sort());
  });
});
