# Plan – Project Translate

Grundsatz: Der Funktionsumfang ist gewollt und funktioniert im Kern. Dieser Plan bringt
ihn von „läuft" auf „rund". Keine neuen Features, keine Umbauten an Architektur, Routen
oder Theme — außer ein Punkt hier verlangt es ausdrücklich.

## Ist-Zustand (Stand 2026-09-16, abends)

- `npm test`: 54 Tests grün. `npm run build`: grün (267 kB JS, 24 kB CSS).
- Scanner läuft gegen die echte Steam-Installation und findet dort 450+ Mods
  inklusive Basisspiel.
- Vollständig da und benutzbar: Scan mit Fortschritt, Library mit Auswahl und Lock,
  Editor mit Suche/Sortierung/Speichern inkl. Backup, LLM-Export als eine Datei über
  den Browser-Save-Dialog, LLM-Import mit Vorschau und Bestätigung, Mod-Export als
  gebündelter Übersetzungs-Mod.

Erledigt an diesem Tag: **A1–A3** (Datenverlust), **B2** (Library-Poster),
**C1–C4** (B42-konforme mod.info), **D1** (doppelte Export-Logik), **E2**
(Config-Validierung), **E8** (Vite-Warnung).

Noch offen: **B1** (Editor lädt beim Scrollen nach), **C5** (Abnahme im Spiel — nur
der Nutzer kann das), **D2/D3** (Reste, Quellsprache), **E1**, **E3–E7**.

Testabdeckung: Backend solide. Nicht abgedeckt: die Routen `POST /api/export/mod`
und `POST /api/import/llm/apply`, und das Frontend komplett.

Die Reihenfolge der Phasen ist nach Schadenshöhe sortiert: A verhindert Datenverlust,
B macht die App bei echter Mod-Zahl benutzbar, C liefert ein im Spiel funktionierendes
Ergebnis, D und E sind Aufräumen und Release.

## Phase A – Datenverlust und blockierte Bedienung [erledigt 2026-09-16]

Alle drei Punkte umgesetzt (Commit `a0d896c`). Einschränkung: A2 und A3 sind durch
Code-Review abgesichert, aber nicht im laufenden Betrieb ausgelöst worden — ein echter
403-Fall (Schreiben ohne Administratorrechte) wurde nicht provoziert. Wer das nachholt,
prüft am besten beides zusammen: Zieldatei schreibgeschützt setzen, im Editor etwas
ändern, speichern, und danach die Seite wechseln und zurückkommen.

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

Entschieden (Nutzer, 2026-09-16): **Nachladen beim Scrollen** — eine durchgehende
Liste, die nachlädt, wenn man unten ankommt. Keine Seitenblätter.

Fertig wenn: Der Editor bleibt bei einer Auswahl aus Basisspiel + mindestens 20 Mods
flüssig bedienbar (Tippen ohne spürbare Verzögerung). Suche und Sortierung wirken
weiterhin über den **ganzen** Bestand eines Mods, nicht nur über das bereits Geladene —
die API filtert und sortiert serverseitig bzw. wird beim Suchen neu angefragt.
Änderungen an Einträgen, die zwischenzeitlich aus dem Blick gescrollt sind, bleiben
gespeichert und speicherbar. Vorher den Ist-Zustand messen, damit „flüssig" belegt ist
und nicht behauptet.

### B2 Library rendert alle Mods samt Postern gleichzeitig [erledigt 2026-09-16]
Gelöst mit `loading="lazy"`: beim Öffnen werden nur noch die sichtbaren Poster
angefordert (an 453 echten Mods gemessen: 15 statt 453 Anfragen).
Ursprüngliches Problem: `src/views/Library.jsx:217` legt für jeden gefundenen Mod eine Karte an, jedes Poster
ist eine eigene Anfrage an `/mod-poster` (`server/index.js:135`). Bei 450 Mods sind das
450 Karten und hunderte parallele Bildanfragen beim Öffnen.

Fertig wenn: Die Library öffnet sich bei der echten Mod-Zahl ohne merkliche Hängephase.
Mindestens `loading="lazy"` an den Postern; falls das nicht reicht, die Kartenliste
begrenzen oder virtualisieren. Suche, Auswahl und Lock bleiben unverändert.

