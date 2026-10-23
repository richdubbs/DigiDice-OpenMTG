/**
 * M12-4b (docs/design/m12-multiplayer.md D13, 4.5, 5.3): the choices a multiplayer game adds. The engine asks them as ordinary `chooseOption` decisions
 * whose options are players (no new decision kinds), and only with two or more candidates, so a two-player game never sees one:
 *
 * - the protector of a Siege, among its controller's opponents (CR 310.12a), and again when the protector left (CR 704.5x);
 * - the defending player a spell or ability means when it is not one attacker's (CR 508.5a, 802.2a);
 * - "an opponent" (CR 601.7a): which opponent an effect means, or which opponent makes a choice the spell asks of "an opponent";
 * - which other opponent makes a choice for an opponent who left the game (CR 800.4g).
 *
 * Each is drawn with the players' names and life, the rule in words, and the players clickable on the board (their life discs). A decision redirected to the
 * viewer because another player left (CR 800.4g-h: "Bob left the game; you choose for them") can be of any kind: `redirectedPrompt` reads it and the
 * prompt bar says it above the decision.
 *
 * Votes (CR 701.38, M12-3): `OPTION_PROMPTS` is the extension point. A `chooseOption` decision citing CR 701.38 is drawn as a vote (VotePrompt: words or
 * players, the players clickable on the board); M12-3's vote node can add its own entry before it, or replace VotePrompt, without touching the other
 * prompts. The first entry whose `matches` is true draws the decision; none: the generic option list (ChoicePrompts.tsx).
 */
import { useState, type ComponentType } from 'react';
import type { ChooseOptionDecision, GameView } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { usePrimary } from './keys';
import { isPlayer, playerName } from './names';
import { PromptActions } from './PromptActions';
import { usePublishSelection } from './selection';
import type { PromptProps } from './types';

/** The new multiplayer choices, told apart by the rules the engine cites (m12 design 4.5). */
export type PlayerChoiceKind = 'siegeProtector' | 'defendingPlayer' | 'opponentChooses' | 'anOpponent' | 'anotherOpponent' | 'players';

const has = (d: { rules?: readonly string[] | undefined }, rule: string) => (d.rules ?? []).some((r) => r === rule || r.startsWith(`${rule}`));

/** Every option of the decision is a player of the game (the new multiplayer choices; votes for players). */
export function optionsArePlayers(d: ChooseOptionDecision, view: GameView): boolean {
  return d.options.length > 0 && d.options.every((o) => isPlayer(view, o.id));
}

/** Which multiplayer choice a decision is, or null for any other `chooseOption`. Only in a multiplayer game (a two-player game draws it as before). */
export function playerChoiceKind(d: ChooseOptionDecision, view: GameView): PlayerChoiceKind | null {
  if (view.options.multiplayer === undefined || !optionsArePlayers(d, view)) return null;
  if (has(d, 'CR 310.12a') || has(d, 'CR 704.5x')) return 'siegeProtector';
  if (has(d, 'CR 508.5a')) return 'defendingPlayer';
  if (has(d, 'CR 800.4g') && /has left the game: choose another opponent/.test(d.prompt)) return 'anotherOpponent';
  if (has(d, 'CR 601.7a')) return /makes this choice/.test(d.prompt) ? 'opponentChooses' : 'anOpponent';
  return 'players';
}

/** What each choice means, in words, under the engine's prompt. */
export const PLAYER_CHOICE_HINTS: Record<PlayerChoiceKind, string> = {
  siegeProtector:
    "A Siege's controller chooses its protector among their opponents: that player defends it, and the other players may attack it (CR 310.9a, 310.12a).",
  defendingPlayer: 'The text says "defending player" and there are several: choose which defending player it means (CR 508.5a, 802.2a).',
  opponentChooses: 'The spell asks an opponent to make a choice: you decide which of your opponents makes it (CR 601.7a).',
  anOpponent: 'The text says "an opponent": choose which of your opponents it means (CR 601.7a).',
  anotherOpponent: 'An opponent who had to make a choice left the game: you choose another opponent to make it (CR 800.4g).',
  players: 'Choose a player: click their life on the table or a name below.',
};

/**
 * A decision redirected to the viewer because its player left the game (CR 800.4g-h; core/game.ts redirectFromLeaver writes "Bob left the game; you choose
 * for them (CR 800.4g). <the original prompt>"): who left, the rule, and the original prompt. Null for any other decision.
 */
export function redirectedPrompt(prompt: string): { who: string; rule: string; rest: string } | null {
  const m = /^(.+?) left the game; you choose for them \((CR 800\.4[gh])\)\.\s*(.*)$/s.exec(prompt);
  return m ? { who: m[1]!, rule: m[2]!, rest: m[3]! } : null;
}

