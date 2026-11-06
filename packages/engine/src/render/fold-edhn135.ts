/**
 * Must-finish round edh-next-135 (choices, votes and opponents): the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhN135` after the other slices' own folds).
 * A fold applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { destPhrase } from './steps-util';
import { alt } from './text';
import type { RenderState } from './state';

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const bound = (name: string | undefined): unknown => ({ ref: 'bound', name });
const unread = (list: EffectStep[], from: number, names: (string | undefined)[]): boolean => !list.slice(from).some((x) => names.some((n) => n !== undefined && JSON.stringify(x).includes(`"${n}"`)));
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * `givenFaceDownPiles` (CR 700.3, 406.3, 608.2c-d; Hostile Negotiations, templates eff.edhn135.exileTop.twoFaceDownPiles, eff.edhn135.lookEachPile.turnOneFaceUp,
 * rid.r5dig.opponentChoosesPile, eff.r5dig.putThatPile.andOther): "Exile the top three cards of your library in a face-down pile, then exile the top three cards of your library in another
 * face-down pile. Look at the cards in each pile, then turn a pile of your choice face up. An opponent chooses one of those piles. Put that pile into your hand and the other into your
 * graveyard." Exactly that shape: your two face-down exiles of your top cards as the two given piles, your look and turn, another player's choice, then your moves of the chosen pile and
 * of the other into two different zones (hand, graveyard), with nothing after reading the piles.
 */
