# Project Translate

Lokales Desktop-Tool (Web-App auf `localhost:3100`) zum Übersetzen der Texte von
Project Zomboid B42 — Basisspiel und Workshop-Mods. Es scannt die Steam-Installation,
zeigt alle übersetzbaren Einträge in einem Editor, exportiert sie als eine Datei für
ein LLM, nimmt die Übersetzung zurück und baut daraus einen installierbaren
Übersetzungs-Mod.

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
  index.js           API-Routen, Scan-Cache, dient dist/ in Production;
                     projiziert den mehrsprachigen Cache flach je ?lang=
  config.js          config.json lesen/schreiben, Standardpfade, Validierung
  langs.js           Die 28 Sprachen von PZ (inkl. EN) + SOURCE_LANG ('EN', fest)
  scanner.js         Steam-Wurzeln → { mods, entriesByModId }; JSON- und Lua-TXT-Parser
  entries.js         Einträge in den Arbeitsordner speichern, Reset, Backup
                     (Speicherpunkte mit meta.json), fs-Fehler klassifizieren
  backups.js         Speicherpunkte auflisten und in den Arbeitsordner zurückspielen
                     ("Restore Backup")
  guard.js           Schreibschutz: jedes Schreiben in Spiel-/Workshop-Ordner → 403
  llm-io.js          LLM-Export-Bundle, Import-Vorschau (inkl. matches)
  lua-usage.js       getText("KEY", ...)-Fundstellen im Mod-Code (Kontext für den LLM-Export)
  scan-store.js      Letzten Scan-Stand nach export/scan-cache.json legen und beim
                     Start wieder laden (nur bei gleichen Pfaden/Zielsprachen)
  mod-export.js      Installierbaren Übersetzungs-Mod erzeugen
  zip.js             Minimaler ZIP-Writer (kein externes Paket) für den Export-Mod-Download
  fake-api.js        Nur Wurzel-Tausch auf server/fixtures/ (PT_FAKE=1)
  fixtures/          Beispieldaten im echten PZ-Layout
  fixtures-inject.js Synthetische Layout-Fixtures für tmp-Kopien in Tests
src/
  App.jsx            View-Umschaltung per State (kein Router-Paket); globaler
                     "Export Mod"-Button (Popover, baut die installierbare Mod);
                     Sprachumschalter (ab 2 Zielsprachen; bei einer
                     Zielsprache eine feste Pille mit dem Sprachcode)
  api.js             Einziger Zugriffspunkt auf die API
  langs.js           Spiegel von server/langs.js (Codes + Namen) fürs Frontend
  placeholders.js    Platzhalter (%1, {0}, <RGB:…>) erkennen/vergleichen; der Editor
                     hebt sie im Original hervor und warnt bei Abweichung (kein Blocker)
  reviewStore.js     Geteilter Session-State für dirty Editor-Einträge je Sprache
                     (Mods-Seite + Editor) — Basis für den "Zu Prüfen"-Status
  components/        Button, Card, Input, Modal, ProgressBar, Tag, Toast, Icons
                     (Figma-SVGs), LangSelect (eine Sprache),
                     LangMultiSelect (mehrere, mit Suche)
  styles/theme.css   Design-Tokens (CSS-Variablen)
  views/             Settings, Mods, Editor
