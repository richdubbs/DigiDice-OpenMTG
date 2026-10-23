/**
 * FAST5X E9: the template data of parser/templates/zz-fast5x/e9.json and the parser and renderer readings E9 needed (design 6.8 G6):
 *  - "blight N" and "<player> blights N" (CR 701.68a), the keyword action as an effect (keywords/actions/counters.ts#BLIGHT);
 *  - the rider "It deals N damage to that creature instead if C" (CR 614.15: the same source and recipient, another amount);
 *  - conditions (parser/holes/cond.ts, render/cond.ts): "it isn't your main phase" (CR 505.1), "~'s additional cost was paid" (CR 118.8, 601.2b), "an
 *    opponent was dealt noncombat damage this turn" (CR 120.1a), "you've scried or surveilled this turn" (CR 701.22d, 701.25d), "~ entered this turn"
 *    (CR 400.7), "you've lost life this turn" as Oracle words it.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e9 from '../../../src/parser/templates/zz-fast5x/e9.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e9-review.json';

const E9 = e9 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At|As long)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const first = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
const steps = (text: string, type?: string): unknown => (first(text, type) as { effect?: { steps: unknown[] } }).effect?.steps;

describe('E9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e9.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e9.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E9) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.e9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E9 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    // the local index prints "<player> blights N" on these two cards only, and "deals N damage to that creature instead if" with a readable condition on one
    const WHOLE_CORPUS: Record<string, string[]> = { 'eff.e9.player.blights': ['High Perfect Morcant', 'Champion of the Weird'], 'rid.e9.instead.damage.that.if': ['Cinder Strike'] };
    for (const t of E9.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E9) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const one = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(f.abilities, e.text).toMatchObject(e.expect as object[]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(one.abilities), c).toBe(false);
      }
    });
  }
});

describe('E9 conditions: what the readings mean, and that they pass the render gate', () => {
  const gateOk = (text: string, type?: string): boolean => { const f = parsed(text, type); return fullyAutomated(f) && f.gate.every((g) => g.ok); };
  it('CR 505.1: "then if it isn\'t your main phase" is not (your turn and either main phase)', () => {
    const s = steps('Return target creature card from your graveyard to your hand. Then if it isn\'t your main phase, blight 2.') as { op: string; cond?: unknown }[];
    expect(s[1]).toMatchObject({ op: 'if', cond: { cond: 'not', of: { cond: 'turnOf', whose: 'you', step: ['main1', 'main2'] } } });
    expect(parsed('Return target creature card from your graveyard to your hand. Then if it isn\'t your main phase, blight 2.').gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 118.8, 601.2b: "if this spell\'s additional cost was paid" is the cast record\'s unnamed optional cost', () => {
    const text = "As an additional cost to cast this spell, you may pay 2 life.\nTarget player draws a card. If this spell's additional cost was paid, that player draws two cards instead.";
    const f = parseCard(exampleCard(text, 'Sorcery'), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('{"cond":"wasCast","kicked":"additional"}');
    expect(gateOk("As an additional cost to cast this spell, you may sacrifice a creature.\nDraw a card. If this spell's additional cost was paid, draw two cards instead.", 'Sorcery')).toBe(true);
  });
  it('CR 120.1a: "an opponent was dealt noncombat damage this turn"', () => {
    const a = first('As long as an opponent was dealt noncombat damage this turn, ~ has menace.');
    expect(a['condition']).toEqual({ cond: 'happened', event: { ev: 'damage', combat: false, recipient: { player: 'opponent' } }, scope: 'turn' });
    expect(gateOk('As long as an opponent was dealt noncombat damage this turn, ~ has menace.')).toBe(true);
  });
  it('CR 701.22d, 701.25d: "you\'ve scried or surveilled this turn" is either action by you this turn', () => {
    const a = first("~ gets +1/+0 as long as you've scried or surveilled this turn.", 'Creature — Human');
    expect(a['condition']).toEqual({ cond: 'any', of: [
      { cond: 'happened', event: { ev: 'action', verb: 'scry', actor: 'you' }, scope: 'turn' },
      { cond: 'happened', event: { ev: 'action', verb: 'surveil', actor: 'you' }, scope: 'turn' },
    ] });
    expect(gateOk("~ gets +1/+0 as long as you've scried or surveilled this turn.", 'Creature — Human')).toBe(true);
  });
  it('CR 400.7: "~ entered this turn" is this object entering the battlefield this turn', () => {
    const a = first('As long as ~ entered this turn, ~ has vigilance.');
    expect(a['condition']).toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, scope: 'turn' });
    expect(gateOk('As long as ~ entered this turn, ~ has vigilance.')).toBe(true);
  });
  it('"you\'ve lost life this turn" passes the gate as Oracle prints it', () => {
    expect(gateOk("As long as you've lost life this turn, ~ has flying.")).toBe(true);
    expect(gateOk("As long as you've gained life this turn, ~ has lifelink.")).toBe(true);
  });
});

describe('E9 real cards (npm run cards -- try): full now', () => {
  it('mobilize, job select, increment', () => {
    for (const name of ['Bone-Cairn Butcher', 'Dragonback Lancer', 'Voice of Victory', "Monk's Fist", "Paladin's Arms", "Bard's Bow", 'Pensive Professor', 'Cuboid Colony', 'Topiary Lecturer']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('blight', () => {
    for (const name of ['Dream Seizer', 'Sourbread Auntie', 'Boggart Mischief', 'Gutsplitter Gang', 'High Perfect Morcant', 'Sting-Slinger', 'Wild Unraveling', "Bogslither's Embrace", 'Requiting Hex', 'Cinder Strike']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('history statics', () => {
    for (const name of ['Grand Ball Guest', 'Armory Mice', 'Whiplash Wordsmith // Vicious Verse', 'Surveillance Phantasm', "Shardmage's Rescue", 'Tenured Concocter', 'Shipwreck Sentry']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('Dose of Dawnglow is full: its "Then if C, blight N" is read by CLOUD std-ecl\'s stable eff.stdecl.thenIf.blight (priority 1; eff.t34.thenIf is also stable since Cloud std-fin and std-blb, fast5/promo2/evidence.ts); FAST5X E11 behold makes Champion of the Weird full (CR 701.4a, 607.2a)', () => {
    expect(compileCard(getCard('Dose of Dawnglow')).automation.level).toBe('full');
    expect(compileCard(getCard('Champion of the Weird')).automation.level).toBe('full');
  });
});