function givenFaceDownPiles(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [e1, e2, p, m1, m2] = list.slice(i, i + 5);
  if (e1?.op !== 'move' || e2?.op !== 'move' || p?.op !== 'piles' || m1?.op !== 'move' || m2?.op !== 'move') return null;
  if ([e1, e2, p, m1, m2].some((x) => x.guard !== undefined)) return null;
  const top = (m: typeof e1): number | null => {
    const w = m.what as { ref?: string; player?: unknown; count?: unknown };
    if (w.ref !== 'topCards' || !same(w.player, { ref: 'you' }) || typeof w.count !== 'number' || w.count < 1 || w.count > 10 || Object.keys(w).length !== 3) return null;
    if (!same(m.to, { zone: 'exile', faceDown: true }) || m.as === undefined || Object.keys(m).some((k) => !['op', 'what', 'to', 'as'].includes(k))) return null;
    return w.count;
  };
  const n1 = top(e1);
  const n2 = top(e2);
  if (n1 === null || n2 === null || e1.as === e2.as) return null;
  if (!same(p, { op: 'piles', cards: bound(e1.as), second: bound(e2.as), separator: { ref: 'you' }, chooser: p.chooser, chosen: p.chosen, other: p.other, turnUp: true })) return null;
  if (p.chooser.ref !== 'anOpponent' || !same(p.chooser, { ref: 'anOpponent' })) return null;
  if (!same(m1.what, bound(p.chosen)) || !same(m2.what, bound(p.other)) || !same(m1.to, { zone: 'hand' }) || !same(m2.to, { zone: 'graveyard' })) return null;
  if (Object.keys(m1).some((k) => !['op', 'what', 'to'].includes(k)) || Object.keys(m2).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  if (!unread(list, i + 5, [e1.as, e2.as, p.chosen, p.other])) return null;
  const saved = st.actor;
  st.actor = 'you';
  const moves = `put that pile ${destPhrase(m1.to, st, false, true)} and the other ${destPhrase(m2.to, st, false, true)}`;
  st.actor = saved;
  const chooser = K.player(p.chooser, st, 'subject').text;
  const text = `exile the top ${NUM[n1]} cards of your library in a face-down pile, then exile the top ${NUM[n2]} cards of your library in another face-down pile. look at the cards in each pile, then turn a pile of your choice face up. ${chooser} chooses one of those piles. ${moves}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 5 };
}

/**
 * `searchShuffleOneCastOthers` (CR 701.23a, 201.2, 608.2d, 608.2g, 701.24a; Emergent Ultimatum, template eff.edhn135.searchDifferentNames.exile.opponentShufflesOne.castOthersFree): "Search your
 * library for up to three monocolored cards with different names and exile them. An opponent chooses one of those cards. Shuffle that card into your library. You may cast the other cards
 * without paying their mana costs." Exactly the six steps that template builds, with nothing after reading their names.
 */
function searchShuffleOneCastOthers(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [s, m, c, back, sh, cast] = list.slice(i, i + 6);
  if (s?.op !== 'search' || m?.op !== 'move' || c?.op !== 'chooseObjects' || back?.op !== 'move' || sh?.op !== 'shuffle' || cast?.op !== 'cast') return null;
  if ([s, m, c, back, sh, cast].some((x) => x.guard !== undefined)) return null;
  if (typeof s.max !== 'number' || s.max < 1 || s.max > 10 || s.as === undefined || m.as === undefined || c.as === undefined) return null;
  if (!same(s, { op: 'search', who: { ref: 'you' }, zone: 'library', filter: s.filter, min: 0, max: s.max, differentNames: true, as: s.as })) return null;
  if (!same(m, { op: 'move', what: bound(s.as), to: { zone: 'exile' }, as: m.as })) return null;
  if (!same(c, { op: 'chooseObjects', who: { ref: 'anOpponent' }, from: { ref: 'each', filter: { is: bound(m.as), zone: 'exile' } }, min: 1, max: 1, as: c.as })) return null;
  if (!same(back, { op: 'move', what: bound(c.as), to: { zone: 'library' } }) || !same(sh, { op: 'shuffle', who: { ref: 'you' } })) return null;
  if (!same(cast, { op: 'cast', who: { ref: 'you' }, what: { ref: 'each', filter: { is: bound(m.as), zone: 'exile', not: { is: bound(c.as) } } }, free: true, optional: true, select: {} })) return null;
  if (!unread(list, i + 6, [s.as, m.as, c.as])) return null;
  const cards = K.np(s.filter, st, { det: 'none', plural: true, head: 'card' });
  const text = `search your library for up to ${NUM[s.max]} ${cards} with different names and exile them. an opponent chooses one of those cards. shuffle that card into your library. you may cast the other cards without paying their mana costs`;
  return { clauses: [plain(text, { standalone: true })], consumed: 6 };
}

/**
 * `opponentsChooseUnchosenReturn` (CR 101.4, 608.2d; Rejoin the Fight, template eff.edhn135.startingNextOpponent.eachOpponentChoosesUnchosen.fromYourGraveyard): "starting with the next opponent in
 * turn order, each opponent chooses a creature card in your graveyard that hasn't been chosen. Return each card chosen this way to the battlefield under your control." Exactly that choice
 * (one card each, none chosen twice) and the return of every card chosen, with nothing after reading the choice.
 */
function opponentsChooseUnchosenReturn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, m] = list.slice(i, i + 2);
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || c.guard !== undefined || m.guard !== undefined || c.from.ref !== 'each' || !('filter' in c.from)) return null;
  const f = c.from.filter;
  if (f.anyOf?.length !== 1 || !same(f, { anyOf: f.anyOf, zone: 'graveyard', owner: 'you', isCard: true })) return null;
  if (!same(c, { op: 'chooseObjects', who: { ref: 'each', who: 'opponent' }, startingWith: { ref: 'you' }, from: c.from, min: 1, max: 1, unchosen: true, as: c.as })) return null;
  if (!same(m, { op: 'move', what: bound(c.as), to: { zone: 'battlefield', controller: { ref: 'you' } } }) || !unread(list, i + 2, [c.as])) return null;
  const one = K.np({ ...f.anyOf[0]!, zone: 'graveyard' }, st, { det: 'a', noZone: true, head: 'card' });
  const text = `starting with the next opponent in turn order, each opponent chooses ${one} in your graveyard that hasn't been chosen. return each card chosen this way to the battlefield under your control`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/**
 * `searchDifferentPowersOpponentChooses` (CR 701.23a, 208.1, 608.2d, 701.24a; Threats Undetected, template eff.edhn135.searchDifferentPowers.reveal.opponentChooses.shuffleChosen.restToHand):
 * "Search your library for up to four creature cards with different powers and reveal them. An opponent chooses two of those cards. Shuffle the chosen cards into your library and put the
 * rest into your hand." Exactly the four steps that template builds, with nothing after reading their names.
 */
function searchDifferentPowersOpponentChooses(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [s, c, m, sh] = list.slice(i, i + 4);
  if (s?.op !== 'search' || c?.op !== 'chooseObjects' || m?.op !== 'move' || sh?.op !== 'shuffle' || [s, c, m, sh].some((x) => x.guard !== undefined)) return null;
  if (typeof s.max !== 'number' || s.max < 1 || s.max > 10 || typeof c.min !== 'number' || c.min < 1 || c.min > 10 || c.max !== c.min) return null;
  if (!same(s, { op: 'search', who: { ref: 'you' }, zone: 'library', filter: s.filter, min: 0, max: s.max, differentPowers: true, reveal: true, as: s.as })) return null;
  if (!same(c, { op: 'chooseObjects', who: { ref: 'anOpponent' }, from: { ref: 'each', filter: { is: bound(s.as), zone: 'library' } }, min: c.min, max: c.min, as: c.as })) return null;
  if (!same(m, { op: 'move', what: { ref: 'each', filter: { is: bound(s.as), zone: 'library', not: { is: bound(c.as) } } }, to: { zone: 'hand' } }) || !same(sh, { op: 'shuffle', who: { ref: 'you' } })) return null;
  if (!unread(list, i + 4, [s.as, c.as])) return null;
  const cards = K.np(s.filter, st, { det: 'none', plural: true, head: 'card' });
  const text = `search your library for up to ${NUM[s.max]} ${cards} with different powers and reveal them. an opponent chooses ${NUM[c.min]} of those cards. shuffle the chosen cards into your library and put the rest into your hand`;
  return { clauses: [plain(text, { standalone: true })], consumed: 4 };
}

/**
 * `targetChoosesFromHandCastOne` (CR 608.2d, 701.20e, 608.2g, 107.3; Extract Brain, template eff.edhn135.playerChoosesFromHand.look.castOneFree): "Target opponent chooses X cards from their
 * hand. Look at those cards. You may cast a spell from among them without paying its mana cost." Exactly the three steps that template builds, the chooser a target opponent.
 */
function targetChoosesFromHandCastOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, l, cast] = list.slice(i, i + 3);
  if (c?.op !== 'chooseObjects' || l?.op !== 'look' || cast?.op !== 'cast' || [c, l, cast].some((x) => x.guard !== undefined) || c.who.ref !== 'target') return null;
  if (!same(c, { op: 'chooseObjects', who: c.who, from: { ref: 'each', filter: { zone: 'hand', owner: c.who } }, min: c.min, max: c.min, as: c.as }) || c.min === 'any') return null;
  if (!same(l, { op: 'look', who: { ref: 'you' }, at: bound(c.as) })) return null;
  if (!same(cast, { op: 'cast', who: { ref: 'you' }, what: { ref: 'each', filter: { is: bound(c.as), zone: 'hand' } }, free: true, optional: true, select: { max: 1 } }) || !unread(list, i + 3, [c.as])) return null;
  const who = K.player(c.who, st, 'subject');
  if (!/^target opponent$/.test(who.text)) return null;
  const n = typeof c.min === 'number' ? NUM[c.min] : K.qty(c.min as never, st);
  if (n === undefined) return null;
  const text = `${who.text} chooses ${n} cards from their hand. look at those cards. you may cast a spell from among them without paying its mana cost`;
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

const GUESS_STEPS = [
  { op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'you' }, count: 2 }, as: 'looked' },
  { op: 'move', what: { ref: 'bound', name: 'looked' }, to: { zone: 'library', position: 'top', order: 'chosen' } },
  { op: 'guess', chooser: { ref: 'you' }, guesser: { ref: 'anOpponent' }, card: { ref: 'topCards', player: { ref: 'you' }, count: 1 }, kinds: [{ word: 'land', filter: { types: ['Land'] } }, { word: 'nonland', filter: { notTypes: ['Land'] } }], as: 'guessedRight', reveal: true },
  { op: 'if', cond: { cond: 'did', step: 'guessedRight' }, then: [{ op: 'removeFromCombat', what: { ref: 'self' } }], else: [{ op: 'draw', who: { ref: 'you' }, count: 1 }, { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'beBlocked' }] }] },
];

