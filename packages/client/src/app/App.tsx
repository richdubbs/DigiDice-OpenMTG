/**
 * The app shell: navigation state, the top navigation bar, the current screen, and the footer (branding slot 6) on every screen except the game, which has
 * its own bar.
 *
 * Home and About load with the page; every other screen is its own chunk, loaded when it is first opened (the rules engine and the card screens are most
 * of the code, and Home needs none of it).
 */
import { lazy, Suspense } from 'react';
import { AboutScreen } from '../screens/AboutScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { Footer } from './Footer';
import { TopNav } from './TopNav';
import { NavProvider, useNav, type Route } from './nav';

/** The lazily loaded screens' chunks (each one loaded by its screen's first use, or all at once by `preloadScreens`). */
const chunks = {
  decks: () => import('../decks/DecksScreen'),
  deckbuilder: () => import('../decks/DeckbuilderScreen'),
  images: () => import('../images/ImagesScreen'),
  newGame: () => import('../game/NewGameScreen'),
  game: () => import('../game/GameScreen'),
  host: () => import('../online/HostScreen'),
  join: () => import('../online/JoinScreen'),
  hosted: () => import('../hosted/room/HostedScreen'),
  settings: () => import('../settings/SettingsScreen'),
  replays: () => import('../replays/ReplaysScreen'),
};

const DecksScreen = lazy(() => chunks.decks().then((m) => ({ default: m.DecksScreen })));
const DeckbuilderScreen = lazy(() => chunks.deckbuilder().then((m) => ({ default: m.DeckbuilderScreen })));
const ImagesScreen = lazy(() => chunks.images().then((m) => ({ default: m.ImagesScreen })));
const NewGameScreen = lazy(() => chunks.newGame().then((m) => ({ default: m.NewGameScreen })));
const GameScreen = lazy(() => chunks.game().then((m) => ({ default: m.GameScreen })));
const HostScreen = lazy(() => chunks.host().then((m) => ({ default: m.HostScreen })));
const JoinScreen = lazy(() => chunks.join().then((m) => ({ default: m.JoinScreen })));
const HostedScreen = lazy(() => chunks.hosted().then((m) => ({ default: m.HostedScreen })));
const SettingsScreen = lazy(() => chunks.settings().then((m) => ({ default: m.SettingsScreen })));
const ReplaysScreen = lazy(() => chunks.replays().then((m) => ({ default: m.ReplaysScreen })));

/**
 * Loads every lazily loaded screen's chunk now (the same modules the screens load on first use). Tests await it in a hook with its own timeout, so
 * loading and transforming the engine on a busy machine is not counted against a test's or a `findBy`'s timeout (CL3: the app.test.tsx and
 * decks-arena.test.tsx flakes).
 */
export async function preloadScreens(): Promise<void> {
  await Promise.all(Object.values(chunks).map((load) => load()));
}

function CurrentScreen({ route }: { route: Route }) {
  switch (route.screen) {
    case 'home':
      return <HomeScreen />;
    case 'decks':
      return <DecksScreen />;
    case 'deckbuilder':
      return <DeckbuilderScreen {...(route.deckId !== undefined ? { deckId: route.deckId } : {})} />;
    case 'images':
      return <ImagesScreen />;
    case 'replays':
      return <ReplaysScreen />;
    case 'newGame':
      return <NewGameScreen {...(route.deckId !== undefined ? { deckId: route.deckId } : {})} {...(route.setup ? { setup: route.setup } : {})} />;
    case 'hostOnline':
      return <HostScreen />;
    case 'joinOnline':
      return <JoinScreen />;
    case 'hosted':
      return <HostedScreen />;
    case 'game':
      return (
        <GameScreen
          connection={route.connection}
          {...(route.rematch ? { rematch: route.rematch } : {})}
          {...(route.online ? { online: route.online } : {})}
          {...(route.hosted ? { hosted: route.hosted } : {})}
          {...(route.sleeves ? { sleeves: route.sleeves } : {})}
          {...(route.setup ? { setup: route.setup } : {})}
        />
      );
    case 'settings':
      return <SettingsScreen />;
    case 'about':
      return <AboutScreen />;
  }
}

function Shell() {
  const { route } = useNav();
  return (
    <div className="app">
      {route.screen !== 'game' && <TopNav />}
      <main className="app-main">
        <Suspense
          fallback={
            <p className="screen" role="status">
              Loading…
            </p>
          }
        >
          <CurrentScreen route={route} />
        </Suspense>
      </main>
      {route.screen !== 'game' && <Footer />}
    </div>
  );
}

export function App({ initial }: { initial?: Route }) {
  return (
    <NavProvider {...(initial ? { initial } : {})}>
      <Shell />
    </NavProvider>
  );
}
