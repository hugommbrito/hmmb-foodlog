import type {
  ContextTag,
  EntryWithFoods,
  EntryAnalysisView,
  PatternsPayload,
  ReanalyzeRequest,
  RequestLog,
  ShareLink,
  SharedPayload,
} from './types';

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

// Delete an entry (and its food_items, via DB cascade). Returns once the row is
// gone; callers only rely on the request succeeding.
export function deleteEntry(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/entries/${id}`, { method: 'DELETE' });
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

// Manual web entry: free-text description (required), optional photo(s) and a chosen
// date/time. Sent as multipart/form-data — `request` only sets Authorization, so the
// browser fills the multipart boundary. Synchronous on the backend (up to ~timeout):
// the AI segregates the foods and estimates weights/macros. Returns the new entry view.
export function createManualEntry(input: {
  description: string;
  createdAt?: string; // ISO 8601 instant
  photos?: File[];
}): Promise<EntryAnalysisView> {
  const form = new FormData();
  form.append('description', input.description);
  if (input.createdAt) {
    form.append('created_at', input.createdAt);
  }
  for (const photo of input.photos ?? []) {
    form.append('photo', photo);
  }
  return request<EntryAnalysisView>('/entries/manual', { method: 'POST', body: form });
}

// CAP-9 — context tags. GET auto-seeds the four defaults the first time.
export function fetchTags(): Promise<ContextTag[]> {
  return request<ContextTag[]>('/tags');
}

export function createTag(name: string, color?: string): Promise<ContextTag> {
  return request<ContextTag>('/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(color ? { name, color } : { name }),
  });
}

// Update a tag's name and/or color (at least one). Backend leaves omitted fields untouched.
export function updateTag(id: string, patch: { name?: string; color?: string }): Promise<ContextTag> {
  return request<ContextTag>(`/tags/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteTag(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/tags/${id}`, { method: 'DELETE' });
}

// Set (or clear, with null) an entry's context tag. Returns the updated view.
export function setEntryContext(id: string, contextTagId: string | null): Promise<EntryAnalysisView> {
  return request<EntryAnalysisView>(`/entries/${id}/context`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_tag_id: contextTagId }),
  });
}

// CAP-7a — share links (owner, Bearer).
export function createShareLink(input: {
  period_start: string;
  period_end: string;
  expires_at: string;
}): Promise<ShareLink> {
  return request<ShareLink>('/share-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function listShareLinks(): Promise<ShareLink[]> {
  return request<ShareLink[]>('/share-links');
}

export function deleteShareLink(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/share-links/${id}`, { method: 'DELETE' });
}

// Distinct errors so the public view can tell "expired" from "invalid/revoked".
export class ShareExpiredError extends Error {}
export class ShareInvalidError extends Error {}

// Public, tokenless read of a shared period. Does NOT send Authorization — the
// endpoint is unauthenticated and the nutritionist has no token.
export async function fetchShared(token: string): Promise<SharedPayload> {
  const res = await fetch(`${API_BASE}/shared/${encodeURIComponent(token)}`);
  if (res.status === 410) {
    throw new ShareExpiredError('Link expirado');
  }
  if (res.status === 404) {
    throw new ShareInvalidError('Link inválido');
  }
  if (!res.ok) {
    throw new Error(`Erro ${res.status}`);
  }
  return res.json() as Promise<SharedPayload>;
}

// CAP-7b: public, tokenless read of the AI pattern analysis for the period.
// Computed+cached server-side on first access. 502 → analysis couldn't be
// generated (the UI offers a retry). Reuses the share error classes for 410/404.
export async function fetchSharedPatterns(token: string): Promise<PatternsPayload> {
  const res = await fetch(`${API_BASE}/shared/${encodeURIComponent(token)}/patterns`);
  if (res.status === 410) {
    throw new ShareExpiredError('Link expirado');
  }
  if (res.status === 404) {
    throw new ShareInvalidError('Link inválido');
  }
  if (!res.ok) {
    throw new Error(`Erro ${res.status}`);
  }
  return res.json() as Promise<PatternsPayload>;
}

// Audit module: list recent request logs, optionally filtered by a path
// substring and/or direction. `/audit/*` requests are not themselves logged.
export function fetchRequestLogs(
  q?: string,
  direction?: 'inbound' | 'outbound',
  limit = 100
): Promise<RequestLog[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q && q.trim()) {
    params.set('q', q.trim());
  }
  if (direction) {
    params.set('direction', direction);
  }
  return request<RequestLog[]>(`/audit/requests?${params.toString()}`);
}

// Manual cleanup. Without `before`, purges all logs; with `before` (YYYY-MM-DD),
// removes logs older than that date. Returns the number deleted.
export function purgeRequestLogs(before?: string): Promise<{ deleted: number }> {
  const q = before ? `?before=${encodeURIComponent(before)}` : '';
  return request<{ deleted: number }>(`/audit/requests${q}`, { method: 'DELETE' });
}