/**
 * `guessKind` (CR 608.2d, 701.20a, 506.4, 509.1b; Gollum, Scheming Guide, template eff.edhn135.lookTwoBack.chooseKind.opponentGuesses.revealIfRightRemoveElseDrawUnblockable): "look at the top
 * two cards of your library, put them back in any order, then choose land or nonland. An opponent guesses whether the top card of your library is the chosen kind. Reveal that card. If they
 * guessed right, remove ~ from combat. Otherwise, you draw a card and ~ can't be blocked this turn." Exactly the four steps that template builds, as the whole list.
 */
function guessKind(list: EffectStep[], i: number, st: RenderState): Folded | null {
  if (i !== 0 || list.length !== GUESS_STEPS.length || !same(list, GUESS_STEPS)) return null;
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  // family attacker-it-removed (edh-next-135): the attacking source is also "it" in the sentence of its removal
  const text = `look at the top two cards of your library, put them back in any order, then choose land or nonland. an opponent guesses whether the top card of your library is the chosen kind. reveal that card. if they guessed right, remove ${alt(self, 'it')} from combat. otherwise, you draw a card and ${self} can't be blocked this turn`;
  return { clauses: [plain(text, { standalone: true })], consumed: 4 };
}

/**
 * `guessManaValue` (CR 608.2d, 202.3, 608.2g; Master of Predicaments, template eff.edhn135.chooseInHand.playerGuessesManaValue.ifWrongCastFree): "choose a card in your hand. That player guesses
 * whether the card's mana value is greater than 4. If the player guessed wrong, you may cast the card without paying its mana cost." Exactly the three steps that template builds, the
 * guesser the player the triggering damage was dealt to.
 */
