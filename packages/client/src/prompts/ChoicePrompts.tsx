/**
 * Choosing among offered things: objects (discard, sacrifice, put on the bottom, CR 701.9, 701.21, 103.5), targets (CR 601.2c, 115: only the legal targets
 * the engine offers can be clicked; players are buttons), modes and other options (CR 700.2), a number such as X (CR 107.3, 601.2b), and an order
 * (CR 603.3b). One component per decision kind.
 *
 * Sound: choosing a target locks on (card.target), picking objects and options selects (ui.select), stepping a number or an order ticks (ui.tick; the page's
 * generic sounds tick the slider); taking a choice back ticks. The submit buttons keep the page's generic confirm.
 */
import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { HIDDEN_DEF, parseManaCost, type GameView, type ManaCost, type ObjectId, type PlayerId, type TargetChoice } from '@openmtg/engine';
import { ManaCostView } from '../board/ManaSymbols';
import { gameSfx } from '../game/sound';
import { Chips } from './Chips';
import { usePrimary } from './keys';
import { isPlayer, objectName, playerName, withSelfName } from './names';
import { usePublishSelection } from './selection';
import { PromptStage, StageCard, useStageOverlap } from './stage';
import type { PromptProps } from './types';
import { PromptActions } from './PromptActions';
import { optionPromptFor } from './PlayerChoicePrompts';

/** "Choose 2", "Choose 1 to 3", "Choose up to 2". */
export function countText(min: number, max: number): string {
  if (min === max) return `Choose ${min}`;
  if (min === 0) return `Choose up to ${max}`;
  return `Choose ${min} to ${max}`;
}

/** Toggle `id` in a selection of at most `max` (with `max` 1 a click replaces the selection). */
export function toggle(list: readonly string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (max === 1) return [id];
  return list.length >= max ? [...list] : [...list, id];
}

function OkButton({ label, ok, busy, onClick }: { label: string; ok: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="button-primary" disabled={busy || !ok} onClick={onClick}>
      {label}
    </button>
  );
}

export function ChooseObjectsPrompt({ d, view, answer, busy }: PromptProps<'chooseObjects'>) {
  const [chosen, setChosen] = useState<string[]>([]);
  const ok = chosen.length >= d.min && chosen.length <= d.max;
  const submit = () => answer({ kind: 'chooseObjects', ids: chosen });
  const click = (id: string) => {
    gameSfx(chosen.includes(id) ? 'ui.tick' : 'ui.select');
    setChosen((c) => toggle(c, id, d.max));
  };
  const marks = d.ordered ? Object.fromEntries(chosen.map((id, i) => [id, String(i + 1)])) : {};
  usePrimary(submit, ok);
  usePublishSelection({ selectable: d.options, selected: chosen, marks, click });
  const library = searchedLibrary(view, d.options);
  const hand = library === null ? revealedHand(view, d.options) : null;
  const mulligan = library === null && hand === null && isMulliganBottom(view, d);
  return (
    <>
      <p className="prompt-detail">
        {countText(d.min, d.max)} ({chosen.length} chosen){d.ordered ? '; the order you click them in is the order used.' : '.'}
      </p>
      <Chips view={view} ids={d.options} selected={chosen} marks={marks} onClick={click} disabled={busy} label="Choices" />
      {library !== null && <LibrarySearchStage view={view} owner={library} options={d.options} min={d.min} max={d.max} chosen={chosen} marks={marks} busy={busy} onClick={click} />}
      {hand !== null && <RevealedHandStage view={view} owner={hand} options={d.options} min={d.min} max={d.max} chosen={chosen} marks={marks} busy={busy} onClick={click} />}
      {mulligan && <MulliganBottomStage view={view} player={d.player} options={d.options} count={d.min} chosen={chosen} busy={busy} onClick={click} />}
      <PromptActions>
        <OkButton label={mulligan ? 'Put on the bottom' : 'OK'} ok={ok} busy={busy} onClick={submit} />
        <button type="button" disabled={busy || chosen.length === 0} onClick={() => setChosen([])}>
          Clear
        </button>
      </PromptActions>
    </>
  );
}

/**
 * The library a choice searches (CR 701.23a): every option is a card in the same player's library, which the engine showed to the searcher; null otherwise
 * (discards, sacrifices, cards already looked at in other zones).
 */
