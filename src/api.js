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

export function exportLlm(modIds, targetLang) {
  return request("/api/export/llm", {
    method: "POST",
    body: JSON.stringify({ modIds, targetLang }),
  });
}

export function exportMod(modIds, targetDir, targetLang) {
  return request("/api/export/mod", {
    method: "POST",
    body: JSON.stringify({ modIds, targetDir, targetLang }),
  });
}

export function importPreview(dir) {
  return request(
    `/api/import/llm/preview${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`,
  );
}

export function importApply(dir) {
  return request("/api/import/llm/apply", {
    method: "POST",
    body: JSON.stringify(dir ? { dir } : {}),
  });
}
