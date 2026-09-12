# Projektregeln

## Stack
React 19 + Vite + Tailwind 4 (JS, kein TypeScript) im Frontend, Node 24 + Express im
Backend (`server/`), npm, Tests mit `node:test`.

## Struktur
- `src/` — React-App: `views/` (Screens), `components/` (Fundament), `api.js`
- `server/` — Express-API: `index.js`, `scanner.js`, `entries.js`, `llm-io.js`,
  `mod-export.js`, `fake-api.js`, `fixtures/`

## Regeln
- Die Frontend holt Daten ausschließlich über `src/api.js`, nie direkte fetch-Aufrufe.
- Styles nur über die Tokens aus `src/styles/theme.css` + `src/components/`, keine
  eigenen Farben oder Abstände in Views.
- Pfade immer POSIX-Style (`/`), auch auf Windows.
- Keine neuen Pakete ohne Rückfrage.
- Bestehende Muster schlagen eigene Vorlieben — sieh in eine Nachbardatei.
- Keine Funktionen bauen, die im Auftrag nicht stehen. Fällt etwas auf, das fehlt:
  im Abschlussbericht erwähnen, nicht einbauen.
- Tests nie so ändern, dass sie durchlaufen. Stattdessen den Code reparieren.
- Vor dem Abschluss `npm run build` und `npm test` ausführen und das Ergebnis berichten.

## Nie anfassen
- `ARCHITECTURE.md` (nachfragen, wenn etwas fehlt)
- `src/components/` und `src/styles/theme.css` (nach Slice 1.1)
- Die API-Routenform in `server/index.js`
