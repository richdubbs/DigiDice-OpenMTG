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
const W_EACH_OPPONENT = P('each opponent');
const W_EACH_OF_YOUR_OPPONENTS = P('each of your opponents'); // std-mkm (CR 102.3): the opponents of the controller, one at a time, as "each opponent"
const W_EACH_PLAYER = P('each player');
const W_EACH_OTHER_PLAYER = P('each other player');
// Standard round 4, r4-trig (CR 506.2: the active player is the attacking player; Contested Game Ball): "the attacking player"
const W_ACTIVE = [P('the active player'), P('active player'), P('the attacking player')];
const W_DEFENDING = [P('the defending player'), P('defending player')];
const W_THAT_PLAYER = P('that player');
const W_THAT_OPPONENT = P('that opponent');
const W_THEY = P('they');
const W_THE_CHOSEN_PLAYER = P('the chosen player');
/** r3-choose (CR 115.1, 608.2c): several players named before as one group ("Choose any number of target players. ... those players control"). */
const W_THOSE_PLAYERS = P('those players');
/** C6 (CR 101.3, 608.2c): the players of a group who can't do what an earlier instruction told each of them (lower/mentions.ts#cantOf). */
const W_EACH_OPPONENT_WHO_CANT = P("each opponent who can't");
const W_EACH_PLAYER_WHO_CANT = P("each player who can't");
/** M12-3 (m12 design D6; CR 101.4, 103.1): "the player to your left / right", the next / previous player in turn order still in the game (`seat`). */
const W_TO_YOUR_LEFT = P('the player to your left');
const W_TO_YOUR_RIGHT = P('the player to your right');
/** M12F (CR 701.38a): the opponents of a finished vote by their ballots (`voters`; render/refs.ts accepts it only after "whenever players finish voting"). */
const W_VOTERS_AGREE = P('each opponent who voted for a choice you voted for');
const W_VOTERS_DISAGREE = P("each opponent who voted for a choice you didn't vote for");
const W_ENCHANTED_PLAYER = P('enchanted player'); // std-rr
// std-combat-1 (CR 608.2c, 508.1b, 508.5; Sandswirl Wanderglyph): the opponents who attacked you or a planeswalker you control this turn (the history's attacks with that
// player as the actor and you, or a planeswalker you controlled, as the defender; rules/history.ts reads `orPlaneswalker` from `defenderKind`)
const W_EACH_OPPONENT_WHO_ATTACKED_YOU = [P('each opponent who attacked you or a planeswalker you control this turn'), P('each opponent who attacked you or a planeswalker you controlled this turn')];
const W_PLAYER = P('player');
const W_PLAYERS = P('players');
const W_OPPONENT = P('opponent');
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
function simplePlayers(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const add = (words: readonly string[], v: unknown): void => { const e = phraseAt(ctx, pos, words); if (e >= 0) out.push({ end: e, value: v }); };
  add(W_YOU, you);
  add(W_YOUR_OPPONENTS, { ref: 'each', who: 'opponent' });
  add(W_AN_OPPONENT, { ref: 'anOpponent' });
  add(W_EACH_OPPONENT, { ref: 'each', who: 'opponent' });
  add(W_EACH_OF_YOUR_OPPONENTS, { ref: 'each', who: 'opponent' });
  add(W_EACH_OTHER_PLAYER, { ref: 'each', who: 'otherPlayer' });
  add(W_EACH_PLAYER, { ref: 'each', who: 'player' });
  for (const w of W_ACTIVE) add(w, { ref: 'active' });
  for (const w of W_DEFENDING) add(w, { ref: 'defending' });
  add(W_THAT_PLAYER, anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }));
  add(W_THAT_OPPONENT, anaphorObj({ sort: 'player', number: 'singular', head: 'opponent', text: 'that opponent' }));
  add(W_THEY, anaphorObj({ sort: 'any', number: 'plural', text: 'they' }));
  add(W_THOSE_PLAYERS, anaphorObj({ sort: 'player', number: 'plural', head: 'player', text: 'those players' }));
  // r3-choose (CR 608.2c, 115.1): "Choose target opponent. ... Then the chosen player loses X life": after a sentence of the same ability that only announced targets
  // (holes/core.ts#Discourse.chose), the player it chose (lower/mentions.ts gives that target the participle), and the link placeholder is the weaker reading
  if (ctx.discourse?.chose === true) {
    add(W_THE_CHOSEN_PLAYER, anaphorObj({ sort: 'player', number: 'singular', head: 'player', participle: 'chosen', text: 'the chosen player' }));
    const e = phraseAt(ctx, pos, W_THE_CHOSEN_PLAYER);
    if (e >= 0) out.push({ end: e, value: linkedObj(), weak: 1 });
  } else add(W_THE_CHOSEN_PLAYER, linkedObj());
  add(W_EACH_OPPONENT_WHO_CANT, anaphorObj({ sort: 'player', number: 'plural', head: 'opponent', participle: 'cant', text: "each opponent who can't" })); // C6
  add(W_EACH_PLAYER_WHO_CANT, anaphorObj({ sort: 'player', number: 'plural', head: 'player', participle: 'cant', text: "each player who can't" }));
  add(W_TO_YOUR_LEFT, { ref: 'seat', side: 'left' }); // M12-3 (D6)
  add(W_TO_YOUR_RIGHT, { ref: 'seat', side: 'right' });
  add(W_VOTERS_AGREE, { ref: 'voters', agree: true }); // M12F
  add(W_VOTERS_DISAGREE, { ref: 'voters', agree: false });
  // std-rr (CR 303.4, 702.5a): "enchanted player", the player the source Aura ("Enchant player", a Curse) is attached to
  for (const w of W_EACH_OPPONENT_WHO_ATTACKED_YOU) add(w, { ref: 'eachWho', who: 'opponent', did: { ev: 'attacks', defender: 'you', orPlaneswalker: true }, scope: 'turn' });
  add(W_ENCHANTED_PLAYER, { ref: 'enchantedPlayer' });
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
  const the = phraseAt(ctx, pos, W_THE);
  if (the >= 0) for (const [w, ref] of both) {
    const e = phraseAt(ctx, the, w);
    const of = e >= 0 ? phraseAt(ctx, e, W_OF) : -1;
    if (of >= 0) for (const o of ctx.call('Obj', of)) out.push({ end: o.end, value: { ref, object: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
  }
  return out;
}

export const player: HoleFn = (ctx, pos) => dedupe([...simplePlayers(ctx, pos), ...targetPlayers(ctx, pos), ...ofObjects(ctx, pos), ...controlsMost(ctx, pos)]);

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