export function searchedLibrary(view: GameView, options: readonly ObjectId[]): PlayerId | null {
  let owner: PlayerId | null = null;
  for (const id of options) {
    const o = view.objects[id];
    if (!o || o.zone !== 'library' || (owner !== null && o.owner !== owner)) return null;
    owner = o.owner;
  }
  return owner;
}

/** The cards a search can find, by name (then id, so equal cards keep one order): the library's own order is not part of what the search shows. */
export function searchOrder(view: GameView, options: readonly ObjectId[]): ObjectId[] {
  return [...options].sort((a, b) => objectName(view, a).localeCompare(objectName(view, b)) || (a < b ? -1 : a > b ? 1 : 0));
}

interface LibrarySearchStageProps {
  view: GameView;
  owner: PlayerId;
  options: readonly ObjectId[];
  min: number;
  max: number;
  chosen: readonly string[];
  marks: Record<string, string>;
  busy: boolean;
  onClick: (id: string) => void;
}

/**
 * Searching a library on the board's stage: the search opens by itself and shows only the cards it can find (the engine's
 * options, CR 701.23a-b), all at once, left to right. They overlap to fit with the rightmost card on top, and the card under the pointer comes up above the
 * others so it can be read. While Scryfall pictures can be on screen no picture is covered: the cards sit apart and shrink to fit instead (useStageOverlap).
 */
function LibrarySearchStage({ view, owner, options, min, max, chosen, marks, busy, onClick }: LibrarySearchStageProps) {
  const overlap = useStageOverlap();
  const cards = searchOrder(view, options);
  const size = view.zones.library[owner]?.length ?? cards.length;
  const whose = owner === view.viewer ? 'your library' : `${playerName(view, owner)}'s library`;
  const pick = (id: string) => {
    if (!busy) onClick(id);
  };
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick(id);
  };
  return (
    <PromptStage
      title={`Search ${whose}`}
      subtitle={`${countText(min, max)} (${chosen.length} chosen). ${cards.length} of the ${size} card${size === 1 ? '' : 's'} in ${whose} can be chosen.`}
    >
      <div className={`prompt-search${overlap ? '' : ' is-apart'}`} role="group" aria-label="Cards you can choose" style={{ '--search-n': cards.length } as CSSProperties}>
        {cards.map((id) => {
          const on = chosen.includes(id);
          return (
            <div
              key={id}
              className={`prompt-search-slot${on ? ' is-selected' : ''}`}
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-pressed={on}
              aria-disabled={busy}
              aria-label={objectName(view, id)}
              onClick={() => pick(id)}
              onKeyDown={(e) => key(e, id)}
            >
              <StageCard id={id}>{on && <span className="prompt-search-mark">{marks[id] ?? 'Chosen'}</span>}</StageCard>
            </div>
          );
        })}
      </div>
    </PromptStage>
  );
}

/**
 * Another player's hand a choice picks from (Thoughtseize, Duress: "you choose a nonland card from it", CR 701.20b): every option is a card in the same other
 * player's hand; null otherwise.
 */
export function revealedHand(view: GameView, options: readonly ObjectId[]): PlayerId | null {
  let owner: PlayerId | null = null;
  for (const id of options) {
    const o = view.objects[id];
    if (!o || o.zone !== 'hand' || o.owner === view.viewer || (owner !== null && o.owner !== owner)) return null;
    owner = o.owner;
  }
  return owner;
}

/**
 * Choosing from another player's revealed hand on the stage: the whole hand the viewer can see, not only the cards the choice allows, so the player reads
 * every revealed card; the ones that can't be chosen are dimmed and say so. The cards stay face up in that player's hand row afterwards (Hand.tsx).
 */
