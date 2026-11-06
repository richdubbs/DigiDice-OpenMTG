/**
 * Hole grammar `Player` (PlayerRef) and the possessive forms used in front of a noun ("your", "target player's", "its owner's"). Owner: WP6.
 *
 * "target player" produces a target marker (see core.ts): the lowering pass numbers it. "that player", "they" and "its controller" produce anaphor
 * markers; nothing here guesses an antecedent (design 6.4). Rules: CR 109.5 ("you"), CR 102.1 (the active player), CR 506.2 (the defending player),
 * CR 115.1 (target players), CR 608.2h ("its controller" is read from last known information).
 */
import type { PlayerRef } from '../../types/ability';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, anaphorObj, dedupe, linkedObj, phraseAt, spanOf, targetRef } from './core';
import { targetDets } from './target';
import { npAlts } from './filter';

const W_YOU = P('you');
const W_YOUR_OPPONENTS = P('your opponents');
const W_AN_OPPONENT = P('an opponent');
const W_AN_OPPONENT_OF_YOUR_CHOICE = P('an opponent of your choice'); // edh-replace-7
const W_A_RANDOM_OPPONENT = P('a random opponent'); // trek-17
const W_AN_OPPONENT_CHOSEN_AT_RANDOM = P('an opponent chosen at random'); // edh-d-8 (Zaffai, Thunder Conductor): the same player as "a random opponent"
const W_CHOSEN_AT_RANDOM = P('chosen at random'); // edh-c-14
const W_EACH_OPPONENT = P('each opponent');
const W_EACH_OF_YOUR_OPPONENTS = P('each of your opponents'); // std-mkm (CR 102.3): the opponents of the controller, one at a time, as "each opponent"
const W_EACH_PLAYER = P('each player');
const W_EACH_OTHER_PLAYER = P('each other player');
const W_EACH_OF_THAT_PLAYERS_OPPONENTS = P("each of that player 's opponents"); // edh-players-12
// Standard round 4, r4-trig (CR 506.2: the active player is the attacking player; Contested Game Ball): "the attacking player"
const W_ACTIVE = [P('the active player'), P('active player'), P('the attacking player'), P('that attacking player') /* pc-combat-1 (CR 506.2, the Curses) */, P('attacking player') /* edh-c-65 (Goblin Goon) */, P('the player whose turn it is') /* edh-d-99 (CR 102.1; Obeka, Brute Chronologist) */];
const W_DEFENDING = [P('the defending player'), P('defending player')];
const W_THAT_PLAYER = P('that player');
const W_THE_PLAYER = P('the player'); // edh-c-34 (CR 608.2c; Greener Pastures): "the player creates a token" after "if that player controls ...": the same player as "that player"
const W_THAT_OPPONENT = P('that opponent');
const W_THEY = P('they');
const W_THE_PLAYER_WHO_CAST = P('the player who cast'); // edh-next-146
const W_THE_CHOSEN_PLAYER = P('the chosen player');
/** r3-choose (CR 115.1, 608.2c): several players named before as one group ("Choose any number of target players. ... those players control"). */
const W_THOSE_PLAYERS = P('those players');
/** edh-zones-14 (CR 115.1, 608.2c; Court of Cunning): the same group, "each of those players mills ten cards". */
const W_EACH_OF_THOSE_PLAYERS = P('each of those players');
/** edh-players-10 (CR 115.1, 608.2c): the same group named by its kind, "Choose any number of target opponents. ... the creatures those opponents control". */
const W_THOSE_OPPONENTS = P('those opponents');
/** C6 (CR 101.3, 608.2c): the players of a group who can't do what an earlier instruction told each of them (lower/mentions.ts#cantOf). */
const W_EACH_OPPONENT_WHO_CANT = P("each opponent who can't");
const W_EACH_PLAYER_WHO_CANT = P("each player who can't");
/**
 * edh-players-11 (CR 608.2c, 608.2d, 101.4): the players of a group who did the optional action of the `may` before ("Each player may draw a card, then each player who
 * drew a card this way gains 1 life", "Each opponent who does can't attack you ..."; lower/mentions.ts#didOf). `drewThisWay` only names a `may` of one draw.
 */
