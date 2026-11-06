# OpenMTG: the app

The OpenMTG app players install: a Godot 4 project (GDScript). It is the screen of the game (the table, the cards, the
prompts, the animations and the sound, the deck builder, the replays and the settings); the rules engine and the card
data run in the local OpenMTG server next to it (`packages/server` of this repository), which the app starts as
`bin/openmtg-server.exe` and talks to on the player's own machine.

## Building it

1. Build the server as one program: `node scripts/build-godot-server.mjs --version <x.y.z> --out godot/bin` (from this
   repository's root, after `npm ci`).
2. Open `godot/` in Godot 4.7 (or newer 4.x) and run it, or export it with the "Windows Desktop" preset.
3. The installer: `installer/build.ps1` (NSIS). A build without signing settings is unsigned and never updates itself.

Tests use gdUnit4 (not stored here): install it into `addons/gdUnit4`, then
`godot --headless --path . -s -d res://addons/gdUnit4/bin/GdUnitCmdTool.gd -a res://tests --ignoreHeadlessMode -c`.

OpenMTG is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of
the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Not affiliated with Scryfall. No card
images or card data are stored here. Our code is MIT licensed ([LICENSE](LICENSE)); the DigiDice brand assets
(`assets/brand/`) belong to DigiDice LLC and are not covered by it.
