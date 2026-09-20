// Einziger Zugriffspunkt auf die API — alle Fetch-Logik lebt hier.
//
// Mehrsprachigkeit: Die Konfiguration hält eine Liste von Zielsprachen
// (`targetLangs`) und die davon gerade im Editor aktive (`activeLang`).
// Routen, die genau eine Sprache betreffen (Mods-Liste, Einträge, Speichern),
// nehmen sie optional als `lang` — ohne Angabe gilt serverseitig `activeLang`.

async function throwHttpError(res) {
  let msg;
  try {
    const body = await res.json();
    msg = body?.error || `HTTP ${res.status}`;
  } catch {
    msg = `HTTP ${res.status}`;
  }
  throw new Error(msg);
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) await throwHttpError(res);
  return res.json();
}

export function getStatus() {
  return request("/api/status");
}

export function startScan() {
  return request("/api/scan", { method: "POST" });
}

export function getConfig() {
  return request("/api/config");
}

export function saveConfig(cfg) {
  return request("/api/config", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}

// Nur die aktive Sprache umschalten: kein Rescan, keine Pfadprüfung — der
// Scan-Cache hält alle Zielsprachen bereits.
export function setActiveLang(lang) {
  return request("/api/active-lang", {
    method: "POST",
    body: JSON.stringify({ lang }),
  });
}

export function getMods(lang) {
  return request(`/api/mods${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`);
}

export function getEntries(modId, { page = 1, pageSize = 50, search = "", lang = "" } = {}) {
  return request(
    `/api/mods/${encodeURIComponent(modId)}/entries?page=${page}&pageSize=${pageSize}${
      search ? `&search=${encodeURIComponent(search)}` : ""
    }${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`,
  );
}

export function saveEntries(modId, entries, lang) {
  return request(
    `/api/mods/${encodeURIComponent(modId)}/entries`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lang ? { entries, lang } : { entries }),
    },
  );
}

// notes: optionaler Freitext als Kontext für die KI.
export function exportLlm(modIds, targetLangs, notes) {
  return request("/api/export/llm", {
    method: "POST",
    body: JSON.stringify({ modIds, ...(targetLangs ? { targetLangs } : {}), ...(notes ? { notes } : {}) }),
  });
}

export function exportMod(modIds, targetDir, targetLangs) {
  return request("/api/export/mod", {
    method: "POST",
    body: JSON.stringify({ modIds, targetDir, targetLangs }),
  });
}

export function importPreview(text) {
  return request("/api/import/llm/preview", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// Ohne `langs` setzt der Server alle konfigurierten Zielsprachen zurück.
export function resetTranslations(langs) {
  return request("/api/reset-translations", {
    method: "POST",
    body: JSON.stringify(langs ? { langs } : {}),
  });
}

// Liefert die installierbare Mod als ZIP-Blob (+ Dateiname aus dem
// Content-Disposition-Header) statt JSON — der Aufrufer stößt darüber den
// normalen Browser-"Speichern unter"-Download an (wie beim LLM-Export).
// Die Mod enthält alle in `targetLangs` genannten Sprachen.
export async function exportModZip(modIds, targetLangs) {
  const res = await fetch("/api/export/mod/zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modIds, targetLangs }),
  });
  if (!res.ok) await throwHttpError(res);
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match ? match[1] : "mod.zip";
  const blob = await res.blob();
  return { blob, filename };
}

// Speicherpunkte ("Restore Backup" in Settings): neueste zuerst, je Punkt
// { id, createdAt, kinds, fileCount, mods, langs, restorable }.
export function listBackups() {
  return request("/api/backups");
}

// Spielt einen Punkt zurück; sichert vorher den aktuellen Stand als eigenen
// Punkt. → { restored, skipped, safetyBackupId }
export function restoreBackup(id) {
  return request(`/api/backups/${encodeURIComponent(id)}/restore`, { method: "POST" });
}
