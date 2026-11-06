/**
 * edh-next-144 sentence join (parser/lower/ability.ts#buildProgram): "Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put
 * those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and
 * the rest on the bottom of your library in a random order." is one instruction (CR 608.2c, 608.2d; Green Sun's Twilight, ruling 2023-02-04): the chosen cards are one group that
 * either both go to the hand or both onto the battlefield, and "instead" replaces the whole sentence before it, so the four sentences are joined and one template reads them
 * (eff.edhn144.reveal.chooseAndOr.handOrBattlefieldIfX). Joined only for exactly this shape, else the sentences stay as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const SHAPE: readonly RegExp[] = [
  /^reveal the top .+ cards of your library \.$/,
  /^choose an? \S+ card and\/or an? \S+ card from among them \.$/,
  /^put those cards into your hand and the rest on the bottom of your library in a random order \.$/,
  /^if x is \S+ or more , instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order \.$/,
];

export function joinEdhN144ChooseAndOr<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const run = pieces.slice(i, i + SHAPE.length);
    if (run.length === SHAPE.length && run.every((p, k) => SHAPE[k]!.test(norms(p.tokens)))) {
      out.push({ ...run[0]!, tokens: run.flatMap((p) => p.tokens) });
      i += SHAPE.length - 1;
      continue;
    }
    out.push(pieces[i]!);
  }
  return out;
}

/**
 * edh-next-144 sentence join (CR 608.2c, 608.2d; Invoke Despair, rulings 2022-02-18): "Target opponent sacrifices a creature of their choice. If they can't, they lose 2 life and you
 * draw a card. Then repeat this process for an enchantment and a planeswalker." is one instruction: the process of the first two sentences is done again, the same player each
 * time, for each of the two other kinds, whether or not the player could sacrifice the first. Joined only for exactly this shape (eff.edhn144.sacrifice.ifCant.repeatForTwoMore).
 */
const REPEAT_SHAPE: readonly RegExp[] = [
  /^.+ sacrifices an? \S+ of their choice \.$/,
  /^if they can't , they lose \S+ life and you draw a card \.$/,
  /^then repeat this process for an? \S+ and an? \S+ \.$/,
];

export function joinEdhN144RepeatProcess<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const run = pieces.slice(i, i + REPEAT_SHAPE.length);
    if (run.length === REPEAT_SHAPE.length && run.every((p, k) => REPEAT_SHAPE[k]!.test(norms(p.tokens)))) {
      out.push({ ...run[0]!, tokens: run.flatMap((p) => p.tokens) });
      i += REPEAT_SHAPE.length - 1;
      continue;
    }
    out.push(pieces[i]!);
  }
  return out;
}

/**
 * edh-next-144 sentence join (CR 608.2c, 608.2h, 701.21a; Kethek, Crucible Goliath): "you may sacrifice another creature. If you do, reveal cards from the top of your library until you
 * reveal a nonlegendary creature card with lesser mana value, put it onto the battlefield, then put the rest on the bottom of your library in a random order." is one instruction: the
 * mana value is compared with that of the sacrificed creature (as it last existed), so both sentences are read by one template (eff.edhn144.maySacrifice.revealUntil.lesserMv.rest).
 * Joined only for exactly this shape.
 */
const SAC_REVEAL: readonly RegExp[] = [
  /^you may sacrifice another \S+ \.$/,
  /^if you do , reveal cards from the top of your library until you reveal an? .+ with lesser mana value , put it onto the battlefield , then put the rest on the bottom of your library in a random order \.$/,
];

export function joinEdhN144SacrificeReveal<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const run = pieces.slice(i, i + SAC_REVEAL.length);
    if (run.length === SAC_REVEAL.length && run.every((p, k) => SAC_REVEAL[k]!.test(norms(p.tokens)))) {
      out.push({ ...run[0]!, tokens: run.flatMap((p) => p.tokens) });
      i += SAC_REVEAL.length - 1;
      continue;
    }
    out.push(pieces[i]!);
  }
  return out;
}