function RevealedHandStage({ view, owner, options, min, max, chosen, marks, busy, onClick }: LibrarySearchStageProps) {
  const overlap = useStageOverlap();
  const cards = (view.zones.hand[owner] ?? []).filter((id) => {
    const o = view.objects[id];
    return o !== undefined && o.defId !== HIDDEN_DEF;
  });
  const can = new Set(options);
  const pick = (id: string) => {
    if (!busy && can.has(id)) onClick(id);
  };
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick(id);
  };
  return (
    <PromptStage
      title={`${playerName(view, owner)}'s hand`}
      subtitle={`${countText(min, max)} (${chosen.length} chosen). ${options.length} of the ${cards.length} revealed card${cards.length === 1 ? '' : 's'} can be chosen.`}
    >
      <div className={`prompt-search${overlap ? '' : ' is-apart'}`} role="group" aria-label="Revealed cards" style={{ '--search-n': cards.length } as CSSProperties}>
        {cards.map((id) => {
          const on = chosen.includes(id);
          const choosable = can.has(id);
          return (
            <div
              key={id}
              className={`prompt-search-slot${on ? ' is-selected' : ''}${choosable ? '' : ' is-unchoosable'}`}
              role="button"
              tabIndex={busy || !choosable ? -1 : 0}
              aria-pressed={on}
              aria-disabled={busy || !choosable}
              aria-label={`${objectName(view, id)}${choosable ? '' : " (can't be chosen)"}`}
              onClick={() => pick(id)}
              onKeyDown={(e) => key(e, id)}
            >
              <StageCard id={id}>
                {on && <span className="prompt-search-mark">{marks[id] ?? 'Chosen'}</span>}
                {!choosable && <span className="prompt-search-note">Can't be chosen</span>}
              </StageCard>
            </div>
          );
        })}
      </div>
    </PromptStage>
  );
}

/**
 * The cards a mulligan puts on the bottom of the library (CR 103.5): a choice from the deciding player's own new hand before the first turn, cited to
 * CR 103.5, which only the mulligan asks (engine core/start.ts).
 */
export function isMulliganBottom(view: GameView, d: { player: PlayerId; options: readonly ObjectId[]; rules?: readonly string[] }): boolean {
  if (view.turn.number > 0 || d.rules?.includes('CR 103.5') !== true || d.options.length === 0) return false;
  return d.options.every((id) => {
    const o = view.objects[id];
    return o !== undefined && o.zone === 'hand' && o.owner === d.player;
  });
}

interface MulliganBottomStageProps {
  view: GameView;
  player: PlayerId;
  options: readonly ObjectId[];
  /** How many go on the bottom. */
  count: number;
  chosen: readonly string[];
  busy: boolean;
  onClick: (id: string) => void;
}

/**
 * The new hand after a mulligan, on the stage like the opening hand (SimplePrompts.tsx MulliganPrompt) and fanned the same way: a click on a card picks it
 * for the bottom of the library (CR 103.5) and drops it a little with a "Bottom" tag; a second click takes it back. With more than one, the first card
 * picked goes to the very bottom (the engine's order).
 */
function MulliganBottomStage({ view, player, options, count, chosen, busy, onClick }: MulliganBottomStageProps) {
  const overlap = useStageOverlap();
  const hand = (view.zones.hand[player] ?? []).filter((id) => options.includes(id));
  const taken = view.players.find((p) => p.id === player)?.mulligans ?? 0;
  const pick = (id: string) => {
    if (!busy) onClick(id);
  };
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick(id);
  };
  const cards = `${count} card${count === 1 ? '' : 's'}`;
  return (
    <PromptStage
      title={`Put ${cards} on the bottom`}
      subtitle={
        `Your new hand after ${taken === 1 ? 'a mulligan' : `${taken} mulligans`}: click ${count === 1 ? 'the card' : `the ${cards}`} to put on the bottom of ` +
        `your library (${chosen.length} of ${count} chosen).${count > 1 ? ' The first one you pick goes to the very bottom.' : ''}`
      }
    >
      <div className={`prompt-fan${overlap ? '' : ' is-apart'}`} role="group" aria-label="Your new hand" style={{ '--fan-n': Math.max(1, hand.length) } as CSSProperties}>
        {hand.map((id, i) => {
          const at = chosen.indexOf(id);
          const on = at >= 0;
          return (
            <div
              key={id}
              className={`prompt-fan-slot prompt-fan-pick${on ? ' is-selected' : ''}`}
              style={{ '--fan-i': i - (hand.length - 1) / 2 } as CSSProperties}
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-pressed={on}
              aria-disabled={busy}
              aria-label={`${objectName(view, id)}${on ? ': to the bottom' : ''}`}
              onClick={() => pick(id)}
              onKeyDown={(e) => key(e, id)}
            >
              <StageCard id={id}>{on && <span className="prompt-search-mark">{count > 1 ? `Bottom ${at + 1}` : 'Bottom'}</span>}</StageCard>
            </div>
          );
        })}
      </div>
    </PromptStage>
  );
}

