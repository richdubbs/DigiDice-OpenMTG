/**
 * New game (docs/design/m8-client.md screen 5; docs/design/decks-and-formats.md "Quick play"): a saved deck and a name for each player, the format the
 * decks are checked against, starting options, and whether each other player is a person at this screen (hot-seat) or the computer (computer.ts); then the
 * cards are compiled by the local server, the config is built (config.ts) and the game opens through a LocalConnection (hot-seat) or a ComputerGame.
 *
 * M12-4b (docs/design/m12-multiplayer.md 5.3 item 1): two to four players ("Players: 2 / 3 / 4", and Remove on the third and fourth seat). The first seat
 * is always the person at this screen; every other seat is a person (hot-seat) or the computer, in any mix. With three or four players the game is a
 * Free-for-All (CR 806, 802), the players are seated at random from the seed (CR 806.3, config.ts `seatAtRandom`), a Commander game
 * starts at the variant's multiplayer life (CR 903.7, 903.12f) and Duel Commander is not offered (a two-player format). A two-player New
 * game is exactly as before.
 *
 * A card the local card data does not know is never dropped or guessed: the screen names it and offers to play it as a blank stub card that the players
 * resolve by hand (`stubs` of POST /api/cards/defs), which needs an explicit click.
 *
 * Deck problems for the chosen format are shown with their rules, and starting anyway needs an explicit tick (never silently ignored). When no deck
 * checker is available the screen says the decks were not checked.
 *
 * Against the computer: the computer applies nothing by hand (packages/ai answers a manual resolution with a note), and its decisions are never shown to
 * the human (CR 400.2: they would show its hand). So text the engine cannot automate on the computer's cards (CR 113.1, "Resolve by hand") is skipped,
 * and the game starts without a confirmation for it.
 *
 * Online (milestone 9): "Host an online game" and "Join an online game" open their own screens (online/HostScreen.tsx, online/JoinScreen.tsx).
 * Milestone 13: "Play on the DigiDice server" opens hosted/room/HostedScreen.tsx when a hosted game server is configured (hosted/config.ts); without one it
 * is shown switched off, with a diagonal "Coming soon" ribbon (owner, 2026-10-22).
 */
import { COMMANDER_VARIANTS, ConfigError, type CommanderVariant, type PlayerId } from '@openmtg/engine';
import type { DeckProblem } from '@openmtg/server/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScreenHeader } from '../app/ScreenHeader';
import { useNav } from '../app/nav';
import { LocalConnection } from '../connection/LocalConnection';
import type { PlayerSleeves } from '../board/sleeves';
import { DeckBox } from '../decks/chrome';
import { DeckChooser } from './DeckOptions';
import { formatOption } from '../decks/formats';
import '../decks/decks.css';
import { MAX_NAME_LENGTH, settingsStore, stopSettings, type PlayerNames, type SettingsStore } from '../settings/settings';
import { useSettings } from '../settings/useSettings';
import {
  ConfigBuildError, DEFAULT_FORMAT, DEFAULT_START, FORMATS, MAX_PLAYERS, MIN_PLAYERS, PLAYER_IDS, buildGameConfig, commanderVariantOf, companionOf, deckCardNames,
  deckNotes, formatProblem, mainCardNames, offeredFormat, playerName, startingLifeFor, unplayableReason, type StartOptions,
} from './config';
import { COMPUTER_NAME, ComputerGame, computerDelayMs } from './computer';
import { useHostedServer } from '../hosted/config';
import { sealConnection, sealedFactory } from './sealed';
import { recordLocalGame } from '../replays/record';
import { defaultServices, localRematch, type GameDeck, type GameServices } from './services';
import { gameSfx } from './sound';
import './game.css';

/** CMP1: `companion`, the companion the check read (ValidateResponse.companion, CR 702.139a), null for none. */
type Check =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'ok'; companion: string | null }
  | { status: 'problems'; problems: DeckProblem[]; companion: string | null }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

const NONE: Check = { status: 'none' };