const W_DID_PHRASES: readonly [readonly string[], 'opponent' | 'player', 'did' | 'drewThisWay' | 'discardedHandThisWay' | 'discardedThisWay'][] = [
  [P('each opponent who does'), 'opponent', 'did'], [P('each opponent who did'), 'opponent', 'did'],
  [P('each player who does'), 'player', 'did'], [P('each player who did'), 'player', 'did'],
  [P('each opponent who drew a card this way'), 'opponent', 'drewThisWay'], [P('each player who drew a card this way'), 'player', 'drewThisWay'],
  // edh-players-14 (CR 701.9a, 608.2c; Snort): the option began with discarding the hand
  [P('each opponent who discarded their hand this way'), 'opponent', 'discardedHandThisWay'], [P('each player who discarded their hand this way'), 'player', 'discardedHandThisWay'],
  // edh-next-43 (CR 701.9a, 608.2c; Borderland Explorer): the option was discarding one card
  [P('each opponent who discarded a card this way'), 'opponent', 'discardedThisWay'], [P('each player who discarded a card this way'), 'player', 'discardedThisWay'],
];
/** M12-3 (m12 design D6; CR 101.4, 103.1): "the player to your left / right", the next / previous player in turn order still in the game (`seat`). */
const W_TO_YOUR_LEFT = P('the player to your left');
const W_TO_YOUR_RIGHT = P('the player to your right');
/** M12F (CR 701.38a): the opponents of a finished vote by their ballots (`voters`; render/refs.ts accepts it only after "whenever players finish voting"). */
const W_VOTERS_AGREE = P('each opponent who voted for a choice you voted for');
const W_VOTERS_DISAGREE = P("each opponent who voted for a choice you didn't vote for");
const W_ENCHANTED_PLAYER = P('enchanted player'); // std-rr
const W_THE_MONARCH = P('the monarch'); // edh-d-10 (CR 725.1)
const W_THE_INITIATIVE = [P('the player who has the initiative'), P('the player with the initiative')]; // edh-next-82 (CR 726.1; Loot Dispute)
const W_ENCHANTED_OPPONENT = P('enchanted opponent'); // edh-players-17
const W_EACH_PLAYER_SELF_ATTACKED = P('each player ~ attacked this turn'); // edh-players-17
// std-combat-1 (CR 608.2c, 508.1b, 508.5; Sandswirl Wanderglyph): the opponents who attacked you or a planeswalker you control this turn (the history's attacks with that
// player as the actor and you, or a planeswalker you controlled, as the defender; rules/history.ts reads `orPlaneswalker` from `defenderKind`)
const W_EACH_OPPONENT_WHO_ATTACKED_YOU = [P('each opponent who attacked you or a planeswalker you control this turn'), P('each opponent who attacked you or a planeswalker you controlled this turn')];
const W_EACH_OPPONENT_WHO_LOST_LIFE = P('each opponent who lost life this turn'); // pc-players-3
const W_EACH_PLAYER_WHO_LOST_LIFE = P('each player who lost life this turn');
// edh-next-66 (CR 608.2c, 601.2, 508.1; Angelic Arbiter): the opponents who cast a spell / attacked with a creature this turn (the history's cast / attacks with that player as the actor)
const W_EACH_OPPONENT_WHO_CAST = P('each opponent who cast a spell this turn');
const W_EACH_OPPONENT_WHO_ATTACKED_WITH = P('each opponent who attacked with a creature this turn');
/**
 * edh-next-147 (CR 120.3, 608.2c; Aurelia's Fury): "Players dealt damage this way can't cast noncreature spells this turn": the players an earlier damage step of the ability
 * actually dealt damage to (effects/handlers/lifedamage.ts binds exactly those, players and objects together; a player is read from the binding's players only). An anaphor only
 * that step answers (lower/mentions.ts: the damage step's participle-only mention); unresolved, manual.
 */
const W_PLAYERS_DEALT_DAMAGE_THIS_WAY = [P('players dealt damage this way')];
const W_PLAYER = P('player');
const W_PLAYERS = P('players');
const W_OPPONENT = P('opponent');
const W_WHO_DEALT_COMBAT_BY_SELF = P('who was dealt combat damage by ~ this turn'); // edh-cast-13 (Hope of Ghirapur)
const W_WHO_LOST_LIFE = P('who lost life this turn'); // edh-c-34 (CR 119.3; Rix Maadi Guildmage): a target player who has lost life this turn
const W_WHOSE_TURN_IT_IS = P('whose turn it is'); // trek-16 (Cmdr. Troi): the player whose turn it is
const W_OPPONENTS = P('opponents');
// cloud std-spm (CR 115.1, 404.1): the plural possessive is one word ("any number of target players' graveyards")
const W_PLAYERS_POSS = P("players'");
const W_OPPONENTS_POSS = P("opponents'");
const W_YOUR_OPPONENTS_POSS = P("your opponents'"); // r5-fxz
const W_ITS = P('its');
const W_THE = P('the');
const W_EACH = P('each');
const W_OF = P('of');

const you: PlayerRef = { ref: 'you' };