function guessManaValue(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, gs, f] = list.slice(i, i + 3);
  if (c?.op !== 'chooseObjects' || gs?.op !== 'guess' || f?.op !== 'if' || [c, gs, f].some((x) => x.guard !== undefined)) return null;
  if (!same(c, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'hand', owner: 'you' } }, min: 1, max: 1, as: c.as })) return null;
  const n = (gs.kinds[0]?.filter.manaValue as { value?: unknown } | undefined)?.value;
  if (typeof n !== 'number' || n < 0 || n > 20 || gs.as === undefined) return null;
  if (!same(gs, { op: 'guess', chooser: { ref: 'you' }, guesser: { ref: 'event', role: 'recipient' }, card: bound(c.as), kinds: [{ filter: { manaValue: { op: '>', value: n } } }], as: gs.as })) return null;
  if (!same(f, { op: 'if', cond: { cond: 'did', step: gs.as, not: true }, then: [{ op: 'cast', who: { ref: 'you' }, what: bound(c.as), free: true, optional: true }] }) || !unread(list, i + 3, [c.as, gs.as])) return null;
  const text = `choose a card in your hand. that player guesses whether the card's mana value is greater than ${n}. if the player guessed wrong, you may cast the card without paying its mana cost`;
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

/**
 * `exileIfChosenPlayerControls` (CR 115.1, 607.2d, 608.2c; Stalking Leonin, template eff.edhn135.exileTargetAttackingYou.ifChosenPlayerControls): "Exile target creature that's attacking you if it's
 * controlled by the chosen player." The exile of one target only when the player the source's choice holds (link `opponent`) controls it, as the whole list.
 */
function exileIfChosenPlayerControls(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (i !== 0 || list.length !== 1 || f?.op !== 'if' || f.guard !== undefined || f.else !== undefined || f.then.length !== 1) return null;
  const m = f.then[0]!;
  if (m.op !== 'move' || m.what.ref !== 'target' || !same(m, { op: 'move', what: m.what, to: { zone: 'exile' } })) return null;
  if (!same(f.cond, { cond: 'exists', of: { ref: 'each', filter: { is: m.what, controller: { ref: 'linked', link: 'opponent' } } } })) return null;
  const target = K.obj(m.what, st, 'object').text;
  return { clauses: [plain(`exile ${target} if it's controlled by the chosen player`, { standalone: true })], consumed: 1 };
}

/**
 * `exileAllAuction` (CR 406.1, 101.4, 608.2c, 303.4f; Thieves' Auction, template eff.edhn135.exileAllNontoken.auctionTapped): "Exile all nontoken permanents. Starting with you, each player
 * chooses one of the exiled cards and puts it onto the battlefield tapped under their control. Repeat this process until all cards exiled this way have been chosen." Exactly the two steps.
 */
function exileAllAuction(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [m, a] = list.slice(i, i + 2);
  if (m?.op !== 'move' || a?.op !== 'auction' || m.guard !== undefined || a.guard !== undefined || m.as === undefined) return null;
  if (!same(m, { op: 'move', what: { ref: 'each', filter: { token: false } }, to: { zone: 'exile' }, as: m.as })) return null;
  if (!same(a, { op: 'auction', cards: bound(m.as), startingWith: { ref: 'you' }, tapped: true }) || !unread(list, i + 2, [m.as])) return null;
  const text = 'exile all nontoken permanents. starting with you, each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control. repeat this process until all cards exiled this way have been chosen';
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

export function foldEdhN135(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileAllAuction(list, i, st) ?? exileIfChosenPlayerControls(list, i, st) ?? givenFaceDownPiles(list, i, st) ?? searchShuffleOneCastOthers(list, i, st) ?? opponentsChooseUnchosenReturn(list, i, st) ?? searchDifferentPowersOpponentChooses(list, i, st) ?? targetChoosesFromHandCastOne(list, i, st) ?? guessKind(list, i, st) ?? guessManaValue(list, i, st);
}
