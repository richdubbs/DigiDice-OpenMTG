/**
 * FAST5X E25: the template data of parser/templates/zz-fast5x/e25.json and the parser and renderer readings E25 needed (design 6.8 G6):
 *  - manifest dread by another player ("its controller manifests dread", "the exiled card's owner manifests dread", CR 701.62a, 608.2h, 607.2a), the manifested
 *    permanent named afterwards ("that creature", "each of those creatures", CR 608.2c), "manifest dread X times" and "whenever you manifest dread" (CR 701.62b);
 *  - cloak from a hand, of N cards chosen from a look, of another player's library, of an exiled pile, "then attach ~ to it" (CR 701.58a, 701.58e);
 *  - "as ~ enters or is turned face up, put X counters on it" (CR 614.1c, 614.1e, 708.11), "can't be turned face up during your turn" (CR 708.7, 101.2),
 *    "you may look at face-down creatures ... any time" (CR 708.5, 609.4), "exile ... face down" (CR 406.3), "return it ... face down ..., then turn it face up";
 *  - conditions "a permanent entered the battlefield face down under your control this turn", "you turned a permanent face up this turn" (CR 603.4);
 *  - "its controller" names the source last (CR 109.5: the source's controller is "you"), so "Counter target spell. Its controller ..." names the spell.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or
 * parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import e25 from '../../../src/parser/templates/zz-fast5x/e25.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import ownReview from '../../m5/golden/cards/fast5x-e25-review.json';
import r3FxReview from '../../m5/golden/cards/cloud-r3-fx-review.json';
import r5FxbReview from '../../m5/golden/cards/cloud-r5-fxb-promoted.json';
// r5-fxb: the promotions of design 10.4 are verified in the reviews of the slices that promoted them too
const review = [...ownReview, ...r3FxReview, ...r5FxbReview];

const E25 = e25 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES });

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At|As|Enchanted|Equipped|Enchant|Flying|Vigilance|You may look|Permanents|Creatures|Face-down|~)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (/^Enchant creature/.test(text) ? 'Enchantment — Aura' : permanent ? 'Creature — Human' : 'Sorcery');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: / X /.test(` ${text} `) ? '{X}{1}' : '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const first = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
const gateOk = (text: string, type?: string): boolean => { const f = parsed(text, type); return fullyAutomated(f) && f.gate.every((g) => g.ok); };

describe('E25 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e25.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e25.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E25) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta|rst|static)\.e25\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E25 template has its evidence: every card of the corpus that prints the sentence, hand-verified in the golden review', () => {
    const golden = review as { card: string; verified: string }[];
    // the local index (npm run cards -- snapshot, 34,473 cards) prints these sentences on these cards only
    const WHOLE_CORPUS: Record<string, string[]> = {
      'eff.e25.manifestDread.player': ['Fear of Impostors', 'Unwanted Remake'],
      'eff.e25.manifestDread.linkedOwner': ['Unidentified Hovership'],
      'eff.e25.manifestDread.counters': ['Underwater Tunnel // Slimy Aquarium', 'Moldering Gym // Weight Room'],
      'eff.e25.manifestDread.times.counters': ["Valgavoth's Onslaught"],
      'eff.e25.shuffleEnchanted.manifestDread': ['Stay Hidden, Stay Silent'],
      'eff.e25.cloak.top.attachSelf': [], // Cryptic Coat (its other ability keeps it partial; reviewed in the scenarios below)
      'eff.e25.shuffleEnchanted': ['Dramatic Accusation'],
      'eff.e25.cloak.fromHand': ['Vannifar, Evolved Enigma'],
      'eff.e25.look.cloak.restBottomRandom': ['Hide in Plain Sight'],
      'rst.e25.cantTurnFaceUp.yourTurn': ['Karlov Watchdog'],
      'static.e25.entersOrFaceUp.counters.whereX': ['Crowd-Control Warden'],
      'eff.e25.discard.unless': ['Oblivious Bookworm', 'Moon-Circuit Hacker'],
      'sta.e25.look.faceDown.opponents': ['Found Footage'],
      'sta.e25.look.faceDown.notYours': ['Keeper of the Lens'],
      'eff.e25.eot.look.faceDown.notYours': ['Lumbering Laundry'],
      'eff.e25.return.faceDown.thenFaceUp': ['Yarus, Roar of the Old Gods'],
      'eff.e25.cloak.top.player': ['Etrata, Deadly Fugitive'],
      'eff.e25.exilePile.cloak': ['Expose the Culprit'],
      'trg.e25.you.manifestDread': ['Paranormal Analyst'],
      'eff.e25.dread.binnedToHand': ['Paranormal Analyst'],
      // r5-fxb (design 10.4): promoted with every card of the local index on which an ability that reads it is fully automated, each read by hand
      // (test/m5/golden/cards/cloud-r5-fxb-promoted.json; Edward Kenway in cloud-r3-fx-review.json). The other cards that print the sentence keep that ability
      // manual or partial for another sentence ("exiled with this", "It becomes foretold", "You may look at ..."), so the template never decides how they play
      'eff.e25.exile.faceDown': ['Duplicity', 'Moonring Mirror', 'Bottled Cloister', 'Knowledge Vault', 'Gonti, Canny Acquisitor', 'Urianger Augurelt', 'The Creation of Avacyn',
        "Kayla's Music Box", 'Rev, Tithe Extractor', 'Inverter of Truth', 'Necropotence', 'Grimoire Thief', 'Connecting the Dots', 'Bomat Courier', "Colfenor's Plans",
        'Flamewar, Brash Veteran // Flamewar, Streetwise Operative', 'Expert-Level Safe', "Gandalf, Goblins' Bane // Flameshape", 'Kyren Archive', 'Edward Kenway'],
      // trg.e25.faceDownEnters.orTurnedFaceUp (Cryptid Inspector) was dropped at the FAST5X batch 1 merge: FAST5 T62's trg.t62.andSelfOrAnotherTurnedFaceUp reads the line
    };
    for (const t of E25.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      expect(whole, `${t.id}: no evidence listed`).toBeDefined();
      if (t.id === 'eff.e25.cloak.top.attachSelf') continue; // Cryptic Coat is in the base fixture set: the scenario below plays it
      expect(cards.slice().sort(), t.id).toEqual([...whole!].sort());
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E25) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'additional', 'random', 'whenever']) {
        if (words.includes(w) && !(w === 'each' && t.consumes === undefined && !/\beach\b/.test(t.pattern))) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('E25 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E25) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const one = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) {
          const ab = f.abilities.find((x) => x.kind !== 'keyword') as unknown as Record<string, unknown>;
          expect(t.kind === 'trigger' ? ab['trigger'] : f.abilities, e.text).toMatchObject(e.expect as object);
        }
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(one.abilities), c).toBe(false);
      }
    });
  }
});

describe('E25 readings: what they mean, and that they pass the render gate', () => {
  it('CR 109.5, 608.2c: "its controller" after a target names the target, not the source (whose controller the text calls "you")', () => {
    const f = first('When ~ enters, counter target spell. Its controller manifests dread.');
    expect(JSON.stringify(f['effect'])).toContain('"who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}');
    expect(gateOk('When ~ enters, counter target spell. Its controller manifests dread.')).toBe(true);
  });
  it('CR 708.3, 603.4: "entered the battlefield face down" and "a face-down creature entered" are one history condition, read both ways', () => {
    const a = first('At the beginning of your end step, if a creature entered the battlefield face down under your control this turn, draw a card.');
    const b = first('At the beginning of your end step, if a face-down creature entered the battlefield under your control this turn, draw a card.');
    expect(a['interveningIf']).toEqual(b['interveningIf']);
    expect(a['interveningIf']).toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you', faceDown: true }, to: 'battlefield' }, scope: 'turn' });
    expect(gateOk('At the beginning of your end step, if a creature entered the battlefield face down under your control this turn, draw a card.')).toBe(true);
  });
  it('CR 708.8, 603.4: "you turned a permanent face up this turn" is a permanent turned face up by you', () => {
    const f = first("At the beginning of your end step, if you've turned a permanent face up this turn, draw a card.");
    expect(f['interveningIf']).toEqual({ cond: 'happened', event: { ev: 'becomes', what: 'turnedFaceUp', object: {} }, scope: 'turn', by: 'you' });
    expect(gateOk("At the beginning of your end step, if you've turned a permanent face up this turn, draw a card.")).toBe(true);
  });
  it('a near miss keeps its sentence manual: "manifest dread twice, then put ... on that creature", "cloak a card from your graveyard"', () => {
    expect(fullyAutomated(parsed('Manifest dread twice, then put a +1/+1 counter on that creature.'))).toBe(false);
    expect(fullyAutomated(parsed('Cloak a card from your graveyard.'))).toBe(false);
    expect(fullyAutomated(parsed('Look at the top five cards of your library, cloak two of them, and put the rest into your hand.'))).toBe(false);
  });
});

describe('E25 real cards (npm run cards -- try): full now', () => {
  it('manifest dread by another player, the manifested permanent named, X times, "whenever you manifest dread"', () => {
    for (const name of ['Fear of Impostors', 'Unwanted Remake', 'Unidentified Hovership', 'Stay Hidden, Stay Silent', 'Underwater Tunnel // Slimy Aquarium', 'Moldering Gym // Weight Room', "Valgavoth's Onslaught", 'Paranormal Analyst']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('cloak from a hand and from a look; face-down permissions, restrictions, history, "enters or is turned face up"', () => {
    for (const name of ['Vannifar, Evolved Enigma', 'Hide in Plain Sight', 'Found Footage', 'Lumbering Laundry', 'Keeper of the Lens', 'Karlov Watchdog', 'Oblivious Bookworm', 'Tunnel Tipster', 'Cryptid Inspector', 'Crowd-Control Warden', 'Yarus, Roar of the Old Gods', 'Dramatic Accusation']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('"its controller" / "that creature\'s controller" after a target (CR 109.5, 608.2h)', () => {
    for (const name of ['Cavalier of Dawn', "Neonate's Rush", 'Rakdos Ickspitter', 'Burn Away', 'Sawtusk Demolisher', 'Cindervines', 'Zulaport Duelist', 'Nin, the Pain Artist', 'Essence Backlash', 'Grotag Siege-Runner']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  // CLOUD std-mkm: Expose the Culprit is full since eff.m6.turnFaceUp (its experimental template) is stable, with three golden cards (test/cloud/std-mkm/std-mkm-templates.test.ts)
  // Standard round 9 (second lane, std-r9b): Connecting the Dots is full since std-r9b reads "put all cards exiled with ~ into their owners' hands" (eff.stdr9b.linked.putAll.hands, CR 607.2a)
  // std-typechange-2: Etrata is full since its granted ability is read ("If you can't" after turning ~ face up, CR 608.2c, 708.7; the exiled card of ~, CR 400.7)
  it('Etrata is full since std-typechange-2 (its granted "If you can\'t, exile it, then you may cast" is read); Connecting the Dots is full since Standard round 9 (std-r9b); Cryptic Coat is full since Standard round 4 r4-fxb promoted the other package\'s template (sta.pump.cantbeblocked)', () => {
    expect(compileCard(getCard('Etrata, Deadly Fugitive')).automation.level).toBe('full');
    expect(compileCard(getCard('Connecting the Dots')).automation.level).toBe('full');
    expect(compileCard(getCard('Cryptic Coat')).automation.level).toBe('full');
    expect(compileCard(getCard('Expose the Culprit')).automation.level).toBe('full');
  });
});