/** Players that are a plain word, without anything that could continue the phrase ("you", "an opponent", "each opponent", ...). */
/** edh-next-143: the link of "For each player, choose friend or foe." (template eff.edhn143.forEachPlayer.chooseFriendOrFoe). */
export const FRIEND_OR_FOE_LINK = 'friendOrFoe';

function simplePlayers(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const add = (words: readonly string[], v: unknown): void => { const e = phraseAt(ctx, pos, words); if (e >= 0) out.push({ end: e, value: v }); };
  add(W_YOU, you);
  add(W_YOUR_OPPONENTS, { ref: 'each', who: 'opponent' });
  add(W_AN_OPPONENT, { ref: 'anOpponent' });
  add(W_AN_OPPONENT_OF_YOUR_CHOICE, { ref: 'anOpponent' }); // edh-replace-7 (CR 601.7a, 109.5; Khârn the Betrayer): the controller of the ability picks the opponent, as for "an opponent"
  add(W_A_RANDOM_OPPONENT, { ref: 'randomOpponent' }); // trek-17 (Alexander, Ship's Fool)
  add(W_AN_OPPONENT_CHOSEN_AT_RANDOM, { ref: 'randomOpponent' }); // edh-d-8 (CR 608.2d; Zaffai, Thunder Conductor): the game picks the opponent, as "a random opponent"
  add(W_EACH_OPPONENT, { ref: 'each', who: 'opponent' });
  add(W_EACH_OF_YOUR_OPPONENTS, { ref: 'each', who: 'opponent' });
  add(W_EACH_OTHER_PLAYER, { ref: 'each', who: 'otherPlayer' });
  add(W_EACH_PLAYER, { ref: 'each', who: 'player' });
  for (const w of W_ACTIVE) add(w, { ref: 'active' });
  for (const w of W_DEFENDING) add(w, { ref: 'defending' });
  add(W_THAT_PLAYER, anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }));
  // edh-c-34 (CR 608.2c; Greener Pastures): "the player creates ...": the player an earlier instruction or condition named, as cond.ts#playerIsOpponent reads "the player is your opponent" (the same anaphor, so both give one reading)
  add(W_THE_PLAYER, anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'the player' }));
  add(W_THAT_OPPONENT, anaphorObj({ sort: 'player', number: 'singular', head: 'opponent', text: 'that opponent' }));
  add(W_THEY, anaphorObj({ sort: 'any', number: 'plural', text: 'they' }));
  // edh-next-146 (CR 601.2a, 608.2h, 611.2c, 707.10; Hellish Rebuke): "the player who cast ¤" inside an ability a spell's resolved effect grants: the player who cast that spell, fixed as
  // the effect is created (nobody for a copy that was not cast); only with the outer name (¤), so it never names the caster of another object
  const whoCast = phraseAt(ctx, pos, W_THE_PLAYER_WHO_CAST);
  if (whoCast >= 0 && ctx.toks[whoCast]?.kind === 'GRANTOR') out.push({ end: whoCast + 1, value: { ref: 'grantCaster' } });
  add(W_THOSE_PLAYERS, anaphorObj({ sort: 'player', number: 'plural', head: 'player', text: 'those players' }));
  add(W_EACH_OF_THOSE_PLAYERS, anaphorObj({ sort: 'player', number: 'plural', head: 'player', text: 'each of those players' }));
  add(W_THOSE_OPPONENTS, anaphorObj({ sort: 'player', number: 'plural', head: 'opponent', text: 'those opponents' }));
  // r3-choose (CR 608.2c, 115.1): "Choose target opponent. ... Then the chosen player loses X life": after a sentence of the same ability that only announced targets
  // (holes/core.ts#Discourse.chose), the player it chose (lower/mentions.ts gives that target the participle), and the link placeholder is the weaker reading
  if (ctx.discourse?.chose === true) {
    add(W_THE_CHOSEN_PLAYER, anaphorObj({ sort: 'player', number: 'singular', head: 'player', participle: 'chosen', text: 'the chosen player' }));
    const e = phraseAt(ctx, pos, W_THE_CHOSEN_PLAYER);
    if (e >= 0) out.push({ end: e, value: linkedObj(), weak: 1 });
  } else add(W_THE_CHOSEN_PLAYER, { ref: 'linked', link: 'opponent' }); // edh-replace-3 (CR 607.2d; Stuffy Doll): the player another ability of the face chose as it entered, read through the link of std-control-1 (parse.ts#CHOSEN_OPPONENT_LINK, linkChosenOpponent: with no such choice, or two, the reader is manual)
  for (const w of W_PLAYERS_DEALT_DAMAGE_THIS_WAY) add(w, anaphorObj({ sort: 'set', number: 'plural', participle: 'dealt damage this way', text: 'players dealt damage this way' })); // edh-next-147
  add(W_EACH_OPPONENT_WHO_CANT, anaphorObj({ sort: 'player', number: 'plural', head: 'opponent', participle: 'cant', text: "each opponent who can't" })); // C6
  add(W_EACH_PLAYER_WHO_CANT, anaphorObj({ sort: 'player', number: 'plural', head: 'player', participle: 'cant', text: "each player who can't" }));
  // (weak, design 6.3 rule 2: "each player who does draws N cards" stays the specific templates' sentence, rid.r5refs.eachWhoDoes.draw, eff.t65.eachMay.shuffleHandGraveyard.thenDraw)
  for (const [w, head, participle] of W_DID_PHRASES) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'player', number: 'plural', head, participle, text: `each ${head} who ${participle === 'did' ? 'does' : participle === 'drewThisWay' ? 'drew a card this way' : participle === 'discardedThisWay' ? 'discarded a card this way' : 'discarded their hand this way'}` }), weak: 1 }); // edh-players-11, edh-players-14
  }
  add(W_TO_YOUR_LEFT, { ref: 'seat', side: 'left' }); // M12-3 (D6)
  add(W_TO_YOUR_RIGHT, { ref: 'seat', side: 'right' });
  add(W_VOTERS_AGREE, { ref: 'voters', agree: true }); // M12F
  add(W_VOTERS_DISAGREE, { ref: 'voters', agree: false });
  // std-rr (CR 303.4, 702.5a): "enchanted player", the player the source Aura ("Enchant player", a Curse) is attached to
  // pc-players-3 (CR 119.3, 608.2c; Papalymo Totolymo): "each opponent who lost life this turn": the opponents (players) whose life went down this turn, damage included (the game history)
  add(W_EACH_OPPONENT_WHO_LOST_LIFE, { ref: 'eachWho', who: 'opponent', did: { ev: 'life', change: 'loss' }, scope: 'turn' });
  add(W_EACH_PLAYER_WHO_LOST_LIFE, { ref: 'eachWho', who: 'player', did: { ev: 'life', change: 'loss' }, scope: 'turn' });
  add(W_EACH_OPPONENT_WHO_CAST, { ref: 'eachWho', who: 'opponent', did: { ev: 'cast' }, scope: 'turn' }); // edh-next-66
  add(W_EACH_OPPONENT_WHO_ATTACKED_WITH, { ref: 'eachWho', who: 'opponent', did: { ev: 'attacks' }, scope: 'turn' }); // edh-next-66
  for (const w of W_EACH_OPPONENT_WHO_ATTACKED_YOU) add(w, { ref: 'eachWho', who: 'opponent', did: { ev: 'attacks', defender: 'you', orPlaneswalker: true }, scope: 'turn' });
  add(W_ENCHANTED_PLAYER, { ref: 'enchantedPlayer' });
  for (const w of W_THE_INITIATIVE) add(w, { ref: 'initiative' }); // edh-next-82 (CR 726.1)
  // edh-next-143 (CR 608.2d; Pir's Whim, Khorvath's Fury): "each friend" / "each foe", the players an earlier "For each player, choose friend or foe." of the same ability chose
  // that word for (the `chose` reference of its link; lower/links.ts#checkChoseWords keeps the sentence manual when no such choice comes before it)
  add(['each', 'friend'], { ref: 'chose', link: FRIEND_OR_FOE_LINK, value: 'friend' });
  add(['each', 'foe'], { ref: 'chose', link: FRIEND_OR_FOE_LINK, value: 'foe' });
  add(W_THE_MONARCH, { ref: 'monarch' }); // edh-d-10 (CR 725.1, 725.2; Archivist of Gondor, Azure Fleet Admiral, Fealty to the Realm)
  add(W_ENCHANTED_OPPONENT, { ref: 'enchantedPlayer' }); // edh-players-17 (CR 303.4, 702.5a; Tenuous Truce): an Aura with "Enchant opponent" says "enchanted opponent"
  add(W_EACH_PLAYER_SELF_ATTACKED, { ref: 'attackedBySource' }); // edh-players-17 (CR 506.3, 508.1; Angel of Destiny): the players the source creature attacked this turn
  // edh-players-12 (CR 102.3, 608.2c; Heartwood Storyteller): "each of that player's opponents": every player but the one "that player" names (the players of `each player` other than them)
  add(W_EACH_OF_THAT_PLAYERS_OPPONENTS, { ref: 'otherOf', of: { ref: 'each', who: 'player' }, than: anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }) });
  return out;
}