/** "Bianca (32 life)", "Bianca (you, 32 life)". */
function playerLabel(view: GameView, id: string): string {
  const p = view.players.find((x) => x.id === id);
  const bits = [...(id === view.viewer ? ['you'] : []), ...(p ? [`${p.life} life`] : [])];
  return `${playerName(view, id)}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

/**
 * The options of a `chooseOption` as buttons (players named with their life), the players clickable on the board; one click picks with `max` 1. Shared by
 * the player choices and the vote prompt.
 */
function OptionButtons({
  d, view, busy, answer, hint, okLabel,
}: PromptProps<'chooseOption'> & { hint: string; okLabel: (chosen: readonly string[]) => string }) {
  // The picks in order; with `allowRepeat` (several votes, CR 701.38d) an option can be picked more than once.
  const [chosen, setChosen] = useState<string[]>([]);
  const ok = chosen.length >= d.min && chosen.length <= d.max;
  const submit = () => {
    if (ok) answer({ kind: 'chooseOption', ids: chosen });
  };
  const usable = d.options.filter((o) => o.disabled === undefined).map((o) => o.id);
  const click = (id: string) => {
    if (!usable.includes(id)) return;
    if (d.allowRepeat) {
      gameSfx('ui.select');
      setChosen((c) => (d.max === 1 ? [id] : c.length >= d.max ? c : [...c, id]));
      return;
    }
    gameSfx(chosen.includes(id) ? 'ui.tick' : 'ui.select');
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : d.max === 1 ? [id] : c.length >= d.max ? c : [...c, id]));
  };
  const count = (id: string) => chosen.filter((x) => x === id).length;
  const players = usable.filter((id) => isPlayer(view, id));
  usePrimary(submit, ok);
  usePublishSelection({
    selectable: players,
    selected: [...new Set(chosen.filter((id) => players.includes(id)))],
    marks: Object.fromEntries([...new Set(chosen)].map((id) => [id, count(id) > 1 ? `chosen x${count(id)}` : 'chosen'])),
    click,
  });
  return (
    <>
      <p className="prompt-hint">{hint}</p>
      <div className="prompt-chips" role="group" aria-label={players.length === d.options.length ? 'Players' : 'Options'}>
        {d.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={chosen.includes(o.id) ? 'prompt-chip is-selected' : 'prompt-chip'}
            aria-pressed={chosen.includes(o.id)}
            disabled={busy || o.disabled !== undefined}
            title={o.disabled}
            data-id={o.id}
            onClick={() => click(o.id)}
          >
            {isPlayer(view, o.id) ? playerLabel(view, o.id) : o.label}
            {d.allowRepeat && count(o.id) > 1 ? ` x${count(o.id)}` : ''}
          </button>
        ))}
      </div>
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy || !ok} onClick={submit}>
          {okLabel(chosen)}
        </button>
        {d.max > 1 && (
          <button type="button" disabled={busy || chosen.length === 0} onClick={() => setChosen([])}>
            Clear
          </button>
        )}
      </PromptActions>
    </>
  );
}

/** M12-4b: the new multiplayer choices among players (Siege protector, defending player, an opponent; CR 310.12a, 508.5a, 601.7a, 800.4g). */
export function PlayerChoicePrompt(props: PromptProps<'chooseOption'>) {
  const kind = playerChoiceKind(props.d, props.view) ?? 'players';
  const verb: Record<PlayerChoiceKind, string> = {
    siegeProtector: 'as the protector',
    defendingPlayer: 'as the defending player',
    opponentChooses: 'to make the choice',
    anOpponent: '',
    anotherOpponent: 'to make the choice',
    players: '',
  };
  const label = (chosen: readonly string[]) =>
    chosen.length === 1 ? `Choose ${playerName(props.view, chosen[0]!)}${verb[kind] ? ` ${verb[kind]}` : ''}` : chosen.length === 0 ? 'Choose a player' : 'Choose these players';
  return <OptionButtons {...props} hint={PLAYER_CHOICE_HINTS[kind]} okLabel={label} />;
}

/**
 * Votes (CR 701.38a-b; M12-3's vote node for words and players): each player in turn votes for one of the options. Drawn as its own prompt so that a vote
 * reads as a vote; M12-3 may replace this component in OPTION_PROMPTS.
 */
export function VotePrompt(props: PromptProps<'chooseOption'>) {
  const words = !optionsArePlayers(props.d, props.view);
  const { min, max } = props.d;
  const votes = max > 1 ? ` You have ${min === max ? max : `${min} to ${max}`} votes; they can be for the same choice or different ones (CR 701.38d).` : '';
  const labelOf = (id: string) => props.d.options.find((o) => o.id === id)?.label ?? playerName(props.view, id);
  return (
    <OptionButtons
      {...props}
      hint={`Vote for ${words ? 'one of these' : 'a player'}: every player votes in turn order, starting with the player the text names (CR 701.38a${words ? ', 701.38b' : ''}).${votes}`}
      okLabel={(chosen) => (chosen.length === 0 ? 'Vote' : `Vote for ${chosen.map(labelOf).join(' and ')}`)}
    />
  );
}

/** One entry of the `chooseOption` prompt table: the decisions it draws and how. */
export interface OptionPromptEntry {
  id: string;
  matches: (d: ChooseOptionDecision, view: GameView) => boolean;
  Prompt: ComponentType<PromptProps<'chooseOption'>>;
}

/**
 * The extension point for `chooseOption` decisions that need their own prompt (votes from M12-3, CR 701.38; the multiplayer player choices). The first
 * entry that matches draws the decision; no match: the generic option list. Exported (and mutable) so a later package adds an entry in one line.
 */
export const OPTION_PROMPTS: OptionPromptEntry[] = [
  { id: 'vote', matches: (d) => has(d, 'CR 701.38'), Prompt: VotePrompt },
  { id: 'multiplayerPlayers', matches: (d, view) => playerChoiceKind(d, view) !== null, Prompt: PlayerChoicePrompt },
];

/** The entry that draws `d`, or undefined for the generic list. */
export function optionPromptFor(d: ChooseOptionDecision, view: GameView): OptionPromptEntry | undefined {
  return OPTION_PROMPTS.find((e) => e.matches(d, view));
}
