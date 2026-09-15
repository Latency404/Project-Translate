# Plan – Project Translate

Grundsatz: Der Funktionsumfang ist gewollt und funktioniert im Kern. Dieser Plan bringt
ihn von „läuft" auf „rund". Keine neuen Features, keine Umbauten an Architektur, Routen
oder Theme — außer ein Punkt hier verlangt es ausdrücklich.

## Ist-Zustand (geprüft am 2026-09-16)

- `npm test`: 43 Tests grün. `npm run build`: grün (265 kB JS, 24 kB CSS).
- Scanner läuft gegen die echte Steam-Installation und findet dort 100+ Mods
  inklusive Basisspiel.
- Vollständig da und benutzbar: Scan mit Fortschritt, Library mit Auswahl und Lock,
  Editor mit Suche/Sortierung/Speichern inkl. Backup, LLM-Export als eine Datei über
  den Browser-Save-Dialog, LLM-Import mit Vorschau und Bestätigung, Mod-Export als
  gebündelter Übersetzungs-Mod.
- Testabdeckung: Backend solide (Scanner-Parser, Layouts, Export, Import, Fehler-
  klassifikation, Routen-Roundtrip). Nicht abgedeckt: die Routen
  `POST /api/export/mod` und `POST /api/import/llm/apply`, und das Frontend komplett.

Die Reihenfolge der Phasen ist nach Schadenshöhe sortiert: A verhindert Datenverlust,
B macht die App bei echter Mod-Zahl benutzbar, C liefert ein im Spiel funktionierendes
Ergebnis, D und E sind Aufräumen und Release.

## Phase A – Datenverlust und blockierte Bedienung