/** "target player", "target opponent", "up to two target players", ... as target markers. */
function targetPlayers(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const d of targetDets(ctx, pos)) {
    const singular = d.number === 'singular';
    for (const [who, one, many] of [['any', W_PLAYER, W_PLAYERS], ['opponent', W_OPPONENT, W_OPPONENTS]] as const) {
      const e = phraseAt(ctx, d.end, singular ? one : many);
      if (e >= 0) out.push({ end: e, value: targetRef({ kind: 'player', players: { who }, min: d.min, max: d.max, text: spanOf(ctx, pos, e), ...(d.another ? { another: true } : {}) }), ...(d.eachOf ? { flags: ['each-of'] } : {}) });
      // edh-c-14 (CR 115.1, 601.2c, 603.3d; Witch Hunt): "target opponent chosen at random": one target player the game picks among the legal ones as the ability is put on the stack (TargetSpec.random)
      if (e >= 0 && who === 'opponent' && singular && d.min === 1 && d.max === 1 && !d.another && !d.eachOf) {
        const ar = phraseAt(ctx, e, W_CHOSEN_AT_RANDOM);
        if (ar >= 0) out.push({ end: ar, value: targetRef({ kind: 'player', players: { who }, min: 1, max: 1, text: spanOf(ctx, pos, ar), random: true }) });
      }
      // edh-cast-13 (CR 115.1, 510.2, 120.1; Hope of Ghirapur): "target player who was dealt combat damage by ~ this turn": a player this object dealt combat damage to this turn
      const dealt = e >= 0 && singular && who === 'any' ? phraseAt(ctx, e, W_WHO_DEALT_COMBAT_BY_SELF) : -1;
      if (dealt >= 0) out.push({ end: dealt, value: targetRef({ kind: 'player', players: { who, dealtCombatDamageBySource: true }, min: d.min, max: d.max, text: spanOf(ctx, pos, dealt), ...(d.another ? { another: true } : {}) }) });
      // edh-c-34 (CR 115.1, 119.3; Rix Maadi Guildmage): "target player who lost life this turn": one target, a player who has lost life this turn (any player, or an opponent)
      const lost = e >= 0 && singular ? phraseAt(ctx, e, W_WHO_LOST_LIFE) : -1;
      if (lost >= 0) out.push({ end: lost, value: targetRef({ kind: 'player', players: { who, lostLife: true }, min: d.min, max: d.max, text: spanOf(ctx, pos, lost), ...(d.another ? { another: true } : {}) }) });
      // trek-16 (CR 115.1, 608.2b; Cmdr. Troi, Outgoing Empath): "target opponent whose turn it is": the opponent who is the active player (one opponent only)
      const turn = e >= 0 && singular && who === 'opponent' ? phraseAt(ctx, e, W_WHOSE_TURN_IT_IS) : -1;
      if (turn >= 0) out.push({ end: turn, value: targetRef({ kind: 'player', players: { who, activePlayer: true }, min: d.min, max: d.max, text: spanOf(ctx, pos, turn), ...(d.another ? { another: true } : {}) }) });
      // STD-OTJ (CR 115.1, 601.2c): "any number of target players each discard a card", "up to two target opponents each draw a card": the same targets, each doing the verb
      // (several targets only; the renderer prints "each" after a plural player target that is the subject, render/refs.ts#player)
      const each = e >= 0 && !singular && !d.eachOf ? phraseAt(ctx, e, W_EACH) : -1;
      if (each >= 0) out.push({ end: each, value: targetRef({ kind: 'player', players: { who }, min: d.min, max: d.max, text: spanOf(ctx, pos, e), ...(d.another ? { another: true } : {}) }) });
    }
    // cloud std-spm: "any number of target players'" (a plural target phrase in the possessive, one token): only a template that names the noun after it reads it
    // ("exile {p:Player} graveyards"), so the flag keeps it out of every other use of the hole
    if (!singular && !d.eachOf) {
      for (const [who, words] of [['any', W_PLAYERS_POSS], ['opponent', W_OPPONENTS_POSS]] as const) {
        const e = phraseAt(ctx, d.end, words);
        if (e >= 0) out.push({ end: e, value: targetRef({ kind: 'player', players: { who }, min: d.min, max: d.max, text: spanOf(ctx, pos, e), ...(d.another ? { another: true } : {}) }), flags: ['possessive'] });
      }
    }
  }
  return out;
}

