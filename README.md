# OpenMTG

OpenMTG is an unofficial, free, open-source fan project: a fully automated rules engine that
plays up to 4 player games of Magic: The Gathering from a decklist. You type card names; the game
fetches the cards' Oracle data from Scryfall, works out their rules, and enforces them.

> OpenMTG is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

OpenMTG is not affiliated with, endorsed by, or sponsored by Wizards of the Coast or Scryfall.
It is free, has no ads, no paid tiers and no accounts, and it will never be sold.

## Status

Early development. Many cards are fully automated; text the engine does not understand yet is
marked "Resolve by hand" and applied by the players (see "In a game" below).

## What is (and is not) covered by the license

- **Our code** is licensed under the MIT License ([LICENSE](LICENSE)), copyright © 2026 DigiDice LLC.
- **Not covered:** Wizards of the Coast's intellectual property, including card names, card text
  (Oracle text), card art, mana and set symbols, logos, and the text of the Magic: The Gathering
  Comprehensive Rules. These belong to Wizards of the Coast and are not licensed by this project.
- **Card data** comes from [Scryfall](https://scryfall.com). The repository does not contain
  Scryfall bulk data. Your machine downloads card rules data (names, Oracle text, mana costs, types,
  power/toughness) from Scryfall's API into a local, git-ignored cache.
- **Card images are never bundled or redistributed.** By default cards are rendered as text.
  Players may attach their own images to cards (kept only in their own browser), and may opt in to
  a setting that loads card images directly from Scryfall's image servers in their own browser.
- The test suite uses a small fixture file containing only the Oracle fields of about 125 test
  cards and 8 token variants (no images, no prices, no artwork).
- **DigiDice brand assets** (`assets/brand/`: name, logos, card back) belong to DigiDice LLC and
  are not covered by the MIT License.
- Third-party npm packages and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Repository layout

| Path | What |
|---|---|
| `packages/engine` | Headless, deterministic rules engine (TypeScript). State + action in, new state + events out. |
| `packages/cards` | Card-data tool: Scryfall bulk-data cache, name lookup, decklist resolution (Node). |
| `packages/client` | Browser UI (React + Vite): board, hand, stack, log, prompts. |
| `docs/` | Architecture notes and the ability-model design. |
| `rules/` | Local copy of the Comprehensive Rules for development. Git-ignored; not distributed. |

## Getting started

Requirements: Node.js 20 or newer.

```bash
npm install
npm run cards -- refresh # download the card data once (see "Card data" below)
npm run play             # build the app and serve it at http://127.0.0.1:47600
npm test                 # the fast default suite, offline (no soak games or whole-index corpus tests)
npm run test:all         # every test, the slow suites too (before a merge)
npm run typecheck        # type-check every package
```

### Playing

`npm run play` builds the browser app and starts the local server on your machine (it listens on
127.0.0.1 only). Open http://127.0.0.1:47600 in your browser (`npm run play -- --open` opens it for
you; `--port 47601` picks another port; `--no-build` reuses the last build). Stop it with Ctrl+C.
For development, `npm run dev` runs the server (restarting on changes) and the Vite dev server with
hot reload at http://127.0.0.1:5173.

- **Decks.** On the Decks screen, start a new deck and build it in the deckbuilder (search with
  filters, each card shows how much of it OpenMTG automates: Full, Partial or Manual), or import
  one: paste a decklist (Arena, MTGO or plain text) or upload a .txt file. A link to a deck site is
  never fetched: OpenMTG shows that site's export steps instead. Decks are kept in your browser
  (IndexedDB) and can be exported as Arena, MTGO or plain text.
- **Card images.** Cards are drawn with OpenMTG's own text frame. On the Images screen you can add
  your own pictures (files or a folder, matched to cards by file name; stored only in your browser).
  Scryfall images are off by default; turn on "Show card images from Scryfall" in Settings to show
  them (the browser then loads them from Scryfall). No card art is ever bundled with OpenMTG.
- **New game.** Play, then choose a deck and a name for each player, the format the decks are
  checked against, starting life and who plays first.
  - *Hot-seat*: player 2 is a person at the same screen. Whenever the other player must act, a
    "Pass to ..." screen hides everything until they click, so neither player sees the other's
    hand. Z takes back your last action while nothing hidden was revealed.
  - *Against the computer*: under "Played by" choose "The computer". The computer plays player 2
    with the heuristic AI of `packages/ai`, seeing only what its player may see, and makes one move
    at a time with a short pause (Settings, animation speed, sets how long). The computer skips
    text the engine cannot automate on its own cards (nobody applies it for the computer).
- **In a game.** Space passes priority or confirms the current prompt, Esc cancels. Click cards to
  play them, to choose targets, attackers and blockers. Text the engine does not understand is
  never guessed: the card is marked "Resolve by hand". When a spell with such text resolves, its
  controller gets a "Resolve by hand" prompt with tools to apply it (move cards, life, counters,
  draw, ...). "Apply and continue" applies the adjustments so far and keeps the prompt open with
  the result on the board, so text that depends on what an earlier part did can be followed
  (Brainstorm: draw three, see them, then put two back); Done ends it. For a triggered or static
  ability with such text, click the card: its "By hand" actions put the trigger on the stack
  ("it triggered") or apply the static ability, each logged with the card's text, and you then
  apply the effect with the same tools. Settings has your stops (the steps where you get
  priority) and full control.
- **Sound.** Every button, card and game event has its own sound effect in a Tron / grid style,
  synthesized live by OpenMTG itself (no audio files). Settings, Sound turns them off or sets the
  master, interface, game and ambience volumes, and its "All sounds" list plays each one. Browsers
  start sound only after your first click or key press.

### Card data

Card data comes from Scryfall and is cached on your machine in `.cache/scryfall/` (git-ignored;
override with the `OPENMTG_CACHE_DIR` environment variable). The tool sends a descriptive
User-Agent, respects Scryfall's rate limits, and downloads the Oracle Cards bulk file (about 24 MB)
at most once per 24 hours.

```bash
npm run cards -- refresh              # download Oracle Cards bulk data and build the local index
npm run cards -- refresh --force      # download again even if the cache is fresh
npm run cards -- lookup "Lightning Bolt"
npm run cards -- deck my-deck.txt     # resolve a decklist; reports unknown names with suggestions
npm run cards -- deck - < my-deck.txt # ...or read it from stdin
npm run cards -- fixtures             # regenerate the engine test fixture from the card-name lists
npm run cards -- stats                # cache location, bulk file metadata, index counts
```

Names that are not in the bulk file are fetched once with Scryfall's batch endpoint and cached
(including "not found" answers, for 24 hours). `--no-fetch` keeps `lookup` and `deck` fully offline.
Decklists may use "4 Lightning Bolt", "4x Lightning Bolt", Arena/MTGO exports with set codes,
section headers (Deck, Sideboard, Commander, Companion), and `//` or `#` comments.

More commands are added as milestones land; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- OpenMTG is created by DigiDice LLC. Code © 2026 DigiDice LLC, MIT License.
- Card data: [Scryfall](https://scryfall.com). OpenMTG is not produced by or endorsed by Scryfall.
- Magic: The Gathering is a trademark of Wizards of the Coast LLC.
