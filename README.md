# Project Translate

A local desktop tool for translating the texts of Project Zomboid Build 42 — the base
game and your Workshop mods. It scans your Steam installation, shows every translatable
entry in one editor, exports them as a single file for an AI translator, takes the
finished translation back, and builds an installable translation mod from it.

It runs entirely on your own machine. Your game and Workshop folders are only ever
read, never changed.

## Download and run

Download the release ZIP, extract it anywhere, and double-click
**Start Project Translate.cmd**. Your browser opens at `http://127.0.0.1:3100`. To stop
the tool, close the console window.

Nothing gets installed: the Node.js runtime ships inside the folder, and everything the
tool writes (`config.json` and the `export\` folder) stays next to the start file. To
update, copy the new version over and keep your `config.json` and `export\` folder.

`CHECKSUMS.txt` in the folder lists SHA-256 hashes of the files that matter, with
instructions for checking them. The bundled `runtime\node.exe` is the official Node.js
runtime, digitally signed by the OpenJS Foundation. You can verify it under
Properties → Digital Signatures.

## Requirements

- Windows, with Project Zomboid (B42) and its Workshop mods installed via Steam.
- Nothing else for the release ZIP. To run from source instead, you need Node.js 22.2
  or newer (the ZIP download behind "Export Mod" uses `zlib.crc32`, which only exists
  from that version on).

**No administrator rights needed.** The tool only reads your game and Workshop folders,
even when they live under `C:\Program Files (x86)\...`. Your translations are saved in
the tool's own `export\work` folder. To get them into the game, use "Export Mod" and
install the result yourself.

The API only listens on `127.0.0.1`, so other machines on your network can't reach it.

## How it works

1. **Settings** — Check the game folder and Workshop folder (the usual Steam paths are
   prefilled), choose the language(s) you want to translate into, and click **Save**.
   The source language is always English, which is what B42 itself uses. Then click
   **Search Mods** to scan your installation. The first scan can take a while if you
   have many mods.

   Changing the folders or the target languages invalidates the current scan. If you
   had scanned before, a new scan starts automatically in the background. The last
   scan is kept across restarts, so you only need **Search Mods** again after a
   Workshop update or a newly installed mod.

   This page also has **Restore Backup** (undo a save, reset or restore) and **Reset
   Translations** (set a mod's saved translations back to the state in the game).

2. **Mods** — Pick the mods you want to translate. The base game is listed too. You can
   filter by status (Open / Translated / Needs Review). If you configured more than one
   target language, the language switcher in the top bar selects which one Mods and
   Editor show. Switching is instant and needs no rescan. Your selection carries over
   to the Editor and to the **Export Mod** button.

   This page also handles the round trip with an AI translator:
   - **Export** downloads the entries of the selected mods as one JSON file with the
     original texts, for all target languages at once. Give that file to an AI
     translator (or translate it by hand) and ask for the same structure back.
   - **Import** loads the translated file and shows a preview of how many entries
     matched. After you confirm, the affected mods are marked **Needs Review**.
     Nothing is written to disk at this point.

3. **Editor** — Open one mod at a time and work through its entries (you can search,
   sort and filter by file) in the active language. Entries imported from an AI
   translator appear pre-filled but unsaved, just like a manual edit. Review them and
   click **Save**. Saving writes to disk, keeps an automatic backup of anything it
   overwrites, and rescans so the counts stay correct. Once every "Needs Review" entry
   of a mod is saved, the mod returns to its normal Open/Translated status.

   Some older mods ship their original texts as plain `.txt` files instead of JSON.
   B42 no longer reads those, so saving a translation for them creates a proper `.json`
   file instead. You don't need to do anything differently.

4. **Export Mod** (top right, available on every page) — Bundles the translated entries
   of the currently selected mods and languages into one installable mod and downloads
   it as a ZIP. See [Installing the exported mod](#installing-the-exported-mod).

## Installing the exported mod

"Export Mod" downloads a ZIP containing one folder. Its name is the mod's own folder
name plus the language, for example `UsefulBarrelsMP-DE`. If you export several mods
together, it's `TranslationPack-DE`. With more than one language, the language part is
`Multi` instead (`UsefulBarrelsMP-Multi`, `TranslationPack-Multi`).

The tool never installs anything itself, so you do the last step by hand:

1. **Extract the ZIP into your game's mods folder**, usually
   `%UserProfile%\Zomboid\mods`. Copy the extracted folder there, not the ZIP itself.
   Then check that `mods\<folder name>\42\mod.info` exists directly, without a second
   folder of the same name in between. Windows' "Extract All" sometimes adds one. If
   that happens, move the inner folder up.
2. **Start Project Zomboid** and open **Mods** in the main menu. The translation mod is
   listed as `<Mod name> Translation (<Language>)`. Enable it, and keep the original
   mod enabled too. The translation mod only adds texts to it.
3. **Set the game language** to the language you translated into (Options → Language)
   and restart the game if it asks you to.
4. **Playing with others?** On a multiplayer server, the translation mod has to be
   installed and enabled on the server as well.

If you export the same selection of mods and languages again, the mod ID stays the same,
so the new version simply replaces the old one in the game. If you add or remove a mod
in the selection, the ID changes. The game then lists both versions, and you remove the
old folder from `mods\` yourself.

## Running from source

```
npm install
npm run dev
```

This starts the API on `:3100` and the Vite dev server on `:5173` (open
`http://localhost:5173`), pointed at your real Steam installation.

For production-style use, with one server and no separate dev server:

```
npm run build
npm start
```

Everything is then served from `:3100`. Open `http://localhost:3100`.

To try the app with bundled sample data instead of a real Steam installation, set
`PT_FAKE=1`:

```
PT_FAKE=1 npm run dev
```

### Commands

| Purpose | Command |
|---|---|
| Development (Vite `:5173` + API `:3100`) | `npm run dev` |
| Build | `npm run build` |
| Production (everything on `:3100`) | `npm start` |
| Tests | `npm test` |
| Build the release package | `npm run package` |
| Build the Steam Workshop item | `npm run workshop` |

See [CLAUDE.md](CLAUDE.md) for the project's internal contracts (entry ID format, API
routes, layout rules).

## License

MIT — see [LICENSE](LICENSE). Project Zomboid is a trademark of The Indie Stone; this
tool is not affiliated with or endorsed by them.