/** Objects' controllers and owners: "its controller", "that creature's owner", "the controller of target spell". */
function ofObjects(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const both: [string[], 'controllerOf' | 'ownerOf'][] = [[P('controller'), 'controllerOf'], [P('owner'), 'ownerOf']];
  const itsEnd = phraseAt(ctx, pos, W_ITS);
  if (itsEnd >= 0) for (const [w, ref] of both) {
    const e = phraseAt(ctx, itsEnd, w);
    // FAST5X E25: "its controller" names the source last (CR 109.5: the source's controller is "you"; lower/anaphora.ts#resolveAnaphor, AnaphorInfo.selfLast)
    if (e >= 0) out.push({ end: e, value: { ref, object: anaphorObj({ sort: 'object', number: 'singular', text: 'it', ...(ref === 'controllerOf' ? { selfLast: true } : {}) }) } });
  }
  for (const o of ctx.call('Obj', pos)) {
    if (ctx.toks[o.end]?.norm !== "'s") continue;
    for (const [w, ref] of both) {
      const e = phraseAt(ctx, o.end + 1, w);
      if (e >= 0) out.push({ end: e, value: { ref, object: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
    }
  }
  // edh-d-5 (CR 109.4, 115.1; Acorn Catapult): "that permanent's controller or that player": the controller of the permanent a
  // target phrase chose, or the player it chose (`orPlayer`; the lowering binds the object to the target as for "that creature's controller")
  for (const o of ctx.call('Obj', pos)) {
    if (ctx.toks[o.end]?.norm !== "'s") continue;
    const e = phraseAt(ctx, o.end + 1, P('controller or that player'));
    if (e >= 0) out.push({ end: e, value: { ref: 'controllerOf', object: o.value, orPlayer: true }, ...(o.flags ? { flags: o.flags } : {}) });
  }
  // edh-next-132 (CR 115.1, 109.4, 608.2h; Chain Lightning): the same player said the other way round, "that player or that permanent's controller"
  const thatPlayerOr = phraseAt(ctx, pos, P('that player or'));
  if (thatPlayerOr >= 0) for (const o of ctx.call('Obj', thatPlayerOr)) {
    // only "that permanent's" (an "any target" reading): "that player or that planeswalker's controller" keeps the older readings of edh-v-22 and the damage rounds (G10)
    if (ctx.toks[o.end]?.norm !== "'s" || (o.value as { $anaphor?: { head?: string } }).$anaphor?.head !== 'permanent') continue;
    const e = phraseAt(ctx, o.end + 1, P('controller'));
    if (e >= 0) out.push({ end: e, value: { ref: 'controllerOf', object: o.value, orPlayer: true }, ...(o.flags ? { flags: o.flags } : {}) });
  }
  const the = phraseAt(ctx, pos, W_THE);
  if (the >= 0) for (const [w, ref] of both) {
    const e = phraseAt(ctx, the, w);
    const of = e >= 0 ? phraseAt(ctx, e, W_OF) : -1;
    if (of >= 0) for (const o of ctx.call('Obj', of)) out.push({ end: o.end, value: { ref, object: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
    // edh-players-20 (CR 109.4, 603.2c; Nelly Borca): "the controller of those creatures": the one controller of a batch the trigger groups by controller (`TriggerDef.perController`)
    if (of >= 0 && ref === 'controllerOf') for (const o of ctx.call('Objs', of)) if (o.flags?.includes('anaphor') === true || JSON.stringify(o.value).includes('anaphor')) out.push({ end: o.end, value: { ref, object: o.value }, ...(o.flags ? { flags: [...o.flags, 'controllerOfGroup'] } : { flags: ['controllerOfGroup'] }) });
  }
  return out;
}

/**
 * edh-zones-16 (CR 109.4, 108.3; Wild Magic Surge): the `ObjPlayer` hole, the one player an object names, "its controller", "that creature's owner": never a group ("each opponent"),
 * so a template that keeps one set of bindings for the player's instruction (a reveal that stops at one card) cannot read an instruction given to several players.
 */
export const objPlayer: HoleFn = (ctx, pos) => dedupe(ofObjects(ctx, pos));

export const player: HoleFn = (ctx, pos) => dedupe([...simplePlayers(ctx, pos), ...targetPlayers(ctx, pos), ...ofObjects(ctx, pos), ...controlsMost(ctx, pos), ...controlsAny(ctx, pos), ...otherThan(ctx, pos), ...eachOfControllersOpponents(ctx, pos), ...dealtDamageBy(ctx, pos)]);

const W_WHO_CONTROLS = P('each player who controls');
const W_OPP_WHO_DOESNT_CONTROL = P("each opponent who doesn't control"); // edh-d-4 (Thornbow Archer)
const W_EACH_PLAYER_OTHER_THAN = P('each player other than');

/**
 * edh-perms-13 (CR 109.4, 101.4, 608.2h; Fade from History): "each player who controls an artifact or enchantment": every player who controls at least one permanent that
 * matches a plain description (no controller, owner or zone of its own: "controls" says whose and where), judged as the instruction is performed.
 */
function controlsAny(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_WHO_CONTROLS);
  const out: Alt[] = [];
  const det = e >= 0 ? ctx.toks[e]?.norm : undefined;
  if (e >= 0 && (det === 'a' || det === 'an')) {
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.head === 'card' || n.head === 'spell' || n.head === 'ability' || n.head === 'stackObject') continue;
      const f = n.filter;
      if (f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.other !== undefined) continue;
      out.push({ end: n.end, value: { ref: 'controlsAny', filter: f } });
    }
  }
  // edh-d-4 (CR 109.4, 102.2, 608.2h; Thornbow Archer): "each opponent who doesn't control an Elf": the opponents who control no permanent that matches a plain description
  const en = phraseAt(ctx, pos, W_OPP_WHO_DOESNT_CONTROL);
  const detN = en >= 0 ? ctx.toks[en]?.norm : undefined;
  if (en >= 0 && (detN === 'a' || detN === 'an')) {
    for (const n of npAlts(ctx, en + 1)) {
      if (n.number !== 'singular' || n.head === 'card' || n.head === 'spell' || n.head === 'ability' || n.head === 'stackObject') continue;
      const f = n.filter;
      if (f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.other !== undefined) continue;
      out.push({ end: n.end, value: { ref: 'controlsAny', filter: f, opponents: true, none: true } });
    }
  }
  return out;
}

/**
 * edh-perms-13 (CR 608.2c, 101.4; Fractured Identity): "each player other than its controller": the players of the group "each player" other than the one(s) a second
 * reference stands for (`otherOf`, effects/refs.ts). The second reference is one object's controller or owner ("its controller", "that creature's owner") only: a named
 * player ("target player") would be the one candidate a later "they" binds to, wrongly (review finding), so it is not read.
 */
function otherThan(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_EACH_PLAYER_OTHER_THAN);
  if (e < 0) return [];
  const out: Alt[] = [];
  for (const p of ofObjects(ctx, e)) out.push({ end: p.end, value: { ref: 'otherOf', of: { ref: 'each', who: 'player' }, than: p.value }, ...(p.flags ? { flags: p.flags } : {}) });
  // edh-c-65 (CR 115.1, 608.2c, 111.2; Death by Dragons): "Each player other than target player creates a 5/5 Dragon token": the one target player is the one the others are measured
  // against. Only before "creates" (the review of edh-perms-13 kept a named player out of every other verb, where a later "they"/"that player" would bind to the target)
  if (ctx.toks[pos]?.norm === 'each') {
    for (const t of targetPlayers(ctx, e)) {
      const v = t.value as { target?: { min?: number; max?: number } };
      if (ctx.toks[t.end]?.norm !== 'creates' || (v.target?.min ?? 1) !== 1 || (v.target?.max ?? 1) !== 1) continue;
      out.push({ end: t.end, value: { ref: 'otherOf', of: { ref: 'each', who: 'player' }, than: t.value }, ...(t.flags ? { flags: t.flags } : {}) });
    }
  }
  return out;
}

const W_EACH_OF = P('each of');
const W_POSS_OPPONENTS = P("'s opponents");

/**
 * edh-next-1 (CR 102.3, 109.4, 608.2h; Bounty Board): "each of its controller's opponents": every player but the controller of the object, read as the same
 * `otherOf` the other players' reading is ("each player other than its controller", "each of that player's opponents"; render/refs.ts#otherOf says it).
 */
function eachOfControllersOpponents(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_EACH_OF);
  if (e < 0) return [];
  const out: Alt[] = [];
  for (const p of ofObjects(ctx, e)) {
    const end = phraseAt(ctx, p.end, W_POSS_OPPONENTS);
    if (end >= 0) out.push({ end, value: { ref: 'otherOf', of: { ref: 'each', who: 'player' }, than: p.value }, ...(p.flags ? { flags: p.flags } : {}) });
  }
  return out;
}

const W_WHO_CONTROLS_THE = P('each player who controls the');
const W_MOST = P('most');
const W_FEWEST = P('fewest');

/**
 * C6 (CR 109.4, 101.4): "each player who controls the most creatures" / "the fewest lands": every player tied for the greatest (least) number of permanents they control
 * that match a plain description (no controller, owner or zone of its own: "controls" says whose and where).
 */
function controlsMost(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_WHO_CONTROLS_THE);
  if (e < 0) return [];
  const out: Alt[] = [];
  for (const [w, fewest] of [[W_MOST, false], [W_FEWEST, true]] as const) {
    const m = phraseAt(ctx, e, w);
    if (m < 0) continue;
    for (const n of npAlts(ctx, m)) {
      if (n.number !== 'plural' || n.head === 'card' || n.head === 'spell' || n.head === 'ability' || n.head === 'stackObject') continue;
      const f = n.filter;
      if (f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.other !== undefined) continue;
      out.push({ end: n.end, value: { ref: 'controlsMost', filter: f, ...(fewest ? { fewest: true } : {}) } });
    }
  }
  return out;
}

