/**
 * M13-11: the server's notices, loss reasons and result in plain words with the players' names (hosted/game/notices.ts, hosted/errors.ts).
 */
import { LOSS_CODES, type PublicPlacement, type SeatNumber } from '@openmtg/hosted/api';
import { describe, expect, it } from 'vitest';
import { explainHostedError, hostedErrorText } from '../../src/hosted/errors';
import { lossText, noticeText, outcomeHeadline, placementLine } from '../../src/hosted/game/notices';

const who = (seat: SeatNumber | undefined) => (seat === undefined ? 'A player' : seat === 1 ? 'You' : 'Bob');

describe('noticeText', () => {
  it('says the server\'s notices with names, and "You" for this seat', () => {
    expect(noticeText({ kind: 'playerDropped', seat: 2, text: 'x' }, who, 1)).toMatch(/^Bob lost the connection\. The game waits for them only when they must decide/);
    expect(noticeText({ kind: 'playerBack', seat: 2, text: 'x' }, who, 1)).toBe('Bob is back.');
    expect(noticeText({ kind: 'playerLeft', seat: 2, text: 'x' }, who, 1)).toBe('Bob left the game and concedes.');
    expect(noticeText({ kind: 'timeout', seat: 2, text: 'x' }, who, 1)).toBe('Bob ran out of time and concedes.');
    expect(noticeText({ kind: 'forfeit', seat: 2, text: 'x' }, who, 1)).toBe('Bob was away too long and concedes.');
    expect(noticeText({ kind: 'timeout', seat: 1, text: 'x' }, who, 1)).toBe('You ran out of time and concede.');
    expect(noticeText({ kind: 'forfeit', seat: 1, text: 'x' }, who, 1)).toBe('You were away too long and concede.');
    expect(noticeText({ kind: 'playerBack', seat: 1, text: 'x' }, who, 1)).toBe('You are back.');
    expect(noticeText({ kind: 'abandoning', text: 'x' }, who, 1)).toMatch(/Nobody in the game is connected/);
  });

  it('keeps the server\'s own words for what only it can say', () => {
    for (const kind of ['serverDraining', 'degraded', 'voided', 'limitWarning', 'cancelsUsed', 'tableClosed', 'tableExpired', 'readyCheckFailed', 'queueLost', 'capacityTimeout'] as const) {
      expect(noticeText({ kind, text: 'The server says so.' }, who, 1)).toBe('The server says so.');
    }
  });
});

describe('the result in words', () => {
  it('has words for every way a player can lose', () => {
    for (const code of LOSS_CODES) expect(lossText(code)).not.toBe('');
    expect(lossText(null)).toBe('');
    expect(lossText('timeout')).toBe('ran out of time');
    expect(lossText('disconnect')).toBe('was away too long');
  });

  const placements: PublicPlacement[] = [
    { seat: 2, name: 'Bob', place: 1, loss: null, lossRule: null, outTurn: null },
    { seat: 1, name: 'Alice', place: 2, loss: 'concession', lossRule: null, outTurn: 1 },
  ];

  it('says who won, from this seat\'s side, and why there is no winner', () => {
    expect(outcomeHeadline('win', placements, 2)).toBe('You win');
    expect(outcomeHeadline('win', placements, 1)).toBe('Bob wins');
    expect(outcomeHeadline('win', [], 1)).toBe('The game is over');
    expect(outcomeHeadline('draw', placements, 1)).toBe('The game is a draw');
    expect(outcomeHeadline('void', [], 1)).toBe('The game ended without a result');
  });

  it('writes a place with who the player is, how they lost and when', () => {
    expect(placementLine(placements[0]!, 2)).toBe('1st: Bob (you)');
    expect(placementLine(placements[0]!, 1)).toBe('1st: Bob');
    expect(placementLine(placements[1]!, 1)).toBe('2nd: Alice (you, conceded, turn 1)');
    expect(placementLine({ seat: 3, name: 'Carol', place: 3, loss: 'timeout', lossRule: null, outTurn: 7 }, 1)).toBe('3rd: Carol (ran out of time, turn 7)');
  });
});

describe('explainHostedError', () => {
  it('turns every code of the server into a sentence, with what to do where it helps', () => {
    expect(explainHostedError({ code: 'badCode', message: 'x' }).message).toBe('That invite code is not valid.');
    expect(explainHostedError({ code: 'tableFull', message: 'x' }).message).toBe('That table is full.');
    expect(explainHostedError({ code: 'noTable', message: 'x' }).hint).toMatch(/started without you|player who made it left/);
    expect(explainHostedError({ code: 'draining', message: 'x' }).hint).toMatch(/few minutes/);
    expect(explainHostedError({ code: 'serverBusy', message: 'x', retryAfterMs: 60_000 }).hint).toBe('Please try again in about a minute.');
    expect(explainHostedError({ code: 'serverBusy', message: 'x' }).hint).toBe('Please try again in a few minutes.');
    expect(explainHostedError({ code: 'deckRejected', message: 'Forest is not legal.', details: ['a', 'b'] })).toMatchObject({ details: ['a', 'b'], hint: 'Forest is not legal.' });
    expect(explainHostedError({ code: 'illegalAction', message: 'You cannot do that.' })).toEqual({ message: 'You cannot do that.' });
    expect(explainHostedError({ code: 'timeout', message: 'x' }).message).toBe('The server did not answer in time.');
    expect(explainHostedError({ code: 'disconnected', message: '' }).message).toMatch(/dropped before it answered/);
    expect(hostedErrorText({ code: 'stale', message: 'x' })).toBe('The game moved on before that action arrived. Look at the board again and choose once more.');
  });
});
