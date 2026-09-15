# Project Translate

Lokales Desktop-Tool (Web-App auf `localhost:3100`) zum Übersetzen der Texte von
Project Zomboid B42 — Basisspiel und Workshop-Mods. Es scannt die Steam-Installation,
zeigt alle übersetzbaren Einträge in einem Editor, exportiert sie als eine Datei für
ein LLM, nimmt die Übersetzung zurück und baut daraus einen installierbaren
Übersetzungs-Mod.

Der aktuelle Funktionsumfang ist gewollt. Arbeit an diesem Projekt heißt: bestehendes
Verhalten stabiler und runder machen, nicht neu entwerfen. Was ansteht, steht in
[PLAN.md](PLAN.md).

## Stack und Befehle

React 19 + Vite 8 + Tailwind 4 im Frontend, Node + Express 5 im Backend, JavaScript
(kein TypeScript), npm, Tests mit `node:test`. Einzige UI-Zusatzabhängigkeit:
`lucide-react`.

| Zweck | Befehl |
|---|---|
| Entwicklung (Vite :5173 + API :3100) | `npm run dev` |
| Bauen | `npm run build` |
| Production (alles auf :3100) | `npm start` |
| Tests | `npm test` |

`npm run dev` läuft gegen die echte Steam-Installation. Die Fixture-Variante nur
bewusst über `PT_FAKE=1 npm run dev`.

Laufzeit-/Test-Overrides: `PT_FAKE`, `PT_FAKE_ROOT`, `PT_FAKE_SERVE`, `PT_EXPORT_ROOT`,
`PT_CONFIG_PATH`, `PORT`.

## Struktur

```
server/              Express-API (CommonJS)
  index.js           API-Routen, Scan-Cache, dient dist/ in Production
  config.js          config.json lesen/schreiben, Standardpfade
  scanner.js         Steam-Wurzeln → { mods, entriesByModId }; JSON- und Lua-TXT-Parser
  entries.js         Einträge speichern + Backup, fs-Fehler klassifizieren
  llm-io.js          LLM-Export-Bundle, Import-Vorschau und -Apply
  mod-export.js      Installierbaren Übersetzungs-Mod erzeugen
  fake-api.js        Nur Wurzel-Tausch auf server/fixtures/ (PT_FAKE=1)
  fixtures/          Beispieldaten im echten PZ-Layout
  fixtures-inject.js Synthetische Layout-Fixtures für tmp-Kopien in Tests
src/
  App.jsx            View-Umschaltung per State (kein Router-Paket)
  api.js             Einziger Zugriffspunkt auf die API
  components/        Button, Card, Input, Modal, ProgressBar, Tag
  styles/theme.css   Design-Tokens (CSS-Variablen)
  views/             Settings, Library, Editor, Exchange (= "Export"), Showcase (= "Design")
Resources/           Sample-Mods, Logos, Figma-Icons (git-ignoriert)
export/              Laufzeit-Ausgabe: mods/, backups/ (git-ignoriert)
config.json          Laufzeit (git-ignoriert)
```

Navigation: Settings | Library | Editor | Export | Design.

## Verträge, die nicht brechen dürfen

Diese Formen sind über Scanner, Editor, Export und Import hinweg verdrahtet — eine
Änderung an einer Stelle bricht die anderen.

- **entryId**: `<version>/<Quellsprachen-Pfad relativ zum Version-Ordner>::<key>`, z. B.
  `42.20/media/lua/shared/Translate/EN/ContextMenu.json::Key`. Das `version`-Segment ist
  entweder eine Versionsnummer, `common`, `root` oder `base`. Die Quellsprache ist
  derzeit fest `EN` (`scanner.js:32`); sobald sie konfigurierbar wird, ändern sich mit
  ihr alle entryIds — Scan-Cache und Editor-Änderungen müssen dann verworfen werden.
- **LLM-Datei-Keys** sind die Kurzform `<version>/<Dateiname>` (z. B. `42.20/UI.json`);
  `llm-io.js` rekonstruiert daraus die entryId.
- **API-Routenform** (`server/index.js`): `GET /api/status`, `POST /api/scan`,
  `GET|POST /api/config`, `GET /api/mods`, `GET|PUT /api/mods/:modId/entries`,
  `POST /api/export/llm`, `POST /api/import/llm/preview`, `POST /api/import/llm/apply`,
  `POST /api/export/mod`. Fehler immer als `{ error: "<lesbarer Text>" }` + 4xx/5xx.
- **Layout-Regeln** (identisch in `scanner.js`, `llm-io.js`, `mod-export.js`):
  `common` schließt `root` aus; zusätzlich immer nur die **neueste** Versionsnummer.
  Basisspiel hat einen Ort mit Version `base`.
- **Dateinamen-Ableitung EN → Zielsprache**: JSON bleibt gleich, TXT wird
  `<Name>_<LANG>.txt` (`Sandbox_EN.txt` → `Sandbox_DE.txt`). Siehe
  `scanner.targetFileName()`.
- **Backup vor jedem Überschreiben** nach
  `export/backups/<YYYY-MM-DD_HH-mm>/<modId>__<version>__<file>/`. Ein Ordner pro
  Speicher-Batch, wird nie automatisch gelöscht.
- **sessionStorage-Keys**: `pt_library_selected` (die Auswahl — nur die Library
  schreibt sie, Editor und Export lesen sie), `pt_library_locked`, `pt_editor_visible`
  (nur Sichtbarkeit im Editor), `pt_active_view`.
- **Disk ist die Quelle der Wahrheit**: PUT und Import-Apply lösen einen Rescan aus,
  bevor sie antworten.
- **Pfade immer POSIX-Style** (`/`) in APIs und config.json, auch auf Windows.

## Regeln

- Die Frontend holt Daten ausschließlich über `src/api.js`, nie direkte `fetch`-Aufrufe.
- Styles nur über die Tokens aus `src/styles/theme.css` und `src/components/` — keine
  eigenen Farben oder Abstände in Views.
- Keine neuen Pakete ohne Rückfrage.
- Die Oberfläche spricht Englisch — sichtbare Texte und die `{ error }`-Meldungen der
  API. Code-Kommentare dürfen deutsch bleiben.
- Bestehende Muster schlagen eigene Vorlieben — sieh in eine Nachbardatei.
- Keine Funktionen bauen, die im Auftrag nicht stehen. Fällt etwas auf, das fehlt:
  im Abschlussbericht erwähnen, nicht einbauen.
- Tests nie so anpassen, dass sie durchlaufen — stattdessen den Code reparieren.
- Vor dem Abschluss `npm test` und `npm run build` ausführen und das Ergebnis berichten.
- Der Dev-Server wird nie im Hintergrund stehen gelassen; wer ihn startet, beendet ihn.
- `server/scanner.test.js` läuft gegen die echte Steam-Installation und überspringt
  sich auf Maschinen ohne Project Zomboid. Das ist Absicht.
- Smoke-Tests, die direkt gegen `server/fixtures/` schreiben, verändern die Fixtures:
  danach `git status` prüfen und mit `git checkout -- server/fixtures` zurücksetzen.

## Umgebung

Windows 11. Schreiben in `C:\Program Files (x86)\...` (Spiel und Workshop) braucht
Administratorrechte — ohne sie meldet die API einen 403 mit lesbarem Text.
