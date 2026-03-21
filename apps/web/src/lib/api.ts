const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export function buildApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// --- Upload-in-progress flag: suppresses 401→redirect during uploads ---
let _uploadInProgress = false;

export function setUploadInProgress(flag: boolean): void {
  _uploadInProgress = flag;
}

// --- Session keepalive: pings /auth/refresh periodically during long uploads ---
let _keepaliveTimer: ReturnType<typeof setInterval> | null = null;

export function refreshSession(): Promise<boolean> {
  return fetch(buildApiUrl("/api/v1/auth/refresh"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
    .then((res) => res.ok)
    .catch(() => false);
}

export function startSessionKeepalive(): void {
  stopSessionKeepalive();
  _keepaliveTimer = setInterval(() => {
    refreshSession();
  }, 20 * 60 * 1000); // every 20 minutes
}

export function stopSessionKeepalive(): void {
  if (_keepaliveTimer) {
    clearInterval(_keepaliveTimer);
    _keepaliveTimer = null;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(options?.headers as Record<string, string> || {}),
  };

  const res = await fetch(buildApiUrl(path), { ...options, headers, credentials: "include" });

  if (res.status === 401) {
    if (_uploadInProgress) {
      throw new Error("SESSION_EXPIRED");
    }
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

interface ApiUploadOptions {
  method?: "POST" | "PUT" | "PATCH";
  onProgress?: (percent: number) => void;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export function apiUpload<T>(
  path: string,
  formData: FormData,
  options?: ApiUploadOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options?.method || "POST", buildApiUrl(path));
    xhr.withCredentials = true;

    // Timeout: use explicit value, or scale to file size (min 60s)
    const file = formData.get("file") as File | null;
    const fileSize = file?.size || 0;
    xhr.timeout = options?.timeoutMs ?? Math.max(60_000, (fileSize / (500 * 1024)) * 1000 * 2);

    // AbortSignal support
    if (options?.abortSignal) {
      if (options.abortSignal.aborted) {
        reject(new Error("Upload aborted"));
        return;
      }
      options.abortSignal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options?.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        if (_uploadInProgress) {
          reject(new Error("SESSION_EXPIRED"));
          return;
        }
        window.location.href = "/login";
        reject(new Error("Unauthorized"));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          resolve({} as T);
        }
        return;
      }

      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        reject(new Error(body.message || body.error || "Upload failed"));
      } catch {
        reject(new Error("Upload failed"));
      }
    };

    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
  });
}