/** Who plays a seat: a person at this screen (hot-seat; the first seat always) or the computer. */
export type SeatPlayer = 'person' | 'computer';

/** One seat of the New game screen (M12-4b): its player's name, the chosen deck's id ('' for none) and who plays it. */
export interface SeatSetup {
  name: string;
  deckId: string;
  by: SeatPlayer;
}

/**
 * What a game was started with (owner, 2026-10-25: a multiplayer game's end screen asks for a rematch and offers each player's deck): the seats as
 * New game had them (before the random seating), the format and the starting options. The game route keeps it; "Change decks" opens New game with it.
 * `deckNames`: each seat's deck name, for the end screen.
 */
export interface GameSetup {
  seats: readonly SeatSetup[];
  deckNames: readonly string[];
  format: string;
  start: StartOptions;
}

/**
 * M11-2: what a Commander variant changes, from the engine's variant data (COMMANDER_VARIANTS), shown under the format so nothing about it is a surprise.
 * M12-4b: with three or four players (`players`) the multiplayer starting life (CR 903.7, 903.12f) and the free first mulligan of every multiplayer game
 * (CR 103.5c, 800.6).
 */
export function variantSummary(variant: CommanderVariant, players = 2): string {
  const v = COMMANDER_VARIANTS[variant];
  const o = v.options;
  const multi = players > 2;
  const life = multi ? `${v.multiplayerLife ?? v.startingLife} life (${variant === 'commander' ? 'CR 903.7' : 'CR 903.12f'})` : `${v.startingLife} life (CR 903.7)`;
  const parts = [
    life,
    o.damageLimit !== null ? `${o.damageLimit} combat damage from one commander loses the game (CR 903.10a)` : 'no commander damage rule',
    `commander tax {${o.tax}} for each earlier cast from the command zone (CR 903.8)`,
  ];
  if (multi) parts.push('the first mulligan is free (CR 103.5c, 800.6)');
  else if (o.freeMulligan) parts.push('the first mulligan is free (CR 903.12g)');
  return `${v.name}: ${parts.join('; ')}.`;
}

/** M12-4b: what a game with three or four players is (m12 design section 1, D2, D4), said under the options. */
export function multiplayerSummary(players: number): string {
  return (
    `Free-for-All with ${players} players (CR 806): each player may attack any opponents, their planeswalkers and the battles they protect (CR 802); ` +
    'the seats are drawn at random (CR 806.3) and turns go clockwise; the first mulligan is free (CR 800.6) and nobody skips their first draw (CR 800.7).'
  );
}

/** The computer's default name for seat `index`: "Computer", or "Computer 3" when another seat already has that name. */
export function computerName(seats: readonly SeatSetup[], index: number): string {
  const taken = new Set(seats.filter((_s, i) => i !== index).map((s) => playerName(s.name).toLowerCase()));
  if (!taken.has(COMPUTER_NAME.toLowerCase())) return COMPUTER_NAME;
  for (let n = index + 1; ; n++) if (!taken.has(`${COMPUTER_NAME} ${n}`.toLowerCase())) return `${COMPUTER_NAME} ${n}`;
}

const COMPUTER_NAME_RE = new RegExp(`^${COMPUTER_NAME}( \\d+)?$`);

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function CheckLine({ check }: { check: Check }) {
  switch (check.status) {
    case 'none':
      return null;
    case 'checking':
      return <p className="new-game-check">Checking the deck…</p>;
    case 'ok':
      return <p className="new-game-check">Legal in this format.</p>;
    case 'unavailable':
      return <p className="new-game-check">Deck checks are not available yet: this deck was not checked.</p>;
    case 'error':
      return <p className="new-game-check">The deck could not be checked ({check.message}).</p>;
    case 'problems':
      return (
        <ul className="new-game-problems" aria-label="Deck problems">
          {check.problems.map((p, i) => (
            <li key={i}>
              {p.message}
              {p.rules.length > 0 ? ` (${p.rules.join(', ')})` : ''}
            </li>
          ))}
        </ul>
      );
  }
}