export function ChooseTargetsPrompt({ d, view, answer, busy }: PromptProps<'chooseTargets'>) {
  const [chosen, setChosen] = useState<string[]>([]);
  const ok = chosen.length >= d.min && chosen.length <= d.max;
  const toChoice = (id: string): TargetChoice => (d.players.includes(id) && isPlayer(view, id) ? { kind: 'player', id } : { kind: 'object', id });
  const submit = () => answer({ kind: 'chooseTargets', targets: chosen.map(toChoice) });
  // A target chosen on the board, as a chip or as a player locks on (CR 601.2c); taken back, it ticks.
  const click = (id: string) => {
    gameSfx(chosen.includes(id) ? 'ui.tick' : 'card.target');
    setChosen((c) => toggle(c, id, d.max));
  };
  usePrimary(submit, ok);
  usePublishSelection({ selectable: [...d.objects, ...d.players], selected: chosen, click });
  const none = d.objects.length === 0 && d.players.length === 0;
  return (
    <>
      <p className="prompt-detail">
        {countText(d.min, d.max)}: {d.targetText}. {none ? 'Nothing can be targeted.' : 'Only legal targets can be chosen.'}
      </p>
      {d.players.length > 0 && (
        <div className="prompt-chips" role="group" aria-label="Players">
          {d.players.map((p) => (
            <button key={p} type="button" className={chosen.includes(p) ? 'prompt-chip is-selected' : 'prompt-chip'} aria-pressed={chosen.includes(p)} disabled={busy} onClick={() => click(p)}>
              {p === view.viewer ? `${playerName(view, p)} (you)` : playerName(view, p)}
            </button>
          ))}
        </div>
      )}
      {d.objects.length > 0 && <Chips view={view} ids={d.objects} selected={chosen} onClick={click} disabled={busy} label="Targets" />}
      <PromptActions>
        <OkButton label={chosen.length === 0 && d.min === 0 ? 'No targets' : 'Choose targets'} ok={ok} busy={busy} onClick={submit} />
      </PromptActions>
    </>
  );
}

/** The card a mode choice is for: the engine's prompt ends "... modes for <name>." (actions/announce.ts chooseModes). */
export function modeSource(prompt: string): string | undefined {
  return /\bmodes? for (.+)\.$/.exec(prompt)?.[1];
}

/** "Elvish Visionary: When ~ enters, draw a card." -> the source before the colon stands for "~" (CR 201.5). */
export function itemLabel(label: string): string {
  const colon = label.indexOf(': ');
  return colon > 0 ? withSelfName(label, label.slice(0, colon)) : label;
}

/**
 * Options (CR 700.2 modes and other choices). M12-4b: a decision with a prompt of its own in OPTION_PROMPTS (PlayerChoicePrompts.tsx: the multiplayer
 * choices among players, CR 310.12a, 508.5a, 601.7a, 800.4g; votes, CR 701.38) is drawn by it; every other one by the option list below, as before.
 */
export function ChooseOptionPrompt(props: PromptProps<'chooseOption'>) {
  const special = optionPromptFor(props.d, props.view);
  return special ? <special.Prompt {...props} /> : <OptionListPrompt {...props} />;
}

/**
 * The object a mode choice is for, found in the view by the name in the engine's prompt: the spell or ability on the stack first (CR 601.2a: the card is
 * already on the stack while its modes are chosen), else any visible object with that name; null when none (the plain option list is shown then).
 */
export function modeObject(view: GameView, name: string | undefined): ObjectId | null {
  if (!name) return null;
  const named = (id: ObjectId) => {
    const o = view.objects[id];
    const def = o && o.defId !== HIDDEN_DEF ? view.defs[o.defId] : undefined;
    return def !== undefined && (def.name === name || def.faces.some((f) => f.name === name) || o!.stack?.sourceName === name);
  };
  const onStack = [...view.zones.stack].reverse().find(named);
  if (onStack) return onStack;
  return Object.keys(view.objects).find(named) ?? null;
}

/** The printed line of each mode ("• Deal 2 damage ...", "+ {1} — ..."), when the card prints one per option; else null. */
export function modeLines(view: GameView, id: ObjectId, count: number): string[] | null {
  const o = view.objects[id];
  const def = o ? view.defs[o.defId] : undefined;
  if (!o || !def) return null;
  const face = def.faces[o.stack?.face ?? o.face] ?? def.faces[0];
  const lines = (face?.oracleText ?? '').split('\n').map((l) => l.trim()).filter((l) => /^[•+]/.test(l));
  return lines.length === count ? lines : null;
}