### A1 Settings: Konfiguration lässt sich nicht speichern
`src/views/Settings.jsx:76` definiert `handleSave`, aber kein Button ruft es auf (die
einzigen Buttons sind Scan und „Go to Library", `Settings.jsx:182` und `:186`). Pfade und
Zielsprache sind editierbar, aber jede Änderung ist beim nächsten Laden weg; `config.json`
lässt sich nur von Hand ändern.

Fertig wenn: Ein Speichern-Button in der Configuration-Karte schreibt die Werte über
`api.saveConfig`, die Karte zeigt Erfolg oder Fehler, und ein Neuladen der Seite zeigt
die gespeicherten Werte. Zusätzlich ist erkennbar, dass ungespeicherte Änderungen
offen sind (Button aktiv/inaktiv genügt).

### A2 Editor: Fehlgeschlagene Speicherungen verwerfen die Eingaben
`src/views/Editor.jsx:249-259`: Die Schleife speichert Mod für Mod, jeder Fehler
überschreibt `saveError` (nur der letzte bleibt sichtbar), danach leert
`setDirty(new Map())` **alle** Änderungen — auch die von Mods, deren Speichern
fehlgeschlagen ist. Bei fehlenden Schreibrechten (häufigster Fall: nicht als
Administrator gestartet) verliert der Nutzer seine Eingaben und sieht nur eine Meldung.

Fertig wenn: Nur erfolgreich gespeicherte Einträge werden aus `dirty` entfernt;
fehlgeschlagene Mods behalten ihre Eingaben und werden benannt (alle, nicht nur der
letzte). Manuell prüfbar, indem man eine Zieldatei schreibgeschützt macht.

### A3 Editor: Ungespeicherte Änderungen gehen beim View-Wechsel verloren
`src/App.jsx:82` rendert den Editor bedingt, beim Wechsel auf eine andere Seite wird er
ausgehängt und die `dirty`-Map ist weg — ohne Warnung.

Fertig wenn: Ein Wechsel weg vom Editor mit ungespeicherten Änderungen wird abgefangen
(Rückfrage oder Erhalt der Änderungen — eine der beiden Varianten, nicht beide).
Braucht A2, damit der Zustand eindeutig ist.

## Phase B – Skalierung auf die echte Mod-Zahl

### B1 Editor lädt und rendert alles auf einmal
`src/views/Editor.jsx:183` fordert `pageSize: 99999` für **jeden** ausgewählten Mod an
und rendert jede Zeile ins DOM. Die API kann bereits paginieren und suchen
(`server/index.js:158-176`, Default 50, Maximum 500). Bei einer großen Auswahl —
insbesondere mit dem Basisspiel — bedeutet das zehntausende Zeilen in einem Rutsch.

Fertig wenn: Der Editor bleibt bei einer Auswahl aus Basisspiel + mindestens 20 Mods
flüssig bedienbar (Tippen ohne spürbare Verzögerung). Ob über Paginierung, Nachladen
beim Scrollen oder Virtualisierung, ist eine Umsetzungsfrage — Suche, Sortierung und
das Speichern versteckter/ungeladener Änderungen müssen weiter funktionieren. Vorher
den Ist-Zustand messen, damit „flüssig" belegt ist und nicht behauptet.

### B2 Library rendert alle Mods samt Postern gleichzeitig
`src/views/Library.jsx:217` legt für jeden gefundenen Mod eine Karte an, jedes Poster
ist eine eigene Anfrage an `/mod-poster` (`server/index.js:135`). Bei 450 Mods sind das
450 Karten und hunderte parallele Bildanfragen beim Öffnen.

Fertig wenn: Die Library öffnet sich bei der echten Mod-Zahl ohne merkliche Hängephase.
Mindestens `loading="lazy"` an den Postern; falls das nicht reicht, die Kartenliste
begrenzen oder virtualisieren. Suche, Auswahl und Lock bleiben unverändert.

## Phase C – Mod-Export, der in B42 wirklich lädt

Das ist die bisherige Phase 3.5, weiterhin offen und weiterhin richtig. Quellen:
PZ-API-Doku 42.19 (modinfo), pzwiki „Mod.info" und „Mod structure".

### C1 mod.info an den richtigen Ort
`server/mod-export.js:94` schreibt `mod.info` an den Wurzelordner des exportierten Mods.
In B42 gehört sie in den Layout-Ordner neben `media/` (also `42.20/mod.info` bzw.
`common/mod.info`); nur bei echtem Root-Layout liegt sie am Wurzelordner.

Fertig wenn: Die Datei liegt im jeweiligen Layout-Ordner, Bundle-Export inbegriffen,
und `mod-export.test.js` prüft das.

### C2 Gültige Felder in mod.info
`server/mod-export.js:89-93` schreibt `name`, `author` und `game_version`.
`game_version` ist kein gültiger Schlüssel, und das Pflichtfeld `id` fehlt.

Fertig wenn: Jede `mod.info` hat `id`, `name`, `author`, `description` und
`versionMin`/`versionMax` (Format `42.20`, aus den Layout-Versionen abgeleitet);
`game_version` ist weg. Die `id` ist deterministisch — derselbe Mod und dieselbe
Sprache ergeben dieselbe id (z. B. `<slug(workshopId|name)>_<lang>`), damit ein
erneuter Export den vorigen im Spiel ersetzt statt zu duplizieren. Gültige Schlüssel
laut Doku: author, category, description, icon, id, incompatible, loadModAfter,
loadModBefore, modversion, name, pack, poster, require, tiledef, url, versionMax,
versionMin. Braucht C1.

### C3 Poster und Icon verdrahten
`server/mod-export.js:99-108` kopiert ein `icon.png`, deklariert es aber in keiner
`mod.info` — die Datei liegt ungenutzt herum.

Fertig wenn: Ein kopiertes Bild steht als `poster=` bzw. `icon=` in derselben
`mod.info`, mit Dateinamen relativ zu deren Ordner; nicht deklarierte Bilder werden
nicht kopiert. Braucht C2.

### C4 Bundle-Ordnername kann den Pfad sprengen
`server/mod-export.js:165` bildet den Ordnernamen aus allen Mod-Namen, verbunden mit
` + `. Bei einer Auswahl von 50 Mods entsteht ein Name aus hunderten Zeichen — auf
Windows läuft das in die Pfadlängen-Grenze, und Mod-Namen können Zeichen enthalten, die
in Ordnernamen nicht erlaubt sind.

Fertig wenn: Der Ordnername ist begrenzt und von unerlaubten Zeichen befreit (z. B. ab
mehreren Mods ein fester Name plus Anzahl); ein Export aus vielen Mods legt einen
gültigen Ordner an. Test mit einer Auswahl, deren Namen zusammen die Grenze reißen
würden.

### C5 Abnahme im Spiel
Fertig wenn: `mod-export.test.js` deckt die neuen Pfade, Felder, die id-Determinismus-
Regel und das Bundle ab, `npm test` und `npm run build` sind grün, und der exportierte
Ordner lässt sich unverändert nach `<game>/mods/` legen, im Launcher aktivieren und die
Übersetzung erscheint im Spiel. Der letzte Schritt ist eine Prüfung durch den Nutzer,
kein automatischer Test.

## Phase D – Aufräumen

### D1 Zwei Export-Implementierungen zusammenführen
`server/mod-export.js:81` (`exportMod`) hat außerhalb der Tests keinen Aufrufer — die
Route nutzt `exportModsBundle` (`server/index.js:275`). Beide Funktionen enthalten
denselben Traversal- und Filter-Block (`mod-export.js:110-149` und `:195-231`).

Fertig wenn: Die gemeinsame Logik existiert einmal; `npm test` läuft unverändert grün
(die Tests für beide Wege bleiben bestehen und beschreiben weiterhin dasselbe
Verhalten). Nach Phase C machen, sonst wird die Zusammenführung zweimal gemacht.

### D2 Reste und Stolpersteine
Einzeln klein, zusammen ein Nachmittag:
- `server/scanner.js:356-370`: Der Deduplizierungs-Block hat einen leeren `if`-Zweig
  mit fünf sich widersprechenden Kommentarzeilen. Das Verhalten (JSON gewinnt gegen
  TXT bei gleicher entryId) ist richtig — es braucht drei Zeilen Code und einen Satz
  Kommentar.
- `scanner.targetFileName()` nimmt einen dritten Parameter `enDir`, der nie benutzt
  wird (`scanner.js:266`, Aufrufer in `mod-export.js:129` und `:214`).
- `src/views/Library.jsx:2` importiert `LayoutGrid` und `Search`, beide ungenutzt.
- `src/views/Editor.jsx:518` und `:527`: Die Icons sind vertauscht — `FileInput` sitzt
  auf „Export", `FileOutput` auf „Import".
- `src/App.jsx:3` importiert `Settings.jsx` unter dem Namen `Setup`.

Fertig wenn: Alles oben erledigt, `npm test` und `npm run build` grün.

### D3 Quellsprache: entscheiden statt anbieten
`src/views/Settings.jsx:148` bietet eine Auswahl für die Quellsprache an; der Scanner
benutzt die Konstante `SOURCE_LANG = 'EN'` (`server/scanner.js:32`) und ignoriert den
Wert vollständig. Die Auswahl verspricht etwas, das nicht passiert.

Fertig wenn: Entweder ist das Feld raus, oder die Quellsprache wirkt wirklich durch
Scanner, Export und Import. Die Entscheidung trifft der Nutzer (siehe „Offene
Entscheidungen").

## Phase E – Robustheit und Release

### E1 Ehrliche Fehler- und Leerzustände
`src/views/Library.jsx:142` zeigt bei **jedem** Fehler „No scan has been performed yet"
— auch bei einem Serverfehler oder abgebrochener Verbindung. Der Editor verhält sich
ähnlich (`Editor.jsx:396`).

Fertig wenn: Unterschieden wird zwischen „noch kein Scan" und einem echten Fehler
(dessen Text angezeigt wird). Abgedeckt sind außerdem: Spiel/Workshop nicht gefunden,
Mod ohne Translate-Ordner, Export ohne Auswahl, Import einer Datei, die zu keinem Mod
passt, und fehlende Schreibrechte — jeweils mit einer verständlichen Meldung statt
einer leeren Fläche.

### E2 Config-Validierung
`server/config.js:35` schreibt jeden übergebenen Body ungeprüft in `config.json` —
beliebige Pfade, beliebige Sprachcodes.

Fertig wenn: `POST /api/config` lehnt nicht existierende Pfade und ungültige
Sprachcodes mit `{ error }` und 400 ab, die Settings-View zeigt die Meldung an einem
Feld. Braucht A1, sonst ist die Validierung nicht erreichbar.

### E3 Eine Sprache in der Oberfläche
Die UI mischt Deutsch und Englisch: „Search… (all mods)" neben „Gespeichert: 3 Einträge
in 2 Mod(s)." (`Editor.jsx:511` und `:264`), englische Leerzustände in Library und
Export neben deutschen Fehlermeldungen aus dem Server (`entries.js:81`).

Fertig wenn: Die Oberfläche spricht durchgehend eine Sprache, Servermeldungen
inbegriffen. Welche, entscheidet der Nutzer (siehe unten).

### E4 Testlücken schließen
Fertig wenn: `POST /api/export/mod` und `POST /api/import/llm/apply` haben je einen
Routen-Test (Fake-Modus, tmp-Kopie wie die bestehenden Tests in `index.test.js`),
`npm test` grün.

### E5 README
Fertig wenn: Eine README erklärt Installation, Start inklusive Administrator-Hinweis
und den Weg Scan → Auswahl → Editor → LLM-Export → Import → Mod-Export, sodass jemand
Fremdes das Projekt danach bedienen kann.

### E6 Vite-Konfiguration entwarnen
`npm run build` warnt, dass die ESM-Syntax in `vite.config.js` mit dem künftigen
Default `configLoader: 'native'` nicht zusammenpasst.

Fertig wenn: Die Warnung ist weg (Umbenennen auf `.mjs` oder `"type": "module"`
setzen — Letzteres betrifft die CommonJS-Dateien im Server, also vorher prüfen),
`npm run build` und `npm start` laufen.

## Offene Entscheidungen für den Nutzer

1. **Oberflächensprache** (E3): durchgehend Deutsch oder durchgehend Englisch?
2. **Quellsprache** (D3): Auswahlfeld entfernen oder wirklich implementieren?
3. **Editor bei großer Auswahl** (B1): Paginierung mit Seitenblättern oder Nachladen
   beim Scrollen?

## Nicht im Scope

- Steam-Workshop-Auto-Upload und Electron-Verpackung — bewusst spätere, eigene Projekte.
- Übersetzungsinhalte und -formate (JSON und Lua-TXT sind valide und getestet).
- Die API-Routenform, das Design-Fundament (`src/components/`, `src/styles/theme.css`)
  und die Verträge aus [CLAUDE.md](CLAUDE.md).
