const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("intellirag_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string> || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem("intellirag_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || `API error ${res.status}`);
  }

  return res.json();
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch(path, { method: "DELETE" });
}