## Phase C – Mod-Export, der in B42 wirklich lädt [C1–C4 erledigt 2026-09-16]

C1–C4 sind umgesetzt (Commit `b72701b`). Das Format wurde gegen die 909 echten
mod.info-Dateien der Workshop-Installation verifiziert, nicht gegen die Doku — dabei
korrigiert: `versionMax` wird bewusst NICHT geschrieben (siehe C2). **C5 (Abnahme im
Spiel) ist weiterhin offen und kann nur der Nutzer erledigen.**

Ursprünglicher Auftrag (war die alte Phase 3.5). Quellen:
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
`versionMin` (Format `42.20`, aus den Layout-Versionen abgeleitet — `versionMax`
bewusst nicht, es steht in echten Mods nur in 7 % der Dateien und dient dort als
Deckel für aufgegebene Mods);
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

### D1 Zwei Export-Implementierungen zusammenführen [erledigt 2026-09-16]
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

### D3 Quellsprache wirklich implementieren
`src/views/Settings.jsx:148` bietet eine Auswahl für die Quellsprache an; der Scanner
benutzt die Konstante `SOURCE_LANG = 'EN'` (`server/scanner.js:32`) und ignoriert den
Wert vollständig. Entschieden (Nutzer, 2026-09-16): Die Auswahl soll echt werden.

Das ist der einzige Punkt in diesem Plan, der einen Vertrag anfasst — entsprechend
sorgfältig angehen. Betroffen sind mindestens `scanner.js:32` (Konstante), die
`enLocations()`/`readEnDir()`-Kette in `llm-io.js:38-83`, `layoutLocations()` und beide
Traversal-Blöcke in `mod-export.js`, sowie `config.js` (Feld wird zum Pflichtfeld mit
Validierung).

Zwei Fallen, die vorher bedacht gehören:
- **Die entryId enthält den Quellsprachen-Pfad** (`.../Translate/EN/UI.json::Key`).
  Ändert sich die Quellsprache, ändern sich damit alle entryIds. Der Scan-Cache im
  Server und die `dirty`-Map im Editor müssen beim Wechsel verworfen werden, sonst
  schreibt ein Speichern gegen Pfade, die es nicht mehr gibt.
- **Quellsprache gleich Zielsprache** ist sinnlos und muss abgelehnt werden (400 mit
  lesbarer Meldung, siehe E2).

Fertig wenn: Ein Wechsel der Quellsprache in Settings führt nach einem Scan zu
Einträgen aus dem entsprechenden Sprachordner, LLM-Export und Mod-Export folgen
daraus, ein Test deckt eine Nicht-EN-Quelle ab (Fixtures haben DE-Bäume), und
`npm test` ist grün. Nach D1 machen — dann gibt es nur noch eine Traversal-Stelle
statt zweier.

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

### E2 Config-Validierung [erledigt 2026-09-16]
`server/config.js:35` schreibt jeden übergebenen Body ungeprüft in `config.json` —
beliebige Pfade, beliebige Sprachcodes.

Fertig wenn: `POST /api/config` lehnt nicht existierende Pfade und ungültige
Sprachcodes mit `{ error }` und 400 ab, die Settings-View zeigt die Meldung an einem
Feld. Braucht A1, sonst ist die Validierung nicht erreichbar.

### E3 Oberfläche durchgehend auf Englisch
Die UI mischt Deutsch und Englisch: „Search… (all mods)" neben „Gespeichert: 3 Einträge
in 2 Mod(s)." (`Editor.jsx:511` und `:264`), englische Leerzustände in Library und
Export neben deutschen Fehlermeldungen aus dem Server (`entries.js:81`).

Entschieden (Nutzer, 2026-09-16): **durchgehend Englisch**, Servermeldungen inbegriffen.

