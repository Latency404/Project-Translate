## Projektbeschreibung

**Project Translate** ist eine Desktop-Anwendung zur Verwaltung und Erstellung von Übersetzungen für *Project Zomboid* (Version B42.20.4 Stable). Das Tool vereinfacht den bislang mühsamen Prozess, Mods und das Basisspiel für andere Sprachen zugänglich zu machen, indem es einen zentralisierten, visuellen Editor bereitstellt — ohne dass man manuell durch hunderte von Mod-Ordner navigieren und JSON-Dateien händisch bearbeiten muss.

---

## Problemstellung

Project Zomboid unterstützt Modding über den Steam Workshop. Jedes Mod kann eigene Übersetzungsdateien im JSON-Format enthalten. Bei aktuellen 350+Mods bedeutet manuelle Übersetzung:

- Jeden Mod-Ordner im Steam Workshop-Verzeichnis aufspüren
- Die entsprechende englische `translation.json` öffnen
- Jeden Schlüssel manuell übersetzen
- Den modifizierten JSON-Block wieder speichern
- Diesen Vorgang für jeden einzelnen Mod wiederholen

Das ist zeitaufwändig, fehleranfällig und schwer zu skalieren.

---

## Lösungskonzept

**Project Translate** automatisiert den Workflow in einem durchgängigen Tool:

1. **Automatische Erkennung** des Game Root Ordners und des Steam Workshop Mod-Verzeichnisses (Windows 11)
2. **Canvas-basierte Übersicht** aller erkannten Mods mit Modulanzeige im Editor
3. **Modus-Auswahl**: Nur Basisspiel, einzelne Mods, oder alle Mods gleichzeitig
4. **Zweispaltiger Editor** mit Kontext-Anzeige (Original-Text auf der einen, Eingabefeld auf der anderen Seite)
5. **Export in LLM-tauglichem Format**: Zusammengeführte JSON-Datei mit Trennern/Markern pro Mod, ideal zum Laden in LLMs für maschinelle Übersetzung
6. **Import der übersetzten JSON-Datei**: Rückübernahme der LLM-Übersetzungen in den Editor
7. **Export als installierbare Mod**: Generiert einen fertigen Mod-Ordner, der im Spiel aktiviert werden kann
8. **Steam Workshop Export**: Optionale Veröffentlichung direkt als Workshop-Mod

---

## Features im Detail

### 1. Projekt-Erkennung und Initialisierung

- Automatisches Scannen nach Project Zomboid Installation (Windows Steam-Standardpfade: `Steam\steamapps\common\ProjectZomboid`)
- Erkennung der aktiven Mod-Version (B42.20.4 Stable)
- Laden aller verfügbaren Mods aus dem Steam Workshop Ordner (`Steam\steamapps\workshop\content\108600`)
- Anzeige einer Übersicht aller Mods mit Metadaten (Name, Author, ID, Anzahl der übersetzbaren Einträge)

### 2. Canvas-Ansicht

- **Mod-Auswahl**:
  - `[ ]` Nur Basisspiel (`ProjectZomboid` Game Root)
  - `[ ]` Einzelne Mods (Multi-Select aus der Liste)
  - `[X]` Alle ausgewählten Mods
- Visuelle Darstellung des ausgewählten Mod-Umfangs
- Such- und Filterfunktion für die Mod-Liste

### 3. Übersetzungs-Editor

- **Zweispaltiges Layout**: Rechts der englische Originaltext, Links das Eingabefeld für die deutsche Übersetzung
- Maske/Formular mit:
  - **Schlüssel** (JSON Key)
  - **Originaltext** (englisch, readonly)
  - **Übersetzung** (deutsch, editierbar)
  - **Kontext-Hinweis** (optional, falls verfügbar)
- **Schnellnavigation**: Springen zwischen Einträgen, Fortschrittsanzeige pro Mod
- **Farbliche Hervorhebung**: Ung übersetzte Einträge gelb/rot, bereits übersetzt grün markiert
- **Suche im Editor**: Schnelles Finden von Schlüsseln oder Originaltexten
- **Batch-Aktionen**: Mehrere Einträge gleichzeitig markieren und übersetzen (optional LLM-Vorschlag)

