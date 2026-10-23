/**
 * WP7: payment options (convoke, improvise, delve; CR 702.51, 702.126, 702.66, 601.2f-h) and spending restrictions on mana (CR 106.6, design D8: Cavern of Souls).
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ManaRestriction } from '../../../src/index';
import type { PaymentOption } from '../../../src/keywords/types';
import { act, activated, answer, find, labels, legal, reject, scenario, synth, withStatics } from '../helpers';
import { castCard, drive, mana, spell } from '../announce/support';

const stackInfo = (s: GameState) => s.objects[s.zones.stack[0]!]!.stack!;
const colors = ['W', 'U', 'B', 'R', 'G'];

const convoke: PaymentOption = {
  key: 'convoke', describe: 'Tap an untapped creature you control', reduces: { generic: 1, colors },
  cost: { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] },
};
const improvise: PaymentOption = {
  key: 'improvise', describe: 'Tap an untapped artifact you control', reduces: { generic: 1 },
  cost: { other: [{ kind: 'tapUntapped', filter: { types: ['Artifact'] }, count: 1 }] },
};
const delve: PaymentOption = {
  key: 'delve', describe: 'Exile a card from your graveyard', reduces: { generic: 1 },
  cost: { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1 }] },
};

describe('CR 702.51a: convoke — tap a creature rather than pay {1} or one mana of a color it has', () => {
  const card = spell('Test Convoke', '{2}{G}', [], { type: 'Sorcery' });
  const board = (): GameState =>
    scenario(['Forest', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Convoke'], battlefield: ['Forest', 'Grizzly Bears', 'Hill Giant'] }, defs: [card] });
  const only = (o: PaymentOption) => ({ paymentOptions: (_g: unknown, id: string) => (id.length > 0 ? [o] : []) });

  it('castable with the creatures only because of the option: the listing consults it (and not without it)', () => {
    const s = board();
    expect(labels(s, 'p1')).not.toContain('Cast Test Convoke');
    expect(withStatics(only(convoke), () => labels(s, 'p1'))).toContain('Cast Test Convoke');
  });

  it('the caster names the creatures; the green one pays {G}, the other {1}; they are tapped and the Forest pays what is left', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const forest = find(s0, 'Forest', 'battlefield');
    // The statics provider must stay installed for every step: each answer re-runs the whole action (the decision model).
    const s = withStatics(only(convoke), () => {
      let t = castCard(s0, 'Test Convoke');
      expect(t.pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 2 });
      expect((t.pending as { options: string[] }).options.sort()).toEqual([bears, giant].sort());
      t = answer(t, { kind: 'chooseObjects', ids: [bears, giant] });
      return drive(t, []);
    });
    expect(s.objects[bears]!.tapped).toBe(true);
    expect(s.objects[giant]!.tapped).toBe(true);
    expect(s.objects[forest]!.tapped).toBe(true);
    expect(stackInfo(s).costsPaid.manaSpent).toHaveLength(1);
    expect(stackInfo(s).costsPaid.costObjects).toEqual(expect.arrayContaining([bears, giant]));
  });

  it('choosing none pays everything with mana (an option is never forced)', () => {
    const s0 = scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Test Convoke'], battlefield: ['Forest', 'Forest', 'Forest', 'Grizzly Bears'] }, defs: [card] });
    const s = withStatics(only(convoke), () => drive(answer(castCard(s0, 'Test Convoke'), { kind: 'chooseObjects', ids: [] }), []));
    expect(stackInfo(s).costsPaid.manaSpent).toHaveLength(3);
    expect(s.objects[find(s0, 'Grizzly Bears', 'battlefield')]!.tapped).toBe(false);
  });

  it('a creature tapped by convoke cannot also be tapped for mana: the whole payment is checked', () => {
    // Llanowar Elves taps for {G}; the Forest and Elves cannot both pay and also convoke with the Elves.
    const s = scenario(['Forest', 'Llanowar Elves'], { p1: { hand: ['Test Convoke'], battlefield: ['Forest', 'Llanowar Elves'] }, defs: [card] });
    expect(withStatics(only(convoke), () => labels(s, 'p1'))).not.toContain('Cast Test Convoke'); // 3 mana from Forest + Elves + convoking the Elves again
  });
});

describe('CR 702.126a, 702.66a: improvise (artifacts) and delve (graveyard cards) pay generic mana only', () => {
  const card = spell('Test Delve', '{3}{B}', [], { type: 'Sorcery' });

  it('delve: exile cards from the graveyard instead of paying generic mana', () => {
    const s0 = scenario(['Swamp', 'Mountain'], { p1: { hand: ['Test Delve'], graveyard: ['Mountain', 'Mountain', 'Mountain'], battlefield: ['Swamp'] }, defs: [card] });
    expect(labels(s0, 'p1')).not.toContain('Cast Test Delve');
    expect(withStatics({ paymentOptions: () => [delve] }, () => labels(s0, 'p1'))).toContain('Cast Test Delve');
    const gy = s0.zones.graveyard.p1!;
    const s = withStatics({ paymentOptions: () => [delve] }, () => {
      const t = castCard(s0, 'Test Delve');
      expect(t.pending).toMatchObject({ kind: 'chooseObjects', max: 3 }); // generic mana: {3}
      return drive(answer(t, { kind: 'chooseObjects', ids: gy }), []);
    });
    expect(s.zones.exile.filter((x) => s.objects[x]!.defId === 'Mountain')).toHaveLength(3);
    expect(stackInfo(s).costsPaid.manaSpent).toHaveLength(1);
  });

  it('delve does not pay the colored {B}: with an empty battlefield the spell stays uncastable', () => {
    const s0 = scenario(['Swamp', 'Mountain'], { p1: { hand: ['Test Delve'], graveyard: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, defs: [card] });
    expect(withStatics({ paymentOptions: () => [delve] }, () => labels(s0, 'p1'))).not.toContain('Cast Test Delve');
  });

  it('improvise: tap artifacts for generic mana; a creature is not a candidate', () => {
    const rock = synth({ name: 'Test Rock', cost: '{1}', type: 'Artifact', abilities: [] });
    const s0 = scenario(['Swamp', 'Grizzly Bears'], { p1: { hand: ['Test Delve'], battlefield: ['Swamp', 'Test Rock', 'Test Rock', 'Test Rock', 'Grizzly Bears'] }, defs: [card, rock] });
    const rocks = s0.zones.battlefield.filter((x) => s0.objects[x]!.defId === 'Test Rock');
    const s = withStatics({ paymentOptions: () => [improvise] }, () => {
      const t = castCard(s0, 'Test Delve');
      expect((t.pending as { options: string[] }).options.sort()).toEqual([...rocks].sort());
      return drive(answer(t, { kind: 'chooseObjects', ids: rocks }), []);
    });
    expect(rocks.every((r) => s.objects[r]!.tapped)).toBe(true);
  });

  it('an object that would pay for nothing is refused (the option reduces mana the cost does not have)', () => {
    const cheap = spell('Test Cheap', '{B}', [], { type: 'Sorcery' });
    const s0 = scenario(['Swamp', 'Mountain'], { p1: { hand: ['Test Cheap'], graveyard: ['Mountain'], battlefield: ['Swamp'] }, defs: [cheap] });
    const s = withStatics({ paymentOptions: () => [delve] }, () => castCard(s0, 'Test Cheap'));
    expect(s.pending?.kind).toBe('payCost'); // nothing generic to reduce: the option is not even offered
  });
});

describe('CR 106.6: mana with a spending restriction (Cavern of Souls)', () => {
  const restriction: ManaRestriction = { spells: { types: ['Creature'] }, spellRider: 'cantBeCountered' };
  const cavern = synth({
    name: 'Test Cavern', type: 'Land',
    abilities: [activated('{T}: Add one mana of any color. Spend this mana only to cast a creature spell, and that spell can\'t be countered.', { tap: true }, [], { isMana: true }, [{ op: 'addMana', who: { ref: 'you' }, units: [colors], restriction }])],
  });
  const noncreature = spell('Test Bolt', '{1}{R}', []);

  const board = (extra: string[] = []): GameState =>
    scenario(['Forest', 'Grizzly Bears', 'Mountain'], { p1: { hand: ['Grizzly Bears', 'Test Bolt'], battlefield: ['Test Cavern', 'Test Cavern', ...extra] }, defs: [cavern, noncreature] });

  it('two Caverns pay for a creature spell, which then can\'t be countered (the rider is a flag on the spell)', () => {
    const s0 = board();
    expect(labels(s0, 'p1')).toContain('Cast Grizzly Bears');
    const s = drive(castCard(s0, 'Grizzly Bears'), []);
    expect(stackInfo(s).flags).toEqual(['cantBeCountered']);
    expect(stackInfo(s).costsPaid.manaSpent!.every((u) => u.restriction?.spellRider === 'cantBeCountered')).toBe(true);
  });

  it('the same Caverns cannot pay for a noncreature spell: it is not listed and a cast request is refused', () => {
    const s0 = board();
    expect(labels(s0, 'p1')).not.toContain('Cast Test Bolt');
    expect(reject(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bolt', 'hand') }).message).toContain("can't pay");
  });

  it('with a Mountain besides, the Mountain pays the noncreature spell\'s {R} but a Cavern still cannot make the {1}', () => {
    const s0 = board(['Mountain']);
    expect(labels(s0, 'p1')).not.toContain('Cast Test Bolt'); // {1}{R}: only the Mountain can pay
    const s1 = board(['Mountain', 'Mountain']);
    expect(labels(s1, 'p1')).toContain('Cast Test Bolt');
    const s = drive(castCard(s1, 'Test Bolt'), []);
    expect(stackInfo(s).costsPaid.manaSpent!.every((u) => u.restriction === undefined)).toBe(true);
    expect(s.objects[s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Test Cavern')!]!.tapped).toBe(false);
  });

  it('restricted mana already floating is spent only where it is allowed', () => {
    const s0 = scenario(['Forest', 'Grizzly Bears', 'Mountain'], { p1: { hand: ['Grizzly Bears', 'Test Bolt'], battlefield: ['Mountain'] }, defs: [cavern, noncreature] });
    s0.players[0]!.manaPool.push({ type: 'G', restriction }, { type: 'R', restriction });
    expect(labels(s0, 'p1')).toContain('Cast Grizzly Bears'); // {1}{G} from the two restricted units
    expect(labels(s0, 'p1')).not.toContain('Cast Test Bolt'); // {1}{R}: the Mountain makes one, the restricted units cannot help
    s0.players[0]!.manaPool.push({ type: 'R' });
    expect(labels(s0, 'p1')).toContain('Cast Test Bolt'); // the plain {R} in the pool + the Mountain
  });

  it('a restriction for abilities applies to the activation cost of an artifact\'s ability only', () => {
    const only: ManaRestriction = { abilities: { types: ['Artifact'] } };
    const springs = synth({ name: 'Test Spring', type: 'Land', abilities: [activated('{T}: Add {C}.', { tap: true }, [], { isMana: true }, [{ op: 'addMana', who: { ref: 'you' }, units: [['C']], restriction: only }])] });
    const gadget = synth({ name: 'Test Gadget', cost: '{1}', type: 'Artifact', abilities: [activated('{1}: Do it.', { mana: mana('{1}') })] });
    const totem = synth({ name: 'Test Totem', cost: '{1}', type: 'Enchantment', abilities: [activated('{1}: Do it.', { mana: mana('{1}') })] });
    const s = scenario([], { p1: { battlefield: ['Test Spring', 'Test Gadget', 'Test Totem'] }, defs: [springs, gadget, totem] });
    const doable = legal(s, 'p1', 'activate').filter((a) => !a.isMana).map((a) => a.object);
    expect(doable).toEqual([find(s, 'Test Gadget', 'battlefield')]);
    expect(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Gadget', 'battlefield'), ability: 'p:0:0' }).zones.stack).toHaveLength(1);
  });
});