Fertig wenn: Keine deutschen Zeichenketten mehr in der Oberfläche und in den
`{ error }`-Texten der API — betrifft vor allem `entries.js:80-89` (die
fs-Fehlerklassifikation) und die Meldungen in `index.js` (`:92`, `:114`, `:219`,
`:273`). Die Tests in `entries.test.js`, die auf den deutschen Wortlaut prüfen, werden
mitgezogen. Code-Kommentare dürfen deutsch bleiben — das betrifft nur, was der Nutzer
sieht.

### E4 Testlücken schließen
Fertig wenn: `POST /api/export/mod` und `POST /api/import/llm/apply` haben je einen
Routen-Test (Fake-Modus, tmp-Kopie wie die bestehenden Tests in `index.test.js`),
`npm test` grün.

### E5 Fehlermeldungen werden am Wortlaut erkannt
`src/views/Settings.jsx` verteilt die Fehlermeldungen von `POST /api/config` auf die
betroffenen Felder, indem es den Text zerlegt und auf Präfixe prüft
(`startsWith("Game folder")`). Das funktioniert und fällt bei unbekannten Meldungen
sauber auf die allgemeine Anzeige zurück, koppelt die View aber an den genauen
Wortlaut des Servers: Ändert jemand dort eine Formulierung, rutscht die Meldung
stillschweigend zurück unter den Button.

Sauberer wäre eine strukturierte Antwort, die das Feld benennt. Das berührt allerdings
die in CLAUDE.md festgehaltene Fehlerform `{ error: "<lesbarer Text>" }` — also erst
entscheiden, ob diese um ein optionales Feld erweitert werden soll, dann umsetzen.
Nicht dringend, solange keine Meldung verloren geht.

### E6 Zwei Nachwehen aus Phase A
Beim Umsetzen von A1–A3 aufgefallen, beide klein und beide nicht dringend:
- Wird ein Mod in der Library abgewählt, während er im Editor ungespeicherte
  Änderungen hat, verwirft der Editor diese beim nächsten Mount stillschweigend (die
  Bereinigung veralteter entryIds in `Editor.jsx` kann den Fall nicht von einem
  Rescan unterscheiden). Selten, aber es ist wieder stiller Verlust.
- Eine geänderte Zielsprache in Settings löst keinen Rescan aus. Der Cache hält
  weiter die Einträge der alten Sprache, bis von Hand gescannt wird. Sinnvoll wäre,
  nach einer Config-Änderung sichtbar auf den nötigen Scan hinzuweisen oder ihn
  anzustoßen.

Fertig wenn: Beide Fälle enden mit einer sichtbaren Meldung statt mit stiller
Überraschung.

### E7 README
Fertig wenn: Eine README erklärt Installation, Start inklusive Administrator-Hinweis
und den Weg Scan → Auswahl → Editor → LLM-Export → Import → Mod-Export, sodass jemand
Fremdes das Projekt danach bedienen kann.

### E8 Vite-Konfiguration entwarnen [erledigt 2026-09-16]
Gelöst durch Umbenennen auf `vite.config.mjs`. `"type": "module"` schied aus, weil
`server/` und `scripts/dev.js` CommonJS sind. Build, Tests, `npm start` und der
Dev-Proxy auf `:3100` sind nachgeprüft.

## Getroffene Entscheidungen

- **2026-09-16, Oberflächensprache:** durchgehend Englisch, Servermeldungen
  inbegriffen (E3).
- **2026-09-16, Quellsprache:** wird echt implementiert statt entfernt (D3).
- **2026-09-16, Editor bei großer Auswahl:** Nachladen beim Scrollen, keine
  Seitenblätter (B1).
- **2026-09-16, Doku:** `AGENTS.md`, `ARCHITECTURE.md`, `IDEA.md` und `TODO.md`
  ersetzt durch `CLAUDE.md` (Verträge und Regeln) und diese Datei. Der Volltext der
  alten Dokumente bleibt über `git log` erreichbar.

## Nicht im Scope

- Steam-Workshop-Auto-Upload und Electron-Verpackung — bewusst spätere, eigene Projekte.
- Übersetzungsinhalte und -formate (JSON und Lua-TXT sind valide und getestet).
- Die API-Routenform, das Design-Fundament (`src/components/`, `src/styles/theme.css`)
  und die Verträge aus [CLAUDE.md](CLAUDE.md).
