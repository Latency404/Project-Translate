# Project Translate

Local desktop tool for translating Project Zomboid B42 texts — the base game and
Workshop mods. It scans a Steam installation, shows every translatable text entry in
an editor, exports them as one file for an LLM, takes the translation back in, and
builds an installable translation mod from it.

## Requirements

- Windows, with Project Zomboid (B42) and its Workshop mods installed via Steam.
- Node.js (a recent LTS version).
- Administrator rights when the game or Workshop folder lives under
  `C:\Program Files (x86)\...` — writing translations there needs them. Without
  admin rights the app still runs; saving a translation fails with a readable 403
  error instead of silently doing nothing.

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
   the usual Steam paths), the source language texts are originally written in
   (defaults to `EN`) and the target language you're translating into, then **Save**.
   Run **Scan** to read the installation; this can take a while the first time with
   many mods installed. Changing the game/Workshop folder or the source language
   invalidates the current scan — the app rescans automatically the next time you
   open the Library.
2. **Library** — pick the mods you want to translate (the base game is listed too).
   Selection carries over to the Editor and Export.
3. **Editor** — browse every text entry of the selected mods, search and sort them,
   and either type translations directly or use the LLM round trip below. **Save**
   writes changes to disk (with an automatic backup of anything overwritten) and
   re-scans so the counts stay accurate.
4. **LLM export/import** (in the Editor) — **Export** downloads the visible entries as
   one JSON file with the original-language texts. Hand that file to an LLM (or
   translate it by hand) and get back a translated version in the same structure.
   **Import** loads that file, shows a preview of how many entries matched, and
   applies it after confirmation.
5. **Export** (mod) — bundles the translated entries of the selected mods into one
   installable mod folder, with a valid `mod.info` per layout location. Copy that
   folder into your game's `mods` directory and enable it in the launcher.

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
