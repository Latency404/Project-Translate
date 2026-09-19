# Project Translate

Local desktop tool for translating Project Zomboid B42 texts — the base game and
Workshop mods. It scans a Steam installation, shows every translatable text entry in
an editor, exports them as one file for an LLM, takes the translation back in, and
builds an installable translation mod from it.

## Requirements

- Windows, with Project Zomboid (B42) and its Workshop mods installed via Steam.
- Node.js 22.2 or newer (the ZIP download behind "Export Mod" needs `zlib.crc32`,
  which only exists from that version on).
- Administrator rights when the game or Workshop folder lives under
  `C:\Program Files (x86)\...` — writing translations there needs them. Without
  admin rights the app still runs; saving a translation fails with a readable 403
  error instead of silently doing nothing.

The API only listens on `127.0.0.1` — it's not reachable from other machines on
your network.

## Install and start

```
npm install
npm run dev
```

This starts the API on `:3100` and the Vite dev server on `:5173` (open
`http://localhost:5173`), pointed at your real Steam installation.

For production-style use (one server, no separate dev server):

```
npm run build
npm start
```

This serves everything from `:3100` — open `http://localhost:3100`.

To try the app against bundled sample data instead of a real Steam installation, set
`PT_FAKE=1`:

```
PT_FAKE=1 npm run dev
```

## Workflow

1. **Settings** — set the game folder and Workshop folder (defaults are prefilled for
   the usual Steam paths) and the target language(s) you're translating into, then
   **Save**. The source language is fixed to English (B42's own source language) and
   isn't configurable. Click **Search Mods** to scan the installation; this can take
   a while the first time with many mods installed. Changing the game/Workshop
   folder or the target languages invalidates the current scan — there's no
   automatic rescan, so Mods/Editor point back here until you click **Search Mods**
   again. This page also has **Restore Backup** (undo a save, reset or restore point)
   and **Reset Translations** (clear a mod's saved translations back to untranslated).
2. **Mods** — pick the mods you want to translate (the base game is listed too);
   filter by status (Open / Translated / Needs Review). With more than one target
   language configured, a language switcher (top bar) selects which one Mods and
   Editor show and edit — switching is instant, no rescan needed. Selection carries
   over to the Editor and to the global **Export Mod** button. This page also has the
   LLM round trip: **Export** downloads the selected mods' entries as one JSON file
   with the original-language texts (covering all target languages at once) — hand
   that to an LLM (or translate it by hand) and get back a translated version in the
   same structure. **Import** loads that file, shows a preview of how many entries
   matched, and on confirmation marks the affected mods **Needs Review** — nothing is
   written to disk yet.
3. **Editor** — pick one mod from the sidebar at a time and work through its
   entries (search, sort, filter by file) in the currently active language. Entries
   imported via the LLM round trip show up pre-filled but unsaved, exactly like a
   manual edit — review them and hit **Save**, which writes to disk (with an
   automatic backup of anything overwritten) and re-scans so the counts stay
   accurate. Once every "Needs Review" entry of a mod is saved, it reverts to its
   normal Open/Translated status. Some older mods only ship their original texts as
   plain Lua `.txt` files instead of JSON — B42 no longer reads those, so saving a
   translation for them writes a proper `.json` file instead; nothing you need to do
   differently.
4. **Export Mod** (top-right, on every page) — bundles the translated entries of
   the currently selected mods and target languages into one installable mod, and
   downloads it as a ZIP (with a valid `mod.info` per layout location). Extract the
   ZIP into your game's mods folder — typically `%UserProfile%\Zomboid\mods` — and
   enable the mod in the launcher.

## Commands

| Purpose | Command |
|---|---|
| Development (Vite `:5173` + API `:3100`) | `npm run dev` |
| Build | `npm run build` |
| Production (everything on `:3100`) | `npm start` |
| Tests | `npm test` |

See [CLAUDE.md](CLAUDE.md) for the project's internal contracts (entry ID format,
API routes, layout rules) and [PLAN.md](PLAN.md) for what's done and what's still
open.
