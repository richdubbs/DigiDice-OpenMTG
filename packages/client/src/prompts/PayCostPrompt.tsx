/**
 * Paying a cost (CR 601.2g-h, 602.2b). Auto pay is the default (the engine's solver keeps flexible sources untapped); "Pay by hand" lists the mana abilities
 * the engine offers (CR 605.3a): click sources here or on the board, pick a color where a source can make several (it starts with a color the cost still
 * needs), and tick the Phyrexian symbols to pay with 2 life each (CR 107.4f, 119.4). Mana already in the pool is spent as well (CR 601.2h).
 * Auto pay may pay Phyrexian symbols with life: the prompt says so, and Space does not auto pay such a cost.
 */
import { useState } from 'react';
import type { ManaType } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { ManaCost } from '../cards';
import { usePrimary } from './keys';
import { MANA_NAMES, numberDuplicates, playerName } from './names';
import { costSymbols, manualAnswer, neededColors, phyrexianIndices, sourceKey, togglePicked, type PickedSource } from './payCost';
import { usePublishSelection } from './selection';
import type { PromptProps } from './types';
import { PromptActions } from './PromptActions';

/** A cost as our own lettered circles (C2's mana glyphs, one look on every screen). */
export function ManaSymbols({ text }: { text: string }) {
  return <ManaCost cost={text} />;
}

export function PayCostPrompt({ d, view, answer, busy }: PromptProps<'payCost'>) {
  const [manual, setManual] = useState(!d.autoPayable);
  const [picked, setPicked] = useState<PickedSource[]>([]);
  const [life, setLife] = useState<number[]>([]);
  const symbols = costSymbols(d.costText);
  const phyrexian = phyrexianIndices(d.costText);
  const pool = view.players.find((p) => p.id === d.player)?.manaPool ?? [];
  const produced = (p: PickedSource): ManaType | undefined => p.color ?? d.manaSources.find((s) => sourceKey(s) === sourceKey(p))?.produces[0];
  const chosen = picked.flatMap((p) => {
    const c = produced(p);
    return c ? [c] : [];
  });
  // The colors still needed: the cost without the symbols paid with life, minus the pool and the sources picked so far.
  const needed = neededColors(symbols.filter((_, i) => !life.includes(i)).join(''), chosen.map((color) => ({ color })), pool);
  const auto = () => answer({ kind: 'payCost', auto: true });
  const payManual = () => answer(manualAnswer(picked, life));
  // A source picked or put back, here or on the board, selects (ui.select).
  const toggle = (src: (typeof d.manaSources)[number]) => {
    gameSfx('ui.select');
    setPicked((list) => togglePicked(list, src, needed));
  };
  const clickObject = (id: string) => {
    const src = d.manaSources.find((s) => s.objectId === id);
    if (!src) return;
    const already = picked.find((p) => p.objectId === id);
    if (already) {
      gameSfx('ui.select');
      setPicked((list) => list.filter((p) => p.objectId !== id));
    } else toggle(src);
  };
  const setColor = (key: string, color: ManaType) => setPicked((list) => list.map((p) => (sourceKey(p) === key ? { ...p, color } : p)));
  // Space never auto pays a cost with Phyrexian symbols: Auto pay may spend life there (CR 107.4f, 119.4), which the player should choose with a click.
  usePrimary(manual ? payManual : d.autoPayable && phyrexian.length === 0 ? auto : null);
  usePublishSelection(manual ? { selectable: [...new Set(d.manaSources.map((s) => s.objectId))], selected: picked.map((p) => p.objectId), click: clickObject } : null);
  const labels = numberDuplicates(d.manaSources.map((s) => s.label));
  return (
    <>
      <p className="prompt-detail">
        Cost: <ManaSymbols text={d.costText} />
        {d.forPlayer && d.forPlayer !== d.player ? ` (for ${playerName(view, d.forPlayer)})` : ''}
        {pool.length > 0 ? ` Mana in your pool: ${pool.map((u) => `{${u.type}}`).join('')}.` : ''}
      </p>
      {!d.autoPayable && <p className="prompt-detail">No automatic payment was found: choose sources by hand{d.cancellable ? ' or cancel' : ''}.</p>}
      {d.autoPayable && !manual && phyrexian.length > 0 && (
        <p className="prompt-warning" role="status">
          Auto pay may pay Phyrexian symbols with 2 life each instead of mana (CR 107.4f, 119.4). To decide yourself, choose Pay by hand.
        </p>
      )}
      {manual && (
        <div className="prompt-pay">
          {d.manaSources.length === 0 && <p className="prompt-detail">No mana abilities can be activated.</p>}
          <ul className="prompt-sources" aria-label="Mana sources">
            {d.manaSources.map((s, i) => {
              const key = sourceKey(s);
              const p = picked.find((x) => sourceKey(x) === key);
              return (
                <li key={key}>
                  <button type="button" className={p ? 'prompt-chip is-selected' : 'prompt-chip'} aria-pressed={p !== undefined} disabled={busy} onClick={() => toggle(s)}>
                    {labels[i]}
                  </button>
                  {p && s.produces.length > 1 && (
                    <select aria-label={`Color from ${labels[i]}`} value={p.color ?? s.produces[0]} onChange={(e) => setColor(key, e.target.value as ManaType)}>
                      {s.produces.map((c) => (
                        <option key={c} value={c}>
                          {MANA_NAMES[c]}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="prompt-hint">
            Chosen: {chosen.length ? chosen.map((c) => `{${c}}`).join('') : 'nothing'}
            {life.length ? ` and ${2 * life.length} life` : ''} for {d.costText}.
          </p>
          {phyrexian.length > 0 && (
            <div className="prompt-phyrexian" role="group" aria-label="Phyrexian mana">
              {phyrexian.map((i) => (
                <label key={i}>
                  <input type="checkbox" checked={life.includes(i)} onChange={(e) => setLife((l) => (e.target.checked ? [...l, i] : l.filter((x) => x !== i)))} />
                  Pay {symbols[i]} (symbol {i + 1}) with 2 life
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <PromptActions>
        {d.autoPayable && (
          <button type="button" className={manual ? undefined : 'button-primary'} disabled={busy} onClick={auto}>
            Auto pay
          </button>
        )}
        {manual ? (
          <button type="button" className="button-primary" disabled={busy} onClick={payManual}>
            Pay with chosen sources
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setManual(true)}>
            Pay by hand
          </button>
        )}
      </PromptActions>
    </>
  );
}
