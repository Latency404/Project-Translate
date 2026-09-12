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
