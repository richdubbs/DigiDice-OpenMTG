/**
 * FAST5X E14: the template data of parser/templates/zz-fast5x/e14.json and the renderer readings the top of a library needed (design 6.8 G6):
 *  - "you may cast X spells from the top of your library" (one filter, or two: "Spider spells and noncreature spells"), "you may play lands from ...",
 *    "you may play lands and cast X from ...", "once each turn, you may cast an X spell from ...", "as long as ~ attacked this turn, you may play the top card of
 *    your library", and with "you may look at the top card of your library any time" in one sentence, as a static ability or "until end of turn" (CR 401.5,
 *    601.3, 601.3e, 305.1, 611.2a, 611.3a);
 *  - a quoted ability another one follows has no period in Oracle ('has "You may look at ... any time" and "Whenever ... explores."', render/mods.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated (or capped only by the template's status) and passes the exact render gate;
 * every counter-example does not parse or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e14 from '../../../src/parser/templates/zz-fast5x/e14.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e14-review.json';
import r4FxbReview from '../../m5/golden/cards/cloud-r4-fxb-review.json';

const E14 = e14 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const effect = /^(Until|Draw)\b/.test(text);
  const typeLine = type ?? (effect ? 'Sorcery' : 'Creature — Human');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const effects = (text: string, type?: string): unknown => {
  const a = parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as { effects?: unknown; effect?: { steps: unknown[] } };
  return a.effects ?? a.effect?.steps;
};

describe('E14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e14.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e14.json');
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E14) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.e14\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E14 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = [...review, ...r4FxbReview] as { card: string; verified: string }[];
    // the only cards of the local index that print these sentences (npm run cards -- snapshot, 2026-10-14)
    const WHOLE_CORPUS: Record<string, string[]> = {
      'sta.e14.top.once.cast': ['Johann, Apprentice Sorcerer', 'Assemble the Players'],
      'sta.e14.top.look.lands.cast': ['Case of the Locked Hothouse'],
      'eff.e14.top.eot.look.lands.cast': ['The Belligerent'],
      'sta.e14.top.attacked.play': ['The Lunar Whale'], // FAST5X E28: stable since static abilities read "attacked this turn" (sfilter:attackedThisTurn)
      // Standard round 4 r4-fxb: Ka-Zar (its Zabu token is read now) is the one card the line makes full; Courser of Kruphix, Oracle of Mul Daya ("Play with the
      // top card of your library revealed") and Augur of Autumn (coven) print it too and stay partial for those lines. DEVIATION: 4 matches, 1 golden
      'sta.e14.top.lands': ['Ka-Zar of the Savage Land'],
      // std-exile-play-1-1: stable since Gwenom's next sentence is read (rid.stdexile1.top.castThisWay.lifeCost); the one card that prints the line. DEVIATION: 1 golden
      'eff.e14.top.eot.look.play': ['Gwenom, Remorseless'],
    };
    for (const t of E14.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('the templates whose cards have other blockers, or whose engine part is missing, stay experimental', () => {
    const experimental = E14.filter((t) => t.status === 'experimental').map((t) => t.id).sort();
    // lands: Ka-Zar (the token named Zabu), Courser of Kruphix and Oracle of Mul Daya ("revealed"), Augur of Autumn (coven); attacked.play: a static
    // ability couldn't read the turn's history until FAST5X E28 (sfilter:attackedThisTurn; stable now); eot.look.play: Gwenom's next sentence
    // (sta.e14.top.lands: stable since Standard round 4 r4-fxb, above; eot.look.play: stable since std-exile-play-1-1 reads Gwenom's next sentence)
    expect(experimental).toEqual([]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E14) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E14 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E14) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const type = t.id === 'sta.e14.top.attacked.play' ? 'Artifact — Vehicle' : undefined;
      const first = parsed(t.examples[0]!.text, type);
      for (const e of t.examples) {
        const f = parsed(e.text, type);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c, type);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E14 lowering: what the shapes mean', () => {
  const SPELL = { stackKind: 'spell', zone: 'stack' };
  const LOOK = { s: 'permit', who: { ref: 'you' }, action: 'lookAt' };
  const LANDS = { s: 'permit', who: { ref: 'you' }, action: 'play', of: { types: ['Land'] }, fromTop: true };
  const cast = (of: unknown, extra: Record<string, unknown> = {}): unknown => ({ s: 'permit', who: { ref: 'you' }, action: 'cast', of, fromTop: true, ...extra });

  it('CR 205.2a, 601.3: "instant and sorcery spells" is one filter of either type (not "instant" and "sorcery spells"), so it is not ambiguous', () => {
    expect(effects('You may cast instant and sorcery spells from the top of your library.')).toEqual([cast({ types: ['Instant', 'Sorcery'], ...SPELL })]);
    expect(effects('You may cast creature and enchantment spells from the top of your library.')).toEqual([cast({ types: ['Creature', 'Enchantment'], ...SPELL })]);
  });
  it('CR 601.3: two kinds of spells are either ("Goblin spells and noncreature spells")', () => {
    expect(effects('You may cast Goblin spells and noncreature spells from the top of your library.'))
      .toEqual([cast({ anyOf: [{ subtypes: ['Goblin'], ...SPELL }, { notTypes: ['Creature'], ...SPELL }] })]);
  });
  it('CR 305.1, 601.3: "play lands and cast X" is two permissions: lands are played, never cast (CR 305.9)', () => {
    expect(effects('You may play lands and cast Elf spells from the top of your library.')).toEqual([LANDS, cast({ subtypes: ['Elf'], ...SPELL })]);
    expect(effects('You may play lands from the top of your library.')).toEqual([LANDS]);
  });
  it('CR 601.3: "once each turn" limits the permission itself', () => {
    expect(effects('Once each turn, you may cast an artifact spell from the top of your library.')).toEqual([cast({ types: ['Artifact'], ...SPELL }, { oncePerTurn: true })]);
  });
  it('CR 401.5, 611.2a: "until end of turn, you may look ... and you may play ..." is one lasting effect', () => {
    expect(effects('Until end of turn, you may look at the top card of your library any time and you may play cards from the top of your library.'))
      .toEqual([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [LOOK, { s: 'permit', who: { ref: 'you' }, action: 'play', fromTop: true }] }]);
    expect(effects('Until end of turn, you may look at the top card of your library any time, and you may play lands and cast spells from the top of your library.'))
      .toEqual([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [LOOK, LANDS, cast(SPELL)] }]);
  });
  it('a permission from somewhere else or for someone else is no reading (counter-examples stay manual)', () => {
    expect(fullyAutomated(parsed('You may cast creature spells from the top of an opponent\'s library.'))).toBe(false);
    expect(fullyAutomated(parsed('Each player may cast creature spells from the top of their library.'))).toBe(false);
  });
});

describe('E14 rendering (G6): a quoted ability another one follows', () => {
  it('Glowcap Lantern: \'has "You may look at the top card of your library any time" and "Whenever this creature attacks, it explores."\' passes the gate', () => {
    // the game path (compileCard: the quoted abilities are parsed as abilities of their own) passes the gate only with the reading without the period
    expect(compileCard(getCard('Glowcap Lantern')).automation.level).toBe('full');
  });
});

describe('E14 real cards (npm run cards -- try)', () => {
  it('the golden cards compile as reviewed', () => {
    for (const g of review as { card: string; expect?: string }[]) {
      if (g.expect === 'full') expect(compileCard(getCard(g.card)).automation.level, g.card).toBe('full');
    }
  });
});
