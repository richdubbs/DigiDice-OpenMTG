/**
 * The one-click decisions: who plays first (CR 103.1), keep or mulligan (CR 103.5), yes / no, a color (CR 105, 106), which replacement or prevention effect
 * applies first (CR 616.1). One component per decision kind.
 */
import type { CSSProperties } from 'react';
import type { ChooseReplacementDecision, GameView, ManaType } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { usePrimary } from './keys';
import { MANA_NAMES, objectName, playerName } from './names';
import type { PromptProps } from './types';
import { PromptActions } from './PromptActions';
import { PromptStage, StageCard, useStageOverlap } from './stage';

export function PlayFirstPrompt({ d, view, answer, busy }: PromptProps<'playFirst'>) {
  const choose = (player: string) => answer({ kind: 'playFirst', player });
  const self = d.options.includes(d.player) ? d.player : d.options[0];
  usePrimary(self !== undefined ? () => choose(self) : null);
  return (
    <PromptActions>
      {d.options.map((p) => (
        <button key={p} type="button" className={p === self ? 'button-primary' : undefined} disabled={busy} onClick={() => choose(p)}>
          {p === d.player ? 'I play first' : `${playerName(view, p)} plays first`}
        </button>
      ))}
    </PromptActions>
  );
}

/**
 * The opening hand's stage line about the other players (CR 103.5: the starting player declares first, then each other player in turn order): who kept
 * and with how many cards, who took mulligans, who decides after.
 */
export function opponentsMulliganStatus(view: GameView, me: string): string {
  return view.players
    .filter((p) => p.id !== me)
    .map((p) => {
      const n = view.zones.hand[p.id]?.length ?? 0;
      if (p.keptHand) return `${p.name} kept a hand of ${n} card${n === 1 ? '' : 's'}.`;
      if (p.mulligans > 0) return `${p.name} took ${p.mulligans} mulligan${p.mulligans === 1 ? '' : 's'}.`;
      return `${p.name} decides after you.`;
    })
    .join(' ');
}

export function MulliganPrompt({ d, view, answer, busy }: PromptProps<'mulligan'>) {
  const hand = view.zones.hand[d.player] ?? [];
  // Keeping locks the hand in (game.keep, CR 103.5); a mulligan is heard from its event on the board, so its button makes no sound of its own.
  const keep = () => {
    gameSfx('game.keep');
    answer({ kind: 'mulligan', keep: true });
  };
  usePrimary(keep);
  // London mulligan (CR 103.5): a new hand of the same size, then as many cards on the bottom as mulligans taken, this one included. M11-2: in Brawl the
  // first mulligan is free (CR 903.12g, `options.commander.freeMulligan`): it puts nothing on the bottom. M12-6: so is it in every multiplayer game
  // (CR 103.5c, 800.6; `options.multiplayer`, as the engine's core/start.ts#mulligans counts it).
  const multiplayerFree = view.options.multiplayer !== undefined;
  const free = view.options.commander?.freeMulligan === true || multiplayerFree ? 1 : 0;
  const freeRules = multiplayerFree ? 'CR 103.5c, 800.6' : 'CR 903.12g';
  const back = Math.max(0, d.mulligans + 1 - free);
  const onBottom = Math.max(0, d.mulligans - free);
  const first = view.turn.startingPlayer;
  const overlap = useStageOverlap();
  return (
    <>
      <p className="prompt-detail">
        Your hand: {hand.map((id) => objectName(view, id)).join(', ') || 'no cards'}.
        {/* CR 103.5: the cards go on the bottom as part of taking the mulligan (the engine already asked for them); keeping costs nothing more. */}
        {d.mulligans > 0
          ? ` You took ${d.mulligans} mulligan${d.mulligans === 1 ? '' : 's'}; ${onBottom} card${onBottom === 1 ? ' is' : 's are'} already on the bottom of your library.`
          : ''}
      </p>
      {/* Arena's opening screen: who goes first (CR 103.1), what the others did, the hand fanned out large. */}
      <PromptStage title={first === d.player ? 'You go first' : `${playerName(view, first)} goes first`} subtitle={opponentsMulliganStatus(view, d.player)}>
        <div className={`prompt-fan${overlap ? '' : ' is-apart'}`} role="list" aria-label="Your opening hand" style={{ '--fan-n': Math.max(1, hand.length) } as CSSProperties}>
          {hand.map((id, i) => (
            <div key={id} role="listitem" className="prompt-fan-slot" style={{ '--fan-i': i - (hand.length - 1) / 2 } as CSSProperties}>
              <StageCard id={id} />
            </div>
          ))}
        </div>
      </PromptStage>
      <PromptActions className="prompt-mulligan">
        <button type="button" className="button-primary" disabled={busy} onClick={keep}>
          Keep {hand.length}
        </button>
        <button type="button" data-sfx="none" disabled={busy || d.handSize <= 0} onClick={() => answer({ kind: 'mulligan', keep: false })}>
          Mulligan (keep {Math.max(0, d.handSize)} after)
        </button>
        {d.handSize > 0 && (
          <p className="prompt-hint prompt-mulligan-hint">
            {back === 0
              ? `Your first mulligan is free: it draws a new hand and puts nothing on the bottom of your library (${freeRules}).`
              : `A mulligan draws a new hand: you will put ${back} card${back === 1 ? '' : 's'} from it on the bottom of your library.`}
          </p>
        )}
      </PromptActions>
    </>
  );
}

