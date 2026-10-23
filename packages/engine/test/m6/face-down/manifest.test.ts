/**
 * M6-3 (m6 design 3.4 "Putting onto the battlefield face down"): the keyword actions manifest (CR 701.40), cloak (CR 701.58) and manifest dread (CR 701.62),
 * run natively (effects/handlers/face-ops.ts) from the templates of parser/templates/zz-m6/face.json, and putting a card onto the battlefield face down with a
 * `move` (CR 708.3).
 */
import { describe, expect, it } from 'vitest';
import { getChars, type AbilityDef, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { act, drive, faceDownOf, find, lands, logFor, pass, resolveTop, scenario, synthetic, viewFor } from './support';

const CLOAKER = synthetic('Test Shroud Tailor', 'Creature — Human Rogue', '{1}{U}', 'When this creature enters, cloak the top card of your library.', { power: '1', toughness: '1' });
/** "{0}: Put target card from your graveyard onto the battlefield face down." (no template reads this rare wording: the ability is written as data) */
const ORACLE: CardDef = (() => {
  const d = synthetic('Test Grave Oracle', 'Creature — Human Wizard', '{U}', '{0}: Draw a card.', { power: '1', toughness: '1' });
  const ability: AbilityDef = {
    kind: 'activated', text: '{0}: Put target card from your graveyard onto the battlefield face down.', cost: { mana: [{ kind: 'generic', amount: 0 }] },
    effect: {
      targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target card from your graveyard', filter: { zone: 'graveyard', owner: 'you', isCard: true } }],
      steps: [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'battlefield', controller: { ref: 'you' }, faceDown: true } }],
    },
  };
  return { ...d, faces: [{ ...d.faces[0]!, abilities: [ability] }] };
})();

/** Pass priority (declaring no attackers) until the given step of the current turn. */
function toEnd(s: GameState): GameState {
  let t = s;
  for (let i = 0; i < 40 && !(t.turn.step === 'end' && t.pending?.kind === 'priority'); i++) {
    t = t.pending?.kind === 'declareAttackers' ? drive(t, [{ kind: 'declareAttackers', attacks: [] }]) : pass(t);
  }
  return t;
}

const castCard = (s: GameState, name: string): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }));

describe('CR 701.40a: manifest (Whisperwood Elemental: "At the beginning of your end step, manifest the top card of your library")', () => {
  it('the top card of the library is put onto the battlefield face down as a manifested 2/2; only its controller learns what it is', () => {
    let s = scenario(['Whisperwood Elemental', 'Grizzly Bears'], { p1: { battlefield: ['Whisperwood Elemental'], library: ['Grizzly Bears'] } });
    s = toEnd(s);
    expect(s.zones.stack).toHaveLength(1); // the end step trigger
    s = resolveTop(s);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Grizzly Bears', faceDown: true, faceDownInfo: { by: 'manifest', profile: 'plain' } });
    expect(getChars(s, id!)).toMatchObject({ name: '', power: '2', toughness: '2' });
    expect(logFor(s, 'p1')).toContain('Alice manifests Grizzly Bears.');
    expect(logFor(s, 'p2')).toContain('Alice manifests a card.');
    expect(JSON.stringify(viewFor(s, 'p2'))).not.toMatch(/Grizzly Bears/);
    expect(viewFor(s, 'p2').objects[id!]).toMatchObject({ defId: '__facedown__', faceDownInfo: { by: 'manifest' } });
  });
});

describe('CR 701.58a: cloak', () => {
  it('a cloaked permanent is a face-down 2/2 with ward {2}', () => {
    let s = scenario(['Island', 'Grizzly Bears'], { p1: { hand: ['Test Shroud Tailor'], battlefield: lands('Island', 2), library: ['Grizzly Bears'] }, defs: [CLOAKER] });
    s = resolveTop(castCard(s, 'Test Shroud Tailor'));
    s = resolveTop(s); // the enters trigger
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Grizzly Bears', faceDownInfo: { by: 'cloak', profile: 'ward2' } });
    expect(getChars(s, id!).keywords.map((k) => k.keyword)).toEqual(['ward']);
    expect(viewFor(s, 'p2').objects[id!]!.defId).toBe('__facedown_ward2__');
  });
});

describe('CR 701.62a: manifest dread (Abhorrent Oculus: "At the beginning of each opponent\'s upkeep, manifest dread")', () => {
  it('its controller looks at the top two cards, manifests one and puts the other into the graveyard', () => {
    let s = scenario(['Abhorrent Oculus', 'Grizzly Bears', 'Lightning Bolt'], { p1: { battlefield: ['Abhorrent Oculus'], library: ['Lightning Bolt', 'Grizzly Bears'] } });
    s = toEnd(s);
    for (let i = 0; i < 20 && !(s.turn.activePlayer === 'p2' && s.zones.stack.length > 0); i++) s = pass(s);
    expect(s.turn).toMatchObject({ activePlayer: 'p2', step: 'upkeep' });
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    const options = (s.pending as { options: ObjectId[] }).options;
    const bears = options.find((o) => s.objects[o]!.defId === 'Grizzly Bears')!;
    s = drive(s, [{ kind: 'chooseObjects', ids: [bears] }]);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Grizzly Bears', faceDownInfo: { by: 'manifest', profile: 'plain' } });
    expect(find(s, 'Lightning Bolt', 'graveyard', 'p1')).toBeDefined();
    expect(logFor(s, 'p2').join('\n')).not.toMatch(/Grizzly Bears/);
  });
});

describe('CR 708.3: "put ... onto the battlefield face down" (a move with faceDown)', () => {
  it('the card enters as a face-down 2/2 put there by an effect, whatever it is (even an instant card, CR 701.40g)', () => {
    let s = scenario(['Lightning Bolt'], { p1: { battlefield: ['Test Grave Oracle'], graveyard: ['Lightning Bolt'] }, defs: [ORACLE] });
    const oracle = find(s, 'Test Grave Oracle', 'battlefield');
    const bolt = find(s, 'Lightning Bolt', 'graveyard', 'p1');
    const key = getChars(s, oracle).abilities.find((a) => a.def.kind === 'activated')!.key;
    s = drive(act(s, { type: 'activate', player: 'p1', source: oracle, ability: key }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bolt }] }]);
    s = resolveTop(s);
    const [id] = faceDownOf(s, 'p1');
    expect(s.objects[id!]).toMatchObject({ defId: 'Lightning Bolt', faceDown: true, faceDownInfo: { by: 'effect', profile: 'plain' } });
    expect(getChars(s, id!)).toMatchObject({ types: ['Creature'], power: '2', toughness: '2' });
  });
});