### 4. Export-Funktionen

#### Zusammengeführter Export (LLM-Format)
- Alle ausgewählten Mods werden in **eine JSON-Datei** exportiert
- Jeder Mod wird durch einen **klaren Abschnitt-Trenner** markiert:
  ```json
  {
    "// === BEGIN MOD: modname ===": "",
    "key1": "Übersetzung 1",
    "key2": "Übersetzung 2",
    "// === END MOD: modname ===": ""
  }
  ```
- Oder alternativ ein strukturiertes JSON mit `modName` als Top-Level Key
- Datei ist direkt in LLMs ladbar für automatische Übersetzung

#### LLM-Import
- Laden einer bereits vom LLM übersetzten JSON-Datei
- Automatische Rückzuordnung der Übersetzungen zu den richtigen Mods anhand der Marker
- Vorschau und Bestätigung vor dem Übernehmen

#### Mod-Export
- Generiert einen fertigen Mod-Ordner im `steamapps/workshop/published_file_id/` Format
- Oder: Ordner in einem benutzerdefinierten Verzeichnis zur manuellen Installation
- Inklusive `media.lua` oder `resource.json` Metadaten für den Mod

#### Steam Workshop Export
- Generiert eine Workshop-konforme Mod-Struktur
- Option: Automatischer Upload (wenn Steam API Credentials hinterlegt sind)

### 5. Benutzeroberfläche

- **Modernes, professionelles Design** (kein "Vercel-clone" oder generisches Vibe-Coding-Feeling)
- Dunkles Theme (angepasst an Gaming-Ästhetik)
- Responsive Layout für den Editor
- Intuitive Navigation durch den Workflow
- Fortschrittsbalken und Statusanzeigen

---

## Technischer Rahmen

### Plattform
- **Zielplattform**: Windows 11
- **Erster Schritt**: Web-basierte App (HTML/CSS/JS oder React/Svelte) — später optional als Electron App verpackt

### JSON-Struktur von Project Zomboid Translations
Project Zomboid verwendet ein Key-Value Translation-System:
```json
{
  "english": {
    "key1": "Original text in English",
    "key2": "Another string"
  }
}
```
Oder bei einzelnen Mod-Translation-Dateien oft:
```json
{
  "key1": "Original text in English",
  "key2": "Another string"
}
```

### Dateien
- **IDEA.md** (diese Datei): Projektbeschreibung und Anforderungen
- **DESIGN.md**: UI/UX Design-Spezifikationen, Wireframes, Farbpalette
- **ARCHITECTURE.md**: Technische Architektur, Technologien, Build-Prozess
- **TODO.md**: Aufgabenliste mit Priorisierung

---

## Workflow

```
1. Start Project Translate
        ↓
2. Scanne Game Root + Workshop Ordner
        ↓
3. Wähle: Basisspiel, einzelne Mods oder alle
        ↓
4. Übersetze im Editor (Original ↔ Übersetzung)
        ↓
5. Optional exportieren als zusammengeführte JSON (für LLM)
        ↓
6. Lade übersetzte JSON vom LLM zurück
        ↓
7. Überprüfe die Übersetzungen
        ↓
8. Exportiere als fertige Mod / Steam Workshop Mod
        ↓
9. Aktiviere Mod im Spiel
```

---

## Milestones

- **M1**: Projekt-Erkennung + Canvas-Ansicht aller Mods
- **M2**: Editor mit zweispaltiger Ansicht und Fortschrittstracking
- **M3**: Export (LLM-Format) und Import (LLM-übersetzte JSON)
- **M4**: Mod-Export und Steam Workshop Export
- **M5**: Finetuning UI/UX, Polishing, Release

---

## Nicht-Funktionale Anforderungen

- Keine Internetverbindung für den Kern-Workflow nötig (Offline-fähig)
- Performance: muss auch mit 100+ Mods gleichzeitig flüssig arbeiten
- Datensicherung: automatisches Backup der Übersetzungsdateien
