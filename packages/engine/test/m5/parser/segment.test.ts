/**
 * WP5, parser front end step 2 (design 6.2): the decision list that turns lines into abilities, and abilities into sentences. Every layout of the fixture cards
 * is segmented (saga, split, adventure, class, leveler, modal with bullets, planeswalker, flip, transform, meld, prototype, mutate, battle, case); layouts and
 * shapes the fixture lacks (spree, dice rows, orphan bullets, spell static forms) use synthetic faces with invented wording (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { ledgerProblems } from '../../../src/parser/preprocess';
import { tokenNorms } from '../../../src/parser/tokenize';
import type { AbilitySegment, SegmentedFace } from '../../../src/parser/segment';
import { faceContexts, face, segment } from './support';
import { getCard } from '../../fixtures';

const faces = (name: string): SegmentedFace[] => faceContexts(getCard(name)).map((c) => segment(c));
const only = (name: string): SegmentedFace => {
  const f = faces(name);
  expect(f).toHaveLength(1);
  return f[0]!;
};
const shapes = (f: SegmentedFace): string[] => f.abilities.map((a) => a.shape);
const sentences = (a: AbilitySegment): string[] => a.sentences.map((s) => tokenNorms(s.tokens));
const synth = (typeLine: string, text: string, name = 'Test Card') => segment(face(name, typeLine, text));

describe('every ability is classified by shape and every line belongs to one ability (design 6.2 step 5)', () => {
  it('row 7: a keyword line is one ability with its keyword items (commas and "and" split them)', () => {
    const f = synth('Creature — Bear', 'Flying, first strike, and lifelink');
    expect(shapes(f)).toEqual(['keyword']);
    expect(f.abilities[0]!.keywordItems!.map((k) => k.name)).toEqual(['Flying', 'First Strike', 'Lifelink']);
    expect(f.abilities[0]!.lines).toEqual([0]);
  });

  it('keyword parameters are ranges: Kicker {1}{G}, Ward {2}, Protection from white', () => {
    const f = synth('Creature — Bear', 'Kicker {1}{G}\nWard {2}\nProtection from white');
    expect(f.abilities.map((a) => a.keywordItems![0]!.name)).toEqual(['Kicker', 'Ward', 'Protection']);
    const params = f.abilities.map((a) => f.pre.normalized.slice(...a.keywordItems![0]!.paramRange!));
    expect(params).toEqual(['{1}{G}', '{2}', 'from white']);
  });

  it('keyword families the rules describe in prose: landwalk, typecycling, variants', () => {
    const f = synth('Creature — Bear', 'Swampwalk\nPlainscycling {2}\nMultikicker {1}\nSnow forestwalk\nBasic landcycling {1}');
    expect(f.abilities.map((a) => a.keywordItems![0]!.name)).toEqual(['Landwalk', 'Cycling', 'Multikicker', 'Landwalk', 'Cycling']);
  });

  it('a line that only begins like a keyword is not a keyword line', () => {
    expect(shapes(synth('Creature — Bear', 'Flying creatures you control get +1/+0.'))).toEqual(['static']);
    expect(shapes(synth('Creature — Bear', 'Equipped creature gets +1/+1.'))).toEqual(['static']);
    expect(shapes(synth('Creature — Bear', 'Flying. Draw a card.'))).toEqual(['static']);
  });

  it('a keyword with a dash keeps its whole text, cost lists with commas included', () => {
    const f = synth('Instant', 'Escape—{3}{R}{R}, Exile four other cards from your graveyard.');
    expect(shapes(f)).toEqual(['keyword']);
    const k = f.abilities[0]!.keywordItems![0]!;
    expect(k).toMatchObject({ name: 'Escape', dash: true });
    expect(f.pre.normalized.slice(...k.paramRange!)).toBe('--{3}{R}{R}, Exile four other cards from your graveyard.');
  });

  it('row 8: when, whenever and at start a triggered ability', () => {
    const f = synth('Enchantment', 'When ~ enters, draw a card.\nWhenever a land enters, gain 1 life.\nAt the beginning of your upkeep, lose 1 life.');
    expect(shapes(f)).toEqual(['triggered', 'triggered', 'triggered']);
  });

  it('row 9: an unquoted colon after something cost-like is an activated ability', () => {
    const f = synth('Artifact', '{T}: Add {C}.\n{2}, Sacrifice ~: Draw a card.\nDiscard a card: Scry 1.\nTap an untapped creature you control: Draw.\nPay 2 life: Draw.');
    expect(shapes(f)).toEqual(['activated', 'activated', 'activated', 'activated', 'activated']);
  });

  it('a colon inside a quoted ability or after a non-cost is not an activated ability', () => {
    const f = synth('Creature — Bear', 'Creatures you control have "{T}: Add {C}."\nChoose a color: it is red.');
    expect(shapes(f)).toEqual(['static', 'static']);
  });

  it('row 11: everything else is a static ability', () => {
    const f = synth('Enchantment', 'Creatures you control get +1/+1.\nYou have no maximum hand size.');
    expect(shapes(f)).toEqual(['static', 'static']);
  });

  it('a Case\'s "To solve" and "Solved" lines are one case ability: the condition\'s sentences and the solved ability as its child (M6-6, CR 719.3)', () => {
    const f = only('Case of the Locked Hothouse');
    expect(shapes(f)).toEqual(['static', 'case']);
    expect(f.abilities[1]!.text.split('\n')).toEqual([
      'To solve -- You control seven or more lands.',
      'Solved -- You may look at the top card of your library any time, and you may play lands and cast creature and enchantment spells from the top of your library.',
    ]);
    expect(f.abilities[1]!.lines).toEqual([1, 2]);
    expect(f.abilities[1]!.children!.map((c) => c.shape)).toEqual(['static']);
    expect(f.abilities[1]!.children![0]!.text.startsWith('You may look')).toBe(true);
  });

  it('labels go to the ability and are not part of its text or its tokens', () => {
    const f = synth('Creature — Bear', 'Landfall — Whenever a land enters, draw a card.');
    const a = f.abilities[0]!;
    expect(a.shape).toBe('triggered');
    expect(a.label).toMatchObject({ text: 'Landfall', kind: 'ability-word' });
    expect(a.text).toBe('Whenever a land enters, draw a card.');
    expect(a.sentences[0]!.tokens[0]!.norm).toBe('whenever');
  });
});

describe('row 1: reminder-only and blank lines are skipped, but never lost (the ledger records them)', () => {
  it('the line indices of the abilities (AbilityBase.src) refer to the normalized Oracle lines', () => {
    const f = synth('Creature — Bear', '(Only a reminder.)\nFlying\n\nHaste');
    expect(f.abilities.map((a) => a.lines)).toEqual([[1], [3]]);
    expect(f.ledger.filter((e) => e.status === 'reminder')).toHaveLength(1);
    expect(ledgerProblems(f.pre.normalized, f.ledger)).toEqual([]);
  });
});

describe('row 2: LEVEL brackets (CR 711.2)', () => {
  it('Student of Warfare: a Level up keyword, then one levelBracket per band with its P/T and abilities', () => {
    const f = only('Student of Warfare');
    expect(shapes(f)).toEqual(['keyword', 'levelBracket', 'levelBracket']);
    const [, b1, b2] = f.abilities;
    expect(b1!.level).toMatchObject({ min: 2, max: 6, power: '3', toughness: '3' });
    expect(b2!.level).toMatchObject({ min: 7, max: null, power: '4', toughness: '4' });
    expect(b1!.children!.map((c) => c.keywordItems![0]!.name)).toEqual(['First Strike']);
    expect(b2!.children!.map((c) => c.keywordItems![0]!.name)).toEqual(['Double Strike']);
    expect(b1!.lines).toEqual([1, 2, 3]);
    // header and P/T line are structure
    const structure = f.ledger.filter((e) => e.status === 'structure').map((e) => f.pre.normalized.slice(...e.range));
    expect(structure).toEqual(['LEVEL 2-6', '3/3', 'LEVEL 7+', '4/4']);
  });
});

describe('row 3: Saga chapters (CR 714.2)', () => {
  it('History of Benalia: "I, II" is one chapter ability with two chapters', () => {
    const f = only('History of Benalia');
    expect(shapes(f)).toEqual(['chapter', 'chapter']);
    expect(f.abilities.map((a) => a.chapters)).toEqual([[1, 2], [3]]);
    expect(sentences(f.abilities[0]!)).toEqual(['create a 2/2 white knight creature token with vigilance .']);
    const structure = f.ledger.filter((e) => e.status === 'structure').map((e) => f.pre.normalized.slice(...e.range));
    expect(structure).toEqual(['I, II --', 'III --']);
  });

  it('a chapter can have a modal body', () => {
    const f = synth('Enchantment — Saga', 'I — Choose one —\n• Draw a card.\n• Gain 2 life.\nII — Scry 1.');
    expect(shapes(f)).toEqual(['chapter', 'chapter']);
    expect(f.abilities[0]!.modal!.modes).toHaveLength(2);
    expect(f.abilities[0]!.lines).toEqual([0, 1, 2]);
  });
});

describe('row 4: dice rows fold into the ability above (CR 706.2)', () => {
  const f = synth('Creature — Bear', 'When ~ enters, roll a d20.\n1-9 | Draw a card.\n10—19 | Gain 2 life.\n20 | Draw two cards. Gain 4 life.\nFlying');

  it('rows belong to the roll ability, with their numbers', () => {
    expect(shapes(f)).toEqual(['triggered', 'keyword']);
    expect(f.abilities[0]!.rollTable!.map((r) => [r.min, r.max])).toEqual([[1, 9], [10, 19], [20, 20]]);
    expect(f.abilities[0]!.lines).toEqual([0, 1, 2, 3]);
    expect(f.abilities[0]!.rollTable!.map((r) => r.sentences.map((s) => tokenNorms(s.tokens)))).toEqual([['draw a card .'], ['gain 2 life .'], ['draw two cards .', 'gain 4 life .']]);
  });

  it('the row prefix is structure', () => {
    const structure = f.ledger.filter((e) => e.status === 'structure').map((e) => f.pre.normalized.slice(...e.range));
    expect(structure).toEqual(['1-9 |', '10-19 |', '20 |']);
  });

  it('open-ended rows: "15+ |"', () => {
    const g = synth('Artifact', 'Roll a d20.\n15+ | Draw.');
    expect(g.abilities[0]!.rollTable![0]).toMatchObject({ min: 15, max: null });
  });

  it('a Station card (CR 721.2): the lines below a threshold row belong to it, up to the next row', () => {
    const g = synth(
      'Legendary Artifact — Spacecraft',
      'Flash\nWhen ~ enters, draw a card.\nStation (Tap a creature: Put charge counters on this.)\n8+ | Flying\nWhenever ~ attacks, scry 1.\n12+ | Haste\nVigilance\nTrample',
    );
    expect(shapes(g)).toEqual(['keyword', 'triggered', 'keyword']);
    const station = g.abilities[2]!;
    expect(station.keywordItems![0]!.name).toBe('Station');
    expect(station.lines).toEqual([2, 3, 4, 5, 6, 7]);
    expect(station.rollTable!.map((r) => [r.min, r.max, r.more?.map((m) => m.line)])).toEqual([[8, null, [4]], [12, null, [6, 7]]]);
    expect(station.rollTable![0]!.more![0]!.sentences.map((s) => tokenNorms(s.tokens))).toEqual(['whenever ~ attacks , scry 1 .']);
    expect(ledgerProblems(g.pre.normalized, g.ledger)).toEqual([]);
  });

  it('a die-roll table does not take the lines below it', () => {
    const g = synth('Artifact', 'Roll a d20.\n15+ | Draw.\nFlying');
    expect(shapes(g)).toEqual(['static', 'keyword']);
  });
});

describe('row 5: modal headers with bullets, and Spree lines (CR 700.2, 702.172)', () => {
  it('Cryptic Command: one spell ability whose modes are the bullets', () => {
    const f = only('Cryptic Command');
    expect(shapes(f)).toEqual(['spell']);
    const a = f.abilities[0]!;
    expect(a.modal!.kind).toBe('bullets');
    expect(a.modal!.modes.map((m) => m.sentences.map((s) => tokenNorms(s.tokens)).join(' '))).toEqual([
      'counter target spell .',
      "return target permanent to its owner's hand .",
      'tap all creatures your opponents control .',
      'draw a card .',
    ]);
    expect(sentences(a)).toEqual(['choose two --']);
    expect(a.lines).toEqual([0, 1, 2, 3, 4]);
    expect(f.ledger.filter((e) => e.status === 'structure')).toHaveLength(4); // the four bullets
  });

  it('a triggered ability that ends with a dash takes the bullets below it', () => {
    const f = synth('Creature — Bear', 'When ~ enters, choose one —\n• Draw a card.\n• Gain 2 life.\nFlying');
    expect(shapes(f)).toEqual(['triggered', 'keyword']);
    expect(f.abilities[0]!.modal!.modes).toHaveLength(2);
  });

  it('Spree: the "+ {cost} --" lines are the modes of the spell, the cost is a range', () => {
    const f = synth('Instant', 'Spree (Choose one or more additional costs.)\n+ {1} — Draw a card.\n+ {2}{W} — Gain 3 life. Draw a card.');
    expect(shapes(f)).toEqual(['keyword', 'spell']);
    const modal = f.abilities[1]!.modal!;
    expect(modal.kind).toBe('spree');
    expect(modal.modes.map((m) => f.pre.normalized.slice(...m.cost!))).toEqual(['{1}', '{2}{W}']);
    expect(modal.modes[1]!.sentences).toHaveLength(2);
    const structure = f.ledger.filter((e) => e.status === 'structure').map((e) => f.pre.normalized.slice(...e.range));
    expect(structure).toEqual(['+', '--', '+', '--']);
  });

  it('a bullet with no header stays with the ability above', () => {
    const f = synth('Instant', 'Draw a card.\n• Orphan mode.');
    expect(shapes(f)).toEqual(['spell']);
    expect(f.abilities[0]!.modal!.modes).toHaveLength(1);
  });
});

describe('row 6: loyalty abilities (CR 606)', () => {
  it('Jace Beleren: +2, -1, -10 with their costs, effects and sentences', () => {
    const f = only('Jace Beleren');
    expect(shapes(f)).toEqual(['loyalty', 'loyalty', 'loyalty']);
    expect(f.abilities.map((a) => [a.loyalty!.sign, a.loyalty!.amount])).toEqual([['+', 2], ['-', 1], ['-', 10]]);
    expect(sentences(f.abilities[0]!)).toEqual(['each player draws a card .']);
    const structure = f.ledger.filter((e) => e.status === 'structure').map((e) => f.pre.normalized.slice(...e.range));
    expect(structure).toEqual(['+2:', '-1:', '-10:']);
  });

  it('0 and X loyalty costs', () => {
    const f = synth('Planeswalker — Test', '0: Draw a card.\n−X: Gain X life.');
    expect(f.abilities.map((a) => [a.loyalty!.sign, a.loyalty!.amount])).toEqual([['0', 0], ['-', 'X']]);
  });

  it('a "+1:" line on a face that is not a planeswalker is not a loyalty ability', () => {
    expect(shapes(synth('Creature — Bear', '+1: Draw a card.'))).not.toContain('loyalty');
  });
});

describe('row 10: an instant or sorcery has ONE spell ability (CR 113.3a, 608.2)', () => {
  it('Fire // Ice: two faces, each with its own single spell ability; Ice\'s two lines are one ability', () => {
    const [fire, ice] = faces('Fire // Ice');
    expect(shapes(fire!)).toEqual(['spell']);
    expect(shapes(ice!)).toEqual(['spell']);
    expect(ice!.abilities[0]!.lines).toEqual([0, 1]);
    expect(sentences(ice!.abilities[0]!)).toEqual(['tap target permanent .', 'draw a card .']);
    expect(fire!.pre.context.name).toBe('Fire');
  });

  it('Stomp (an Adventure) is a spell face; the creature face is not', () => {
    const [giant, stomp] = faces('Bonecrusher Giant // Stomp');
    expect(shapes(giant!)).toEqual(['triggered']);
    expect(shapes(stomp!)).toEqual(['spell']);
  });

  it('keyword and triggered lines of a spell stay out of the spell ability, and the spell lines merge across them', () => {
    const f = synth('Sorcery', 'Draw a card.\nFlashback {2}{U}\nGain 2 life.');
    expect(shapes(f)).toEqual(['spell', 'keyword']);
    expect(f.abilities[0]!.lines).toEqual([0, 2]);
    expect(sentences(f.abilities[0]!)).toEqual(['draw a card .', 'gain 2 life .']);
  });

  it('the static forms are not the spell ability: costs, additional costs, can\'t be countered, alternative costs, casting limits', () => {
    const f = synth(
      'Instant',
      'This spell costs {1} less to cast if you control a Bear.\nAs an additional cost to cast this spell, discard a card.\nThis spell can\'t be countered.\nYou may pay {R} rather than pay this spell\'s mana cost.\nCast this spell only during combat.\nDraw a card.',
    );
    expect(shapes(f)).toEqual(['static', 'static', 'static', 'static', 'static', 'spell']);
    expect(f.abilities.filter((a) => a.spellStatic)).toHaveLength(5);
    expect(f.abilities[5]!.lines).toEqual([5]);
  });

  it('the same lines on a permanent are static abilities', () => {
    expect(shapes(synth('Creature — Bear', 'This spell costs {1} less to cast.\nThis spell can\'t be countered.'))).toEqual(['static', 'static']);
  });
});

describe('Class cards (CR 716)', () => {
  it('Bard Class: level 1 abilities, then one classLevel per "{cost}: Level N" with its cost and abilities', () => {
    const f = only('Bard Class');
    expect(shapes(f)).toEqual(['classLevel', 'classLevel', 'classLevel']);
    expect(f.abilities.map((a) => a.classLevel!.level)).toEqual([1, 2, 3]);
    expect(f.abilities[0]!.classLevel!.cost).toBeUndefined();
    expect(f.pre.normalized.slice(...f.abilities[1]!.classLevel!.cost!)).toBe('{R}{G}');
    expect(f.abilities.map((a) => a.children!.map((c) => c.shape))).toEqual([['static'], ['static'], ['triggered']]);
  });
});

describe('every layout of the fixture is segmented without loss', () => {
  const names = [
    'Delver of Secrets // Insectile Aberration', // transform
    'Agadeem\'s Awakening // Agadeem, the Undercrypt', // modal double-faced
    'Akki Lavarunner // Tok-Tok, Volcano Born', // flip
    'Bruna, the Fading Light', // meld part
    'Brisela, Voice of Nightmares', // meld result
    'Gemrazer', // mutate
    'Phyrexian Fleshgorger', // prototype
    'Invasion of Ergamon // Truga Cliffcharger', // battle
    'Strife Scholar // Awaken the Ages', // prepare
    'Wear // Tear', // split
    'Murderous Rider // Swift End', // adventure
    'Cunning Azurescale // Divining Dive', // omen
    'Commit // Memory', // aftermath
  ];
  it.each(names)('%s', (name) => {
    const fs = faces(name);
    expect(fs.length).toBeGreaterThan(0);
    for (const f of fs) {
      expect(ledgerProblems(f.pre.normalized, f.ledger)).toEqual([]);
      const lines = f.abilities.flatMap((a) => a.lines);
      expect(new Set(lines).size).toBe(lines.length); // no line belongs to two abilities
    }
  });

  it('transform cards have one segmentation per face', () => {
    expect(faces('Delver of Secrets // Insectile Aberration').map((f) => f.pre.context.name)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
  });

  it('Mutate and Prototype lines are keyword lines', () => {
    expect(shapes(only('Gemrazer'))[0]).toBe('keyword');
    const f = only('Phyrexian Fleshgorger');
    // M6-6 (CR 718.1): the keyword with its cost; the P/T box after the dash is structure (cards/faces.ts reads it into FaceDef.prototype)
    expect(f.abilities[0]!.keywordItems![0]).toMatchObject({ name: 'Prototype', dash: false });
    expect(f.abilities[0]!.text).toBe('Prototype {1}{B}{B}');
  });
});

describe('sentences (design 6.2 step 6)', () => {
  it('split at a period outside quotes and braces', () => {
    const f = synth('Instant', 'Target creature gains "{T}: Add {C}. Draw a card." until end of turn. Draw a card.');
    expect(f.abilities[0]!.sentences).toHaveLength(2);
  });

  it('Then, If you do, If you don\'t, Otherwise, It, They and That continue the previous sentence', () => {
    const f = synth('Instant', 'Discard a card. Then draw a card. If you do, gain 1 life. If you don\'t, lose 1 life. Otherwise, scry 1. It gains flying. They get +1/+1. That creature dies. Draw a card. If you control a Bear, gain 2 life.');
    expect(f.abilities[0]!.sentences.map((s) => s.continuation)).toEqual([false, true, true, true, true, true, true, true, false, false]);
  });

  it('every token of an ability is in exactly one of its sentences, in order', () => {
    const f = synth('Instant', 'Draw a card. Then discard a card, and gain 2 life.');
    const all = f.abilities[0]!.sentences.flatMap((s) => s.tokens);
    expect(all.map((t) => t.range[0])).toEqual([...all.map((t) => t.range[0])].sort((a, b) => a - b));
    expect(all.map((t) => t.norm).join(' ')).toBe('draw a card . then discard a card , and gain 2 life .');
  });

  it('a sentence knows its line and range', () => {
    const f = synth('Creature — Bear', 'Flying\nWhen Test Card dies, draw a card.');
    const s = f.abilities[1]!.sentences[0]!;
    expect(s.line).toBe(1);
    expect(f.pre.normalized.slice(...s.range)).toBe('When Test Card dies, draw a card.');
  });
});

describe('self reference inside the segmentation', () => {
  it('the text of an ability shows "~", its tokens carry SELF with the replaced words as their range', () => {
    const f = synth('Creature — Bear', 'When Test Card dies, Test Card deals 1 damage.');
    const a = f.abilities[0]!;
    expect(a.text).toBe('When ~ dies, ~ deals 1 damage.');
    const selves = a.sentences[0]!.tokens.filter((t) => t.kind === 'SELF');
    expect(selves.map((t) => f.pre.normalized.slice(...t.range))).toEqual(['Test Card', 'Test Card']);
  });
});

describe('card names (design 6.2 step 3)', () => {
  it('"Partner with <name>" with a comma in the name is one keyword item when the name index is known', () => {
    const names = new Set(['Pia Nalaar, Chief Mechanic']);
    const f = segment(face('Test Partner', 'Legendary Creature — Human', 'Partner with Pia Nalaar, Chief Mechanic'), { cardNames: names });
    expect(shapes(f)).toEqual(['keyword']);
    expect(f.abilities[0]!.keywordItems!.map((k) => k.name)).toEqual(['Partner with']);
  });

  it('without the name index the comma splits the line, no item is a keyword, and the line stays a static ability (manual later)', () => {
    const f = synth('Legendary Creature — Human', 'Partner with Pia Nalaar, Chief Mechanic');
    expect(shapes(f)).toEqual(['static']);
  });
});
