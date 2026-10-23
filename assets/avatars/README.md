# OpenMTG avatars

The pictures a player with an account can choose for their profile (milestone 14): 8 shapes (d4, d6, d8, d10, d12, d20, chip, comet) in 6 tones
(blue, magenta, violet, cyan, amber, white), 48 in all, one file per avatar id, `<shape>-<tone>.svg` (`AVATAR_IDS` in `@openmtg/accounts/api`). The
ids are the contract; the art can be redrawn without changing them.

They are OpenMTG's own art, **under the repository's MIT License** (unlike the DigiDice brand assets in `assets/brand/`), drawn in the style of the
deck sleeves: neon on black, circuit traces and pads, die faces with pips. No card art, no mana or set symbols, nothing of Wizards' or Arena's, no
DigiDice logo, and no text. Each file is plain shapes, gradients and filters, with no script and no external reference, under 8 KB
(`packages/accounts/test/m14-9`). The client finds the files and names them for alt text in `packages/client/src/branding/avatars.ts`.

The files are generated; do not edit them by hand:

```bash
node scripts/brand/gen-avatars.mjs          # write the 48 files here
node scripts/brand/gen-avatars.mjs --check  # check that the files here are exactly what the script makes
```
