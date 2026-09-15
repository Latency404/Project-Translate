# TODO – Project Translate

Abnahme: nach jedem Slice

## Aktueller Stand
**Aktueller Stand:** Phasen 2–3 fertig. Neue Entscheidung (2026-09-15, USER):
Editor, Export und Library teilen eine gemeinsame Mod-Auswahl — die
Library-Auswahl (mit neuem Lock-Button gegen versehentliches Abwählen) steuert
Editor-Sidebar und Export-View. **Editor-Übersicht im Lock-Status (USER,
2026-09-15):** Im gelockten Editor steuern die Sidebar-Checkboxes nur ein
lokales Sichtbarkeits-Overlay („Show/Hide", „Hide all"/„Show all", Label
„Selected · visible (n/m)") — die gelockte Auswahl, die Library und der
Export bleiben unverändert; das Overlay ist nicht persistiert und greift
nur, solange gelockt. Ungeändert bleibt, dass der Editor `modIds` nie mehr
schreibt (Library = einziger Writer) und Save die volle Auswahl umspannt
(versteckte Mods behalten ihre Edits). `npm run build` + `npm test` (37) grün.
Nächstes: Phase 4 (4.1 Duplikate zusammenführen).

## Phase 0 – Fundament [fertig]
- [x] 0.1 Projekt aufsetzen · selbst
      fertig wenn: `npm install && npm run dev` läuft (Vite + API-Port), leere Seite
      erscheint, `git init` + erster Commit vorhanden, `npm test` läuft grün (0 Tests ok)
- [x] 0.2 Express-API mit echten Routen auf Fixtures · selbst · braucht 0.1
      fertig wenn: `npm test` grün — `server/fixtures/` im echten PZ-Layout liegt
      (3 SampleMods + Mini-Base-Game mit EN- und DE-Dateien), alle Routen aus
      ARCHITECTURE.md liefern auf `PT_FAKE=1` Fixture-Daten, `GET /api/mods` zeigt
      alle 4 Mods mit entryCount
- [x] 0.3 Scanner-Tests gegen echte Daten · selbst · braucht 0.2
      fertig wenn: `npm test` grün — `scanner.js` wird in Tests gegen die echte
      Workshop-Wurzel + Game-Root gelaufen, findet ≥ 100 Mods inkl. Base Game,
      `1299328280` (More Traits) liefert mehrere Mods mit je mehreren Versionen, Einträge haben
      id/file/key/original korrekt

## Phase 1 – Frontend [fertig]
- [x] 1.1 Design-Fundament · selbst · braucht 0.1
      fertig wenn: `npm run build` grün — eine Showcase-Seite zeigt Tokens
      (Farben, Schriften, Abstände) + Button, Card, Input, ProgressBar, Tag, Modal;
      dunkles Gaming-Theme, vom User abgenommen bevor Screens darauf aufsetzen
- [x] 1.2 Setup-View · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Views-Wechsel via App-State, Status-Karten
      (Spiel/Workshop gefunden), Pfade editierbar, Zielsprache-Auswahl (Default DE),
      "Scannen"-Button mit Fortschrittsanzeige (Fake-Daten aus /api)
- [x] 1.3 Mod-Übersicht (Canvas) · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Grid aller Mods mit Poster, Name,
      Eintragszahl, Fortschrittsbalken; Suche, Multi-Select + "Alle", Basisspiel als
      eigener Eintrag, Auswahl navigiert in den Editor
- [x] 1.4 Editor-View (zweispaltig) · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Original rechts (readonly), Übersetzung
      links (editierbar), Statusfarben gelb/grün, Suche, Paginierung 50/Seite,
      Vor/Zurück-Navigation, Fortschrittsbalken pro Mod, Speichern via /api (PUT)
- [x] 1.5 Exchange-View (LLM-Austausch) · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Export-Dialog (Mod-Auswahl, Zielsprache)
      schreibt nach export/llm/, Import zeigt Vorschau (matched/unmatched pro Mod)
      mit Bestätigung, beide gegen Fake-API

## Phase 2 – Durchstich [fertig]
- [x] 2.1 Echter Scan + echtes Einlesen · delegieren · braucht 0.3, 1.3
      fertig wenn: `npm start` — Setup zeigt echten Status, Scan findet die echten
      362+ Mods, Mod-Liste zeigt echte Eintragszahlen, Editor zeigt echte
      Originaltexte inkl. Pre-Fill vorhandener DE-Werte (grün)
- [x] 2.2 Echtes Speichern mit Backup · selbst · braucht 2.1
      fertig wenn: Eintrag im echten Mod speichern überlebt Neustart, alte Datei liegt
      in export/backups/, Rechtefehler (nicht Admin) wird sauber im UI gemeldet

## Phase 3 – Funktionen [fertig]
- [x] 3.1 LLM-Export/-Import echt · selbst · braucht 2.1
      fertig wenn: Export erzeugt eine Datei pro Mod im richtigen Format
      (Versionen im Datei-Key), Import-Vorschau zuordnet korrekt, Apply schreibt
      targetLang-Dateien mit Backup, unmatched-Keys werden verworfen
- [x] 3.2 Mod-Export · selbst · braucht 2.1
      fertig wenn: `POST /api/export/mod` erzeugt kompletten installierbaren
      Übersetzungs-Mod (mod.info pro Version, Translate/`<LANG>`/-Bäume, icon.png),
      Zielordner wählbar, View zeigt Export-Dialog mit Ordnerauswahl
- [x] 3.3 Finales Produktions-Setup · selbst · braucht 3.1, 3.2
      fertig wenn: `npm start` — Express dient gebautes Frontend + API auf :3100,
      `npm run build` grün, kein Dev-Server nötig

## Phase 4 – Review [geplant]
- [ ] 4.1 Duplikate zusammenführen · selbst · braucht 3.3
      fertig wenn: gleiche Logik existiert nur noch an einer Stelle (z. B.
      Entry-Id-/Pfad-Parsing in scanner.js, entries.js, llm-io.js, mod-export.js),
      `npm test` + `npm run build` laufen danach unverändert grün
- [ ] 4.2 Toter Code und Fake-API-Reste raus · selbst · braucht 4.1
      fertig wenn: keine ungenutzten Dateien, Funktionen oder Importe mehr
      (Fake-API-Flag `PT_FAKE`, `fake-api.js`, Fixture-Routen — nur bleiben lassen,
      was Tests noch brauchen), `npm start` startet sauber, `npm test` grün
- [ ] 4.3 Struktur konsistent machen · selbst · braucht 4.2
      fertig wenn: Benennung und Ordneraufbau folgen überall demselben Muster
      (View-Namen, server/-Modul-Namen, API-Funktionsnamen), `npm test` grün

## Phase 5 – Release [geplant]
- [ ] 5.1 Leere Zustände und Fehlerfälle · delegieren · braucht 4.3
      fertig wenn: fehlendes Spiel/Workshop (leerer Zustand + Hilfe), kaputte
      JSON-Dateien (geskipped + gelistet, kein Abbruch), leerer Mod ohne Translate-
      Ordner, Export ohne Auswahl, Import leerer Ordner, Rechtefehler (nicht
      Admin) — alles zeigt eine verständliche Meldung statt einer leeren Fläche,
      `npm run build` grün
- [ ] 5.2 Validierung · delegieren · braucht 4.3
      fertig wenn: Setup-View lehnt ungültige Pfade mit klarer Meldung ab,
      Import lehnt Dateien ab, die keinem Mod/Format zuzuordnen sind,
      `npm test` grün
- [ ] 5.3 Responsive · delegieren · braucht 4.3
      fertig wenn: alle Views ab Mindestdesktop-Breite (1024px) ohne horizontales
      Scrollen bedienbar, Editor-Spalten brichen sauber um, `npm run build` grün
- [ ] 5.4 README · selbst · braucht 5.1, 5.2, 5.3
      fertig wenn: README zeigt Install, Start (inkl. Admin-Hinweis), Workflow
      Export→LLM→Import→Mod-Export — Fremder kann das Projekt nach der Anleitung
      starten, `npm run build && npm test` grün, letzter Commit

## Entscheidungen & Abweichungen
- **2.1: Poster-Fix als Nachbesserung (USER-Entscheidung):** Im echten Modus
  lieferte `posterUrl()` für alle Workshop-Mods `null` (nur BASE bekam
  `/base-game-poster.jpg`) — die Library zeigte für alle 452 echten Mods
  „No poster". Fix: neue Route `GET /mod-poster?m=<modId>` in server/index.js
  dient das Poster von der Disk (Dateipfad aus dem gecachten Mod, nicht aus
  der URL — kein Pfad-Traversing; nur *.png). `posterUrl()` liefert im echten
  Modus diese URL. 131 von 453 Mods haben ein Poster (poster.png oder
  generic.png).
- **LLM-Export wandert in die Editor-Toolbar (Nacht-Session 14.09):** Der
  LLM-Export-Button (exportLlm) sitzt jetzt neben Save im Editor und exportiert
  die dort ausgewählten Mods — die Export-View hat dafür einen echten Mod-Export
  (POST /api/export/mod) mit wählbarem Zielordner bekommen. Damit ist 3.2 (Mod-
  Export) im Fake-Mode vorgezogen; die View-Abnahme von 3.2 passiert mit 2.1
  gegen echte Pfade.
- **Eine gemeinsame Mod-Auswahl (USER, 2026-09-15):** Editor, Export und
  Library teilen eine einzige Auswahl (sessionStorage `pt_library_selected`) —
  Editor-Sidebar und Export-View zeigen nur die ausgewählten Mods, keine
  eigenständige Editor-Auswahl mehr (alter Key `pt_editor_selection` ist weg).
  Library hat einen Lock-Button (`pt_library_locked`): gesperrt ignorieren
  Karten-Klicks und „All" die Auswahl. Im Editor sind die Sidebar-Checkboxes
  im Lock-Status trotzdem aktiv, steuern aber nur ein lokales
  Sichtbarkeits-Overlay (siehe Auswahl-Verbund in „Aktueller Stand") — die
  gelockte Auswahl bleibt unverändert. App.jsx verdrahtet die Auswahl nicht
  mehr (keine initialModIds/ onSelectionChange).
- **Editor verwaltet eigene Mod-Auswahl (Nacht-Session 14.09):** [ersetzt —
  siehe Auswahl-Verbund oben, 2026-09-15]
- **Disk ist immer die Quelle der Wahrheit (2.2, 2026-09-15):** PUT (Speichern)
  und Import-Apply triggern in BEIDEN Modi einen Rescan, der die Disk in den
  Cache spiegelt — der Editor sieht gespeicherte Änderungen sofort (vorher nur
  Fake-Mode; im echten Modus sah der Editor nach PUT alte Werte, bis zum nächsten
  manuellen Scan). Race-Case unverändert: war beim PUT-Schreib ein rescan aktiv,
  läuft danach ein zweiter (das erste Snapshot ist veraltet). `rescan()` +
  `rescanning`-Flag in server/index.js.
- **2.2: Rechtefehler-Klassifikation (2026-09-15):** `classifyFsError(err, pfad)`
  in `entries.js` übersetzt fs-Fehler in deutsche, menschenlesbare Meldungen
  (EACCES/EPERM → „Zielordner nicht schreibbar: <Pfad> — Schreibrechte fehlen …",
  EBUSY/EAGAIN/EMFILE/ENFILE → „Datei belegt …", sonst `err.message`) und setzt
  `err.status = 403` bei Rechtefehlern. Idempotent (`.ptFsClassified`): wer zuerst
  klassifiziert, gewinnt — `saveBatch` kennt den exakten Zielpfad und wird
  vor der Route-Classifier in `index.js` (die nur den Mod-Root kennt) gemeldet.
  PUT und Import-Apply verdrahten sie im catch; Backup-Copy-Fehler fallen unter
  500, da dort keine 4xx-Meldung passt.
- **config.load() schreibt nichts mehr (Nacht-Session 14.09):** Existiert
  config.json nicht, liefert load() DEFAULTS ohne die Datei anzulegen — nur
  save() schreibt. Davor landete im Fake-Mode ein config.json mit Steam-Pfaden
  im Projektroot (liegt noch: config.json, gitignored).
- **Navigation: 5 Seiten (USER, Slice 5/6):** Editor ist eine eigene Nav-Seite
  direkt rechts neben Library; die Mod-Übersicht heißt „Library". Nav-Reihenfolge:
  Settings | Library | Editor | Export | Design. Die Library-Auswahl wirkt sofort —
  der Editor liest sie live über `onSelectionChange` (Library bleibt mountet,
  Auswahl überlebt View-Wechsel); „Translate"-Button entfällt. Nach neuem Scan
  oder „Go to Library" aus dem Editor wird die Auswahl frisch (library-Key).
  `src/views/Mods.jsx` → `src/views/Library.jsx`.
- **Design-Palette (USER, Slice 1.1):** Carbon-Theme (#0a0a0a/#121517), Text
  #f5f5f5, Muted #ababab, Base-Game-Tag Dust Grey #c4c4c4,
  Accent #e21d1d (Light #ff4040 = Button-Hover — Hover wird heller, nicht
  dunkler; Deep #8a1414), Status: warning #e2901d, success #1de252,
  danger #e21d1d — danger und accent tragen denselben Ton; danger wird nur für
  negative Pills/Buttons (Fehler, Abbruch) verwendet, nie für primäre Aktionen.
  ProgressBar kennt bewusst keinen accent-Ton, damit sich beide nie kreuzen;
  als neutralen Fortschritts-Ton gibt es zusätzlich dust.
  Button-Schrift (alle Größen/Varianten mit Akzent) steht in text-text.
- `npm run dev` startet Vite + API über `scripts/dev.js` (eigenes Skript mit
  `child_process`), damit kein zusätzliches Paket wie `concurrently` nötig ist.
- **Dev startet permanent im echten Modus (USER, 2026-09-15):** `scripts/dev.js`
  setzt `PT_FAKE` nicht mehr (Default war `'1'`); Vite und API erben die
  Umgebung 1:1. Fake-API nur noch bewusst via `PT_FAKE=1 npm run dev` —
  Tests sind davon unberührt (`server/index.test.js` setzt `PT_FAKE: '1'` selbst).
- `GET /api/status` liefert zusätzlich `scanProgress: { done, total, current }`
  (aus dem in-memory-Scan-State in server/index.js) — die Routenform sonst unverändert.
- **Exchange-View ohne Ordner-Auswahl (Slice 1.5):** LLM-Export/Import nutzen immer
  den Standard-Ordner `export/llm/<targetLang>` (dir-Parameter der API bleibt für
  spätere Slices/CLI). Mod-Export (3.2) bekommt dagegen wahlweise einen Zielordner.
- Git-Identität repo-lokal: `Latency <latency@localhost>` (global nicht gesetzt).
- **3.2: Layout-Traversal gehört in mod-export.js, nicht in den Mod-Cache
  (2026-09-15):** `layoutLocations()` (common exklusiv mit root, dann
  `mod.versions`) folgt der Reihenfolge aus `scanner.scan()` und prüft die
  Translate-Direktoren auf der Platte statt `mod.versions` — so exportieren
  auch reine common-/root-Mods (versions = []) ihre Bäume. `written` in
  `exportMod()` ist einheitlich relativ zum exportierten Mod-Ordner
  (vorher gemischt: mod.info/icon relativ zum targetDir).
- **mod.info beim Mod-Export liegt am Root** des exportierten Mods (nicht pro
  Version, wie in der ARCHITECTURE.md geschrieben) — `game_version` = höchste
  Version; Basisspiel-Export hat kein `game_version`; ein reines common/root-
  Layout (keine Versionsordner) ebenfalls. USER-Entscheidung, entspricht
  echten PZ-Mods. → ARCHITECTURE.md entsprechend anpassen (ist "nie anfassen",
  daher hier vermerkt).
- Eintrags-Pfade: `entryId` = `<version>/<EN-Pfad relativ zum Version-Ordner>::<key>`,
  d. h. `42.20/media/lua/shared/Translate/EN/ContextMenu.json::Key`; LLM-Export-Keys
  sind die kurze Form `<version>/<Kategorie>.json`.
- **Versionsregel (USER):** Hat ein Mod mehrere Versionen, wird immer nur die
  NEUESTE Version gescannt, übersetzt und exportiert; ältere Version-Ordner
  bleiben auf der Platte, aber ungenutzt. Implementiert im Scanner (versions =
  [neueste]); Export und LLM-Export folgen daraus, da beide auf den
  Scanner-Einträgen aufbauen.
- Test-/Runtime-Overrides: `PT_FAKE_ROOT`, `PT_EXPORT_ROOT`, `PT_CONFIG_PATH`,
  `PORT` (Defaults: server/fixtures/, export/, config.json, 3100) — Tests laufen
  auf tmp-Kopien, Fixtures bleiben unverändert.
- Scanner-Tests (`server/scanner.test.js`) laufen gegen die ECHTE Steam-Installation
  (Config-Defaults), nicht auf tmp-Kopien — das ist ihr Zweck. Auf Maschinen ohne
  PZ wird der Block übersprungen (`skip`, Assertions unverändert), damit `npm test`
  überall grün bleibt.

## Offene Punkte
- **LLM-Export/-Import im Editor (USER-Entscheidung, andere Session):**
  Gewollt — LLM-Export/Import sitzen ausschließlich in der Editor-Toolbar;
  die Export-View zeigt nur Mod-Export (3.2), keinen LLM-Teil.
- **3.2: View + Fake-API-Vorgriff (14.09)** ist mit dem echten Slice 3.2 (15.09)
  abgeschlossen — Route, exportMod(), Exchange-View mit Zielordner und die
  Abnahme gegen echte Pfade stehen jetzt.
- Altes `config.json` im Projektroot (gitignored) aus Fake-Mode-Tests — beim
  nächsten echten Start überschrieben; kann auch weg.
- Smoke-Tests, die `importApply`/`PUT entries` direkt gegen `server/fixtures/`
  rufen, ändern die Fixture-Dateien (DE-Bäume/Backups) — nach solchen Tests
  `git status` auf Fixtures prüfen und mit `git checkout -- server/fixtures`
  zurücksetzen (war beim Review von 1.5 der Fall).
- `ARCHITECTURE.md`: Zeile "mod.info pro Version" in "Mod-Export" auf "ein
  mod.info am Root, game_version = höchste Version" aktualisieren (Benutzer-
  Entscheidung, s. Entscheidungen).
- Vite 8 warnt, dass die ESM-Syntax in `vite.config.js` mit dem künftigen
  Default `configLoader: 'native'` nicht zusammenpasst — bei Gelegenheit auf
  `.mjs` umtauschen.
- Steam-Workshop-Auto-Upload (ausdrücklich NICHT in v1 — späteres Projekt)
- Electron-Verpackung (ausdrücklich NICHT in v1 — späteres Projekt)