const cardTotal = (entries: readonly { count: number }[] | undefined) => (entries ?? []).reduce((n, e) => n + e.count, 0);

/** The chosen deck as a 3D deck box with its name, format and size; a ghost box in a dashed slot while no deck is chosen. */
function DeckPreview({ deck, player, sleeve }: { deck: GameDeck | null; player: number; sleeve: string | undefined }) {
  if (!deck)
    return (
      <div className="new-game-preview new-game-preview-empty" data-player={player}>
        <div className="new-game-ghost">
          <DeckBox size="xs" />
        </div>
        <span className="new-game-preview-hint">No deck chosen</span>
      </div>
    );
  const main = cardTotal(deck.deck.main) + cardTotal(deck.deck.commander);
  const side = cardTotal(deck.deck.sideboard);
  return (
    <div className="new-game-preview" data-player={player}>
      <div key={deck.id} className="new-game-preview-box">
        <DeckBox size="xs" sleeve={sleeve} />
      </div>
      <span className="new-game-preview-name">{deck.name}</span>
      <span className="new-game-preview-meta">
        {deck.precon ? 'Commander precon' : deck.builtIn && (deck.format ?? 'casual') === 'casual' ? 'Practice deck' : formatOption(deck.format ?? 'casual').name} · {main} cards{side ? ` · ${side} extra` : ''}
      </span>
    </div>
  );
}

/**
 * CL3 (STATUS, wave M8-C6 verification gap 4): the names of a game that starts become the names New game starts with next time (Settings, "Player
 * names"; stored in localStorage by SettingsStore, every write in try/catch, so a browser that cannot store them still starts the game). Only the names of
 * the people who play are kept (M12-4b: four names): a computer seat's default stays a person's name, so choosing "A person" again does not offer the
 * computer's.
 */
function rememberNames(settings: SettingsStore, seats: readonly { name: string; by: SeatPlayer }[]): void {
  try {
    settings.update((s) => ({ playerNames: s.playerNames.map((n, i) => (seats[i]?.by === 'person' ? seats[i]!.name : n)) as PlayerNames }));
  } catch {
    // Remembering the names is a convenience: never a reason the game does not start.
  }
}

/** The seats a New game screen starts with: two people with the names from Settings. */
function initialSeats(names: PlayerNames): SeatSetup[] {
  return [0, 1].map((i) => ({ name: names[i]!, deckId: '', by: 'person' as const }));
}

