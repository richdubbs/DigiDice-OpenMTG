/**
 * The game (docs/design/m8-client.md screens 6-8): the top bar (branding slot 3), the board (C4) with the prompt (C5) below it through the slots of
 * slots.ts, the hot-seat pass cover, undo (hot-seat), concede and the game-over panel (branding slot 7). It renders only the connection's view and
 * sends only actions (GameConnection), so an online game (milestone 9) needs no change here; Rematch comes from the route, never from the connection's
 * type.
 *
 * The screen owns the composition: the prompt publishes what may be clicked on the board (interaction.ts) and the board reports clicks and stop toggles
 * back; the prompt bar (or the game-over panel) is handed to the board to draw below the zones.
 *
 * Hot-seat (docs/design/m8-client.md "Data flow"): while `handoff()` names a player, a full-screen cover hides everything; the board, the prompt and
 * the turn are not rendered at all until that player clicks through. Only Concede (CR 104.3a) and Leave stay reachable, inside the cover.
 *
 * Hidden information (audit 2026-10-12 m5, CR 400.2): everything below the screen holds only the sealed form of the connection (sealed.ts): no route, prop
 * or state reaches the game session, so the React tree holds nothing of the game but the shown player's view.
 *
 * While a game is in progress a reload, tab close or browser Back (navigation is state-based, so Back leaves the app) asks first (beforeunload): a
 * hot-seat game is not saved and cannot be resumed.
 *
 * Online (milestone 9): the connection is a RemoteConnection and the route brings the game's `online` link: Leave (and New game or Home after game over)
 * leaves the online game, so the other side is told (a bye) and the local server closes the UDP link; the online panel (OnlineGamePanel) sits above the
 * prompt. An online game survives a reload at the server: the Host and Join screens offer to return to it.
 *
 * M12-5b (docs/design/m12-multiplayer.md 6): in a 3-4 player online game a guest's Leave concedes and the game goes on for the others
 * (GameBar says so); the host's first Leave concedes and stays on this screen as a spectator while its server keeps running the game for the others
 * (`spectating`; the dialog says so), and a second Leave stops the game for everyone (no result) and goes home. The end screen is M12-4b's GameOver.
 *
 * Sound (docs/design/sound.md): the table's ambience plays while the screen is open, the game sounds are rendered ahead as it opens, a fresh game starts
 * with its "grid powers up" once the table first appears (after a hot-seat cover too), and a change shown without animation still sounds, condensed
 * (board/fx/sounds.ts `unanimatedCues`; the board's animator sounds the animated ones).
 *
 * Hosted (milestone 13, docs/design/m13-hosted-server.md 12): a game on the DigiDice server brings its link (the route's `hosted`): the hosted panel
 * (hosted/game/HostedGamePanel.tsx) sits above the prompt with the clocks, this player's rope beside the prompt's buttons, the server's notices, chat, the
 * approval of other players' adjustments by hand and, after the end, the result with its placements. Leave (and New game or Home after the game) leaves the
 * table: a game that is not over is conceded (CR 104.3a) first, so the others see why it ended. The game runs on the server: no undo, no rematch.
 * M13-12: its replay is a recording of what this player was shown (hosted/replay.ts), and Report a bug can send the report to the server (hosted/report.ts).
 *
 * RPL-2 (replays design 8, 9): a replay (`connection.kind === 'replay'`, connection/ReplayConnection.ts) is watched on this same screen, board, pacer
 * and animator. The prompt's place holds the replay's read-only prompt and, on the table where the action buttons go, the replay bar (replays/viewer);
 * there is no undo, no concede and no hot-seat cover, Leave goes back at once (Esc too), and leaving the page does not ask. The replay's speed sets the
 * animator's time base on top of the player's Animation speed (replays/viewer/pacing.ts): above 4x, or with animations off, every change is shown at
 * once, and the game's sounds are muted there by default. The replay's clock waits for this screen's pacer to show each change. A replay of another
 * engine build is checked before the table is drawn (design 5.3), and one that cannot be watched here says so in the table's place.
 *
 * RPL-4 (replays design 11): "Report a bug" in the game menu (a game being played or a replay being watched), on the end screen, and in a replay's rail
 * when the replay plays differently on the very build it was made on (design 5.2). It opens the bug report dialog (bugs/BugReportDialog.tsx) over the
 * screen, which takes what the report carries from the sealed connection as it opens.
 */