/** The additional cost printed at the start of a mode's line ("+ {1} — ...", spree; "Label {2} — ...", tiered, CR 700.2h), or null. */
export function modeCost(line: string | undefined): ManaCost | null {
  const m = line ? /^[•+]?\s*\+?\s*(?:[^{—]*?\s)?((?:\{[^}]+\})+)\s*[—–-]/.exec(line) : null;
  return m ? parseManaCost(m[1]) : null;
}

/**
 * A mode choice on the stage, as in Arena: the card once for each mode, each with that one mode written under it (and the mode's additional cost, CR
 * 700.2h), and the card's own mana cost in the subtitle. Clicking a card chooses (or un-chooses) its mode; a mode that can't be chosen is dimmed with why.
 */
function ModeStage({ view, id, d, counts, source, busy, onPick }: { view: GameView; id: ObjectId; d: PromptProps<'chooseOption'>['d']; counts: Record<string, number>; source: string | undefined; busy: boolean; onPick: (id: string) => void }) {
  const overlap = useStageOverlap();
  const o = view.objects[id];
  const def = o ? view.defs[o.defId] : undefined;
  const face = def?.faces[o?.stack?.face ?? o?.face ?? 0] ?? def?.faces[0];
  const lines = modeLines(view, id, d.options.length);
  const chosen = Object.values(counts).reduce((n, x) => n + x, 0);
  return (
    <PromptStage
      title={`Choose ${d.max === 1 ? 'a mode' : 'modes'}: ${source ?? objectName(view, id)}`}
      subtitle={
        <>
          {countText(d.min, d.max)} ({chosen} chosen).{face?.manaCost && face.manaCost.length > 0 ? <> Cost: <ManaCostView cost={face.manaCost} /></> : null}
        </>
      }
    >
      <div className={`prompt-search${overlap ? '' : ' is-apart'}`} role="group" aria-label="Modes" style={{ '--search-n': d.options.length } as CSSProperties}>
        {d.options.map((opt, i) => {
          const n = counts[opt.id] ?? 0;
          const off = busy || opt.disabled !== undefined;
          const cost = modeCost(lines?.[i]);
          const label = withSelfName(opt.label, source);
          return (
            <div
              key={opt.id}
              className={`prompt-search-slot prompt-mode-slot${n > 0 ? ' is-selected' : ''}${opt.disabled !== undefined ? ' is-unchoosable' : ''}`}
              role="button"
              tabIndex={off ? -1 : 0}
              aria-pressed={n > 0}
              aria-disabled={off}
              aria-label={label}
              title={opt.disabled}
              onClick={() => {
                if (!off) onPick(opt.id);
              }}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !off) {
                  e.preventDefault();
                  onPick(opt.id);
                }
              }}
            >
              <StageCard id={id}>
                <span className="prompt-mode-text">
                  {cost && (
                    <span className="prompt-option-cost">
                      +<ManaCostView cost={cost} />{' '}
                    </span>
                  )}
                  {label}
                  {d.allowRepeat && n > 0 ? ` x${n}` : ''}
                </span>
                {n > 0 && <span className="prompt-search-mark">Chosen</span>}
                {opt.disabled !== undefined && <span className="prompt-search-note">Not possible: {opt.disabled}</span>}
              </StageCard>
            </div>
          );
        })}
      </div>
    </PromptStage>
  );
}