const W_OPPONENT_WHO_CANT = P("opponent who can't");
const W_PLAYER_WHO_CANT = P("player who can't");

/**
 * C6 (CR 101.3, 608.2c, 608.2f): `WhoCant`, the players of a group who can't do what an earlier instruction told each of them, after "for each" ("For each opponent
 * who can't, you draw a card."): the same anaphor as the subject "each opponent who can't" (lower/mentions.ts#cantOf), nothing else.
 */
export const whoCant: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const add = (words: readonly string[], head: 'opponent' | 'player'): void => {
    const e = phraseAt(ctx, pos, words);
    if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'player', number: 'plural', head, participle: 'cant', text: `each ${head} who can't` }) });
  };
  add(W_OPPONENT_WHO_CANT, 'opponent');
  add(W_PLAYER_WHO_CANT, 'player');
  return out;
};

/**
 * A possessive in front of a noun: "your" (you), "their" (anaphor), and any non-"you" player followed by 's: "target player's", "an opponent's",
 * "its owner's", "that player's", "each opponent's", "your opponents'".
 */
export function possessivePlayerAt(ctx: HoleCtx, pos: number): { end: number; ref: PlayerRef }[] {
  const out: { end: number; ref: PlayerRef }[] = [];
  if (phraseAt(ctx, pos, P('your')) >= 0) out.push({ end: pos + 1, ref: you });
  if (phraseAt(ctx, pos, P('their')) >= 0) out.push({ end: pos + 1, ref: anaphorObj({ sort: 'player', number: 'plural', text: 'their' }) as unknown as PlayerRef });
  // r5-fxz (CR 102.3, 404.1): "your opponents'" (the plural possessive is one token): "creature cards in your opponents' graveyards" are those every opponent owns
  const opp = phraseAt(ctx, pos, W_YOUR_OPPONENTS_POSS);
  if (opp >= 0) out.push({ end: opp, ref: { ref: 'each', who: 'opponent' } });
  for (const p of ctx.call('Player', pos)) {
    const r = p.value as PlayerRef;
    if (r.ref === 'you') continue;
    const n = ctx.toks[p.end]?.norm;
    if (n === "'s" || n === "'") out.push({ end: p.end + 1, ref: r });
  }
  return out;
}

