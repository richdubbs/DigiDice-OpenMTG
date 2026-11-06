/**
 * Lane trek, round trek-18 (Star Trek: turns and combat): the template data of parser/templates/zz-cloud/trek-18.json and what finishes the cards around it:
 *  - once-a-turn casts from the graveyard with a counter rider and from the top of the library (sta.trek18.onceGy.cast.entersWith, sta.trek18.onceTop.cast);
 *  - "you gain hexproof <duration>" (eff.trek18.youGain.hexproof.dur; the render alternative family player-hexproof-gain);
 *  - "create a tapped and attacking <token>" (eff.trek18.token.tappedAttacking.front; family token-tapped-attacking-front-plain);
 *  - "~ stations Spacecraft and crews Vehicles as though ~'s power were tripled" (sta.trek18.stationCrewTripled; rule modification crewStationPowerTripled);
 *  - "end the combat phase" (eff.trek18.endCombatPhase; op endCombatPhase, CR 724.2) with the condition "it's a combat phase" (cond.ts, family its-a-combat-phase);
 *  - "when ~ enters during the declare attackers step" (trg.trek18.duringDeclareAttackers) and "for each of them, you may reselect which player or permanent that
 *    creature is attacking" (eff.trek18.reselect.forEach; op reselectAttack, CR 508.7);
 *  - "if you control a Whale and haven't begun an extra turn this game" (the quantity extraTurnsBegun, parser/holes/cond.ts; family and-havent-begun-extra-turn).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). The behavior is in trek-18-scenarios.test.ts. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-18.json';
import review from '../../m5/golden/cards/trek-18-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const MECH = round as Template[];
const MECH_COUNT = 7;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The card an example belongs on: an ability of a creature, or the spell. */
const typeOf = (text: string): string => (/^(?:flying|defender|vigilance)\b|^\{|^when|^once|^~|:\s/i.test(text) || /\n/.test(text) ? 'Creature — Ooze' : 'Instant');
const parse = (text: string, type = typeOf(text)) => parseCard(card('Example Ooze', type, text, type.startsWith('Creature') ? { power: '1', toughness: '1' } : {}), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

/** The cards each template is the evidence of (design 6.9 DEVIATION: stable on one hand-verified golden Star Trek card plus these tests). */
const EVIDENCE: Record<string, string[]> = {
  'sta.trek18.onceGy.cast.entersWith': ['Overflow Submatrix'],
  'sta.trek18.onceTop.cast': ['Zefram Cochrane, Warp Pioneer'],
  'eff.trek18.youGain.hexproof.dur': ['The Needs of the Many'],
  'eff.trek18.token.tappedAttacking.front': ['U.S.S. Stargazer, Here and There'],
  'sta.trek18.stationCrewTripled': ['Sulu, Heroic Helmsman'],
  'eff.trek18.endCombatPhase': ['Merciful Mandate'],
  'trg.trek18.duringDeclareAttackers': ['Tuvok, Chief Tactical Officer'],
  'eff.trek18.reselect.forEach': ['Tuvok, Chief Tactical Officer'],
};

describe('trek-18 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-18.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-18.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.trek18.*', () => {
    expect(MECH.length).toBe(MECH_COUNT + 1);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.trek18\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings): each wording is printed on one card, so the template is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    for (const [id, cards] of Object.entries(EVIDENCE)) expect(evidence(id), id).toEqual(expect.arrayContaining(cards));
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-18 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
        expect(f.templatesUsed.includes(t.id) && fullyAutomated(f), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/once during each of your turns/i, 'once during each turn'], [/from your graveyard/, 'from your hand'], [/from the top of your library/, 'from the bottom of your library'],
    [/ you gain hexproof/i, ' target player gains hexproof'], [/hexproof/, 'shroud'], [/tapped and attacking/, 'tapped and blocking'], [/tripled/, 'doubled'], [/the combat phase/, 'the turn'],
    [/declare attackers step/, 'declare blockers step'], [/may reselect/, 'must reselect'], [/player or permanent/, 'player'], [/two target/, 'three target'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-18 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-18 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // the word in front of "counter" is the counter's kind, an open vocabulary (CR 122.1b): an unlisted kind is a weak reading
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-18 guard G2 on the whole cards: a nonsense word in any place of the card\'s own text never leaves it full', () => {
  const CARDS: { name: string; type: string; text: string; pt?: [string, string] }[] = [
    { name: 'Merciful Mandate', type: 'Instant', text: "Untap all creatures you control. If it's a combat phase, you may end the combat phase." },
    { name: 'Tuvok, Chief Tactical Officer', type: 'Legendary Creature — Vulcan Officer', text: 'Flash\nWhen Tuvok enters during the declare attackers step, choose up to two target attacking creatures. For each of them, you may reselect which player or permanent that creature is attacking.', pt: ['1', '3'] },
    { name: 'The Needs of the Many', type: 'Instant', text: 'As an additional cost to cast this spell, sacrifice a creature.\nCreatures you control gain hexproof and indestructible until end of turn. You gain hexproof until end of turn. Prevent all damage that would be dealt to you this turn. Exile The Needs of the Many.' },
    { name: 'Sulu, Heroic Helmsman', type: 'Legendary Creature — Human Pilot', text: 'Sulu stations Spacecraft and crews Vehicles as though his power were tripled.', pt: ['1', '2'] },
    { name: 'Zefram Cochrane, Warp Pioneer', type: 'Legendary Creature — Human Pilot', text: 'You may look at the top card of your library any time.\nOnce during each of your turns, you may cast an artifact spell from the top of your library.\nSpacecraft you control enter with two additional charge counters on them.', pt: ['2', '3'] },
    { name: 'Overflow Submatrix', type: 'Artifact Creature — Borg', text: 'Once during each of your turns, you may cast an artifact creature spell from your graveyard. If you cast a spell this way, that artifact creature enters with a finality counter on it.', pt: ['3', '3'] },
  ];
  const level = (c: (typeof CARDS)[number], text: string): { level: string; manualPart: boolean } => {
    const def = compileCard({ name: c.name, layout: 'normal', mana_cost: '{2}{U}', type_line: c.type, oracle_text: text, colors: ['U'], ...(c.pt ? { power: c.pt[0], toughness: c.pt[1] } : {}) } as OracleCard);
    return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
  };
  for (const c of CARDS) {
    it(`${c.name}: the card as printed is full, with no manual part; replacing any one word by an invented word is never full`, () => {
      expect(level(c, c.text)).toEqual({ level: 'full', manualPart: false });
      const words = c.text.split(' ');
      words.forEach((w, i) => {
        // (the word in front of "counter" is the counter's kind, an open vocabulary: CR 122.1b names kinds by any word, an unlisted one is a weak reading the card keeps)
        if (/^counters?\b/.test(words[i + 1] ?? '')) return;
        const lead = w.match(/^["\n]+/)?.[0] ?? '';
        const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
        const r = level(c, mutated);
        expect(r.level === 'full' && !r.manualPart, JSON.stringify(mutated)).toBe(false);
      });
    });
  }
});