import type { GameView, PlayerId } from '@openmtg/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useNav } from '../app/nav';
import { usePrefetchPictures } from '../cards';
import { BRAND, type Brand } from '../branding/brand';
import type { GameConnection } from '../connection/GameConnection';
import { useGameView, useHandoff, useLegalActions } from '../connection/useGame';
import { devSlowMo } from '../board/fx/devSlowMo';
import { planBatch } from '../board/fx/plan';
import { acceleratedBudgetMs } from '../board/fx/stackPace';
import { unanimatedCues } from '../board/fx/sounds';
import type { PlayerSleeves } from '../board/sleeves';
import { soundsOf } from '../audio/engine';
import { soundEngine } from '../audio/sfx';
import { BugReportDialog } from '../bugs/BugReportDialog';
import { replayOffersReport } from '../bugs/capture';
import { PacedConnection } from '../connection/PacedConnection';
import { animationMs, settingsStore, type AnimationSpeed, type SettingsStore } from '../settings/settings';
import { useSettings } from '../settings/useSettings';
import type { OnlineStatus } from '@openmtg/server/online';
import type { OnlineLink } from '../online/OnlineLink';
import { OnlineGamePanel } from '../online/OnlineGamePanel';
import type { ReporterWords, ReportEnvironment } from '../bugs/report';
import type { HostedLink } from '../hosted/HostedLink';
import { sendHostedBugReport } from '../hosted/report';
import { HostedGamePanel } from '../hosted/game/HostedGamePanel';
import { isTable } from '../online/table';
import { replayControllerOf } from '../replays/viewer/controllerOf';
import { animatorBase } from '../replays/viewer/pacing';
import { ReplayCover, ReplayPrompt } from '../replays/viewer/ReplayPrompt';
import { GameBar } from './GameBar';
import { GameOver } from './GameOver';
import { PromptSelectionProvider, SelectionStore, useBoardInteraction } from './interaction';
import { playerName } from './labels';
import { PassCover } from './PassCover';
import { RevealNotice } from './RevealNotice';
import { sealConnection } from './sealed';
import { gameSfx, playCues, quietGameSounds, setGameSoundsMuted, soundClock } from './sound';
import { DEFAULT_SLOTS, type GameSlots } from './slots';
import './game.css';

export interface GameScreenProps {
  connection: GameConnection;
  /** Starts the same game again on a fresh connection (the game route's `rematch`); without it there is no Rematch button. */
  rematch?: () => GameConnection;
  /** The board and prompt components (C4, C5). */
  slots?: GameSlots;
  /** How long the pass cover's button stays disabled (ms), so a key held by the previous player cannot click through it. */
  coverDelayMs?: number;
  brand?: Brand;
  settings?: SettingsStore;
  /** Milestone 9: the online game's link (the game route's `online`): Leave ends the online game; the online panel shows above the prompt. */
  online?: OnlineLink;
  /** Milestone 13: the link of a game on the DigiDice server (the game route's `hosted`): Leave concedes and leaves the table; the hosted panel shows above the prompt. */
  hosted?: HostedLink;
  /** Each player's deck sleeve (the game route's `sleeves`), kept for a rematch. */
  sleeves?: PlayerSleeves;
}

/** A per-connection key, so a rematch (a new connection on the same route) starts with a fresh screen state. */
const keys = new WeakMap<GameConnection, number>();
let nextKey = 1;
function keyOf(c: GameConnection): number {
  let k = keys.get(c);
  if (k === undefined) keys.set(c, (k = nextKey++));
  return k;
}

