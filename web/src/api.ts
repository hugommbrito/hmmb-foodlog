import type { EntryWithFoods, EntryAnalysisView, ReanalyzeRequest, RequestLog } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TOKEN_KEY = 'foodlog_api_token';

// Thrown on HTTP 401 so the UI can drop the stored token and re-show the gate.
export class UnauthorizedError extends Error {}

// localStorage can throw (Safari private mode, storage blocked). Degrade gracefully:
// the in-memory React state still carries the token for the current session.
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — token stays in memory only */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token ?? ''}`,
    },
  });
  if (res.status === 401) {
    throw new UnauthorizedError('Token inválido ou ausente');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchEntries(date?: string): Promise<EntryWithFoods[]> {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  return request<EntryWithFoods[]>(`/entries${q}`);
}

// Mark an entry reviewed. Backend returns the updated row (foods not included);
// callers only rely on the request succeeding.
export function acceptEntry(id: string): Promise<{ reviewed: boolean }> {
  return request<{ reviewed: boolean }>(`/entries/${id}`, { method: 'PATCH' });
}

// CAP-4: correct an entry (free text and/or edited foods) and re-run the AI.
// Returns the re-analyzed view (new foods, reviewed:false). Synchronous on the
// backend, so this can take up to the analysis timeout (~50s).
export function reanalyzeEntry(id: string, payload: ReanalyzeRequest): Promise<EntryAnalysisView> {
  return request<EntryAnalysisView>(`/entries/${id}/reanalyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// Audit module: list recent inbound requests, optionally filtered by a path
// substring. `/audit/*` requests are not themselves logged by the backend.
export function fetchRequestLogs(q?: string, limit = 100): Promise<RequestLog[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q && q.trim()) {
    params.set('q', q.trim());
  }
  return request<RequestLog[]>(`/audit/requests?${params.toString()}`);
}

// Manual cleanup. Without `before`, purges all logs; with `before` (YYYY-MM-DD),
// removes logs older than that date. Returns the number deleted.
export function purgeRequestLogs(before?: string): Promise<{ deleted: number }> {
  const q = before ? `?before=${encodeURIComponent(before)}` : '';
  return request<{ deleted: number }>(`/audit/requests${q}`, { method: 'DELETE' });
}