function OptionListPrompt({ d, view, answer, busy }: PromptProps<'chooseOption'>) {
  const source = modeSource(d.prompt);
  const modeCard = source !== undefined ? modeObject(view, source) : null;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const ids = d.options.flatMap((o) => Array<string>(counts[o.id] ?? 0).fill(o.id));
  const ok = ids.length >= d.min && ids.length <= d.max;
  const submit = () => answer({ kind: 'chooseOption', ids });
  const change = (id: string, delta: number) => {
    gameSfx(delta > 0 && (d.allowRepeat || (counts[id] ?? 0) === 0) ? 'ui.select' : 'ui.tick');
    setCounts((c) => {
      const total = Object.values(c).reduce((n, x) => n + x, 0);
      const now = c[id] ?? 0;
      if (delta > 0 && !d.allowRepeat) {
        if (now > 0) return { ...c, [id]: 0 };
        if (d.max === 1) return { [id]: 1 };
      }
      if (delta > 0 && total >= d.max) return c;
      return { ...c, [id]: Math.max(0, now + delta) };
    });
  };
  usePrimary(submit, ok);
  return (
    <>
      <p className="prompt-detail">
        {countText(d.min, d.max)}{d.allowRepeat ? ' (an option may be chosen more than once)' : ''}.
      </p>
      {modeCard !== null && <ModeStage view={view} id={modeCard} d={d} counts={counts} source={source} busy={busy} onPick={(id) => change(id, 1)} />}
      <div className="prompt-options" role="group" aria-label="Options">
        {d.options.map((o) => {
          const n = counts[o.id] ?? 0;
          const label = withSelfName(o.label, source);
          return (
            <div key={o.id} className="prompt-option">
              <button
                type="button"
                className={n > 0 ? 'prompt-chip is-selected' : 'prompt-chip'}
                aria-pressed={n > 0}
                disabled={busy || o.disabled !== undefined}
                title={o.disabled}
                onClick={() => change(o.id, 1)}
              >
                {label}
                {d.allowRepeat && n > 0 ? ` x${n}` : ''}
              </button>
              {d.allowRepeat && n > 0 && (
                <button type="button" className="prompt-button-small" aria-label={`One less: ${label}`} disabled={busy} onClick={() => change(o.id, -1)}>
                  -
                </button>
              )}
              {o.disabled !== undefined && <span className="prompt-disabled-reason">Not possible: {o.disabled}</span>}
            </div>
          );
        })}
      </div>
      <PromptActions>
        <OkButton label="OK" ok={ok} busy={busy} onClick={submit} />
      </PromptActions>
    </>
  );
}

export function ChooseNumberPrompt({ d, answer, busy }: PromptProps<'chooseNumber'>) {
  const [n, setN] = useState(d.min);
  const ok = Number.isInteger(n) && n >= d.min && n <= d.max;
  const submit = () => answer({ kind: 'chooseNumber', n });
  const clamp = (x: number) => Math.min(d.max, Math.max(d.min, Math.round(x)));
  const step = (x: number) => {
    gameSfx('ui.tick');
    setN(x);
  };
  usePrimary(submit, ok);
  return (
    <>
      <div className="prompt-number">
        <button type="button" className="prompt-button-small" aria-label="Decrease" disabled={busy || n <= d.min} onClick={() => step(clamp(n - 1))}>
          -
        </button>
        <input
          type="number"
          aria-label="Number"
          min={d.min}
          max={d.max}
          step={1}
          value={Number.isNaN(n) ? '' : n}
          onChange={(e) => setN(e.target.value === '' ? NaN : Number(e.target.value))}
        />
        <button type="button" className="prompt-button-small" aria-label="Increase" disabled={busy || n >= d.max} onClick={() => step(clamp(n + 1))}>
          +
        </button>
        {d.max > d.min && d.max - d.min <= 100 && (
          <input type="range" aria-label="Number slider" min={d.min} max={d.max} step={1} value={ok ? n : d.min} onChange={(e) => setN(Number(e.target.value))} />
        )}
        <span className="prompt-hint">
          {d.min} to {d.max}
        </span>
      </div>
      <PromptActions>
        <OkButton label={`Choose ${ok ? n : ''}`.trim()} ok={ok} busy={busy} onClick={submit} />
      </PromptActions>
    </>
  );
}

export function OrderPrompt({ d, answer, busy }: PromptProps<'order'>) {
  const [ids, setIds] = useState(() => d.items.map((i) => i.id));
  const label = (id: string) => itemLabel(d.items.find((i) => i.id === id)?.label ?? id);
  const move = (i: number, delta: number) => {
    gameSfx('ui.tick');
    setIds((list) => {
      const j = i + delta;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  const submit = () => answer({ kind: 'order', ids });
  usePrimary(submit);
  return (
    <>
      <ol className="prompt-order" aria-label="Order">
        {ids.map((id, i) => (
          <li key={id}>
            {/* Explicit positions: the list items are flex rows, which drop the <ol> numbers. What first and last mean is in the engine's prompt. */}
            <span className="prompt-order-pos">{i + 1}.</span>
            <span className="prompt-order-label">{label(id)}</span>
            <button type="button" className="prompt-button-small" aria-label={`Move up: ${label(id)}`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
              Up
            </button>
            <button type="button" className="prompt-button-small" aria-label={`Move down: ${label(id)}`} disabled={busy || i === ids.length - 1} onClick={() => move(i, 1)}>
              Down
            </button>
          </li>
        ))}
      </ol>
      <PromptActions>
        <OkButton label="OK" ok busy={busy} onClick={submit} />
      </PromptActions>
    </>
  );
}
