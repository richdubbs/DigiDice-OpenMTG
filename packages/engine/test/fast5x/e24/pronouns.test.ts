/**
 * FAST5X E24: a character card's own gendered pronouns (parser/front/selfref.ts#pronounRefs). CR 201.5: text that refers to the object it's on by name
 * means just that object; Oracle calls a character "he" or "she" ("Put a +1/+1 counter on Abomination. He fights ..."), and design 6.4's unique-candidate
 * rule decides when the pronoun is that object: a legendary face that refers to itself, one character in its name, no other capitalized word that could
 * name a character, one gender. Then the parse text holds "~" ("~'s", "~ is") in place of the pronoun, offsets unchanged; otherwise the pronoun stays a
 * word nobody understands and the sentence is manual (never a guess). Also CR 201.5c: a legendary card's short name that is also a subtype is its name.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { ledgerProblems } from '../../../src/parser/preprocess';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { getCard } from '../../fixtures';
import { face, pre, segment } from '../../m5/parser/support';
import { fullyAutomated } from '../../m5/templates/support';

const HERO = 'Legendary Creature — Human Hero';
const parsed = (name: string, text: string, type = HERO) => pre(face(name, type, text)).parse;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parseFace = (name: string, type: string, text: string) =>
  parseCard({ name, layout: 'normal', type_line: type, oracle_text: text, power: '3', toughness: '3' } as never, OPTS).faces[0]!;

describe('CR 201.5, design 6.4: the pronouns of one character are "~"', () => {
  it('he, him, she and the object "her" become "~"; his and the possessive "her" become "~\'s"; offsets do not move', () => {
    const t1 = 'Whenever Bruno attacks, he gets +2/+0 until end of turn. Put a +1/+1 counter on him.';
    expect(parsed('Bruno, Test Hero', t1)).toBe('Whenever     ~ attacks,  ~ gets +2/+0 until end of turn. Put a +1/+1 counter on   ~.');
    const t2 = "When Vera dies, return her to the battlefield under her owner's control. Draw a card if her power is 4 or greater.";
    expect(parsed('Vera, Test Hero', t2)).toBe("When    ~ dies, return   ~ to the battlefield under ~'s owner's control. Draw a card if ~'s power is 4 or greater.");
    const t3 = 'Vera can\'t be blocked if her power is 1 or less. When Vera enters, she connives.';
    expect(parsed('Vera, Test Hero', t3)).toBe("   ~ can't be blocked if ~'s power is 1 or less. When    ~ enters,   ~ connives.");
    for (const t of [t1, t2, t3]) expect(parsed('Bruno, Test Hero', t).length).toBe(t.length);
  });

  it('a contraction keeps its verb ("he\'s" is "~ is", "she\'s" is " ~ is") and a capitalized pronoun at a sentence start is "~" too', () => {
    expect(parsed('Bruno, Test Hero', "As long as Bruno is tapped, he's a 4/4 creature.")).toBe('As long as     ~ is tapped, ~ is a 4/4 creature.');
    expect(parsed('Vera, Test Hero', "As long as Vera is tapped, she's a 4/4 creature.")).toBe('As long as    ~ is tapped,  ~ is a 4/4 creature.');
    expect(parsed('Bruno, Test Hero', 'Put a +1/+1 counter on Bruno. He gains menace until end of turn.')).toBe('Put a +1/+1 counter on     ~.  ~ gains menace until end of turn.');
  });

  it('the self references record the pronouns (via "pronoun") and the tokens of "~\'s" still cover the whole word (ledger G4)', () => {
    const p = pre(face('Vera, Test Hero', HERO, "When Vera dies, return her to the battlefield under her owner's control."));
    expect(p.selfRefs.filter((r) => r.via === 'pronoun').map((r) => [r.text, r.as])).toEqual([['her', '  ~'], ['her', "~'s"]]);
    const f = segment(face('Vera, Test Hero', HERO, "When Vera dies, return her to the battlefield under her owner's control. She gains haste."));
    expect(ledgerProblems(f.pre.normalized, f.ledger)).toEqual([]);
  });

  it('"this card" is the character too (a legendary card that never prints its name: "Return this card ... with a +1/+1 counter on her")', () => {
    expect(parsed('Gala, Test Host', 'Return this card from your graveyard to the battlefield tapped with a +1/+1 counter on her.'))
      .toBe('Return         ~ from your graveyard to the battlefield tapped with a +1/+1 counter on   ~.');
  });
});

describe('design 6.4: zero or several candidates leave the pronoun alone (it stays an unknown word, the sentence manual)', () => {
  const kept = (name: string, text: string, type = HERO): void => {
    expect(parsed(name, text, type), `${name}: ${text}`).toMatch(/\b(he|him|his|she|her|she's|he's)\b/i);
  };
  it('a card that is not legendary (not a character: "her controller" of a Liliana planeswalker it destroyed)', () => {
    kept('Test Defeat', 'Destroy target black creature or planeswalker. If that permanent was a Liliana planeswalker, her controller loses 3 life.', 'Sorcery');
    kept('Bruno', 'When Bruno enters, he deals 2 damage to any target.', 'Creature — Human');
  });
  it('a face that never refers to itself outside quotes', () => {
    kept('Bruno, Test Hero', 'When a creature enters, he deals 2 damage to any target.');
    kept('Bruno, Test Hero', 'Equipped creature has "Whenever Bruno attacks, he deals 1 damage to any target."');
  });
  it('another character in the text (near miss G9: "he" with two candidate antecedents) or two characters in the name', () => {
    kept('Bruno, Test Hero', 'Whenever Bruno or Marco attacks, he deals 1 damage to any target.');
    kept('Bruno, Test Hero', 'Search your library for a card named Marco the Brave. Bruno deals damage equal to his power to any target.');
    kept('Raph & Leo, Test Heroes', 'Whenever Raph & Leo attacks, he deals 1 damage to any target.');
    kept('The Test Queen', 'Whenever Her Majesty attacks, put a +1/+1 counter on The Test Queen. She gains flying until end of turn.');
  });
  it('both genders, the old player wordings, and the reflexive forms', () => {
    kept('Bruno, Test Hero', 'When Bruno enters, he deals 1 damage to any target and she gains 1 life.');
    kept('Bruno, Test Hero', 'When Bruno enters, target player discards a card of his or her choice. He gains haste until end of turn.');
    expect(parsed('Bruno, Test Hero', 'When Bruno enters, he deals 1 damage to himself.')).toContain('himself');
  });
  it('a pronoun inside a quoted ability is the quote\'s own business (CR 201.5a): left alone', () => {
    // r5-fxb: except in a quote the object grants to ITSELF ("Iron Test gains \"...\""), where the object that has the ability is the one its name means, so
    // its name and a "his" after it are "~" (parser/front/selfref.ts#findSelfRefs); a quote granted to another object keeps the pronoun as before
    expect(parsed('Iron Test, Hero', 'Whenever Iron Test attacks, target creature gains "{T}: Iron Test deals damage equal to his power to any target" until end of turn.')).toContain('his power');
    expect(parsed('Iron Test, Hero', 'Whenever Iron Test attacks, Iron Test gains "{T}: Iron Test deals damage equal to his power to any target" until end of turn.')).not.toContain('his power');
  });
  it('the whole sentence of a kept pronoun is manual, never fully automated (G9 near miss)', () => {
    const f = parseFace('Bruno, Test Hero', HERO, 'Whenever Bruno or Marco attacks, he deals 1 damage to any target.');
    expect(fullyAutomated(f)).toBe(false);
    const g = parseFace('Bruno, Test Hero', HERO, 'Whenever Bruno attacks, he deals 1 damage to any target.');
    expect(fullyAutomated(g)).toBe(true);
    expect(g.gate.every((x) => x.ok)).toBe(true);
  });
});

describe('CR 201.5c: a legendary card\'s short name that is also a subtype is its name, except where the text puts it in a type position', () => {
  it('"Wolverine, ..." and "Kaito, ..." (a creature type and a planeswalker type) are "~"; "a Wolverine" and "Wolverine creatures" stay types', () => {
    expect(parsed('Wolverine, Test Fighter', 'When Wolverine enters, Wolverine fights up to one other target creature.')).toBe('When         ~ enters,         ~ fights up to one other target creature.');
    expect(parsed('Wolverine, Test Fighter', 'Other Wolverine creatures you control get +1/+1. Whenever a Wolverine attacks, draw a card.', HERO)).toBe('Other Wolverine creatures you control get +1/+1. Whenever a Wolverine attacks, draw a card.');
    expect(parsed('Kaito, Test Ninja', 'Whenever Kaito deals combat damage to a player, draw a card.', 'Legendary Creature — Human Ninja')).toBe('Whenever     ~ deals combat damage to a player, draw a card.');
    expect(parsed('Wolverine Rider', 'Whenever a Wolverine attacks, draw a card.', 'Creature — Human')).toBe('Whenever a Wolverine attacks, draw a card.');
  });
});

describe('the real cards (fixtures)', () => {
  it('the characters whose pronouns were the only missing words play exactly as written (full)', () => {
    for (const name of ['Venus, Torn Between Worlds', 'Kang, Temporal Tyrant', 'Scarlet Spider, Kaine', 'Gandalf, Wandering Wizard', 'Gallia, Tragic Host',
      'Stature, Size Shifter', 'Leatherhead, Swamp Stalker', 'Morlun, Devourer of Spiders', 'Quicksilver, Brash Blur', 'Wraith, Vicious Vigilante']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('Venus: "put that many +1/+1 counters on her" puts the damage dealt to her as counters on her (CR 120.3, 122.6)', () => {
    const v = compileCard(getCard('Venus, Torn Between Worlds')).faces[0]!.abilities[0] as unknown as { effect: { steps: unknown[] } };
    expect(v.effect.steps).toEqual([{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: { q: 'eventAmount' } }]);
  });
  it('"Her Majesty" is another name: The Underworld Fantasy Queen keeps "her" (manual where it is used); Hellcat\'s "She loses all abilities and gains haste" reads "she" as the returned card (r4-fxb\'s eff.fxb.loseAll.gains.permanent)', () => {
    expect(compileCard(getCard('The Underworld Fantasy Queen')).automation.level).not.toBe('full');
    const h = compileCard(getCard('Hellcat, Undying Vigilante'));
    expect(h.automation.level).toBe('full');
  });
});
