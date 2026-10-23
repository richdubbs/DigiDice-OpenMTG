/**
 * FAST5 T35: the template data of parser/templates/zz-fast5/t35.json ("For Mirrodin!", CR 702.163a), the keyword data the package made implemented
 * (for mirrodin!, power-up, station: keywords/data) and the parser and renderer readings the package's shapes needed (design 6.8 G6, CONTRIBUTING "Adding a
 * template"):
 *   - the pattern grammar takes "!" as a punctuation word (parser/chart.ts), the keyword name "for mirrodin!" renders (render/kw.ts);
 *   - "Power-up -- {cost}: {effect}" is a wrapper keyword like exhaust (limit once per game, `reducedByManaCost`, CR 702.193a);
 *   - a Station card (CR 702.184, 721): the Station line is the keyword, each `N+ | keywords` row is a static ability (`station: true`) built from the card's
 *     printed power and toughness and the reminder text's "artifact creature at N+"; a row with anything else in it, or with lines under it, stays manual.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON. Examples are synthetic wordings (design 6.10) except the keyword name itself, which is a rules term.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { renderGate } from '../../../src/render/gate';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t35 from '../../../src/parser/templates/zz-fast5/t35.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';

const T35 = t35 as Template[];
const OPTS = defaultParseOptions();

function card(text: string, type = 'Artifact — Equipment', pt?: [string, string]): OracleCard {
  return { name: 'Example Subject', layout: 'normal', type_line: type, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}', colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard;
}
const parsed = (text: string, type?: string, pt?: [string, string]) => parseCard(card(text, type, pt), OPTS).faces[0]!;

describe('T35 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t35.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t35.json');
    expect(files.indexOf('zz-fast5/t35.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t35.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status and a template-set version', () => {
    expect(T35.length).toBeGreaterThan(0);
    for (const t of T35) {
      expect(t.kind, t.id).toBe('ability');
      expect(t.id, t.id).toMatch(/^kw\.t35\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
    }
  });
});

describe('T35 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T35) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
  it('guard G2: a nonsense word in place of any word of "For Mirrodin!" never leaves an automated ability', () => {
    for (const m of ['For blorfty!', 'Blorfty Mirrodin!', 'For Mirrodin blorfty']) expect(fullyAutomated(parsed(m)), m).toBe(false);
  });
  it('"For Mirrodin!" alone is the keyword; the keyword is not a keyword with a different spelling (no "!" is no keyword)', () => {
    const f = parsed('For Mirrodin!');
    expect(f.abilities).toMatchObject([{ kind: 'keyword', keyword: 'for mirrodin!' }]);
    expect(fullyAutomated(parsed('For Mirrodin'))).toBe(false);
  });
});

describe('T35 Power-up (CR 702.193a): a wrapper keyword like exhaust', () => {
  const creature = (text: string) => parsed(text, 'Creature — Human', ['1', '1']);
  it('"Power-up -- {3}{G}: put two +1/+1 counters on ~" is one activated ability, once per game, reduced by the mana cost on the turn it entered', () => {
    const f = creature('Power-up -- {3}{G}: Put two +1/+1 counters on ~.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities).toMatchObject([{ kind: 'activated', keyword: 'power-up', limit: { per: 'game', max: 1 }, reducedByManaCost: true }]);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('the shapes of the cards: more counters, a counter and a draw, a counter and a token, a counter and a token with a keyword', () => {
    for (const text of [
      'Power-up -- {5}{U}: Put a +1/+1 counter on ~ and draw two cards.',
      'Power-up -- {6}: Put two +1/+1 counters on ~ and create a 2/2 colorless Robot Villain artifact creature token.',
      'Power-up -- {6}{G}: Put a +1/+1 counter on ~ and create a 3/2 white Hero creature token with vigilance.',
      'Power-up -- {6}{R}: Put three +1/+1 counters on ~.',
    ]) {
      const f = creature(text);
      expect(fullyAutomated(f), text).toBe(true);
      expect(f.gate.every((g) => g.ok), text).toBe(true);
    }
  });
  // cloud std-dsk (PR #11, parser/lower/ability.ts; CR 702.193a, 602.5b): a restriction of the ability's own that the keyword does not give is kept beside the
  // keyword's (as FAST1 T4's exhaust test now says): once per game from power-up, and as a sorcery; the same kind of restriction from both stays manual
  it('an ability that adds a restriction of its own to the wrapper keeps both; the same kind of restriction from both stays manual', () => {
    const f = creature('Power-up -- {3}{G}: Put two +1/+1 counters on ~. Activate only as a sorcery.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities).toMatchObject([{ kind: 'activated', keyword: 'power-up', limit: { per: 'game', max: 1 }, sorcerySpeed: true, reducedByManaCost: true }]);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(fullyAutomated(creature('Power-up -- {3}{G}: Put two +1/+1 counters on ~. Activate only once each turn.'))).toBe(false);
  });
});

describe('T35 Station (CR 702.184, 721.2)', () => {
  const REMINDER = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)";
  const ship = (rows: string, pt: [string, string] | null = ['4', '4'], reminder = REMINDER) => parsed(`${reminder}\n${rows}`, 'Artifact — Spacecraft', pt ?? undefined);
  const row = (f: ReturnType<typeof parsed>) => f.abilities.filter((a) => (a as { station?: boolean }).station === true);

  it('"8+ | Flying" with the card\'s P/T is the keyword plus a row: 8 or more charge counters, creature with base 4/4, flying', () => {
    const f = ship('8+ | Flying');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities).toMatchObject([{ kind: 'keyword', keyword: 'station' }, { kind: 'static', station: true }]);
    expect(row(f)[0]).toMatchObject({
      condition: { cond: 'matches', object: { ref: 'self' }, filter: { counters: { kind: 'charge', cmp: { op: '>=', value: 8 } } } },
      effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, types: { add: ['Creature'] } }, { layer: '7b', power: 4, toughness: 4 }, { layer: 6, add: [{ kind: 'keyword', keyword: 'flying' }] }] }],
    });
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('several keywords: "8+ | Flying, lifelink", "9+ | Flying, first strike", "8+ | Flying, vigilance, haste"', () => {
    for (const [n, kws] of [[8, 'Flying, lifelink'], [8, 'Flying, vigilance, haste'], [8, 'Flying, trample']] as const) {
      const f = ship(`${n}+ | ${kws}`);
      expect(fullyAutomated(f), kws).toBe(true);
      expect(f.gate.every((g) => g.ok), kws).toBe(true);
    }
    const nine = ship('9+ | Flying, first strike', ['3', '4'], REMINDER.replace('8+', '9+'));
    expect(fullyAutomated(nine)).toBe(true);
    expect(nine.gate.every((g) => g.ok)).toBe(true);
  });
  it('a card with no power and toughness box (and no creature threshold) only gives the abilities (CR 721.2a)', () => {
    const f = ship('2+ | Lifelink', null, REMINDER.replace(" It's an artifact creature at 8+.", ''));
    expect(fullyAutomated(f)).toBe(true);
    expect(row(f)[0]).toMatchObject({ effects: [{ mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'lifelink' }] }] }] });
  });
  it('the row that cannot be tied to the power and toughness box is manual: a different threshold than the reminder text names, a P/T that is not a number', () => {
    expect(fullyAutomated(ship('7+ | Flying'))).toBe(false);
    expect(fullyAutomated(ship('8+ | Flying', ['*', '4']))).toBe(false);
    expect(fullyAutomated(ship('8+ | Flying', ['4', '4'], REMINDER.replace(" It's an artifact creature at 8+.", '')))).toBe(false);
  });
  it('a row with an ability the parser cannot read is manual, a keyword with a parameter or a line under the symbol is one of its abilities (T54, CR 721.2)', () => {
    expect(fullyAutomated(ship('8+ | Ward {2}'))).toBe(true);
    expect(fullyAutomated(ship('8+ | Flying\nWhenever this Spacecraft attacks, draw a card.'))).toBe(true);
    expect(fullyAutomated(ship('8+ | Blorfty'))).toBe(false);
    expect(fullyAutomated(ship('8+ | Flying\nBlorfty the zoof.'))).toBe(false);
    // the Station keyword itself is still the keyword, so the card is partial rather than lost
    const f = ship('8+ | Flying\nBlorfty the zoof.');
    expect(f.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'station' });
  });
  it('the render of a row is the printed row and nothing else: another condition or another change has no wording', () => {
    const f = ship('8+ | Flying');
    const r = row(f)[0] as unknown as { condition: { filter: { counters: { cmp: { value: number } } } } };
    const changed = JSON.parse(JSON.stringify(f.abilities[1])) as typeof r & { effects: { mods: unknown[] }[] };
    changed.condition.filter.counters.cmp.value = 0;
    const ctx = { selfNames: ['Example Subject'], selfTypes: ['Artifact', 'Spacecraft'], oracleLines: ['8+ | Flying'] };
    expect(renderGate(f.abilities[1] as never, ['8+ | Flying'], ctx).ok).toBe(true);
    expect(renderGate(changed as never, ['8+ | Flying'], ctx).ok).toBe(false);
    const extra = JSON.parse(JSON.stringify(f.abilities[1])) as { effects: { mods: unknown[] }[] };
    extra.effects[0]!.mods.push({ layer: 5, colors: { add: ['R'] } });
    expect(renderGate(extra as never, ['8+ | Flying'], ctx).ok).toBe(false);
  });
});
