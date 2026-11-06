/**
 * Commander lane cost, round edh-next-58 (top 20,000, cost changes and alternative costs): the template data of parser/templates/zz-cloud/edh-next-58.json and the round's parser,
 * renderer and engine changes, tested at the end of this file and in edh-next-58-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. CR cites from memory, unverified (cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext58 from '../../../src/parser/templates/zz-cloud/edh-next-58.json';
import review from '../../m5/golden/cards/edh-next-58-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext58 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'cm.edhn58.additional.tapAny.lessForEach': ['Explosive Singularity'],
  'cm.edhn58.spells.less.you.cantBeCountered': ['Cunning Nightbonder'],
  'cm.edhn58.keywordAbilities.you.ofOther.less': ['Bladehold War-Whip'],
  'cm.edhn58.keywordAbilities.you.less.forEach': ['Dragonkin Berserker'],
  'sta.edhn58.aura.activatedAbilities.costLess.floorOne': ['Power Artifact'],
  'cm.edhn58.spells.you.less.forEachTarget': ['Hinata, Dawn-Crowned'],
  'cm.edhn58.spells.opp.more.forEachTarget': ['Hinata, Dawn-Crowned'],
  'cm.edhn58.spells.you.less.forEachTargetOfKind': ['Battlefield Thaumaturge'],
  'cm.edhn58.spells.opp.more.targetYouOrPermanent': ['Monastery Siege'],
  'sta.edhn58.abilities.less.floorOne.asLongAs': ['Convergence of Dominion'],
  'sta.edhn58.duringYourTurn.oppSpellsAndAbilities.more': ['Tithe Taker'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Equip ') ? card('Example Plate', 'Artifact — Equipment', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-58 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-58.json, path order: after edh-next-52.json, before edh-next-6.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-58.json');
    expect(files.indexOf('zz-cloud/edh-next-58.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-52.json'));
    expect(files.indexOf('zz-cloud/edh-next-58.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn58.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn58\./);
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

describe('edh-next-58 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bElf\b/, 'Elves'], [/\bsecond\b/, 'third'], [/\bhalf\b/, 'a third'], [/\bdifferent\b/, 'same'], [/\bflash\b/, 'haste'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-58 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-58 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-58 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-58 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const fixed = (_l: string): boolean => false;
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !fixed(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-next-58 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Artifact Creature — Construct', name = 'Example Beast') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const trap = (cond: string) => parseCard(card('Example Trap', 'Instant — Trap', `If ${cond}, you may pay {0} rather than pay this spell's mana cost.\nYou gain 1 life.`), OPTS).faces[0]!;
  it('parser/holes/edhn58.ts + render/qty.ts + render/cond.ts (CR 118.9, 701.23a, 701.6a, 400.3): the three Trap conditions, and nothing near them', () => {
    expect(fullyAutomated(trap('an opponent searched their library this turn'))).toBe(true);
    expect(fullyAutomated(trap('a creature spell you cast this turn was countered by a spell or ability an opponent controlled'))).toBe(true);
    expect(fullyAutomated(trap('an opponent had three or more cards put into their graveyard from anywhere this turn'))).toBe(true);
    expect(fullyAutomated(trap('an opponent had one cards put into their graveyard from anywhere this turn'))).toBe(false);
    expect(fullyAutomated(trap('an opponent searched your library this turn'))).toBe(false);
    expect(fullyAutomated(trap('a creature spell you cast this turn was countered by a spell you controlled'))).toBe(false);
    expect(fullyAutomated(trap('an opponent had three or fewer cards put into their graveyard from anywhere this turn'))).toBe(false);
  });
  it('parser/holes/edhn58.ts + statics/costmods.ts + actions/cast.ts (CR 205.2a, 701.21a, 601.2f): "for each card type among permanents you\'ve sacrificed this turn"; the singular and "the number of" forms; another group or turn stays out', () => {
    const own = (text: string) => parseCard(card('Example Glutton', 'Creature — Dragon', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
    expect(fullyAutomated(own("~ costs {1} less to cast for each card type among permanents you've sacrificed this turn."))).toBe(true);
    expect(fullyAutomated(own("~ costs {1} less to cast for each card type among permanents your opponents have sacrificed this turn."))).toBe(false);
    expect(fullyAutomated(own("~ costs {1} less to cast for each card type among permanents you've sacrificed this game."))).toBe(false);
    expect(fullyAutomated(own("~ costs {1} more to cast for each card type among permanents you've sacrificed this turn."))).toBe(false);
  });
  it('parser/holes/edhn58.ts + render/cond.ts (CR 404.1, 102.3): "ten or more creature cards total in all graveyards" is the count of every graveyard; "in your graveyard" is another condition', () => {
    const own = (text: string) => parseCard(card('Example Avatar', 'Creature — Avatar', text, { power: '6', toughness: '6' }), OPTS).faces[0]!;
    expect(fullyAutomated(own('If there are ten or more creature cards total in all graveyards, ~ costs {6} less to cast.'))).toBe(true);
    expect(jsonKey(own('If there are ten or more creature cards total in all graveyards, ~ costs {6} less to cast.').abilities)).toBe(jsonKey(own('If there are ten or more creature cards in graveyards, ~ costs {6} less to cast.').abilities));
    expect(jsonKey(own('If there are ten or more creature cards total in all graveyards, ~ costs {6} less to cast.').abilities)).not.toBe(jsonKey(own('If there are ten or more creature cards in your graveyard, ~ costs {6} less to cast.').abilities));
    expect(fullyAutomated(own('If there are ten or fewer creature cards total in all graveyards, ~ costs {6} less to cast.'))).toBe(false);
  });
  it('statics/costmods.ts + model/lint-nodes.ts (CR 601.2c, 601.2f): spellTargetCount in a modifier of other spells is allowed (Hinata); in a static outside a cost modifier it stays a lint error', () => {
    expect(fullyAutomated(creature('Spells you cast cost {1} less to cast for each target.'))).toBe(true);
    expect(fullyAutomated(creature('Spells you cast cost {1} less to cast for each target beyond the first.'))).toBe(false);
  });
  it('statics/costmods.ts#appliesToSpell + capability feature:costMod.spellTargets.orYou (CR 115.1, 601.2c): "that target you or a permanent you control" is the template\'s alone; without "you or" it is the older reading', () => {
    const a = creature('Spells your opponents cast that target you or a permanent you control cost {2} more to cast.');
    const b = creature('Spells your opponents cast that target a permanent you control cost {2} more to cast.');
    expect(fullyAutomated(a)).toBe(true);
    expect(fullyAutomated(b)).toBe(true);
    expect(jsonKey(a.abilities)).not.toBe(jsonKey(b.abilities));
    expect(ENGINE_CAPABILITIES.has('feature:costMod.spellTargets.orYou')).toBe(true);
    expect(fullyAutomated(creature('Spells your opponents cast that target you or a permanent you control cost {2} less to cast.'))).toBe(false); // an increase only: no card prints the reduction
  });
  it('render/stat.ts (CR 602.2b, 601.2f): the cost-change wordings of the round render to Oracle (equip of other Equipment, boast per Dragon, enchanted artifact\'s abilities, the floor sentence)', () => {
    expect(fullyAutomated(creature('Equip abilities you activate of other Equipment cost {1} less to activate.'))).toBe(true);
    expect(fullyAutomated(creature('Equip abilities you activate of other Equipment cost {1} more to activate.'))).toBe(false);
    expect(fullyAutomated(creature('Boast abilities you activate cost {1} less to activate for each Dragon you control.'))).toBe(true);
    expect(fullyAutomated(creature('As long as you control a creature, activated abilities of cards in your graveyard cost {2} less to activate. This effect can\'t reduce the mana in that ability\'s activation cost to less than one mana.'))).toBe(true);
    expect(fullyAutomated(creature('Activated abilities of artifacts you control cost {2} less to activate. This effect can\'t reduce the mana in that cost to less than one mana.'))).toBe(true);
  });
});