export function YesNoPrompt({ d, answer, busy }: PromptProps<'yesNo'>) {
  const yes = () => answer({ kind: 'yesNo', yes: true });
  usePrimary(yes);
  return (
    <PromptActions>
      <button type="button" className="button-primary" disabled={busy} onClick={yes}>
        {d.yesLabel ?? 'Yes'}
      </button>
      <button type="button" disabled={busy} onClick={() => answer({ kind: 'yesNo', yes: false })}>
        {d.noLabel ?? 'No'}
      </button>
    </PromptActions>
  );
}

export function ChooseColorPrompt({ d, answer, busy }: PromptProps<'chooseColor'>) {
  const choose = (color: ManaType) => answer({ kind: 'chooseColor', color });
  const only = d.options.length === 1 ? d.options[0]! : null;
  usePrimary(only ? () => choose(only) : null);
  return (
    <div className="prompt-actions" role="group" aria-label="Colors">
      {d.options.map((c) => (
        <button key={c} type="button" className="prompt-chip" disabled={busy} onClick={() => choose(c)}>
          {MANA_NAMES[c]} ({c})
        </button>
      ))}
    </div>
  );
}

/**
 * M6-11 (m6 design 2.3, CR 616.1a-e): the classes a replacement or prevention effect falls into, in the order they must be applied. The engine offers only
 * the effects of the first class that has any (effects/propose.ts), so the heading says why these are the choices; options without a class (an older engine,
 * a test) go under "Effects".
 */
export const REPLACEMENT_CLASSES: Record<0 | 1 | 2 | 3 | 4, { title: string; rule: string; why: string }> = {
  0: { title: 'Self-replacement effects', rule: 'CR 616.1a', why: 'One of these must apply first: they come from the spell or ability that causes the event (CR 614.15).' },
  1: { title: 'Effects on who controls it as it enters', rule: 'CR 616.1b', why: 'One of these must apply before any other effect.' },
  2: { title: 'Copy effects as it enters', rule: 'CR 616.1c', why: 'One of these must apply before any effect but the ones above.' },
  3: { title: 'Entering with its back face up', rule: 'CR 616.1d', why: 'One of these must apply before the remaining effects (CR 701.27, 701.28).' },
  4: { title: 'Replacement and prevention effects', rule: 'CR 616.1e', why: 'Any of these may apply first.' },
};

/** The options grouped by class, in CR 616.1 order (options without a class last, as one group). */
export function replacementGroups(options: ChooseReplacementDecision['options']): { klass: 0 | 1 | 2 | 3 | 4 | null; options: ChooseReplacementDecision['options'] }[] {
  const order: (0 | 1 | 2 | 3 | 4 | null)[] = [0, 1, 2, 3, 4, null];
  return order.map((klass) => ({ klass, options: options.filter((o) => (o.klass ?? null) === klass) })).filter((g) => g.options.length > 0);
}

export function ChooseReplacementPrompt({ d, view, answer, busy }: PromptProps<'chooseReplacement'>) {
  const groups = replacementGroups(d.options);
  return (
    <>
      <p className="prompt-detail">
        {playerName(view, d.player)} chooses which effect applies first; the others may still apply afterwards, if they still apply (CR 616.1, 616.1f).
      </p>
      {groups.map((g) => {
        const c = g.klass === null ? null : REPLACEMENT_CLASSES[g.klass];
        return (
          <div key={g.klass ?? 'none'} className="prompt-group" role="group" aria-label={c ? `${c.title} (${c.rule})` : 'Effects'}>
            {c && (
              <p className="prompt-hint" title={c.rule}>
                <strong>{c.title}</strong> ({c.rule}). {c.why}
              </p>
            )}
            <div className="prompt-actions prompt-column">
              {g.options.map((o) => (
                <button key={o.id} type="button" disabled={busy} onClick={() => answer({ kind: 'chooseReplacement', id: o.id })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
