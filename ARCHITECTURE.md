# Architektur – Project Translate

## Kontext
Project Zomboid hat 350+ Mods im Workshop, jeder mit eigenen Übersetzungs-JSONs.
Manuell jeden Mod-Ordner aufspüren, die EN-Datei öffnen, jeden Key übersetzen und
zurückspeichern ist für die Menge nicht praktikabel. Project Translate zentralisiert
diesen Workflow in einem Tool statt in Handarbeit pro Mod-Ordner.

## Was die App tut
Desktop-Tool (Web-App auf localhost) zum Übersetzen der Mod- und Basisspiel-Texte von
Project Zomboid: es scannt die Steam-Installation, zeigt alle übersetzbaren Einträge in
einem zweispaltigen Editor, exportiert sie LLM-tauglich, nimmt die Übersetzungen zurück
und erzeugt daraus einen installierbaren Übersetzungs-Mod.

## Was sie ausdrücklich nicht tut
- Kein automatischer Steam-Workshop-Upload — fertige Mods werden als Ordner exportiert,
  der Upload erfolgt manuell im Steam-Client.
- Kein Bearbeiten von Spiellogik, Lua, Sprites oder anderen Mod-Dateien — nur
  Übersetzungs-JSONs (`Translate/<LANG>/*.json`).
- Keine Cloud, kein Login, keine Datenbank — alle Daten leben im Dateisystem.
- Kein Electron-Paket in diesem Projekt — optional später als eigenes Projekt.
- Keine eigene Übersetzung — das Tool organisiert, der LLM (oder User) übersetzt.

## Stack
- **Frontend:** React 19 + Vite + Tailwind CSS 4, JavaScript (kein TypeScript)
- **Backend:** Node.js 24 + Express (dient im Production-Modus auch das gebaute
  Frontend aus)
- **Tests:** `node:test` (eingebaut, kein extra Framework)
- **Paketmanager:** npm, ein einziges `package.json`
- Einzige UI-Zusatzabhängigkeit: `lucide-react` (Icons)

Begründung: Eine Sprache (JS) für Frontend und Server hält das Projekt bei einem
Paketmanager und einem Build. Vite + Express ist der kleinste Stack, der einen lokalen
Server liefert, ohne den Steam-Dateisystemzugriff — ohne den geht nichts, denn der
Browser allein kann Workshop-Ordner nicht lesen.

## Datenmodell

Pfadkonvention: alle Pfade als POSIX-Style mit `/` (auch auf Windows), relativer Pfad
`file` immer relativ zum Version-Ordner des Mods.

### Config
Gespeichert in `config.json` im Projektroot (wird zur Laufzeit erzeugt, git-ignoriert).

| Feld | Typ | Pflicht | Anmerkung |
|---|---|---|---|
| gameRoot | Pfad | ja | Standard: `C:/Program Files (x86)/Steam/steamapps/common/ProjectZomboid` |
| workshopDir | Pfad | ja | Standard: `C:/Program Files (x86)/Steam/steamapps/workshop/content/108600` |
| targetLang | Text | ja | 2- oder 4-Buchstaben-Code, Default `DE`. Erlaubt: die in `Translate/` vorhandenen Codes (EN, DE, FR, ES, ...) |
| sourceLang | Text | ja | Fix `EN` — kein Feld in der UI, im Code eine Konstante |

### Mod
| Feld | Typ | Pflicht | Anmerkung |
|---|---|---|---|
| id | Text | ja | Workshop: Published-File-ID (z. B. `1299328280`); Basisspiel: fix `BASE` |
| name | Text | ja | Ordnername unter `mods/`; Basisspiel: `Project Zomboid (Base Game)` |
| isBaseGame | ja/nein | ja | |
| versions | Text[] | ja | z. B. `["42", "42.15", "42.20"]`; Basisspiel: `["base"]`. Sortiert absteigend nach Version |
| rootPath | Pfad | ja | Ordner, in dem die Version-Ordner liegen |
| poster | Pfad oder null | nein | `generic.png` oder `poster.png` am Mod-Root, falls vorhanden |
| entryCount | Zahl | ja | Summe aller EN-Einträge über alle Versionen |
| translatedCount | Zahl | ja | Einträge, für die die targetLang-Datei einen Wert hat (inkl. Pre-Fill) |

Beziehung: Ein Mod hat mehrere Versionen; jede Version hat eigene Übersetzungs-Dateien.
**Entscheidung: Alle Versionen eines ausgewählten Mods werden übersetzt** (das Spiel
nutzt die höchste kompatible Version; jede Version braucht ihre eigene `Translate/`-
Dateien). Fortschritt wird pro Mod über alle Versionen aggregiert.

### Entry
Eindeutig pro Mod durch `id`.