Resources/           Sample-Mods, Logos, Figma-Mockups/Icons (git-ignoriert)
export/              Laufzeit-Ausgabe: work/ (Übersetzungen), mods/, backups/ (git-ignoriert)
config.json          Laufzeit (git-ignoriert)
```

Navigation: Mods | Editor | Settings, plus Sprachumschalter (bei mehreren Zielsprachen
umschaltbar, bei einer nur als Anzeige) und globaler "Export Mod"-Button (baut die installierbare Mod aus
der aktuellen Mods-Auswahl, unabhängig von der gerade offenen Seite).

## Verträge, die nicht brechen dürfen

Diese Formen sind über Scanner, Editor, Export und Import hinweg verdrahtet — eine
Änderung an einer Stelle bricht die anderen.

- **Mod-Anzeigename und Poster**: `mod.name` ist der `name=` aus der `mod.info` (Suche: neuester
  Versionsordner, `common`, Mod-Wurzel; Rückfall: Ordnername). `mod.id` bleibt der Ordnername
  (steckt in jeder entryId). Das Poster kommt aus `poster=` derselben `mod.info` (relativ zu
  deren Ordner, darf nach `../common/` zeigen, nie aus dem Mod-Ordner heraus), sonst
  `poster.png`/`generic.png`/`icon.png` in diesen Ordnern.
- **entryId**: `<version>/<Quellsprachen-Pfad relativ zum Version-Ordner>::<key>`, z. B.
  `42.20/media/lua/shared/Translate/EN/ContextMenu.json::Key`. Das `version`-Segment ist
  entweder eine Versionsnummer, `common`, `root` oder `base`. Die Quellsprache ist
  **fest `EN`** (`server/langs.js` → `SOURCE_LANG`) und nicht konfigurierbar — eine
  entryId ändert sich dadurch nie durch Konfiguration. `POST /api/config` verwirft den
  Scan-Cache, wenn sich `targetLangs`, `gameRoot` oder `workshopDir` ändern
  (`index.js`). War schon einmal gescannt worden, startet danach **automatisch**
  ein neuer Scan im Hintergrund (Fortschritt über `/api/status`); gab es noch keinen
  Scan, zeigen Mods und Editor „noch nicht gescannt" und verweisen auf Settings.
  Übersetzungs-Mods, die das Tool selbst exportiert hat (`author=Project Translate`
  in der `mod.info`), überspringt der Scanner.
  **Scan-Stand überlebt den Neustart**: nach jedem Scan/Rescan schreibt
  `scan-store.js` den Cache nach `export/scan-cache.json`; der Server lädt ihn beim
  Start, sofern `gameRoot`, `workshopDir` und `targetLangs` noch zu dem Scan
  passen (sonst wird er ignoriert). Steam-seitige Änderungen (Workshop-Update)
  sieht man erst nach **Search Mods**.
- **Mehrere Zielsprachen**: `config.targetLangs` (Liste, nie leer) und
  `config.activeLang` (eine davon, die im Editor bearbeitete). Die möglichen Codes
  stehen in `server/langs.js` und gespiegelt in `src/langs.js` — die 28 Sprachen,
  die Project Zomboid kennt. Achtung: Codes sind **2 bis 5** Zeichen lang
  (`ES_CL`, `ES_MX`).
  **EN ist auch als Ziel wählbar** (die englische Fassung selbst umschreiben).
  Die Änderungen liegen wie bei jeder Sprache im Arbeitsordner; die Originaltexte
  der Mod (und damit die Original-Spalte) bleiben unverändert.
  Der Scan-Cache hält alle Zielsprachen gleichzeitig: entries tragen
  `translations: { LANG: wert|null }` und `preFilled: { LANG: bool }`, Mods tragen
  `translatedCounts: { LANG: n }`. Nach außen **projiziert** `index.js` das auf die
  flachen Felder `translation` / `preFilled` / `translatedCount` für genau die
  angefragte Sprache (`?lang=`, Default `activeLang`) — deshalb ändert sich für das
  Frontend am Aufbau der Einträge nichts. Ein Sprachwechsel ist damit nur ein
  Re-Fetch (`POST /api/active-lang`) und braucht **keinen** neuen Scan.
- **LLM-Datei-Keys** sind die Kurzform `<version>/<Dateiname>` (z. B. `42.20/UI.json`);
  `llm-io.js` rekonstruiert daraus die entryId. Die exportierte Datei trägt
  `targetLangs`, `note` und `context` (Spiel, Sprachnamen, Übersetzungsregeln z. B. zu
  Platzhaltern — `llm-io.buildContext`), die Originaltexte unter `mods` (je Mod optional
  `description` aus der `mod.info`; `usage` = Fundstellen der Keys im Lua-Code der Mod, s.
  `server/lua-usage.js`; `context.notes` = optionaler Freitext des Nutzers aus dem
  Export-Dialog, Body-Feld `notes`) und ein leeres Gerüst
  `translations: { "<LANG>": {} }`, das das LLM füllt:
  `translations[LANG][modId][fileKey][key] = "Übersetzung"`. Das alte
  einsprachige Format (`{ targetLang, mods }`, blankes Array, einzelnes Mod-Doc)
  wird beim Import weiterhin gelesen.
- **API-Routenform** (`server/index.js`): `GET /api/status`, `POST /api/scan`,
  `GET|POST /api/config`, `POST /api/active-lang`, `GET /api/mods`,
  `GET|PUT /api/mods/:modId/entries`, `POST /api/reset-translations`,
  `GET /api/backups`, `POST /api/backups/:id/restore`,
  `POST /api/export/llm`, `POST /api/import/llm/preview`, `POST /api/export/mod`,
  `POST /api/export/mod/zip`. Fehler immer als `{ error: "<lesbarer Text>" }` (auch
  bei internen Fehlern — englischer Text) + 4xx/5xx. Sprachbezogene Routen nehmen
  `?lang=` bzw. `lang`/`targetLangs` im Body (Default: die Konfiguration); ein
  einzelnes `targetLang` wird weiterhin akzeptiert; die Export-Routen lehnen
  unbekannte Sprachcodes mit 400 ab.
  `POST /api/active-lang` setzt NUR die aktive Sprache: kein Rescan, keine
  Pfadprüfung, Cache bleibt stehen.
  Der Server hört nur auf `127.0.0.1` (kein Netzwerkzugriff von außen). Als
  CSRF-Schutz verlangen alle mutierenden `/api`-Routen `Content-Type:
  application/json`, sonst 415.
  Es gibt bewusst **keine** `/api/import/llm/apply`-Route: Import
  schreibt nichts auf die Platte (s. Import-Review-Status unten) —
  `POST /api/import/llm/preview` liefert neben den Zähl-Feldern (`perMod`,
  `perLang`) auch `matches: [{ modId, entryId, translation, lang }]`, dazu
  `detectedTargetLangs` und `unknownLangs`. Sprachen, die nicht in `targetLangs`
  stehen, landen in `unknownLangs` und **nie** in `matches` — der Editor könnte sie
  weder anzeigen noch speichern.
- **`POST /api/export/mod/zip`**: für den globalen "Export Mod"-Button — baut
  die Mod wie `/api/export/mod` (in einen frischen, danach gelöschten
  Temp-Ordner), packt sie serverseitig in eine ZIP (`server/zip.js`, kein
  externes Paket — `zlib.deflateRawSync`/`zlib.crc32`) und liefert sie als
  Binär-Antwort (`application/zip` + `Content-Disposition: attachment`). Der
  Browser übernimmt danach den normalen "Speichern unter"-Dialog — derselbe
  Blob-Mechanismus wie beim LLM-Export. Grund für den Umweg über eine Datei
  statt direktem Schreiben an einen vom Nutzer gewählten Ordner: eine
  Web-Seite bekommt aus einem Datei-Dialog nie einen echten OS-Pfad (File
  System Access API liefert nur ein sandboxed Handle) — der Nutzer entpackt
  die ZIP danach selbst in seinen PZ-Mods-Ordner.
- **B42 lädt Übersetzungen ausschließlich aus**
  `<Ort>/media/lua/shared/Translate/<LANG>/<Kategorie>.json` (gegen
  `projectzomboid.jar`/`Translator.tryFillMapFromFile` verifiziert) — TXT-Dateien
  liest das Spiel nicht mehr. Ein Mod wird nur über `common/mod.info` oder
  `<versionDir>/mod.info` erkannt; geladen werden `common/` + genau ein
  Versionsordner (höchste Version ≤ Spielversion); die Mod-Wurzel selbst
  (`media/` direkt im Mod-Ordner) lädt B42 nie.
- **Layout-Regeln** (identisch in `scanner.js`, `llm-io.js`, `mod-export.js`):
  Workshop-Mod = `common` (falls vorhanden) + der **neueste** Versionsordner,
  beide gleichzeitig — `common` schließt den Versionsordner also **nicht** aus.
  `root` (B41-Layout, Mod-Wurzel) wird nur gescannt, wenn weder `common` noch der
  neueste Versionsordner einen `Translate/EN`-Ordner haben. Basisspiel hat einen
  Ort mit Version `base`. Mods ohne übersetzbare Einträge werden gar nicht gelistet.
- **Quellen**: alle `.json` im EN-Ordner; eine `<Kategorie>_EN.txt` nur, wenn im
  selben Ordner **keine** `<Kategorie>.json` liegt (B41-Altlast); andere `.txt`
  (`README.txt`, `language.txt`, …) sind nie Quelle. Die entryId bleibt dabei wie
  gehabt `<version>/<Pfad der Quelldatei>::<key>` — bei TXT-Quellen also
  `.../EN/Sandbox_EN.txt::Key`.
- **Dateinamen-Ableitung EN → Zielsprache**: Ziel ist **immer** `<Kategorie>.json`
  (`scanner.targetFileName()`) — auch für TXT-Quellen (`Sandbox_EN.txt` →
  `Sandbox.json`). Die alte Zieldatei `<Kategorie>_<LANG>.txt`
  (`scanner.legacyTargetFileName()`) wird nur noch als Rückfall **gelesen**,
  solange die JSON-Zieldatei nicht existiert; das erste Speichern sät die JSON
  daraus. EN als Zielsprache mit TXT-Quelle: Speichern erzeugt eine vollständige
  `<Kategorie>.json` in EN (konvertierte Kopie + Änderungen) im Arbeitsordner.
  Backups hängen am jeweiligen **Zielpfad** (immer eine Arbeitsdatei);
  Speicherpunkte deduplizieren über den exakten Zielpfad.
- **Spiel- und Workshop-Ordner sind schreibgeschützt.** Die App liest dort nur
  (Originale und vorhandene Übersetzungen). Alles, was der Nutzer übersetzt,
  liegt im **Arbeitsordner** `export/work/<modId, "/" → "_">/<version>/media/lua/shared/Translate/<LANG>/<Kategorie>.json`
  (`scanner.workLangDir`). Eine Arbeitsdatei ist der **komplette** Stand der Zieldatei:
  das erste Speichern sät sie aus der Übersetzung im Spiel/Workshop, danach
  überlagert sie diese vollständig (`scanner.readTargetMapWithWork`; Scan und
  Mod-Export lesen so). Eine unlesbare Arbeitsdatei bricht das Speichern ab (409),
  statt sie zu überschreiben. **Reset** löscht die Arbeitsdateien (= zurück auf
  den Stand im Spiel/Workshop); es gibt keine Baselines mehr. Ausgabe an das
  Spiel läuft ausschließlich über den Mod-Export — der Nutzer installiert die
  Mod selbst. `server/guard.js` (`assertWritable`) ist das zweite Netz: jedes
  Schreiben (Speichern, Reset, Restore, Mod-Export-Zielordner) in `gameRoot`/
  `workshopDir` bricht mit 403 ab. **Neue Schreibpfade müssen `assertWritable`
  aufrufen.** Hintergrund: ein früherer Bug hat die DE-Sprachdateien des
  Basisspiels geleert.
- **Mod-Export bündelt alle gewählten Mods UND Sprachen in EINE Mod**: ein
  Ordner `<Name>-<LANGS>/` (`<Name>` = bei EINEM Mod dessen interner Ordnername, das letzte Segment der `mod.id`, z. B. `UsefulBarrelsMP`; bei mehreren `TranslationPack`) mit `42/mod.info` (+ `42/icon.png`, falls ein Poster
  vorhanden ist) und **allen** Übersetzungen aller gewählten Mods gemergt nach
  `common/media/lua/shared/Translate/<LANG>/<Kategorie>.json` — Merge-Reihenfolge:
  Mods in Auswahlreihenfolge, je Mod `common` → `root` → neuester Versionsordner,
  bei Schlüsselkollision gewinnt der spätere. `mod.info` trägt `id`/`name`/
  `author`/`description`, `poster=`/`icon=` falls vorhanden, sowie
  `loadModAfter=` mit den `mod.info`-IDs der Quell-Mods, damit die Übersetzung
  eine eigene Übersetzung des Quell-Mods überlagert. Ordnername/`mod.info`-ID:
  Ordnername: eine Sprache `<base>-DE`, ab 2 Sprachen `<base>-Multi`; `mod.info`-ID bis zu 3 Sprachen
  `pt_<slug>_DE_FR`, ab 4 Sprachen `_multi` (unverändert). Unbekannte Sprachcodes werden mit 400 abgelehnt. Die Übersetzungen
  kommen aus dem Arbeitsstand (Arbeitsdatei vor Spiel/Workshop). Ein Zielordner
  in Spiel/Workshop wird mit 403 abgelehnt.
- **Backup vor jedem Überschreiben/Löschen einer Arbeitsdatei** nach
  `export/backups/<YYYY-MM-DD_HH-mm>/<modId>__<version>__<file>__<LANG>/`. Ein Ordner
  pro Speicher-Batch (= Speicherpunkt), wird nie automatisch gelöscht. Jeder Punkt
  hat eine `meta.json` (Datum/Uhrzeit, Art `save`/`reset`/`restore`, je Datei der
  **exakte Zielpfad** (Arbeitsdatei), Mod, Sprache und `absent`, falls es die Datei
  vorher nicht gab) — nur damit ist ein Punkt über "Restore Backup" sicher
  zurückzuspielen; der Ordnername allein verstümmelt modId/Pfad. **Erste Sicherung
  gewinnt**: mehrmals in derselben Minute gespeichert, bleibt der Stand vor dem
  ersten Speichern. Reset und Restore bekommen je einen **eigenen**,
  sekundengenauen Punkt (`<YYYY-MM-DD_HH-mm-ss>`, bei Kollision `_N`), damit sie
  sich gezielt rückgängig machen lassen. Restore sichert vorher den aktuellen
  Stand. **Restore schreibt nur in den Arbeitsordner**: Punkte aus der Zeit, als
  die App noch in Spiel/Workshop schrieb (ohne `meta.json` oder mit Zielpfaden
  außerhalb von `export/work/`), bleiben auf der Platte, gelten aber als nicht
  wiederherstellbar (`legacy`, ausgegraut). Der Sprachanteil im Ordnernamen ist
  Pflicht, damit sich zwei Zielsprachen nie denselben Ordner teilen.
- **sessionStorage-Keys**: `pt_library_selected` (die Mods-Auswahl — nur die
  Mods-Seite schreibt sie, Editor und der globale Export-Mod-Button lesen sie),
  `pt_library_locked`, `pt_editor_active_mod` (der EINE aktuell im Editor
  geöffnete Mod — Editor-eigen, nie die Mods-Auswahl selbst), `pt_active_view`,
  `pt_editor_dirty` (ungespeicherte Einträge, Key ist `<lang>::<entryId>`, Wert
  `{ modId, value, origin, lang }`; `origin` ist `"manual"` oder `"import"` —
  s. `src/reviewStore.js`). **Ausnahme: `pt_editor_dirty` liegt in
  `localStorage`**, damit ungespeicherte Änderungen das Schließen von Tab/Browser
  überleben (ein Alt-Stand in sessionStorage wird weiter gelesen und beim
  nächsten Schreiben übernommen; `clearDirty()` löscht beide). Der Sprachpräfix ist nötig, weil dieselbe entryId in
  mehreren Sprachen gleichzeitig offen sein kann; Einträge aus älteren Sessions
  ohne Präfix werden beim Laden auf die aktive Sprache migriert.
- **Disk ist die Quelle der Wahrheit**: PUT löst einen Rescan aus, bevor es
  antwortet (der Scan liest Spiel/Workshop plus Arbeitsordner). Ausnahme bewusst: ein LLM-Import schreibt NICHT direkt — er füllt
  nur `pt_editor_dirty` (`origin: "import"`), bis der Nutzer die Einträge im
  Editor Mod für Mod prüft und speichert (dann wie jeder andere Save via PUT).
- **"Zu Prüfen"-Status**: eine Mod gilt als "Zu Prüfen" (statt Open/Translated),
  solange sie mindestens einen offenen `origin: "import"`-Eintrag in
  `pt_editor_dirty` hat — rein client-seitig berechnet (`reviewStore.statusOf`),
  kein Server-Feld. Verschwindet automatisch, sobald diese Einträge gespeichert
  (oder verworfen) sind.
- **Pfade immer POSIX-Style** (`/`) in APIs und config.json, auch auf Windows.

## Regeln

- Code suchen/verstehen: zuerst `codegraph_explore` (bzw. `codegraph explore "<Frage>"`),
  erst danach Grep/Dateien lesen. Dieses Projekt ist indexiert.
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
- `server/scanner.test.js` läuft gegen die echte Steam-Installation und überspringt
  sich auf Maschinen ohne Project Zomboid. Das ist Absicht.
- Smoke-Tests, die direkt gegen `server/fixtures/` schreiben, verändern die Fixtures:
  danach `git status` prüfen und mit `git checkout -- server/fixtures` zurücksetzen.

## Umgebung

Windows 11. Die App liest `C:\Program Files (x86)\...` (Spiel und Workshop) nur; sie
schreibt dort nie und braucht deshalb keine Administratorrechte.

Node **≥ 22.2** (`package.json` → `engines`): der ZIP-Export (`server/zip.js`)
nutzt `zlib.crc32`, das erst ab dieser Version existiert.
