/**
 * RPL-4 (replays design 11; roadmap "In-game bug reports"): "Report a bug". The game screen opens it from the game menu (a game being played and a
 * replay being watched), from the end screen, and from a replay that plays differently on the build it was made on (design 5.2: an engine bug offers a
 * report). The player writes what happened and what they expected, may name the card it is about (the names offered are the cards of the view on
 * screen), sees what the report holds, and saves it as a file. Nothing is sent anywhere: the player chooses whom to give the file to. A game on the
 * DigiDice server (M13-12, `send`) can also send it to the server's bug inbox, where it is kept with the server's record of the game.
 *
 * The moment is taken when the dialog opens (capture.ts); a replay being watched is paused there. The game's file stays in the capture's closure and
 * is made into the report only when the player saves (FXH: the dialog's props and state hold no game file, only the view the screen already shows).
 *
 * The dialog is modal for the keyboard as well: while it is open the game's own keys (Space passes priority, Z undoes, H holds priority, a replay's
 * transport keys) never fire. They listen on the window, so the guard is a window listener installed when this module loads, before any of them: Esc
 * closes the dialog, Tab stays inside it, keys typed into its text fields are theirs, and every other key does only what it does to the focused
 * control (a button's Space or Enter).
 */
import type { GameView } from '@openmtg/engine';
import { useEffect, useId, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import type { GameConnection } from '../connection/GameConnection';
import { replayControllerOf } from '../replays/viewer/controllerOf';
import { settingsStore, type SettingsStore } from '../settings/settings';
import { captureReport, type ReportCapture, type ReportContext } from './capture';
import { saveBytes } from './download';
import { pageEnvironment } from './environment';
import { bugReportFileName, CARD_MAX, encodeBugReport, WORDS_MAX, type ReportEnvironment, type ReporterWords } from './report';
import './bugs.css';

export interface BugReportDialogProps {
  /** The game screen's sealed connection (game/sealed.ts): what the report carries is taken from it as the dialog opens. */
  connection: GameConnection;
  /** The view on screen: the moment's turn, and the card names offered. */
  view: GameView;
  /** The online game's side, when online; the clock and build for tests. */
  context?: ReportContext;
  settings?: SettingsStore;
  /** Saves the file (default: a download, bugs/download.ts). False when this browser cannot. */
  save?: (fileName: string, bytes: Uint8Array) => boolean;
  /** The environment of the report (default: this page's, environment.ts). */
  environment?: () => ReportEnvironment;
  /**
   * M13-12 (hosted design 4.8): a game on the DigiDice server can also send the report to the server's bug inbox (hosted/report.ts), with the view as it
   * was when the dialog opened. Resolves null when the server took it, else what went wrong. Absent: the report is saved as a file only.
   */
  send?: (said: ReporterWords, env: ReportEnvironment, view: GameView) => Promise<string | null>;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The dialog open now (there is at most one): its element and how it closes. */
let open: { el: HTMLElement; close: () => void } | null = null;

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes((t as HTMLInputElement).type);
}

/** The modal key guard (see the file comment). */
function guardKeys(e: KeyboardEvent): void {
  const d = open;
  if (!d) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    d.close();
    return;
  }
  if (e.key === 'Tab') {
    const items = [...d.el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    const inside = at instanceof Node && d.el.contains(at);
    if (first && last && (!inside || (e.shiftKey ? at === first : at === last))) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
    e.stopImmediatePropagation();
    return;
  }
  if (isTextField(e.target) && e.target instanceof Node && d.el.contains(e.target)) return;
  e.stopImmediatePropagation();
}

if (typeof window !== 'undefined') window.addEventListener('keydown', guardKeys, true);

/** The card names the view shows (its definitions), for "Which card?". */
function cardNames(view: GameView): string[] {
  const names = new Set<string>();
  for (const d of Object.values(view.defs)) if (!d.id.startsWith('__') && d.name.trim() !== '') names.add(d.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** "turn 4, after action 14", "turn 7, action 83 of 214", "turn 3, frame 12 of 40", ... */
function momentText(c: ReportCapture, view: GameView): string {
  const turn = view.turn.number <= 0 ? 'the start of the game' : `turn ${view.turn.number}`;
  if (c.holds === 'view' || c.length === 0) return c.holds === 'game' ? 'the start of the game, before any action' : turn;
  if (c.holds === 'game') return `${turn}, after action ${c.at + 1}`;
  return `${turn}, ${c.kind === 'game' ? 'action' : 'frame'} ${c.at + 1} of ${c.length}`;
}

function holdsText(c: ReportCapture): string {
  switch (c.holds) {
    case 'game':
      return `The game so far, so it can be played again exactly to this moment: its decks, its shuffles and its ${c.length === 1 ? '1 action' : `${c.length} actions`}. It holds every player's cards, hidden ones too.`;
    case 'replay':
      return 'This replay as you have it, and the moment you are watching.';
    case 'recording':
      return 'What this screen was shown of the game so far, change by change, with its log. Nothing that was hidden from this screen.';
    case 'view':
      return 'What this screen shows of the game now: the view, its log and the last change. Nothing that is hidden from this screen.';
  }
}

export function BugReportDialog({ connection, view, context, settings, save = saveBytes, environment, send, onClose }: BugReportDialogProps) {
  // The moment, taken once as the dialog opens (capture.ts holds the game in a closure).
  const [capture] = useState(() => captureReport(connection, context));
  const [env] = useState(() => (environment ? environment() : pageEnvironment((settings ?? settingsStore()).get())));
  const [names] = useState(() => cardNames(view));
  const [moment] = useState(() => momentText(capture, view));
  const [words, setWords] = useState('');
  const [card, setCard] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened] = useState(view);
  const [sent, setSent] = useState(false);
  const ids = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // A replay being watched stops at the moment reported.
    replayControllerOf(connection)?.pause();
    const before = document.activeElement;
    const el = dialog.current;
    if (el) open = { el, close: () => close.current() };
    text.current?.focus();
    return () => {
      if (open?.el === el) open = null;
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [connection]);

  const describe = words.trim() !== '';
  const saveReport = async () => {
    if (busy || !describe) return;
    setBusy(true);
    setError(null);
    try {
      const made = capture.report({ words, card }, env);
      if (!made.ok) {
        setError(`The report could not be made: ${made.error.message}`);
        sfx('ui.error');
        return;
      }
      const name = bugReportFileName(new Date());
      if (!save(name, await encodeBugReport(made.value))) {
        setError('This browser cannot save files.');
        sfx('ui.error');
        return;
      }
      setSaved(name);
      sfx('ui.success');
    } catch (e) {
      setError(`The report could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      sfx('ui.error');
    } finally {
      setBusy(false);
    }
  };

  const sendReport = async () => {
    if (busy || !describe || !send || sent) return;
    setBusy(true);
    setError(null);
    try {
      const problem = await send({ words, card }, env, opened);
      if (problem !== null) {
        setError(`The report was not sent: ${problem}`);
        sfx('ui.error');
        return;
      }
      setSent(true);
      sfx('ui.success');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="bug-backdrop" />
      <div ref={dialog} className="bug-dialog" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} aria-describedby={`${ids}-intro`}>
        <h2 id={`${ids}-title`}>Report a bug</h2>
        <p id={`${ids}-intro`} className="bug-intro">
          {send
            ? 'Send the report to the people who run the DigiDice server: it is kept there with the record of this game, which the server has in full. You can also save it as a file on this computer.'
            : 'Nothing is sent anywhere: the report is saved as a file on this computer. Send it yourself to whoever looks after OpenMTG for you.'}
        </p>
        <p className="bug-moment">The moment reported: {moment}.</p>
        <label className="bug-field">
          <span>What happened, and what did you expect?</span>
          <textarea ref={text} value={words} maxLength={WORDS_MAX} rows={5} required onChange={(e) => setWords(e.currentTarget.value)} />
        </label>
        <label className="bug-field">
          <span>Which card? (optional)</span>
          <input type="text" value={card} maxLength={CARD_MAX} list={`${ids}-cards`} autoComplete="off" onChange={(e) => setCard(e.currentTarget.value)} />
        </label>
        <datalist id={`${ids}-cards`}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <section className="bug-holds" aria-labelledby={`${ids}-holds`}>
          <h3 id={`${ids}-holds`}>What the report holds</h3>
          <ul>
            <li>{holdsText(capture)}</li>
            <li>What you write here.</li>
            <li>This OpenMTG&apos;s version, your browser and its window size, and your display settings.</li>
            <li>
              {env.errors.length === 0 ? (
                'No errors were caught on this page.'
              ) : (
                <details>
                  <summary>{env.errors.length === 1 ? '1 error this page caught' : `${env.errors.length} errors this page caught`}</summary>
                  <ol className="bug-errors">
                    {env.errors.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          </ul>
        </section>
        {sent && (
          <p className="bug-note" role="status">
            Sent. Thank you: the people who run the server will see it with the game.
          </p>
        )}
        {saved !== null && (
          <p className="bug-note" role="status">
            Saved as {saved}.{send ? '' : ' Nothing was sent.'}
          </p>
        )}
        {error !== null && (
          <p className="bug-note bug-error" role="alert">
            {error}
          </p>
        )}
        <div className="bug-buttons">
          {send && (
            <button type="button" className="button-primary" disabled={busy || !describe || sent} onClick={() => void sendReport()} title={describe ? undefined : 'Write what happened first'}>
              {sent ? 'Sent' : busy ? 'Sending…' : 'Send report'}
            </button>
          )}
          <button
            type="button"
            className={send ? undefined : 'button-primary'}
            disabled={busy || !describe}
            onClick={() => void saveReport()}
            title={describe ? undefined : 'Write what happened first'}
          >
            {saved !== null ? 'Save again' : send ? 'Save as a file' : 'Save report'}
          </button>
          <button type="button" onClick={() => close.current()}>
            {saved !== null || sent ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </>
  );
}