export function GameScreen(props: GameScreenProps) {
  // FXH (audit m5, CR 400.2): the board, the prompt and the screen's own state get only the sealed connection (sealed.ts), never a session behind it.
  const connection = sealConnection(props.connection);
  return <GameTable key={keyOf(connection)} {...props} connection={connection} />;
}

const noStatus = () => null;
const NO_ONLINE: OnlineStatus = { role: 'none', phase: 'idle', warnings: [] };
const noOnlineStatus = () => NO_ONLINE;
const noSubscribe = () => () => {};
/** How long a replay's jump keeps the game's sounds back (ms): shorter than the shortest pause before the next change that is heard (100 ms at 4x). */
const JUMP_QUIET_MS = 60;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Settings "Animation speed" as a time scale for the board's animations. */
function animationScale(speed: AnimationSpeed): number {
  return speed === 'fast' ? 0.6 : speed === 'slow' ? 1.7 : 1;
}

/** Games whose start was heard (a screen that opens again on the same game, back from Settings, stays quiet). */
const started = new WeakSet<GameConnection>();

/** Web Audio exists: only then is rendering the sounds ahead worth it (jsdom tests and old browsers stay silent anyway). */
function hasWebAudio(): boolean {
  return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function GameTable({ connection: source, rematch, slots = DEFAULT_SLOTS, coverDelayMs = 600, brand = BRAND, settings = settingsStore(), online, hosted, sleeves }: GameScreenProps) {
  const nav = useNav();
  // Online: leaving the screen for good leaves the game at the local server (the other side gets a bye) and closes the page's socket. The server
  // concedes a running game for this player first (CL4, CR 104.3a), so the other side sees that it won and why.
  const leaveTo = (route?: Parameters<typeof nav.reset>[0]) => {
    if (online) void online.leave().finally(() => online.close());
    // Hosted: the server concedes a running game for this player (CR 104.3a) and frees the seat; the socket closes once it has answered (or after a short wait).
    if (hosted) void hosted.leave().finally(() => hosted.close());
    nav.reset(route);
  };
  // M12-5b: the host of a running 3-4 player game leaves the game but not the table: its server keeps running the game for the others.
  const onlineStatus = useSyncExternalStore(online?.subscribe ?? noSubscribe, online?.status ?? noOnlineStatus);
  const { animationSpeed, showScryfallImages } = useSettings(settings);
  // RPL-2: a replay's controller (play, seek, speed, perspective), found by its connection (the route's, sealed or not).
  const replay = useMemo(() => (source.kind === 'replay' ? replayControllerOf(source) : null), [source]);
  // Only what this screen needs of the replay's state, as plain values: the board is not drawn again whenever the replay's timeline grows.
  const replaySpeed = useSyncExternalStore(replay?.subscribe ?? noSubscribe, () => replay?.state().speed ?? 1);
  const muted = useSyncExternalStore(replay?.subscribe ?? noSubscribe, () => replay?.state().muted ?? false);
  const replayBadge = useSyncExternalStore(replay?.subscribe ?? noSubscribe, () => replay?.state().badge ?? null);
  const replayJumps = useSyncExternalStore(replay?.subscribe ?? noSubscribe, () => replay?.state().jumps ?? 0);
  // ui/arena: the whole screen reads the paced connection, which shows each change after the board has animated it (MTG Arena's pace). Animations off
  // (Settings) or a player who prefers reduced motion: every change shows at once. RPL-2: a replay's speed divides the time base, and above 4x every
  // change shows at once too (condensed, replays design 8).
  const settingScale = animationSpeed === 'off' || prefersReducedMotion() ? null : animationScale(animationSpeed);
  const base = replay ? animatorBase(replaySpeed, settingScale) : settingScale;
  const timeScale = base ?? animationScale(animationSpeed);
  const animate = useRef(true);
  animate.current = base !== null;
  const speed = useRef(timeScale);
  speed.current = timeScale;
  // A change shown without animation sounds condensed, once per change (its seq).
  const sounded = useRef(-1);
  const [connection] = useState(
    () =>
      new PacedConnection(source, {
        enabled: () => animate.current,
        // Stack acceleration (board/fx/stackPace.ts): the resolutions of a pile above 5 get their (shorter) time on top of the usual 6 s.
        deadlineMs: (batch, from, to) => (6000 + acceleratedBudgetMs(planBatch(batch.events, from, to).a, from.zones.stack.length)) * speed.current * devSlowMo(),
        unanimated: (batch, from, to) => {
          if (batch.seq === sounded.current) return;
          sounded.current = batch.seq;
          playCues(unanimatedCues(batch.events, from, to, soundClock.since('game.start')));
        },
      }),
  );
  const stale = useSyncExternalStore(connection.subscribe, connection.stale);
  const view = useGameView(connection);
  // The pictures of the cards in play are read before the board draws them again in another zone (cards/prefetch.ts).
  usePrefetchPictures(view.defs);
  const legalActions = useLegalActions(connection);
  const handoff = useHandoff(connection);
  const canUndo = useSyncExternalStore(connection.subscribe, connection.canUndo);
  const status = useSyncExternalStore(connection.subscribe, connection.status ?? noStatus);
  const [selection] = useState(() => new SelectionStore());
  const prompted = useBoardInteraction(connection, selection);
  // A replay takes no stop toggles from the board's phase bar: nothing is played.
  const interaction = useMemo(() => (replay ? { ...prompted, onSetStops: () => {} } : prompted), [replay, prompted]);
  const promptSlot = useRef<HTMLDivElement>(null);
  const hotSeat = connection.kind === 'local';
  const over = view.result !== null;

  // RPL-2: the replay's clock waits for this screen's pacer to show each change; it pauses when the screen closes (Settings, Leave).
  useEffect(() => {
    if (!replay) return;
    const detach = replay.attachPacer(connection);
    return () => {
      replay.pause();
      detach();
    };
  }, [replay, connection]);
  // RPL-2: the game's sounds are muted at a replay's condensed speeds (by default, replays design 8).
  useEffect(() => {
    if (!replay) return;
    setGameSoundsMuted(muted);
    return () => setGameSoundsMuted(false);
  }, [replay, muted]);
  // RPL-2 (replays design 8): a jump is shown without sound. This layout effect runs in the commit that draws the jump, before the board's own effects
  // (the result screen sounds when a view with a result first appears).
  useLayoutEffect(() => {
    if (replay && replayJumps > 0) quietGameSounds(JUMP_QUIET_MS);
  }, [replay, replayJumps]);
  // RPL-2: leaving a replay goes back to where it was opened (the replay library, the end screen).
  const leaveReplay = useCallback(() => nav.back(), [nav]);
  // RPL-4: the bug report dialog, over the whole screen while it is open.
  const [reporting, setReporting] = useState(false);
  const reportBug = useCallback(() => setReporting(true), []);

  // The table hums while the screen is open; the game's sounds are rendered ahead, one per idle moment, so the first spell does not wait for its sound.
  useEffect(() => {
    let release = () => {};
    try {
      const engine = soundEngine();
      release = engine.holdAmbience();
      if (hasWebAudio()) engine.prerender(soundsOf('game'));
    } catch (e) {
      console.error('[GameScreen] sound', e);
    }
    return () => release();
  }, []);

  // A fresh game (before its first turn has gone by, CR 103) starts with its sound once its table first appears: after the pass cover in hot-seat. The
  // first turn's banner gives way to it (board/fx/sounds.ts bannerSound).
  const fresh = view.turn.number <= 1 && view.result === null;
  useEffect(() => {
    if (replay || handoff !== null || !fresh || started.has(source)) return;
    started.add(source);
    gameSfx('game.start');
  }, [replay, handoff, fresh, source]);

  const undo = useCallback(() => {
    if (connection.canUndo()) connection.undo();
  }, [connection]);

  // Z = undo in hot-seat (docs/design/m8-client.md "Visual design"); Space and Esc belong to the prompts (C5).
  useEffect(() => {
    if (!hotSeat) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || connection.handoff() !== null) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connection, hotSeat, undo]);

  // Leaving the page (reload, tab close, browser Back) asks first while the game is in progress (a replay loses nothing).
  useEffect(() => {
    if (over || replay) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [over, replay]);

  // While the board still shows the state before the last change (the first half of its animation), the prompt shows the decision before it: it takes no
  // clicks until the new state is on screen (the paced connection also refuses a stale action, CR 117.3).
  useEffect(() => {
    const el = promptSlot.current;
    if (!el) return;
    // A replay's prompt takes no action: its perspective picker and sound toggle stay usable while the board animates.
    if (stale && !replay) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [stale, replay]);

  // After the pass cover the keyboard starts at the decision (the game-over panel focuses its result itself).
  const lastHandoff = useRef(handoff);
  useEffect(() => {
    if (lastHandoff.current !== null && handoff === null && !over) promptSlot.current?.focus();
    lastHandoff.current = handoff;
  }, [handoff, over]);

  // CR 104.3a: any player may concede at any time: the players who sit at this screen (both in hot-seat, the human against the computer; online only
  // the local player).
  const seated = connection.seated?.() ?? (view.viewer !== null ? [view.viewer] : []);
  const concedable: PlayerId[] = view.players.filter((p) => seated.includes(p.id) && !p.hasLost && !p.conceded).map((p) => p.id);
  const concede = (player: PlayerId) => {
    void connection.act({ type: 'concede', player }).then((r) => {
      if (!r.ok) console.error('[GameScreen] concede rejected', r.error);
    });
  };

  // M12-5b: Leave in a 3-4 player online game (m12 design 6).
  const table = !!online && isTable(onlineStatus);
  const hostKeepsServing = table && onlineStatus.role === 'host' && onlineStatus.phase === 'playing' && !over;
  const spectating = table && onlineStatus.phase === 'spectating' && !over;
  const out = concedable.length === 0;
  // With only one other player still in the game, the host's concession ends it (CR 104.2a): the result shows here, and Leave then closes the game.
  const lastTwo = view.players.filter((p) => !p.hasLost).length <= 2;
  const leaveConfirm = hostKeepsServing && !out && lastTwo
    ? {
      text: 'Leave this game? Leaving concedes it: you lose, and the last other player wins (CR 104.3a). The result shows here; leave again to close the game.',
      button: 'Concede',
    }
    : hostKeepsServing
    ? {
      text: out
        ? 'Leave this game? You are out of it already. Your OpenMTG keeps running the game for the others: keep it open while they play, and watch the table. Leave again to stop it, which ends the game for everyone without a result.'
        : 'Leave this game? You concede: you lose and leave the game (CR 104.3a, 800.4a). Your OpenMTG keeps running the game for the others: keep it open while they play, and watch the table. Leave again to stop it, which ends the game for everyone without a result.',
      button: out ? 'Leave and keep serving' : 'Concede and keep serving',
    }
    : spectating
      ? {
        text: 'Stop running the game? It ends at once for every other player, without a result. Keep OpenMTG open instead to let them finish.',
        button: 'Stop the game for everyone',
      }
      : table && !over && out
        ? { text: 'Leave the table? You are out of the game already; it goes on for the others.', button: 'Leave the table' }
        : undefined;
  const leave = () => {
    if (hostKeepsServing && online) {
      // The server concedes for this player and keeps the game (`spectating`): this screen stays, as a spectator of the table.
      void online.leave().then((r) => {
        if (!r.ok) console.error('[GameScreen] leave (keep serving) refused', r.error);
      });
      return;
    }
    leaveTo();
  };

  const bar = (covered: boolean) => (
    <GameBar
      view={view}
      undo={{ available: hotSeat, can: canUndo, run: undo }}
      concedable={replay ? [] : concedable}
      onConcede={concede}
      onLeave={replay ? leaveReplay : leave}
      leaveAtOnce={replay !== null}
      leaveConcedes={(!!online || !!hosted) && concedable.length > 0}
      {...(leaveConfirm ? { leaveConfirm } : {})}
      onSettings={() => nav.go({ screen: 'settings' })}
      onAbout={() => nav.go({ screen: 'about' })}
      onReportBug={reportBug}
      covered={covered}
      brand={brand}
    />
  );

  const { Board, Prompt } = slots;
  const style = { '--anim-ms': `${animationMs(animationSpeed)}ms` } as CSSProperties;
  // RPL-2: another build's replay is checked before its table is drawn, and one that cannot be watched here says so in its place.
  const replayCovered = replayBadge === 'checking' || replayBadge === 'unplayable';
  return (
    <div className="game-screen" style={style} data-animation={animationSpeed} data-replay={replay ? '' : undefined}>
      {replay && replayCovered ? (
        <>
          {bar(false)}
          <ReplayCover controller={replay} onLeave={leaveReplay} />
        </>
      ) : handoff !== null && !replay ? (
        <PassCover name={playerName(view, handoff)} onAccept={connection.acceptHandoff} armDelayMs={coverDelayMs}>
          {bar(true)}
        </PassCover>
      ) : (
        <>
          {bar(false)}
          <PromptSelectionProvider store={selection}>
            <div className="game-table">
              <div className="game-board-slot">
                <Board
                  connection={connection}
                  view={view}
                  legalActions={legalActions}
                  interaction={interaction}
                  pacer={connection}
                  animationScale={timeScale}
                  cardsMayOverlap={!showScryfallImages}
                  seats={seated}
                  {...(sleeves ? { sleeves } : {})}
                  prompt={
                    <div className="game-prompt-slot" ref={promptSlot} tabIndex={-1} data-stale={(stale && !replay) || undefined}>
                      {online && <OnlineGamePanel link={online} />}
                      {hosted && <HostedGamePanel link={hosted} />}
                      {status !== null && !view.result && !replay && (
                        <p className="game-status" role="alert">
                          {status}
                        </p>
                      )}
                      <RevealNotice view={view} />
                      {replay ? (
                        <ReplayPrompt
                          connection={connection}
                          controller={replay}
                          onLeave={leaveReplay}
                          {...(replayOffersReport(source, replayBadge) ? { onReportBug: reportBug } : {})}
                        />
                      ) : view.result ? (
                        <GameOver
                          view={view}
                          result={view.result}
                          {...(rematch ? { onRematch: () => nav.reset({ screen: 'game', connection: sealConnection(rematch()), rematch, ...(sleeves ? { sleeves } : {}) }) } : {})}
                          onNewGame={() => leaveTo({ screen: 'newGame' })}
                          onHome={() => leaveTo()}
                          onReportBug={reportBug}
                          brand={brand}
                        />
                      ) : (
                        <Prompt connection={connection} />
                      )}
                    </div>
                  }
                />
              </div>
            </div>
          </PromptSelectionProvider>
        </>
      )}
      {reporting && (
        <BugReportDialog
          connection={source}
          view={view}
          context={{ online: online ? { role: onlineStatus.role, ...(onlineStatus.format ? { format: onlineStatus.format } : {}) } : null }}
          settings={settings}
          {...(hosted ? { send: (said: ReporterWords, env: ReportEnvironment, at: GameView) => sendHostedBugReport(hosted, said, env, at) } : {})}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}
