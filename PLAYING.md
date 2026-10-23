# Playing OpenMTG with friends

## Install (once)

**Windows, the easy way:** run **OpenMTG-Setup-&lt;version&gt;.exe** and follow the steps. OpenMTG opens in its own window; the first start
downloads the card data from Scryfall (a minute or a few). Start it again from the Start menu or the desktop shortcut. Your card data and
settings are kept in `%APPDATA%\OpenMTG`; uninstall from Windows **Settings**, **Apps**.

**From the source (Windows, Mac or Linux):**

1. Install **Node.js 20 or newer** (the LTS version) from https://nodejs.org.
2. Get OpenMTG: clone this repository, or download it as a ZIP (green "Code" button, "Download ZIP") and unzip it.

## Start

- **Windows:** double-click **Start OpenMTG.cmd**. The first start installs everything and downloads the card
  data from Scryfall (a few minutes). The game opens in your browser at http://127.0.0.1:47600. Keep the
  black window open while you play; close it to stop.
- **Mac / Linux:** in a terminal in the OpenMTG folder run `npm ci`, then `npm run cards -- refresh` (first time
  only), then `npm run play -- --open`.

## Play each other online

1. One player (the host) clicks **Play**, then **Host an online game**, picks a deck and gets a join code.
2. The host forwards the UDP port the Host screen shows on their router (the screen explains how).
3. The other player clicks **Join an online game**, enters the host's public address and the join code.

You can also play the computer, or two people at one screen (hot-seat), from the same **Play** screen.

## Change the look

**Settings**, **Look and feel**: pick **Neon Grid** (the standard look) or **LCARS** (a starship console, with a space battle behind the
Home screen). Save one as a profile of your own to change its colors, text size and backgrounds; keep as many profiles as you like and
switch between them there. Every look plays the same.

## Report a bug

Something went wrong in a game? Open the game's **Menu** and click **Report a bug** (it is also on the end screen, and in a replay's menu).
Write what happened and what you expected, name the card if there is one, and click **Save report**. OpenMTG sends nothing anywhere: the
report is saved as a file on your computer; send that file to whoever looks after your OpenMTG. A report of a game at one screen or against
the computer holds that whole game, so it can be played again exactly to that moment; a report of an online game holds only what your own
screen showed.

## Updating

Get the newest version (`git pull`, or download the ZIP again), then start it as usual. If it fails to start
after an update, delete the `node_modules` folder and start again.

OpenMTG is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards.
Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