const W_EACH_OPP_DEALT = P('each opponent dealt'); // edh-d-86 (Gollum, Obsessed Stalker)
const W_EACH_PLAYER_DEALT = P('each player dealt');
const W_DAMAGE_THIS_GAME_BY = P('damage this game by');
const W_DAMAGE_THIS_TURN_BY = P('damage this turn by');
const W_COMBAT = P('combat');

/**
 * edh-d-86 (CR 120.1, 510.2, 608.2c, 201.2; Gollum, Obsessed Stalker): "each opponent dealt combat damage this game by a creature named Gollum, Obsessed Stalker": the
 * players of the group (the controller's opponents, or every player) who were dealt damage (combat damage only with "combat") in the scope's history (this game or
 * this turn) by a source that matched a plain description when it dealt it (the history's `source.<fact>` facts: a creature with that name, CR 201.2, whichever
 * object it was), judged as the instruction is performed (`eachWho`, effects/refs.ts). Only a singular plain description with no controller, owner, zone or "other"
 * of its own (the source's facts are what it was then).
 */
function dealtDamageBy(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const [w, who] of [[W_EACH_OPP_DEALT, 'opponent'], [W_EACH_PLAYER_DEALT, 'player']] as const) {
    let e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const c = phraseAt(ctx, e, W_COMBAT);
    const combat = c >= 0;
    if (combat) e = c;
    for (const [ws, scope] of [[W_DAMAGE_THIS_GAME_BY, 'game'], [W_DAMAGE_THIS_TURN_BY, 'turn']] as const) {
      const b = phraseAt(ctx, e, ws);
      const det = b >= 0 ? ctx.toks[b]?.norm : undefined;
      if (det !== 'a' && det !== 'an') continue;
      for (const n of npAlts(ctx, b + 1)) {
        if (n.number !== 'singular' || n.head === 'card' || n.head === 'spell' || n.head === 'ability' || n.head === 'stackObject') continue;
        const f = n.filter;
        if (f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.other !== undefined || f.self !== undefined) continue;
        out.push({ end: n.end, value: { ref: 'eachWho', who, did: { ev: 'damage', source: f, ...(combat ? { combat: true } : {}) }, scope } });
      }
    }
  }
  return out;
}
