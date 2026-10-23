/**
 * M12 gaps (STATUS "Wave M12" gap 7): the bot's vote for words (CR 701.38a-b), on the real engine. With two or more opponents it reads what each word does
 * in the resolving spell (src/votes.ts) and votes for the word worth more to itself: the caster's bot for its own gain, an opponent's bot against the caster;
 * a word it cannot value, a tie, or a two-player game (m12 design D17) keep the first word. The cards are compiled from invented wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, viewFor, type Action, type CardDef, type GameState, type OracleCard, type PlayerId } from '@openmtg/engine';
import { act, answer, drive, find, mpScenario, pass } from '../../../engine/test/m12/rules/helpers';
import { chooseAction } from '../../src/index';

const sorcery = (name: string, text: string): CardDef =>
  compileCard({ name, layout: 'normal', type_line: 'Sorcery', mana_cost: '{W}', oracle_text: text, colors: [] } as unknown as OracleCard);

const TORMENT = sorcery('Test Torment Vote', 'Starting with you, each player votes for death or torture. If death gets more votes, each opponent sacrifices a creature of their choice. If torture gets more votes or the vote is tied, each opponent loses 4 life.');
const PORTAL = sorcery('Test Portal Vote', 'Starting with you, each player votes for carnage or homage. If carnage gets more votes, destroy all nonland permanents. If homage gets more votes or the vote is tied, draw a card.');
const SECRET = sorcery('Test Secret Vote', 'Starting with you, each player votes for truth or consequences. Draw a card.');
const DEFS = [TORMENT, PORTAL, SECRET];
const CARDS = ['Plains', 'Craw Wurm', 'Serra Angel', 'Hill Giant'];

const ai = (s: GameState): Action => chooseAction(viewFor(s, s.pending!.player), s.pending!, 'm12-gaps-votes');

/** Alice casts `name`; every voter's vote is the AI's. Returns each voter's word in turn order. */
function votes(s0: GameState, name: string): Record<string, string> {
  let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
  for (let i = 0; i < 8 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
  const out: Record<string, string> = {};
  while (s.pending?.kind === 'chooseOption' && s.pending.rules?.includes('CR 701.38a')) {
    const voter = s.pending.player;
    const a = ai(s);
    expect(a.type).toBe('answer');
    const ids = ((a as Extract<Action, { type: 'answer' }>).answer as { ids: string[] }).ids;
    out[voter] = ids.join('+');
    s = answer(s, { kind: 'chooseOption', ids });
  }
  return out;
}

const game = (zones: Partial<Record<PlayerId, string[]>> = {}, players = 4): GameState => mpScenario({
  players, defs: DEFS, cards: CARDS, ...(players === 2 ? { options: { multiplayer: undefined } } : {}),
  zones: Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as const).slice(0, players).map((p) => [p, {
    ...(p === 'p1' ? { hand: ['Test Torment Vote', 'Test Portal Vote', 'Test Secret Vote'] } : {}), battlefield: [...(p === 'p1' ? ['Plains'] : []), ...(zones[p] ?? [])],
  }])),
});

describe('M12 gaps: the AI votes for the word worth more to it (CR 701.38a-b, 3-4 players)', () => {
  it('"death or torture" (each opponent sacrifices a creature / loses 4 life): the caster\'s bot takes death, its opponents take torture', () => {
    expect(votes(game({ p2: ['Hill Giant'], p3: ['Hill Giant'], p4: ['Hill Giant'] }), 'Test Torment Vote')).toEqual({ p1: 'death', p2: 'torture', p3: 'torture', p4: 'torture' });
  });

  it('"carnage or homage" (destroy all nonland permanents / draw a card): a bot with the biggest board keeps it, a bot with nothing wipes the others', () => {
    // Alice (the caster) has the only creature: homage; Bob, Carol and Dan have nothing to lose and would see Alice's Craw Wurm go: carnage
    expect(votes(game({ p1: ['Craw Wurm'] }), 'Test Portal Vote')).toEqual({ p1: 'homage', p2: 'carnage', p3: 'carnage', p4: 'carnage' });
    // the opponents hold the creatures: Alice (nothing on the battlefield) wipes them; Dan, the only one without a creature, too; Bob and Carol keep theirs
    expect(votes(game({ p2: ['Serra Angel'], p3: ['Craw Wurm'] }), 'Test Portal Vote')).toEqual({ p1: 'carnage', p2: 'homage', p3: 'homage', p4: 'carnage' });
  });

  it('words whose outcome the bot cannot tell apart keep the first word (the default)', () => {
    expect(votes(game(), 'Test Secret Vote')).toEqual({ p1: 'truth', p2: 'truth', p3: 'truth', p4: 'truth' });
  });
});

describe('M12 gaps: two players (m12 design D16, D17) keep the first word', () => {
  it('"death or torture" and "carnage or homage": the first word, as before', () => {
    expect(votes(game({ p2: ['Hill Giant'] }, 2), 'Test Torment Vote')).toEqual({ p1: 'death', p2: 'death' });
    expect(votes(game({ p1: ['Craw Wurm'] }, 2), 'Test Portal Vote')).toEqual({ p1: 'carnage', p2: 'carnage' });
  });
});
