# TODO – Project Translate

Abnahme: nach jedem Slice

## Aktueller Stand
0.3 fertig: Scanner-Tests gegen die echte Installation (echter Scan findet 453 Mods inkl.
Base Game, More-Traits liefert mehrere Mods mit je mehreren Versionen, Einträge korrekt).
18 Tests grün. Phase 0 vollständig. Nächster Punkt: 1.1

## Phase 0 – Fundament                             [fertig]
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

## Phase 1 – Frontend                              [geplant]
- [ ] 1.1 Design-Fundament · selbst · braucht 0.1
      fertig wenn: `npm run build` grün — eine Showcase-Seite zeigt Tokens
      (Farben, Schriften, Abstände) + Button, Card, Input, ProgressBar, Tag, Modal;
      dunkles Gaming-Theme, vom User abgenommen bevor Screens darauf aufsetzen
- [ ] 1.2 Setup-View · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Views-Wechsel via App-State, Status-Karten
      (Spiel/Workshop gefunden), Pfade editierbar, Zielsprache-Auswahl (Default DE),
      "Scannen"-Button mit Fortschrittsanzeige (Fake-Daten aus /api)
- [ ] 1.3 Mod-Übersicht (Canvas) · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Grid aller Mods mit Poster, Name,
      Eintragszahl, Fortschrittsbalken; Suche, Multi-Select + "Alle", Basisspiel als
      eigener Eintrag, Auswahl navigiert in den Editor
- [ ] 1.4 Editor-View (zweispaltig) · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Original rechts (readonly), Übersetzung
      links (editierbar), Statusfarben gelb/grün, Suche, Paginierung 50/Seite,
      Vor/Zurück-Navigation, Fortschrittsbalken pro Mod, Speichern via /api (PUT)
- [ ] 1.5 Exchange-View (LLM-Austausch) · delegieren · braucht 1.1, 0.2
      fertig wenn: `npm run build` grün — Export-Dialog (Mod-Auswahl, Zielsprache)
      schreibt nach export/llm/, Import zeigt Vorschau (matched/unmatched pro Mod)
      mit Bestätigung, beide gegen Fake-API

## Phase 2 – Durchstich                            [geplant]
- [ ] 2.1 Echter Scan + echtes Einlesen · delegieren · braucht 0.3, 1.3
      fertig wenn: `npm start` — Setup zeigt echten Status, Scan findet die echten
      362+ Mods, Mod-Liste zeigt echte Eintragszahlen, Editor zeigt echte
      Originaltexte inkl. Pre-Fill vorhandener DE-Werte (grün)
- [ ] 2.2 Echtes Speichern mit Backup · delegieren · braucht 2.1
      fertig wenn: Eintrag im echten Mod speichern überlebt Neustart, alte Datei liegt
      in export/backups/, Rechtefehler (nicht Admin) wird sauber im UI gemeldet

## Phase 3 – Funktionen                             [geplant]
- [ ] 3.1 LLM-Export/-Import echt · delegieren · braucht 2.1
      fertig wenn: Export erzeugt eine Datei pro Mod im richtigen Format
      (Versionen im Datei-Key), Import-Vorschau zuordnet korrekt, Apply schreibt
      targetLang-Dateien mit Backup, unmatched-Keys werden verworfen
- [ ] 3.2 Mod-Export · delegieren · braucht 2.1
      fertig wenn: `POST /api/export/mod` erzeugt kompletten installierbaren
      Übersetzungs-Mod (mod.info pro Version, Translate/<LANG>/-Bäume, icon.png),
      Zielordner wählbar, View zeigt Export-Dialog mit Ordnerauswahl
- [ ] 3.3 Finales Produktions-Setup · selbst · braucht 3.1, 3.2
      fertig wenn: `npm start` — Express dient gebautes Frontend + API auf :3100,
      `npm run build` grün, kein Dev-Server nötig

## Phase 4 – Abschluss                             [geplant]
- [ ] 4.1 Fehlerfälle und leere Zustände · delegieren
      fertig wenn: fehlendes Spiel/Workshop (leerer Zustand + Hilfe), kaputte
      JSON-Dateien (geskipped + gelistet, kein Abbruch), leerer Mod ohne Translate-
      Ordner, Export ohne Auswahl, Import leerer Ordner — alles sichtbar gemeldet,
      `npm run build` grün
- [ ] 4.2 Cleanup und README · selbst
      fertig wenn: Fixtures-Flag konsistent, toter Code entfernt, README zeigt
      Install, Start (inkl. Admin-Hinweis), Workflow Export→LLM→Import→Mod-Export;
      `npm run build && npm test` grün, letzter Commit

## Entscheidungen & Abweichungen
- `npm run dev` startet Vite + API über `scripts/dev.js` (eigenes Skript mit
  `child_process`), damit kein zusätzliches Paket wie `concurrently` nötig ist.
- Git-Identität repo-lokal: `Latency <latency@localhost>` (global nicht gesetzt).
- **mod.info beim Mod-Export liegt am Root** des exportierten Mods (nicht pro
  Version, wie in der ARCHITECTURE.md geschrieben) — `game_version` = höchste
  Version; Basisspiel-Export hat kein `game_version`. USER-Entscheidung, entspricht
  echten PZ-Mods. → ARCHITECTURE.md entsprechend anpassen (ist "nie anfassen",
  daher hier vermerkt).
- Eintrags-Pfade: `entryId` = `<version>/<EN-Pfad relativ zum Version-Ordner>::<key>`,
  d. h. `42.20/media/lua/shared/Translate/EN/ContextMenu.json::Key`; LLM-Export-Keys
  sind die kurze Form `<version>/<Kategorie>.json`.
- Test-/Runtime-Overrides: `PT_FAKE_ROOT`, `PT_EXPORT_ROOT`, `PT_CONFIG_PATH`,
  `PORT` (Defaults: server/fixtures/, export/, config.json, 3100) — Tests laufen
  auf tmp-Kopien, Fixtures bleiben unverändert.
- Scanner-Tests (`server/scanner.test.js`) laufen gegen die ECHTE Steam-Installation
  (Config-Defaults), nicht auf tmp-Kopien — das ist ihr Zweck. Auf Maschinen ohne
  PZ wird der Block übersprungen (`skip`, Assertions unverändert), damit `npm test`
  überall grün bleibt.

## Offene Punkte
- `ARCHITECTURE.md`: Zeile "`mod.info` pro Version" in "Mod-Export" auf "ein
  mod.info am Root, game_version = höchste Version" aktualisieren (Benutzer-
  Entscheidung, s. Entscheidungen).
- Vite 8 warnt, dass die ESM-Syntax in `vite.config.js` mit dem künftigen
  Default `configLoader: 'native'` nicht zusammenpasst — bei Gelegenheit auf
  `.mjs` umtauschen.
- Steam-Workshop-Auto-Upload (ausdrücklich NICHT in v1 — späteres Projekt)
- Electron-Verpackung (ausdrücklich NICHT in v1 — späteres Projekt)
