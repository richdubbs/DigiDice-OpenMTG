/**
 * std-rx30 (wave 2, Standard lane rx30: other players' choices and per-player effects): the template data of parser/templates/zz-cloud/std-rx30.json and the
 * round's parser, renderer and engine support: the sentence joiners of parser/lower/ability.ts (alternating picks, "round down each time", the card revealed by
 * the other player, the card chosen from outside the game, the search of a library and outside the game); the target phrases "controlled by the same opponent"
 * (TargetSpec.sameController), "from the battlefield and/or ... from graveyards" and "card from your graveyard or exiled card" (parser/holes/object.ts); "from their
 * hand" naming a revealed hand (HandCard); "the number of coins that came up heads" (parser/holes/qty.ts); the X of a turned-face-up trigger (model/lint-nodes.ts,
 * triggers/stack.ts); the counter riders `toIf` and `sourceEffect`; the folds of render/fold.ts and render/program.ts#chosenPlayerAndTarget. Guard G9 (design 6.8):
 * every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in std-rx30-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the
 * cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx30 from '../../../src/parser/templates/zz-cloud/std-rx30.json';
import review from '../../m5/golden/cards/cloud-std-rx30-review.json';
import r4MechReview from '../../m5/golden/cards/cloud-r4-mech-review.json';
import rx3Review from '../../m5/golden/cards/cloud-std-rx3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX30 = stdRx30 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const IDS = [
  'eff.stdrx30.reveal.separate.twoPiles', 'eff.stdrx30.eachOpponentMay.sacrificeOrDiscard', 'rid.stdrx30.thenDamageEqual.eachOpponentWhoDidnt.thisWay',
  'eff.stdrx30.ownerMay.putOnTop.theirLibrary', 'rid.stdrx30.ifTheyDidnt.putOnTop.theyPutBottom', 'eff.stdrx30.player.choosesOneOf', 'eff.stdrx30.rest.cantBlock.thisTurn',
  'eff.stdrx30.alternatingPicks.youOpponent', 'eff.stdrx30.eachPlayer.halfLifeHandPermanents.roundDown', 'eff.stdrx30.startingWithYou.eachPlayerChooses.oppPermanents',
  'eff.stdrx30.forEachPlayer.destroyUpToOne.thatPlayerControls', 'eff.stdrx30.forEachLandDestroyedThisWay.controllerMaySearchBasic', 'eff.stdrx30.forEachPlayer.chooseTargets',
  'eff.stdrx30.whileSource.becomeTreasures.loseOtherAbilities', 'eff.stdrx30.twoPlayersReveal.loseOthersManaValue.putIntoHand',
  'eff.stdrx30.player.skipsNextXTurns.whereX', 'eff.stdrx30.extraTurn.forEachCoinHeads',
  'eff.stdrx30.mayRevealExactlyFromOutside.opponentChooses', 'eff.stdrx30.searchLibraryAndOutside.opponentChoosesN', 'eff.stdrx30.choose.targetPlayer.andTargets',
  'eff.stdrx30.exile.handCardOrObj', 'rid.stdrx30.countered.ifSpellOfKind.exileInstead', 'rid.stdrx30.countered.abilityOf.sourceLosesAllAbilities',
];

/** The type line an example is printed on: a loyalty ability on a planeswalker, another activated ability on an artifact, a trigger on a creature, else a sorcery. */
const typeOf = (text: string): string => {
  const last = text.split('\n').at(-1)!;
  if (/^[+−-]\d+:/.test(last)) return 'Legendary Planeswalker — Ral';
  if (/^\{/.test(last)) return 'Artifact';
  if (/^(When|Whenever|At)\b/.test(last) || text.includes('\n')) return 'Creature — Human Wizard';
  return 'Sorcery';
};
const extra = (type: string) => (type.includes('Creature') ? { power: '2', toughness: '2' } : type.includes('Planeswalker') ? { loyalty: '5' } : undefined);
const face = (text: string) => parseCard(card('Example Relic', typeOf(text), text, extra(typeOf(text))), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const level = (type: string, text: string): string =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(extra(type) ?? {}) } as OracleCard).automation.level;
const abilitiesOf = (type: string, text: string): string => JSON.stringify(parseCard(card('Example Relic', type, text, extra(type)), OPTS).faces[0]!.abilities);