| Feld | Typ | Pflicht | Anmerkung |
|---|---|---|---|
| id | Text | ja | Format: `<version>/<file>::<key>`, z. B. `42.20/media/lua/shared/Translate/EN/ItemName.json::ItemName_X` |
| modId | Text | ja | |
| version | Text | ja | |
| file | Pfad | ja | Relativ zum Version-Ordner, immer der EN-Pfad: `media/lua/shared/Translate/EN/<Kategorie>.json` |
| key | Text | ja | JSON-Schlüssel aus der EN-Datei |
| original | Text | ja | Wert aus der EN-Datei |
| translation | Text oder null | ja | Wert aus der targetLang-Datei, null = fehlt |
| preFilled | ja/nein | ja | true, wenn die translation aus einer vorhandenen targetLang-Datei stammt (grün, aber vom User überprüfbar) |

Status wird nicht gespeichert, sondern abgeleitet: `translated` (translation nicht
null) / `missing` (translation null). JSON-Dateien sind flache `key → string`-Maps,
keine verschachtelten Strukturen. Reihenfolge: Einträge in JSON-Datei-Reihenfolge
(Insertion Order), Dateien alphabetisch.

### LLM-Export-Format (Entscheidung: eine Datei pro Mod)
Ordner `export/llm/<targetLang>/<ModName>.json`:
```json
{
  "mod": "More Traits",
  "modId": "1299328280",
  "targetLang": "DE",
  "files": {
    "42.20/ItemName.json": { "ItemName_MoreTraits.Bag_PackerBag": "Packer Bag" },
    "42.20/Moodles.json": { "Mood_X": "Stimmung X" }
  }
}
```
Datei-Keys unter `files` tragen das Versions-Segment, damit mehrere Versionen desselben
Mods keine Kollisionen erzeugen. Der LLM bekommt die Originaltexte und soll die Werte
übersetzt zurückliefern; Struktur und Keys bleiben unverändert.

### LLM-Import
Import liest den Ordner `export/llm/<targetLang>/` (oder einen gewählten Ordner).
Zuordnung über `(modId oder mod-Name, Datei-Key, JSON-Key)`. Keys, die nicht existieren,
werden in der Vorschau als `unmatched` gelistet und nicht übernommen.

### Mod-Export (installierbarer Übersetzungs-Mod)
Ziel: `<ExportZiel>/<ModName>-<targetLang>/` mit:
- `media/lua/shared/Translate/<targetLang>/<Kategorie>.json` (pro Version im
  Version-Ordner `<version>/media/...`, wie im echten Mod)
- **Ein** `mod.info` am Root des exportierten Mods (nicht pro Version) mit:
  `name = "<ModName> Translation (<targetLang>)"`, `author = "Project Translate"`,
  `game_version = <höchste Version>` — bei Basisspiel-Export oder reinem
  common-/root-Layout (keine Versionsordner) entfällt `game_version`
- `icon.png` falls die Quelle eine hat

### Backup
Vor jedem Überschreiben einer targetLang-Datei wird die alte Datei kopiert nach
`export/backups/<YYYY-MM-DD_HH-mm>/<modId>__<version>__<file>`. Ein Ordner pro
Speicher-Batch. Backups werden nie automatisch gelöscht.

### Datumsformat
Zeitstempel für Backups: `YYYY-MM-DD_HH-mm` (lokal). Keine anderen Datumsfelder im
Modell.

## Ordnerstruktur

```
project-translate/
├── server/            Express-API (Node, CommonJS)
│   ├── index.js       Einstieg: API-Routen + dient dist/ (Production)
│   ├── config.js      Lese/schreibe config.json, Standardpfade, Steam-Pfade
│   ├── scanner.js     Reine Funktion: Wurzel-Dir → Mods + Einträge (fixtures-fähig)
│   ├── entries.js     Lesen/Schreiben von Übersetzungs-Einträge + Backup
│   ├── llm-io.js      LLM-Export/-Import
│   ├── mod-export.js  Übersetzungs-Mod-Ordner generieren
│   ├── fake-api.js    Gleiche Routen, auf server/fixtures/ gerichtet (nur mit PT_FAKE=1)
│   └── fixtures/      Beispieldaten im echten PZ-Ordnerlayout (3 SampleMods + Mini-Base-Game)
├── src/               React-App
│   ├── main.jsx
│   ├── App.jsx        View-Umschaltung (Settings / Library / Editor / Export / Design), kein Router-Paket
│   ├── api.js         Einziger Zugriffspunkt auf die API (fetch-Wrapper)
│   ├── styles/theme.css   Design-Tokens (CSS-Variablen)
│   ├── components/    Design-Fundament: Button, Card, Input, ProgressBar, Tag, Modal
│   └── views/         Settings.jsx, Library.jsx, Editor.jsx, Exchange.jsx, Showcase.jsx
├── Resources/         Vorhanden: SampleMods (Quelle für fixtures/), Logo
├── export/            Laufzeit: llm/, mods/, backups/ (git-ignoriert)
├── config.json        Laufzeit (git-ignoriert)
├── package.json
├── vite.config.js     Dev-Proxy: /api → http://localhost:3100
└── index.html
```

