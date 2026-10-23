/**
 * FAST5X E28: the template data of parser/templates/zz-fast5x/e28.json, the event grammar it added (parser/holes/event.ts) and the real cards the package
 * makes full (design 6.8 G6, G9):
 *  - "forage" (CR 701.61a), "you may forage" (the generic `ch.may`, CR 608.2d), "whenever you forage" (the forage action event);
 *  - "exert <object>" (CR 701.43a; experimental: no printed card uses it as an effect);
 *  - "whenever you sacrifice one or more <things>" (CR 603.2c, 701.21a: one occurrence per player's batch);
 *  - "<filter> that attacked this turn" (CR 508.1): the filter field the layer system now evaluates.
 * Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import e28 from '../../../src/parser/templates/zz-fast5x/e28.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e28-review.json';

const E28 = e28 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES }); // the game's capabilities: the templates need action:forage, action:exert

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At|As long|You and)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const first = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
const gateOk = (text: string, type?: string): boolean => { const f = parsed(text, type); return fullyAutomated(f) && f.gate.every((g) => g.ok); };

describe('E28 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e28.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e28.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E28) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.e28\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E28 template has its evidence: every card of the corpus that prints the sentence, verified by hand', () => {
    const golden = review as { card: string; verified: string }[];
    // the local index prints "forage" as an effect on these four cards only (Bloomburrow); "exert <object>" as an effect on none (experimental)
    const WHOLE_CORPUS: Record<string, string[]> = {
      'eff.e28.forage': ['Bushy Bodyguard', 'Corpseberry Cultivator', 'Curious Forager', 'Treetop Sentries'],
      // the local index prints "you and <objects> have hexproof" on Sigarda and on the scheme I Am Untouchable (a scheme's abilities are manual for another
      // reason: they function in the command zone, CR 113.6p), and the "as long as" form only on Captain America, Super-Soldier
      'sta.e28.youAndEach.hexproof': ["Sigarda, Heron's Grace"],
      'sta.e28.aslong.youAndEach.hexproof': ['Captain America, Super-Soldier'],
    };
    for (const t of E28.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...(WHOLE_CORPUS[t.id] ?? ['(no evidence)'])].sort());
    }
    expect(E28.find((t) => t.id === 'eff.e28.exert')?.status).toBe('experimental');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E28) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E28 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E28) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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

describe('E28 event grammar (parser/holes/event.ts) and filters: what the readings mean, and that they pass the render gate', () => {
  it('CR 701.61a: "whenever you forage" is the forage action of the controller', () => {
    expect((first('Whenever you forage, you gain 1 life.')['trigger'] as object)).toEqual({ on: [{ ev: 'action', verb: 'forage', actor: 'you' }] });
    expect(gateOk('Whenever you forage, you gain 1 life.')).toBe(true);
  });
  it('CR 603.2c: "whenever you sacrifice one or more Foods" is a batch trigger; "a Food" is one per Food', () => {
    expect(first('Whenever you sacrifice one or more Foods, you gain 1 life.')['trigger']).toEqual({ on: [{ ev: 'action', verb: 'sacrifice', actor: 'you', object: { subtypes: ['Food'] } }], batch: true });
    expect(first('Whenever you sacrifice a Food, you gain 1 life.')['trigger']).toEqual({ on: [{ ev: 'action', verb: 'sacrifice', actor: 'you', object: { subtypes: ['Food'] } }] });
    expect(gateOk('Whenever you sacrifice one or more Foods, you gain 1 life.')).toBe(true);
    expect(gateOk('Whenever you sacrifice one or more other creatures, ~ deals 1 damage to each opponent.')).toBe(true);
    // "one or more" with a singular noun is not this sentence
    expect(fullyAutomated(parsed('Whenever you sacrifice one or more Food, you gain 1 life.'))).toBe(false);
  });
  it('CR 508.1: "<filter> that attacked this turn" in targets, "each" and a cost reduction, with the capability the layer system now has', () => {
    expect(ENGINE_CAPABILITIES.has('sfilter:attackedThisTurn')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('rfilter:attackedThisTurn')).toBe(true);
    expect(gateOk('Destroy target creature that attacked this turn.')).toBe(true);
    expect(gateOk('Destroy each creature that attacked this turn.')).toBe(true);
    expect(gateOk('This spell costs {1} less to cast for each creature that attacked this turn.\nDraw a card.', 'Instant')).toBe(true);
  });
  it('CR 122.1c: "put a shield counter on target creature" needs counter:shield, which the engine has now', () => {
    expect(ENGINE_CAPABILITIES.has('counter:shield')).toBe(true);
    expect(gateOk('Put a shield counter on target creature.')).toBe(true);
  });
});

describe('E28 real cards (npm run cards -- try): full now', () => {
  it('keywords: persist, decayed, battle cry', () => {
    for (const name of ['Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight', 'Rot-Curse Rakshasa', 'Sanguine Evangelist']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
  it('exert and forage costs, forage effects and triggers, "one or more" sacrifices, "attacked this turn"', () => {
    for (const name of ["Basri, Tomorrow's Champion", 'Thornvault Forager', 'Feed the Cycle', 'Camellia, the Seedmiser', 'Bushy Bodyguard', 'Corpseberry Cultivator',
      'Curious Forager', 'Treetop Sentries', 'Forge Boss', 'Blood Hypnotist', 'Rowdy Research', 'Witchstalker Frenzy']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('shield counters and "you and <objects> have hexproof"', () => {
    for (const name of ['Captain America, Super-Soldier', "Sigarda, Heron's Grace"]) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
  it('riot and extort are automated keywords; the rest of these cards is what keeps them partial (template work)', () => {
    for (const name of ['The Kingpin of Crime']) {
      const d = compileCard(getCard(name));
      // r4-refs: The Kingpin of Crime's attack trigger is read now ("... assign combat damage equal to their toughness rather than their power", CR 510.1c,
      // zz-cloud/r4-refs.json): full
      expect(d.automation.level, name).toBe('full');
      expect(JSON.stringify(d.automation), name).not.toMatch(/keyword:(riot|extort)/);
    }
    // cloud std-spm: Spider-Punk's other lines are read now ("Spells and abilities can't be countered.", "Damage can't be prevented.", zz-cloud/std-spm.json)
    expect(compileCard(getCard('Spider-Punk')).automation.level).toBe('full');
  });
});