describe('std-rx30 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx30.json, after zz-cloud/std-rx3.json, before zz-cloud/std-rx5.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx30.json');
    expect(files.indexOf('zz-cloud/std-rx30.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx3.json'));
    expect(files.indexOf('zz-cloud/std-rx30.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx5.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX30.map((t) => t.id)).toEqual(IDS);
    for (const t of RX30) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.stdrx30\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // narrow wordings, each printed on one or two cards: stable on one or two hand-verified golden cards plus these tests and the scenarios, a 6.9 deviation named
    // in the round record and the PR (the extra turn of Ral Zarek is in the review file of r4-mech and Thranduil's Decree in std-rx3's, whose templates they promote)
    for (const id of IDS) {
      const cards = id === 'eff.stdrx30.extraTurn.forEachCoinHeads' ? goldenUsing(id, r4MechReview as Golden) : id === 'rid.stdrx30.countered.ifSpellOfKind.exileInstead' ? goldenUsing(id, rx3Review as Golden) : goldenUsing(id);
      expect(cards.length, id).toBeGreaterThanOrEqual(1);
    }
    expect(goldenUsing('eff.stdrx30.extraTurn.forEachCoinHeads', r4MechReview as Golden)).toEqual(['Ral Zarek']);
    expect(goldenUsing('eff.stdrx30.choose.targetPlayer.andTargets')).toEqual(['Cloak and Dagger, Entwined']);
    expect(goldenUsing('rid.stdrx30.countered.ifSpellOfKind.exileInstead', rx3Review as Golden)).toEqual(["Thranduil's Decree"]); // in std-rx3's file, whose eff.stdrx3.permit.free.cast.obj.dur it promotes
    expect(goldenUsing('rid.stdrx30.countered.abilityOf.sourceLosesAllAbilities')).toEqual(["Tishana's Tidebinder"]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX30) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'extra', 'half', 'exactly', 'different']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx30 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX30) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/two piles/, 'three piles'], [/each opponent may/, 'each player may'], [/its owner may/, 'its controller may'], [/on the bottom/, 'into their graveyard'],
    [/the same opponent/, 'the same player'], [/the other can't block/, 'the other can\'t attack'], [/Round down/, 'Round up'], [/Starting with you/, 'Starting with an opponent'],
    [/up to one/, 'up to two'], [/basic land card/, 'land card'], [/Treasure artifacts/, 'Clue artifacts'], [/the other player/, 'that player'],
    [/next turn/, 'next untap step'], [/came up heads/, 'came up tails'], [/comes up heads/, 'comes up tails'], [/different names/, 'the same name'],
    [/outside the game/, 'in exile'], [/target opponent and/, 'an opponent and'], [/permanent spell/, 'permanent card'], [/loses all abilities/, 'loses flying'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx30 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX30) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx30 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX30) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1; // the line of the template (an earlier line is a keyword or another ability of the card)
        const words = lines[last]!.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...lines.slice(0, last), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join('\n');
          expect(understood(face(mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

describe('std-rx30 parser, renderer and engine support (hole readings, no template)', () => {
  const ANGEL = 'Creature — Angel';
  it('CR 115.1, 601.2c: "controlled by the same opponent" is one target spec whose targets share a controller (TargetSpec.sameController)', () => {
    const text = 'Choose two target creatures controlled by the same opponent. That player chooses one of those creatures. Destroy that creature, and the other can\'t block this turn.';
    expect(level('Sorcery', text)).toBe('full');
    expect(abilitiesOf('Sorcery', text)).toContain('"sameController":true');
  });
  it('CR 400.1, 115.1: "creatures from the battlefield and/or creature cards from graveyards" and "card from your graveyard or exiled card" are targets in two zones', () => {
    const both = 'When ~ enters, exile up to two target creatures from the battlefield and/or creature cards from graveyards.';
    expect(level(ANGEL, both)).toBe('full');
    expect(abilitiesOf(ANGEL, both)).toContain('"zone":["battlefield","graveyard"]');
    const either = 'Return target creature card from your graveyard or exiled card with flashback you own to your hand.';
    expect(level('Sorcery', either)).toBe('full');
    expect(abilitiesOf('Sorcery', either)).toContain('"zone":["graveyard","exile"]');
  });
  it('CR 701.20a: "from their hand" names the hand an earlier sentence revealed (HandCard); with no hand revealed it is not understood', () => {
    const text = 'When ~ enters, choose target opponent and up to one target artifact they control. They reveal their hand. You may exile a creature card from their hand or the chosen artifact until ~ leaves the battlefield.';
    expect(level(ANGEL, text)).toBe('full');
    expect(abilitiesOf(ANGEL, text)).toContain('"is":{"ref":"bound","name":"them"}');
    expect(level(ANGEL, 'When ~ enters, choose up to one target artifact an opponent controls. You may exile a creature card from their hand or the chosen artifact until ~ leaves the battlefield.')).not.toBe('full');
  });
  it('CR 705.1, 107.3: "the number of coins that came up heads" counts the heads of the flip before it; with no flip it stays manual', () => {
    const text = 'Flip two coins. Target opponent skips their next X turns, where X is the number of coins that came up heads.';
    expect(level('Sorcery', text)).toBe('full');
    expect(level('Sorcery', 'Target opponent skips their next X turns, where X is the number of coins that came up heads.')).not.toBe('full');
  });
  it('CR 702.168e, 107.3: the X of a "when this creature is turned face up" trigger is the X paid to turn it face up (only on a card with that cost)', () => {
    const text = 'Disguise {X}{2}{W}\nWhen this creature is turned face up, exile up to X other target creatures.';
    expect(level(ANGEL, text)).toBe('full');
    expect(level(ANGEL, 'When this creature enters, exile up to X other target creatures.')).not.toBe('full');
  });
  it('CR 701.6a, 614.15: `toIf` exiles only the countered spells of a kind; `sourceEffect` acts on the source of a countered ability', () => {
    expect(abilitiesOf('Instant', "Counter target spell. If a creature spell is countered this way, exile it instead of putting it into its owner's graveyard.")).toContain('"toIf":{"types":["Creature"]');
    expect(abilitiesOf('Instant', 'Counter target activated ability. If an ability of a creature is countered this way, that permanent loses all abilities until end of turn.')).toContain('"sourceEffect":{"filter":{"types":["Creature"]}');
  });
  it('CR 201.5: a plural name takes a plural verb in "until ~ leave the battlefield" (render/evt.ts, family plural-name-verb)', () => {
    const r = parseCard({ name: 'Example Twins', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Human', power: '2', toughness: '2', colors: [], oracle_text: 'When Example Twins enter, choose target opponent and up to one target creature they control. They reveal their hand. You may exile a nonland card from their hand or the chosen creature until Example Twins leave the battlefield.' } as OracleCard, OPTS);
    expect(r.faces[0]!.gate.every((g) => g.ok)).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx30 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx30 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const context = /^(Flying|Reach|Trample|Vigilance|Flash|Disguise \{X\}\{2\}\{W\})$/;
    const verbatim = RX30.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !context.test(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