## Fake-API

Datei: `server/fake-api.js`

Der Scanner (`scanner.js`) ist von Anfang an echte Logik — die Fake-API richtet ihn nur
auf `server/fixtures/` statt auf die Steam-Pfade. In `server/index.js` wird per
Umgebungsvariable `PT_FAKE=1` gewählt, welche Wurzel die Routen nutzen. Damit ist der
Tausch in Phase 2 eine Zeile, und die Frontend-Slices arbeiten ab Slice 1.2 gegen die
echte API-Form.

Stellt bereit (gleiche Routen in echt und fake):
- `GET  /api/status` — `{ gameFound, workshopFound, scanRunning, modCount, error }`
- `POST /api/scan` — Scan (neu) starten
- `GET  /api/config` / `POST /api/config` — Config lesen/schreiben
- `GET  /api/mods` — alle Mods, nach Name aufsteigend
- `GET  /api/mods/:modId/entries?search=&page=&pageSize=` — paginiert + Suche nach
  Key/Originaltext
- `PUT  /api/mods/:modId/entries` — speichern (Body: `{ entries: [{ entryId, translation }] }`,
  einzelnes Speichern ist ein Batch mit einem Element — eine Route für beides)
- `POST /api/export/llm` — Body: `{ modIds, targetLang }`
- `GET  /api/import/llm/preview?dir=` — Vorschau: `{ matched, unmatched, perMod }`
- `POST /api/import/llm/apply` — Vorschau übernehmen
- `POST /api/export/mod` — Body: `{ modIds, targetDir }`

Regel: Die Frontend-Komponenten sprechen ausschließlich `src/api.js`; die Routenform
darf sich nicht ändern, nur die dahinterliegende Wurzel (fixtures → echt).

## Befehle

| Zweck | Befehl |
|---|---|
| Abhängigkeiten installieren | `npm install` |
| Entwicklung (Vite :5173 + API :3100) | `npm run dev` |
| Bauen und prüfen | `npm run build` |
| Production starten (eine Port :3100) | `npm start` |
| Tests | `npm test` |

Produktionsport: 3100. Der Entwicklungsserver wird nie von einem Worker gestartet —
seine Hintergrundprozesse werden beendet, sobald er fertig ist.

## Festgelegte Entscheidungen
- **Pfade POSIX-Style** (`/`) in allen APIs und in config.json, auch auf Windows.
- **Eine Sprache pro Projekt**: JavaScript überall, kein TypeScript.
- **Kein Router-Paket**: Views werden in `App.jsx` per State umgeschaltet.
- **Scanner ist echt ab Phase 0**, Fake = andere Wurzel. Damit Phase 2 nur Wurzel-Tausch
  + Randfälle ist, kein Umbau.
- **LLM-Export: eine Datei pro Mod** (nicht eine Riesendatei mit Marker-Kommentaren) —
  kleinere Kontexte pro Mod, parallel übersetzbar, Import zuordnet sauber über
  `(modId, Datei-Key, Key)`.
- **Alle Versionen eines Mods übersetzen**, Fortschritt pro Mod aggregiert.
- **Pre-Fill**: Bestehende targetLang-Werte werden als `translation` geladen und
  `preFilled: true` markiert (grün, nicht als vom User bestätigt).
- **Einschränkung**: Ein Published-File kann mehrere Mods enthalten (z. B.
  `1299328280/mods/More Traits*/`). Jeder Unterordner unter `mods/` zählt als eigener
  Mod mit eigenem `id = <PublishedFileID>/<Unterordnername>`.
- **Farbstatus im Editor**: gelb = missing, grün = translated/preFilled, neutral =
  ungeprüft. Genaue Werte liegen im Design-Fundament (Slice 1.1).
- **Keine Batch-Aktionen im Editor in v1** — der Bulk-Pfad ist der LLM-Export.
- **Schreiben nach `C:\Program Files (x86)`** (Spiel + Workshop) erfordert auf Windows
  Admin-Rechte: die App wird als Administrator gestartet (README + Hinweis im Setup-
  View, wenn Schreiben fehlschlägt).
- **Design-Dunkeltheme** mit Gaming-Ästhetik: Tokens in `src/styles/theme.css`,
  Komponenten in `src/components/` — kein direktes Tailwind-Farb-Nennen in Views.
- **Icons**: `lucide-react`, nichts anderes.
- **Fehlerbehandlung API**: Fehler als `{ error: "Mensch lesbarer Text" }` + HTTP 4xx/
  5xx; die Frontend zeigt `error` direkt an, ohne weitere Dekodierung.
- **Performance**: Scan läuft asynchron im Hintergrund, `GET /api/status` zeigt
  Fortschritt; Einträge werden paginiert (50/Seite).
