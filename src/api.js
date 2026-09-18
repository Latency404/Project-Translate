// Einziger Zugriffspunkt auf die API — alle Fetch-Logik lebt hier.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg;
    try {
      const body = await res.json();
      msg = body?.error || `HTTP ${res.status}`;
    } catch {
      msg = `HTTP ${res.status}`;
    }
    throw new Error(msg);
  }
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

export function getMods() {
  return request("/api/mods");
}

export function getEntries(modId, { page = 1, pageSize = 50, search = "" } = {}) {
  return request(
    `/api/mods/${encodeURIComponent(modId)}/entries?page=${page}&pageSize=${pageSize}${
      search ? `&search=${encodeURIComponent(search)}` : ""
    }`,
  );
}

export function saveEntries(modId, entries) {
  return request(
    `/api/mods/${encodeURIComponent(modId)}/entries`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    },
  );
}

export function exportLlm(modIds) {
  return request("/api/export/llm", {
    method: "POST",
    body: JSON.stringify({ modIds }),
  });
}

export function exportMod(modIds, targetDir, targetLang) {
  return request("/api/export/mod", {
    method: "POST",
    body: JSON.stringify({ modIds, targetDir, targetLang }),
  });
}

export function importPreview(text) {
  return request("/api/import/llm/preview", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function resetTranslations() {
  return request("/api/reset-translations", { method: "POST" });
}

// Liefert die installierbare Mod als ZIP-Blob (+ Dateiname aus dem
// Content-Disposition-Header) statt JSON — der Aufrufer stößt darüber den
// normalen Browser-"Speichern unter"-Download an (wie beim LLM-Export).
export async function exportModZip(modIds, targetLang) {
  const res = await fetch("/api/export/mod/zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modIds, targetLang }),
  });
  if (!res.ok) {
    let msg;
    try {
      const body = await res.json();
      msg = body?.error || `HTTP ${res.status}`;
    } catch {
      msg = `HTTP ${res.status}`;
    }
    throw new Error(msg);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match ? match[1] : "mod.zip";
  const blob = await res.blob();
  return { blob, filename };
}