export function NewGameScreen({
  services = defaultServices, settings = settingsStore(), deckId, setup, hostedServer,
}: { services?: GameServices; settings?: SettingsStore; deckId?: string; setup?: GameSetup; hostedServer?: string | null }) {
  const nav = useNav();
  // Milestone 13: the DigiDice game server this page may offer (undefined while it is read, null when none is configured).
  const hosted = useHostedServer(hostedServer);
  const s = useSettings(settings);
  const [decks, setDecks] = useState<GameDeck[] | null>(null);
  const [decksError, setDecksError] = useState<string | null>(null);
  // A rematch whose decks are being changed (`setup`): the same players, decks, format and options as the game that ended.
  const [seats, setSeats] = useState<SeatSetup[]>(() => (setup ? setup.seats.map((x) => ({ ...x })) : initialSeats(s.playerNames)));
  const [format, setFormat] = useState(setup?.format ?? DEFAULT_FORMAT);
  const [formatTouched, setFormatTouched] = useState(setup !== undefined);
  const [start, setStart] = useState<StartOptions>(setup?.start ?? DEFAULT_START);
  /** The player typed a starting life: it no longer follows the format (CR 103.4, 903.7). */
  const [lifeTouched, setLifeTouched] = useState(setup !== undefined && setup.start.startingLife !== startingLifeFor(setup.format, setup.seats.length));
  const [checks, setChecks] = useState<Check[]>(() => (setup ? setup.seats.map(() => NONE) : [NONE, NONE]));
  const [playAnyway, setPlayAnyway] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** Names the card data does not know, offered as stub cards after a failed start (null: no offer). */
  const [stubOffer, setStubOffer] = useState<string[] | null>(null);
  const count = seats.length;

  useEffect(() => {
    let live = true;
    services.listDecks().then(
      (list) => live && setDecks(list),
      (e: unknown) => {
        if (!live) return;
        setDecks([]);
        setDecksError(message(e));
      },
    );
    return () => {
      live = false;
    };
  }, [services]);

  // M11-2: opened from the deckbuilder with a deck ("Play this deck"): player 1 gets it, with its format, once the decks are read.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !decks || deckId === undefined) return;
    preselected.current = true;
    if (decks.some((d) => d.id === deckId)) pickDeck(0, deckId);
    // pickDeck reads only `decks` and the format state.
  }, [decks, deckId]);

  // The starting life follows the format and the number of players until the player types one: 20 (CR 103.4), or the Commander variant's (CR 903.7,
  // 903.12f; with three or four players the multiplayer life).
  useEffect(() => {
    if (lifeTouched) return;
    const life = startingLifeFor(format, count);
    setStart((prev) => (prev.startingLife === life ? prev : { ...prev, startingLife: life }));
  }, [format, count, lifeTouched]);

  // A starting player who was removed: back to random.
  useEffect(() => {
    if (start.firstPlayer !== 'random' && start.firstPlayer >= count) setStart((prev) => ({ ...prev, firstPlayer: 'random' }));
  }, [count, start.firstPlayer]);

  // The decks only change when a seat's deck does (typing a name does not check the decks again).
  const deckKey = seats.map((x) => x.deckId).join('\n');
  const chosen = useMemo(() => deckKey.split('\n').map((id) => decks?.find((d) => d.id === id) ?? null), [decks, deckKey]);

  // Each chosen deck's sleeve, the one of its colors (branding/sleeves.ts), read once per deck; until it arrives the deck shows the classic back.
  const [sleeves, setSleeves] = useState<ReadonlyMap<string, string | undefined>>(new Map());
  useEffect(() => {
    let live = true;
    for (const d of chosen) {
      if (!d || sleeves.has(d.id) || !services.deckSleeve) continue;
      services.deckSleeve(d.deck).then(
        (id) => live && setSleeves((m) => new Map(m).set(d.id, id)),
        () => {},
      );
    }
    return () => {
      live = false;
    };
    // `sleeves` is read only to skip decks already done.
  }, [chosen, services]);

  // Check every deck whenever a deck or the format changes; answers of an older request are dropped.
  useEffect(() => {
    let live = true;
    setPlayAnyway(false);
    setChecks(chosen.map(() => NONE));
    chosen.forEach((d, i) => {
      const set = (c: Check) => live && setChecks((prev) => prev.map((x, j) => (j === i ? c : x)));
      if (!d) return set(NONE);
      set({ status: 'checking' });
      services.validateDeck(d.deck, format).then(
        // `status`, not `valid`: warnings (something could not be checked) are shown and need "Play anyway" too; never shown as legal.
        (r) =>
          set(
            r === null
              ? { status: 'unavailable' }
              : r.status === 'legal'
                ? { status: 'ok', companion: r.companion ?? null }
                : { status: 'problems', problems: r.problems.filter((p) => p.severity !== 'note'), companion: r.companion ?? null },
          ),
        (e: unknown) => set({ status: 'error', message: message(e) }),
      );
    });
    return () => {
      live = false;
    };
  }, [chosen, format, services]);

  // A start error describes the choices it was made with: any change makes it stale.
  useEffect(() => {
    setStartError(null);
    setStubOffer(null);
  }, [chosen, format, seats, start]);

  const updateSeat = (i: number, change: (seat: SeatSetup, all: readonly SeatSetup[]) => Partial<SeatSetup>) =>
    setSeats((prev) => prev.map((x, j) => (j === i ? { ...x, ...change(x, prev) } : x)));

  const choosePlayer = (i: number, by: SeatPlayer) =>
    // The computer's default name, and back to the player's own name for a person (a name the player typed is kept).
    updateSeat(i, (seat, all) => ({
      by,
      name:
        by === 'computer'
          ? seat.name === s.playerNames[i]
            ? computerName(all, i)
            : seat.name
          : COMPUTER_NAME_RE.test(seat.name)
            ? s.playerNames[i]!
            : seat.name,
    }));

  /** M12-4b: two to four players; a new seat is a person with the next name from Settings. */
  const setCount = (n: number) => {
    gameSfx(n > count ? 'ui.open' : 'ui.close');
    setSeats((prev) =>
      n <= prev.length ? prev.slice(0, n) : [...prev, ...Array.from({ length: n - prev.length }, (_x, k) => ({ name: s.playerNames[prev.length + k]!, deckId: '', by: 'person' as const }))],
    );
  };
  const removeSeat = (i: number) => {
    gameSfx('ui.close');
    setSeats((prev) => (prev.length <= MIN_PLAYERS ? prev : prev.filter((_x, j) => j !== i)));
  };

  // Leaving the screen cancels a start in progress: the player is never pulled into a game they left.
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const pickDeck = (i: number, id: string) => {
    updateSeat(i, () => ({ deckId: id }));
    const deckFormat = offeredFormat(decks?.find((d) => d.id === id)?.format);
    if (i === 0 && !formatTouched && deckFormat && formatProblem(deckFormat, count) === null) setFormat(deckFormat);
  };

  const trimmed = seats.map((x) => playerName(x.name)); // as the game gets them (config.ts)
  const lower = trimmed.map((n) => n.toLowerCase());
  const nameProblem = trimmed.some((n) => n === '')
    ? 'Each player needs a name.'
    : lower.some((n, i) => lower.indexOf(n) !== i)
      ? 'The players need different names.'
      : null;
  const variant = commanderVariantOf(format);
  const unplayable = chosen.map((d) => (d ? unplayableReason(d.deck, format) : null));
  const seatChecks = chosen.map((_d, i) => checks[i] ?? NONE);
  const hasProblems = seatChecks.some((c) => c.status === 'problems');
  // M11-2 (m11 design 5.1): in a Commander game the deck checks are the deck construction rules the engine relies on (D6: who may be a commander, partners,
  // color identity, singleton): an error blocks the start; warnings (something could not be checked) and a check that could not be done are shown and need
  // "Play anyway", as in any other format.
  const commanderErrors = variant !== null && seatChecks.some((c) => c.status === 'problems' && c.problems.some((p) => p.severity === 'error'));
  // CMP1 (CR 702.139a): a companion whose condition the deck does not fulfill (or a card without a companion ability, or two) can't be revealed: in any
  // format the start is blocked until the deck is fixed (it is a game rule, not a format rule, so "Play anyway" does not cover it).
  const companionErrors = seatChecks.some((c) => c.status === 'problems' && c.problems.some((p) => p.severity === 'error' && p.kind === 'companion'));
  const uncheckedCommander = variant !== null && seatChecks.some((c) => c.status === 'unavailable' || c.status === 'error');
  // CMP1 review (CR 702.139a): a companion is revealed only when the deck fulfills its condition. A deck with a Companion section whose check could not be
  // done is never revealed silently: it needs "Play anyway", like the other unchecked cases.
  const uncheckedCompanion = seatChecks.some((c, i) => (c.status === 'unavailable' || c.status === 'error') && companionOf({ name: '', deck: chosen[i]?.deck ?? { main: [], sideboard: [] } }) !== null);
  const needsTick = hasProblems || uncheckedCommander || uncheckedCompanion;
  const checking = seatChecks.some((c) => c.status === 'checking');
  const lifeOk = Number.isInteger(start.startingLife) && start.startingLife >= 1 && start.startingLife <= 999;
  const formatBlocked = formatProblem(format, count);
  const computers = seats.filter((x) => x.by === 'computer').length;
  // Why Start game cannot be clicked (the first reason), shown next to the button.
  const blocked = formatBlocked ?? (chosen.some((d) => !d)
    ? 'Choose a deck for each player.'
    : unplayable.some((u) => u !== null)
      ? 'A chosen deck cannot be played yet (see above).'
      : nameProblem ?? (!lifeOk
        ? 'Starting life must be a whole number from 1 to 999.'
        : checking
          ? 'Checking the decks…'
          : commanderErrors
            ? 'A deck breaks the rules of this Commander format (see above): fix it in the deckbuilder.'
            : companionErrors
              ? "A deck's companion can't be revealed (see above, CR 702.139a): fix the deck or remove the companion in the deckbuilder."
            : needsTick && !playAnyway
              ? hasProblems
                ? 'Tick Play anyway to start with these deck problems.'
                : uncheckedCompanion
                  ? "Tick Play anyway to reveal a companion whose condition was not checked (CR 702.139a)."
                  : 'Tick Play anyway to start with decks that were not checked.'
              : null));
  const blockedIsError = blocked !== null && (blocked === nameProblem || blocked === formatBlocked || !lifeOk || commanderErrors || companionErrors);
  const goLabel = computers === 0 ? 'Start game' : computers === count - 1 ? (computers === 1 ? 'Play vs computer' : `Play vs ${computers} computers`) : 'Start game';

  const begin = async (stubs: string[] = []) => {
    if (chosen.some((d) => !d)) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStarting(true);
    setStartError(null);
    setStubOffer(null);
    try {
      // CMP1: the companion the deck check read (an MTGO list's sideboard companion included); without a check, the deck's Companion section
      const companionFrom = (c: Check) => (c.status === 'ok' || c.status === 'problems' ? { companion: c.companion } : {});
      const players = seats.map((_x, i) => ({ name: trimmed[i]!, deck: chosen[i]!.deck, ...companionFrom(seatChecks[i]!) }));
      const res = await services.compileDefs(deckCardNames(players), { signal: controller.signal, ...(stubs.length ? { stubs } : {}) });
      if (controller.signal.aborted) return;
      // FAST5 MX7: a sideboard card that can't be loaded stays out of the game (buildGameConfig skips it); only main-deck cards and commanders stop the start.
      const inMain = new Set([...mainCardNames(players), ...players.map(companionOf).filter((n): n is string => n !== null)]); // CMP1: the companion too
      const failed = res.failed.filter((f) => inMain.has(f.name));
      if (failed.length > 0) {
        // Only names the card data does not know can be stubs; a card the compiler rejects or an ambiguous face name is never hidden behind one.
        const unknown = failed.filter((f) => f.code === 'unknown');
        if (unknown.length === failed.length) setStubOffer(unknown.map((f) => f.name));
        throw new ConfigBuildError(`These cards could not be loaded: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}.`);
      }
      const config = buildGameConfig({ players, defs: res.defs, seed: services.newSeed(), start, stops: stopSettings(settings.get()), commander: variant });
      // Each player's card backs are in their deck's sleeve (board/sleeves.tsx).
      const playerSleeves: PlayerSleeves = Object.fromEntries(chosen.flatMap((d, i) => (d && sleeves.get(d.id) ? [[PLAYER_IDS[i]!, sleeves.get(d.id)!]] : [])));
      rememberNames(settings, seats.map((x, i) => ({ name: trimmed[i]!, by: x.by })));
      const gameSetup: GameSetup = { seats, deckNames: chosen.map((d) => d!.name), format, start };
      if (computers > 0) {
        const ids = (by: SeatPlayer): PlayerId[] => seats.flatMap((x, i) => (x.by === by ? [PLAYER_IDS[i]!] : []));
        const humans = ids('person');
        const machines = ids('computer');
        const opts = () => ({ delayMs: computerDelayMs(settings.get().animationSpeed), seed: services.newSeed() });
        // RPL-1 (replays design 7.1): every local game is recorded as it is played, a rematch too (replays/record.ts).
        const vsComputer = (c: typeof config) => recordLocalGame(new ComputerGame(c, humans, machines, opts()), { format });
        // FXH (audit m5, CR 400.2): the route and the game screen hold only the sealed connection, never the session behind it (sealed.ts).
        nav.go({ screen: 'game', connection: sealConnection(vsComputer(config)), rematch: sealedFactory(() => vsComputer({ ...config, seed: services.newSeed() })), sleeves: playerSleeves, setup: gameSetup });
      } else {
        const rematch = localRematch(config, services.newSeed);
        nav.go({
          screen: 'game',
          connection: sealConnection(recordLocalGame(new LocalConnection(config), { format })),
          rematch: sealedFactory(() => recordLocalGame(rematch(), { format })),
          sleeves: playerSleeves,
          setup: gameSetup,
        });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setStarting(false);
      setStartError(e instanceof ConfigBuildError || e instanceof ConfigError ? e.message : `The game could not be started: ${message(e)}`);
      gameSfx('ui.error');
    }
  };

  return (
    <div className="screen new-game" data-seats={count}>
      <ScreenHeader title="New game" />
      <nav className="hud-panel new-game-online" aria-label="Play online">
        <span className="new-game-legend">Play online against a friend</span>
        <button type="button" onClick={() => nav.go({ screen: 'hostOnline' })}>
          Host an online game
        </button>
        <button type="button" onClick={() => nav.go({ screen: 'joinOnline' })}>
          Join an online game
        </button>
        {hosted ? (
          <button type="button" onClick={() => nav.go({ screen: 'hosted' })}>
            Play on the DigiDice server
          </button>
        ) : (
          // No server yet (D17: none before the launch): the way in is shown, off, with a diagonal "Coming soon" ribbon across its corner.
          <button type="button" className="coming-soon" disabled aria-label="Play on the DigiDice server (coming soon)" title="Coming soon">
            Play on the DigiDice server
            <span className="coming-soon-ribbon" aria-hidden="true">
              Coming soon
            </span>
          </button>
        )}
      </nav>
      {/* Format and options under the online box (owner, 2026-10-25), above the players. */}
      <div className="new-game-quick" role="group" aria-label="Format and options">
        <label>
          Format
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setFormatTouched(true);
            }}
          >
            {FORMATS.map((f) => {
              const notHere = formatProblem(f.id, count) !== null;
              return (
                <option key={f.id} value={f.id} disabled={notHere}>
                  {notHere ? `${f.label} (two players only)` : f.label}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Starting life
          <input
            type="number"
            min={1}
            max={999}
            value={Number.isNaN(start.startingLife) ? '' : start.startingLife}
            onChange={(e) => {
              setLifeTouched(true);
              setStart((prev) => ({ ...prev, startingLife: e.target.valueAsNumber }));
            }}
          />
        </label>
        <label>
          Who plays first
          <select
            value={String(start.firstPlayer)}
            onChange={(e) => setStart((prev) => ({ ...prev, firstPlayer: e.target.value === 'random' ? 'random' : Number(e.target.value) }))}
          >
            <option value="random">Random</option>
            {seats.map((_x, i) => (
              <option key={i} value={String(i)}>
                {trimmed[i] || `Player ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {decks === null ? (
        <p role="status">Loading decks…</p>
      ) : (
        <>
          {decksError && <p className="game-error">Your saved decks could not be read ({decksError}).</p>}
          {!decks.some((d) => !d.builtIn) && (
            <p className="new-game-check">
              Decks you save on the Decks screen appear here; until then, try the practice decks.{' '}
              <button type="button" className="button-link" onClick={() => nav.go({ screen: 'decks' })}>
                Open Decks
              </button>
            </p>
          )}
          <div className="new-game-body">
            <fieldset className="new-game-count">
              <legend>Players</legend>
              <div className="new-game-count-choices">
                {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_x, k) => MIN_PLAYERS + k).map((n) => (
                  <label key={n} className="inline">
                    <input type="radio" name="player-count" checked={count === n} onChange={() => setCount(n)} />
                    {n} players
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="new-game-players" data-seats={count}>
              {seats.map((seat, i) => {
                const deck = chosen[i] ?? null;
                const notes = deck ? deckNotes(deck.deck) : [];
                return (
                  <section key={i} className={`hud-panel new-game-player new-game-player-${i + 1}`} aria-label={`Player ${i + 1}`}>
                    <h2>
                      Player {i + 1}
                      {i >= MIN_PLAYERS && (
                        <button type="button" className="button-link new-game-remove" aria-label={`Remove player ${i + 1}`} onClick={() => removeSeat(i)}>
                          Remove
                        </button>
                      )}
                    </h2>
                    {i === 0 ? (
                      <div className="new-game-opponent">
                        <span className="new-game-legend">Played by</span>
                        <p className="new-game-you">You, at this screen</p>
                      </div>
                    ) : (
                      <fieldset className="new-game-opponent">
                        <legend>Played by</legend>
                        <div className="new-game-segment">
                          <label className="inline">
                            <input type="radio" name={i === 1 ? 'opponent' : `opponent-${i + 1}`} checked={seat.by === 'person'} onChange={() => choosePlayer(i, 'person')} />
                            A person at this screen (hot-seat)
                          </label>
                          <label className="inline">
                            <input type="radio" name={i === 1 ? 'opponent' : `opponent-${i + 1}`} checked={seat.by === 'computer'} onChange={() => choosePlayer(i, 'computer')} />
                            The computer
                          </label>
                        </div>
                      </fieldset>
                    )}
                    <div className="new-game-player-body">
                      <div className="new-game-player-form">
                        <label>
                          Name
                          <input type="text" value={seat.name} maxLength={MAX_NAME_LENGTH} onChange={(e) => updateSeat(i, () => ({ name: e.target.value }))} />
                        </label>
                        {/* Decks the format cannot play are greyed out; not in player 1's list while the format still follows player 1's deck */}
                        <DeckChooser decks={decks} value={seat.deckId} onChange={(id) => pickDeck(i, id)} {...(i > 0 || formatTouched ? { format } : {})} />
                        {unplayable[i] && <p className="game-error">{unplayable[i]}</p>}
                        <CheckLine check={seatChecks[i]!} />
                        {notes.length > 0 && (
                          <ul className="new-game-notes">
                            {notes.map((n) => (
                              <li key={n}>{n}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <DeckPreview deck={deck} player={i + 1} sleeve={deck ? sleeves.get(deck.id) : undefined} />
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="new-game-bottom">
              <div className="new-game-start">
                {needsTick && !commanderErrors && !companionErrors && (
                  <label className="inline">
                    <input type="checkbox" checked={playAnyway} onChange={(e) => setPlayAnyway(e.target.checked)} />
                    {hasProblems ? "Play anyway (the decks break the format's rules above)" : 'Play anyway (the decks were not checked)'}
                  </label>
                )}
                {blocked && (
                  <span id="new-game-start-reason" className={blockedIsError ? 'game-error' : 'new-game-check'}>
                    {blocked}
                  </span>
                )}
                {starting && (
                  <span className="new-game-check" role="status">
                    Loading the cards…
                  </span>
                )}
                <button
                  type="button"
                  className="button-primary new-game-go"
                  disabled={blocked !== null || starting}
                  {...(blocked ? { 'aria-describedby': 'new-game-start-reason' } : {})}
                  onClick={() => void begin()}
                >
                  {starting ? 'Starting…' : goLabel}
                </button>
              </div>
            </div>
          </div>
          {startError && (
            <p className="game-error" role="alert">
              {startError}
            </p>
          )}
          {stubOffer && !starting && (
            <p className="new-game-check">
              The card data does not know {stubOffer.join(', ')}. You can play {stubOffer.length === 1 ? 'it' : 'them'} as blank stub cards: no cost, no types, no
              text, and everything about {stubOffer.length === 1 ? 'it' : 'them'} is done by hand.{' '}
              <button type="button" className="button-link" onClick={() => void begin(stubOffer)}>
                Play with stub cards
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
