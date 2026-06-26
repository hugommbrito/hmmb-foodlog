import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptEntry,
  clearToken,
  createManualEntry,
  createShareLink,
  createTag,
  deleteEntry,
  deleteShareLink,
  deleteTag,
  fetchEntries,
  fetchRequestLogs,
  fetchTags,
  getToken,
  listShareLinks,
  purgeRequestLogs,
  reanalyzeEntry,
  searchEntries,
  setEntryContext,
  setToken,
  UnauthorizedError,
  updateTag,
} from './api';
import type {
  ContextTag,
  EntryWithFoods,
  FoodItem,
  ReanalyzeRequest,
  RequestLog,
  ShareLink,
} from './types';

// YYYY-MM-DD for "today", pinned to the same timezone the backend filters on
// (America/Sao_Paulo) so the default day matches regardless of the device tz.
function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// The America/Sao_Paulo calendar day (YYYY-MM-DD) of an ISO instant — used to
// decide which review day a freshly created manual entry belongs to.
function localDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
}

// "now" as a datetime-local value (YYYY-MM-DDTHH:mm) in America/Sao_Paulo, for the
// manual-entry form default. Minute precision truncates the seconds, so this is
// always slightly in the past — never tripping the backend's "no future" guard.
function nowLocalDateTime(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour'); // some engines emit "24" at midnight
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

// Confidence thresholds from the data-model contract.
export function confClass(c: number | null): string {
  if (c === null) return 'conf-none';
  if (c === 0) return 'conf-zero';
  if (c >= 0.85) return 'conf-high';
  if (c >= 0.7) return 'conf-mid';
  return 'conf-low';
}

export function pct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

// Sum one macro across foods. A macro that is null across every food returns null
// (not 0 — that would imply data the AI never computed); non-finite values are
// ignored. Shared by mealTotals (per-card) and dayTotals (page summary) so the
// null≠0 rule never diverges between the two.
function sumMacros(
  foods: FoodItem[],
  k: 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g'
): number | null {
  const vals = foods
    .map((f) => f[k])
    .filter((v): v is number => v != null && Number.isFinite(v));
  return vals.length > 0 ? vals.reduce((a, v) => a + v, 0) : null;
}

// Format the four macros into the canonical "N kcal · P Xg · G Yg · C Zg" string,
// omitting any macro that is null. Returns null when nothing is showable.
function formatMacros(foods: FoodItem[]): string | null {
  const kcal = sumMacros(foods, 'kcal');
  const protein = sumMacros(foods, 'protein_g');
  const fat = sumMacros(foods, 'fat_g');
  const carbs = sumMacros(foods, 'carbs_g');
  const parts = [
    kcal != null ? `${Math.round(kcal)} kcal` : null,
    protein != null ? `P ${Math.round(protein)}g` : null,
    fat != null ? `G ${Math.round(fat)}g` : null,
    carbs != null ? `C ${Math.round(carbs)}g` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// Meal totals from the AI-identified foods. Weight is intentionally omitted:
// `quantity` is free text (e.g. "1 prato"), not a numeric field. Returns null when
// there is nothing to show so the row can be skipped — mirrors FoodRow's macros.
export function mealTotals(foods: FoodItem[]): string | null {
  if (foods.length === 0) return null;
  return formatMacros(foods);
}

// Day summary: aggregate macros across every visible entry's foods, using the same
// null≠0 rule as the per-card totals. Returns null when there is nothing to show.
export function dayTotals(entries: EntryWithFoods[]): string | null {
  const foods = entries.flatMap((e) => e.foods);
  if (foods.length === 0) return null;
  return formatMacros(foods);
}

type SortDir = 'desc' | 'asc';

// Pure creation-order sort: 'desc' = newest first, 'asc' = oldest first.
function sortByCreated(list: EntryWithFoods[], dir: SortDir): EntryWithFoods[] {
  return [...list].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return dir === 'asc' ? diff : -diff;
  });
}

// Readable text color (near-black or white) for a HEX #RRGGBB background, by luminance.
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return '#fff';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

type Tab = 'review' | 'tags' | 'share' | 'audit';

// Tag filter selection: a specific tag id, or the two synthetic options.
type TagFilter = 'all' | 'none' | string;

export function App() {
  const [token, setTokenState] = useState<string | null>(getToken());

  if (!token) {
    return <TokenGate onSave={(t) => { setToken(t); setTokenState(t); }} />;
  }
  return <Shell onLogout={() => { clearToken(); setTokenState(null); }} />;
}

// Authenticated shell: tab bar switching between the daily review and the
// request audit log. Both screens share the same Bearer token.
function Shell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('review');
  return (
    <div className="shell">
      <nav className="tabs">
        <button
          className={tab === 'review' ? 'tab active' : 'tab'}
          onClick={() => setTab('review')}
        >
          Revisão
        </button>
        <button
          className={tab === 'tags' ? 'tab active' : 'tab'}
          onClick={() => setTab('tags')}
        >
          Tags
        </button>
        <button
          className={tab === 'share' ? 'tab active' : 'tab'}
          onClick={() => setTab('share')}
        >
          Compartilhar
        </button>
        <button
          className={tab === 'audit' ? 'tab active' : 'tab'}
          onClick={() => setTab('audit')}
        >
          Auditoria
        </button>
      </nav>
      {tab === 'review' && <Review onLogout={onLogout} />}
      {tab === 'tags' && <TagsManager onLogout={onLogout} />}
      {tab === 'share' && <ShareManager onLogout={onLogout} />}
      {tab === 'audit' && <Audit onLogout={onLogout} />}
    </div>
  );
}

function TokenGate({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="gate">
      <h1>FoodLog</h1>
      <p>Cole seu token de acesso para revisar as entradas do dia.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = value.trim();
          if (t) onSave(t);
        }}
      >
        <input
          type="password"
          placeholder="api_token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={!value.trim()}>Entrar</button>
      </form>
    </div>
  );
}

function Review({ onLogout }: { onLogout: () => void }) {
  const [date, setDate] = useState<string>(todayLocal());
  const [entries, setEntries] = useState<EntryWithFoods[]>([]);
  const [tags, setTags] = useState<ContextTag[]>([]);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  // CAP-8: food search across full history
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EntryWithFoods[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const isSearchMode = searchQuery.trim().length >= 2;

  // Tags rarely change; load once. A failure here is non-fatal — the chips just
  // won't render and review still works.
  useEffect(() => {
    fetchTags()
      .then(setTags)
      .catch((err) => {
        if (err instanceof UnauthorizedError) onLogout();
      });
  }, [onLogout]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEntries(date);
      setEntries(data);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [date, onLogout]);

  useEffect(() => {
    void load();
  }, [load]);

  // CAP-8: fetch search results whenever query changes (debounced 300 ms).
  // setSearchLoading is deferred inside the timer so cleanup before 300ms never
  // leaves the loading spinner stuck.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setSearchLoading(true);
      setSearchError(null);
      searchEntries(q)
        .then((r) => { if (!cancelled) setSearchResults(r); })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof UnauthorizedError) onLogout();
          else setSearchError((err as Error).message);
        })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, onLogout]);

  const handleAccept = useCallback(
    async (id: string) => {
      try {
        await acceptEntry(id);
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, reviewed: true } : e)));
        setSearchResults((prev) => prev ? prev.map((e) => (e.id === id ? { ...e, reviewed: true } : e)) : prev);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          onLogout();
          return;
        }
        setError((err as Error).message);
      }
    },
    [onLogout]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Excluir esta entrada e seus alimentos? Não dá para desfazer.')) {
        return;
      }
      try {
        await deleteEntry(id);
        setEntries((prev) => prev.filter((e) => e.id !== id));
        setSearchResults((prev) => prev ? prev.filter((e) => e.id !== id) : prev);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          onLogout();
          return;
        }
        setError((err as Error).message);
      }
    },
    [onLogout]
  );

  // CAP-4: re-run the AI with the user's correction, then merge the returned view
  // back into the card (new foods, reviewed:false). Keeps user_id from the existing
  // entry since the view does not carry it. Updated in place (no re-sort) so the card
  // the user just edited stays put — matches handleAccept; it re-sorts on next load.
  const handleReanalyze = useCallback(
    async (id: string, payload: ReanalyzeRequest) => {
      try {
        const view = await reanalyzeEntry(id, payload);
        setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...view } : e)));
        setSearchResults((prev) => prev ? prev.map((e) => (e.id === id ? { ...e, ...view } : e)) : prev);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          onLogout();
        }
        throw err;
      }
    },
    [onLogout]
  );

  // CAP-9: set/clear the entry's context tag (one touch). Updates only the context
  // fields in place so the card stays put and other state is untouched.
  const handleSetContext = useCallback(
    async (id: string, tagId: string | null) => {
      try {
        const view = await setEntryContext(id, tagId);
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, context: view.context, context_tag_id: view.context_tag_id } : e
          )
        );
        setSearchResults((prev) =>
          prev
            ? prev.map((e) =>
                e.id === id ? { ...e, context: view.context, context_tag_id: view.context_tag_id } : e
              )
            : prev
        );
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          onLogout();
          return;
        }
        setError((err as Error).message);
      }
    },
    [onLogout]
  );

  // Create a manual entry from the form, then surface it: jump to the entry's
  // (SP-local) day if it differs from the one shown, else refetch the current day.
  // Re-throws on failure so the form can show the error and stay open.
  const handleCreateManual = useCallback(
    async (input: { description: string; createdAt?: string; photos?: File[] }) => {
      try {
        const view = await createManualEntry(input);
        setShowManual(false);
        const day = localDay(view.created_at);
        if (day === date) {
          await load();
        } else {
          setDate(day); // different day → switch the selector; the load effect refetches
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          onLogout();
        }
        throw err;
      }
    },
    [date, load, onLogout]
  );

  const pending = useMemo(() => entries.filter((e) => !e.reviewed).length, [entries]);

  // Tag id → tag, so each card can resolve its own color/name without a new payload field.
  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  // Apply the tag filter, then the creation-order sort. Pending count above stays
  // over ALL entries (it is a backlog signal, not a view of the filtered list).
  const visible = useMemo(() => {
    const filtered = entries.filter((e) => {
      if (tagFilter === 'all') return true;
      if (tagFilter === 'none') return e.context_tag_id === null;
      return e.context_tag_id === tagFilter;
    });
    return sortByCreated(filtered, sortDir);
  }, [entries, tagFilter, sortDir]);

  // Day summary reflects the active tag filter: it aggregates the visible entries,
  // not all of them. Null when nothing showable so the bar can be skipped.
  const summary = useMemo(() => dayTotals(visible), [visible]);

  return (
    <div className="review">
      <header>
        <div className="header-row">
          <h1>Revisão diária</h1>
          <button className="link" onClick={onLogout}>Sair</button>
        </div>
        <div className="controls">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              // Ignore a cleared input so the list always matches the visible day.
              if (e.target.value) setDate(e.target.value);
            }}
          />
          <button
            type="button"
            className="link sort-toggle"
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            title="Alternar ordem por data de criação"
          >
            {sortDir === 'desc' ? '↓ Mais recentes' : '↑ Mais antigas'}
          </button>
          <span className="pending">{pending} pendente(s)</span>
          <button
            type="button"
            className="new-entry"
            onClick={() => setShowManual((s) => !s)}
          >
            + Novo registro
          </button>
        </div>
        <div className="search-bar">
          <input
            type="search"
            placeholder="Buscar alimento no histórico…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" className="link" onClick={() => setSearchQuery('')}>
              Limpar
            </button>
          )}
        </div>
        {!isSearchMode && tags.length > 0 && (
          <div className="seg tag-filter">
            <button
              type="button"
              className={tagFilter === 'all' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setTagFilter('all')}
            >
              Todas
            </button>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tagFilter === t.id ? 'seg-btn active' : 'seg-btn'}
                onClick={() => setTagFilter(t.id)}
              >
                <span className="dot-color" style={{ background: t.color }} />
                {t.name}
              </button>
            ))}
            <button
              type="button"
              className={tagFilter === 'none' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setTagFilter('none')}
            >
              Sem tag
            </button>
          </div>
        )}
      </header>

      {showManual && !isSearchMode && (
        <ManualEntryForm onSubmit={handleCreateManual} onCancel={() => setShowManual(false)} />
      )}

      {/* CAP-8: search mode */}
      {isSearchMode ? (
        <>
          {searchError && <div className="banner error">{searchError}</div>}
          {searchLoading && <div className="banner">Buscando…</div>}
          {!searchLoading && !searchError && searchResults !== null && searchResults.length === 0 && (
            <div className="empty">Nenhum resultado para "{searchQuery.trim()}".</div>
          )}
          {!searchLoading && !searchError && searchResults && searchResults.length > 0 && (
            <div className="day-summary">
              <span className="day-summary-count">
                {searchResults.length} {searchResults.length === 1 ? 'resultado' : 'resultados'}
              </span>
            </div>
          )}
          <ul className="cards">
            {(searchResults ?? []).map((entry) => (
              <SearchEntryCard
                key={entry.id}
                entry={entry}
                tags={tags}
                currentTag={entry.context_tag_id ? tagsById.get(entry.context_tag_id) ?? null : null}
                onAccept={handleAccept}
                onReanalyze={handleReanalyze}
                onDelete={handleDelete}
                onSetContext={handleSetContext}
              />
            ))}
          </ul>
        </>
      ) : (
        <>
          {error && <div className="banner error">{error}</div>}
          {loading && <div className="banner">Carregando…</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="empty">Nenhuma entrada neste dia.</div>
          )}
          {!loading && !error && entries.length > 0 && visible.length === 0 && (
            <div className="empty">Nenhuma entrada para este filtro.</div>
          )}

          {!loading && !error && visible.length > 0 && (
            <div className="day-summary">
              <span className="day-summary-count">
                {visible.length} {visible.length === 1 ? 'entrada' : 'entradas'}
              </span>
              {summary && <span className="day-summary-totals">{summary}</span>}
            </div>
          )}

          <ul className="cards">
            {visible.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                tags={tags}
                currentTag={entry.context_tag_id ? tagsById.get(entry.context_tag_id) ?? null : null}
                onAccept={handleAccept}
                onReanalyze={handleReanalyze}
                onDelete={handleDelete}
                onSetContext={handleSetContext}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Manual-entry form: free-text description (required), an optional photo set and a
// date/time (defaults to now in SP). Submitting runs the synchronous AI analysis,
// so the button shows a busy state until the new entry comes back.
function ManualEntryForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: { description: string; createdAt?: string; photos?: File[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState<string>(nowLocalDateTime());
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const desc = description.trim();
    if (!desc || busy) return;
    setBusy(true);
    setError(null);
    try {
      // datetime-local is São Paulo wall-clock time. Pin it to SP's fixed offset
      // (-03:00 — Brazil has no DST since 2019) so the instant is correct regardless
      // of the device timezone. Empty → omit so the backend's DEFAULT now() applies.
      const createdAt = when ? new Date(`${when}:00-03:00`).toISOString() : undefined;
      await onSubmit({ description: desc, createdAt, photos });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="manual-form">
      <h2>Novo registro manual</h2>
      <label>
        O que você comeu?
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex.: 2 ovos mexidos, uma fatia de pão integral e um café com leite"
          rows={3}
          autoFocus
        />
      </label>
      <label>
        Data e hora
        <input
          type="datetime-local"
          value={when}
          max={nowLocalDateTime()}
          onChange={(e) => setWhen(e.target.value)}
        />
      </label>
      <label>
        Foto (opcional)
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setPhotos(e.target.files ? Array.from(e.target.files) : [])}
        />
      </label>
      {error && <div className="banner error">{error}</div>}
      <div className="manual-actions">
        <button type="button" onClick={() => void submit()} disabled={!description.trim() || busy}>
          {busy ? 'Analisando…' : 'Criar e analisar'}
        </button>
        <button type="button" className="link" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// One editable food in the correction form: description + quantity, plus a stable
// key so React preserves inputs across re-renders even after a deletion.
interface EditFood {
  key: string;
  description: string;
  quantity: string;
}

function EntryCard({
  entry,
  tags,
  currentTag,
  onAccept,
  onReanalyze,
  onDelete,
  onSetContext,
}: {
  entry: EntryWithFoods;
  tags: ContextTag[];
  currentTag: ContextTag | null;
  onAccept: (id: string) => void;
  onReanalyze: (id: string, payload: ReanalyzeRequest) => Promise<void>;
  onDelete: (id: string) => void;
  onSetContext: (id: string, tagId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editFoods, setEditFoods] = useState<EditFood[]>([]);
  const [foodsDirty, setFoodsDirty] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const time = new Date(entry.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const totals = mealTotals(entry.foods);

  const startEdit = () => {
    setEditFoods(
      entry.foods.map((f) => ({
        key: f.id,
        description: f.description,
        quantity: f.quantity ?? '',
      }))
    );
    setFoodsDirty(false);
    setNote('');
    setErr(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setErr(null);
  };

  const updateFood = (key: string, field: 'description' | 'quantity', value: string) => {
    setEditFoods((prev) => prev.map((f) => (f.key === key ? { ...f, [field]: value } : f)));
    setFoodsDirty(true);
  };

  const removeFood = (key: string) => {
    setEditFoods((prev) => prev.filter((f) => f.key !== key));
    setFoodsDirty(true);
  };

  const submit = async () => {
    // Mirror the backend contract: send `foods` only when the user actually edited
    // them (otherwise the unchanged list would override a pure free-text correction);
    // send `correction` only when there is text. At least one must be present.
    const payload: ReanalyzeRequest = {};
    if (foodsDirty) {
      payload.foods = editFoods
        .filter((f) => f.description.trim())
        .map((f) => ({
          description: f.description.trim(),
          quantity: f.quantity.trim() ? f.quantity.trim() : null,
        }));
    }
    if (note.trim()) {
      payload.correction = note.trim();
    }
    if (!payload.correction && (!payload.foods || payload.foods.length === 0)) {
      setErr('Edite algum alimento ou escreva uma correção.');
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      await onReanalyze(entry.id, payload);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`card ${entry.reviewed ? 'reviewed' : ''}`}>
      <div className="photos">
        {entry.photos.map((url, i) => (
          <img key={i} src={url} alt={`Foto ${i + 1}`} loading="lazy" />
        ))}
      </div>
      <div className="card-body">
        <div className="card-head">
          <div>
            <div>
              <strong>{entry.title ?? 'Sem título'}</strong>
              <span className="time">{time}</span>
            </div>
            {totals && <div className="totals">{totals}</div>}
          </div>
          <span className={`badge ${confClass(entry.ai_confidence_overall)}`}>
            {pct(entry.ai_confidence_overall)}
          </span>
        </div>

        {!editing ? (
          <>
            {entry.foods.length === 0 ? (
              <p className="no-foods">IA não identificou alimentos.</p>
            ) : (
              <ul className="foods">
                {entry.foods.map((f) => (
                  <FoodRow key={f.id} food={f} />
                ))}
              </ul>
            )}
            {tags.length > 0 && (
              <div className="context">
                {currentTag ? (
                  <button
                    type="button"
                    className="tag-badge"
                    style={{ background: currentTag.color, color: textOn(currentTag.color) }}
                    onClick={() => setPickerOpen((o) => !o)}
                    title="Trocar ou limpar a tag"
                  >
                    {currentTag.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tag-badge empty"
                    onClick={() => setPickerOpen((o) => !o)}
                  >
                    + Tag
                  </button>
                )}
                {pickerOpen && (
                  <div className="context-chips">
                    {tags.map((t) => {
                      const active = entry.context_tag_id === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={active ? 'chip active' : 'chip'}
                          style={
                            active
                              ? { background: t.color, borderColor: t.color, color: textOn(t.color) }
                              : { borderColor: t.color }
                          }
                          onClick={() => {
                            onSetContext(entry.id, active ? null : t.id);
                            setPickerOpen(false);
                          }}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="actions">
              {entry.reviewed ? (
                <span className="accepted">✓ Revisado</span>
              ) : (
                <button onClick={() => onAccept(entry.id)}>Aceitar</button>
              )}
              <button className="link" onClick={startEdit}>Corrigir</button>
              <button className="link danger" onClick={() => onDelete(entry.id)}>Excluir</button>
            </div>
          </>
        ) : (
          <div className="edit">
            {editFoods.length > 0 && (
              <ul className="edit-foods">
                {editFoods.map((f) => (
                  <li key={f.key} className="edit-food">
                    <input
                      type="text"
                      value={f.description}
                      placeholder="Alimento"
                      onChange={(e) => updateFood(f.key, 'description', e.target.value)}
                      disabled={busy}
                    />
                    <input
                      type="text"
                      className="qty"
                      value={f.quantity}
                      placeholder="Qtd"
                      onChange={(e) => updateFood(f.key, 'quantity', e.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="link danger"
                      onClick={() => removeFood(f.key)}
                      disabled={busy}
                      aria-label="Remover alimento"
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              className="note"
              value={note}
              placeholder="Correção em texto livre (ex.: é peixe, não frango; porção ~200g)"
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              rows={2}
            />
            {err && <div className="banner error">{err}</div>}
            <div className="actions">
              <button onClick={() => void submit()} disabled={busy}>
                {busy ? 'Re-analisando…' : 'Re-analisar'}
              </button>
              <button className="link" onClick={cancelEdit} disabled={busy}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// CAP-8: thin wrapper that prepends a date label above each card in search results.
// Renders as two sibling <li> elements inside the parent <ul className="cards">.
function SearchEntryCard(props: Parameters<typeof EntryCard>[0]) {
  const date = new Date(props.entry.created_at).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    weekday: 'short',
  });
  return (
    <>
      <li className="search-date-label">{date}</li>
      <EntryCard {...props} />
    </>
  );
}

export function FoodRow({ food }: { food: FoodItem }) {
  const macros = [
    food.kcal != null ? `${Math.round(food.kcal)} kcal` : null,
    food.protein_g != null ? `P ${Math.round(food.protein_g)}g` : null,
    food.fat_g != null ? `G ${Math.round(food.fat_g)}g` : null,
    food.carbs_g != null ? `C ${Math.round(food.carbs_g)}g` : null,
  ].filter(Boolean);
  return (
    <li className="food">
      <span className={`dot ${confClass(food.confidence)}`} title={pct(food.confidence)} />
      <span className="food-desc">
        {food.description}
        {food.quantity ? ` · ${food.quantity}` : ''}
      </span>
      {macros.length > 0 && <span className="macros">{macros.join(' · ')}</span>}
    </li>
  );
}

// CAP-9 — tag management: create, rename, delete the user's context tags.
function TagsManager({ onLogout }: { onLogout: () => void }) {
  const [tags, setTags] = useState<ContextTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#9ca3af');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const byName = (a: ContextTag, b: ContextTag) => a.name.localeCompare(b.name);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTags(await fetchTags());
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const tag = await createTag(name, newColor);
      setTags((prev) => [...prev, tag].sort(byName));
      setNewName('');
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (t: ContextTag) => {
    setEditingId(t.id);
    setEditName(t.name);
    setError(null);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const tag = await updateTag(id, { name });
      setTags((prev) => prev.map((t) => (t.id === id ? tag : t)).sort(byName));
      cancelEdit();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Persist a color change for an existing tag. Kept off the `busy` flag so the
  // native picker stays responsive; updates the row in place on success.
  const handleColor = async (id: string, color: string) => {
    setError(null);
    try {
      const tag = await updateTag(id, { color });
      setTags((prev) => prev.map((t) => (t.id === id ? tag : t)));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    }
  };

  const handleDelete = async (t: ContextTag) => {
    if (!window.confirm(`Apagar a tag "${t.name}"? Entradas que a usam ficam sem contexto.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteTag(t.id);
      setTags((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <header>
        <div className="header-row">
          <h1>Tags de contexto</h1>
          <button className="link" onClick={onLogout}>Sair</button>
        </div>
        <form
          className="controls"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <input
            type="text"
            placeholder="Nova tag (ex.: padaria)"
            value={newName}
            maxLength={30}
            onChange={(e) => setNewName(e.target.value)}
            disabled={busy}
          />
          <input
            type="color"
            className="color-swatch"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            disabled={busy}
            title="Cor da tag"
          />
          <button type="submit" disabled={busy || !newName.trim()}>Adicionar</button>
        </form>
      </header>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="banner">Carregando…</div>}
      {!loading && !error && tags.length === 0 && <div className="empty">Nenhuma tag.</div>}

      <ul className="tag-list">
        {tags.map((t) => (
          <li key={t.id} className="tag-row">
            {editingId === t.id ? (
              <>
                <input
                  type="text"
                  value={editName}
                  maxLength={30}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <button onClick={() => void handleRename(t.id)} disabled={busy || !editName.trim()}>
                  Salvar
                </button>
                <button className="link" onClick={cancelEdit} disabled={busy}>Cancelar</button>
              </>
            ) : (
              <>
                <input
                  type="color"
                  className="color-swatch"
                  defaultValue={t.color}
                  // Persist on blur, not onChange: React's onChange for <input type=color>
                  // fires on every drag tick, which would spray PATCH requests. The guard
                  // skips a no-op save when the value did not actually change.
                  onBlur={(e) => {
                    if (e.target.value !== t.color) void handleColor(t.id, e.target.value);
                  }}
                  disabled={busy}
                  title="Cor da tag"
                />
                <span className="tag-name">{t.name}</span>
                <button className="link" onClick={() => startEdit(t)} disabled={busy}>Renomear</button>
                <button className="link danger" onClick={() => void handleDelete(t)} disabled={busy}>
                  Apagar
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// CAP-7a — share links: generate a read-only link for the nutritionist over a
// chosen period with an expiration, then copy/revoke existing links.
type Validity = '7' | '30' | '90' | 'custom';

function shareUrl(token: number): string {
  // Friendly zero-padded display (e.g. /share/001); the backend lookup parses the int.
  return `${window.location.origin}/share/${String(token).padStart(3, '0')}`;
}

function fmtDate(d: string): string {
  // d is 'YYYY-MM-DD'; render without constructing a Date (avoids tz off-by-one).
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function ShareManager({ onLogout }: { onLogout: () => void }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [start, setStart] = useState<string>(todayLocal());
  const [end, setEnd] = useState<string>(todayLocal());
  const [validity, setValidity] = useState<Validity>('30');
  const [customExpires, setCustomExpires] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLinks(await listShareLinks());
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGenerate = async () => {
    if (start > end) {
      setError('A data inicial deve ser anterior ou igual à final.');
      return;
    }
    // Compute the absolute expiration: presets are N days from now; custom is a local
    // datetime the user picked. Both go to the backend as ISO.
    let expires_at: string;
    if (validity === 'custom') {
      if (!customExpires) {
        setError('Escolha a data/hora de expiração.');
        return;
      }
      const d = new Date(customExpires);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        setError('A expiração deve ser no futuro.');
        return;
      }
      expires_at = d.toISOString();
    } else {
      const d = new Date();
      d.setDate(d.getDate() + Number(validity));
      expires_at = d.toISOString();
    }

    setBusy(true);
    setError(null);
    try {
      await createShareLink({ period_start: start, period_end: end, expires_at });
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (token: number) => {
    const url = shareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 2000);
    } catch {
      // Clipboard blocked (insecure context / permissions): show the URL to copy by hand.
      window.prompt('Copie o link:', url);
    }
  };

  const handleRevoke = async (link: ShareLink) => {
    if (!window.confirm('Revogar este link? Quem tiver a URL perde o acesso.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteShareLink(link.id);
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <header>
        <div className="header-row">
          <h1>Compartilhar com o nutricionista</h1>
          <button className="link" onClick={onLogout}>Sair</button>
        </div>
        <div className="share-form">
          <label>
            De
            <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} disabled={busy} />
          </label>
          <label>
            Até
            <input type="date" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} disabled={busy} />
          </label>
          <label>
            Validade
            <select value={validity} onChange={(e) => setValidity(e.target.value as Validity)} disabled={busy}>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="custom">Personalizada…</option>
            </select>
          </label>
          {validity === 'custom' && (
            <input
              type="datetime-local"
              value={customExpires}
              onChange={(e) => setCustomExpires(e.target.value)}
              disabled={busy}
            />
          )}
          <button type="button" onClick={() => void handleGenerate()} disabled={busy}>
            {busy ? 'Gerando…' : 'Gerar link'}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="banner">Carregando…</div>}
      {!loading && !error && links.length === 0 && <div className="empty">Nenhum link gerado.</div>}

      <ul className="link-list">
        {links.map((l) => (
          <li key={l.id} className={`link-row ${l.status === 'expired' ? 'expired' : ''}`}>
            <div className="link-main">
              <code className="link-url">{shareUrl(l.token)}</code>
              <span className="link-meta">
                {fmtDate(l.period_start)}–{fmtDate(l.period_end)} · {l.status === 'expired' ? 'expirado' : 'ativo'} ·
                expira {new Date(l.expires_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="link-actions">
              <button className="link" onClick={() => void handleCopy(l.token)} disabled={busy}>
                {copied === shareUrl(l.token) ? 'Copiado!' : 'Copiar'}
              </button>
              <button className="link danger" onClick={() => void handleRevoke(l)} disabled={busy}>Revogar</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Color class for an HTTP status code (or null when no response was sent).
function statusClass(code: number | null): string {
  if (code === null) return 'st-none';
  if (code >= 500) return 'st-5xx';
  if (code >= 400) return 'st-4xx';
  if (code >= 200 && code < 300) return 'st-2xx';
  return 'st-other';
}

type DirectionFilter = '' | 'inbound' | 'outbound';

function Audit({ onLogout }: { onLogout: () => void }) {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // `search`/`dir` are passed explicitly so this callback only depends on
  // onLogout (stable) — the mount effect runs once and filtering is manual.
  const load = useCallback(
    async (search: string, dir: DirectionFilter) => {
      setLoading(true);
      setError(null);
      try {
        setLogs(await fetchRequestLogs(search, dir || undefined));
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          onLogout();
          return;
        }
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [onLogout]
  );

  useEffect(() => {
    void load('', '');
  }, [load]);

  // Switching the direction filter reloads immediately with the current query.
  const selectDirection = useCallback(
    (dir: DirectionFilter) => {
      setDirection(dir);
      void load(q, dir);
    },
    [load, q]
  );

  const handlePurge = useCallback(async () => {
    if (!window.confirm('Apagar TODOS os registros de auditoria?')) return;
    try {
      await purgeRequestLogs();
      setLogs([]);
      setExpanded(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return;
      }
      setError((err as Error).message);
    }
  }, [onLogout]);

  return (
    <div className="review">
      <header>
        <div className="header-row">
          <h1>Auditoria</h1>
          <button className="link" onClick={onLogout}>Sair</button>
        </div>
        <div className="seg">
          {([
            ['', 'Todos'],
            ['inbound', 'Entrada'],
            ['outbound', 'Saída'],
          ] as [DirectionFilter, string][]).map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              className={direction === value ? 'seg-btn active' : 'seg-btn'}
              onClick={() => selectDirection(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="controls"
          onSubmit={(e) => {
            e.preventDefault();
            void load(q, direction);
          }}
        >
          <input
            type="search"
            placeholder="Filtrar por path/serviço (ex.: /webhook, z-api)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit">Buscar</button>
          <button type="button" className="link" onClick={() => void load(q, direction)}>Atualizar</button>
          <button type="button" className="link danger" onClick={() => void handlePurge()}>Limpar</button>
        </form>
      </header>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="banner">Carregando…</div>}
      {!loading && !error && logs.length === 0 && (
        <div className="empty">Nenhuma requisição registrada.</div>
      )}

      <ul className="logs">
        {logs.map((log) => (
          <LogRow
            key={log.id}
            log={log}
            open={expanded === log.id}
            onToggle={() => setExpanded((cur) => (cur === log.id ? null : log.id))}
          />
        ))}
      </ul>
    </div>
  );
}

function LogRow({
  log,
  open,
  onToggle,
}: {
  log: RequestLog;
  open: boolean;
  onToggle: () => void;
}) {
  const when = new Date(log.created_at).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const isOutbound = log.direction === 'outbound';
  return (
    <li className="log">
      <button className="log-head" onClick={onToggle}>
        <span className={`status ${statusClass(log.status_code)}`}>{log.status_code ?? '—'}</span>
        <span className={`dir dir-${isOutbound ? 'out' : 'in'}`}>{isOutbound ? '↑' : '↓'}</span>
        <span className="method">{log.method}</span>
        <span className="log-path">{log.path}</span>
        <span className="log-meta">
          {log.duration_ms != null ? `${log.duration_ms}ms` : ''} · {when}
        </span>
      </button>
      {open && (
        <div className="log-detail">
          {isOutbound ? (
            <>
              <Field label="Resumo" value={log.request_body ?? '(vazio)'} />
              <Field label="Resultado" value={log.response_body ?? '(vazio)'} />
            </>
          ) : (
            <>
              {log.query && <Field label="Query" value={log.query} />}
              {log.remote_ip && <Field label="IP" value={log.remote_ip} />}
              <Field label="Headers" value={JSON.stringify(log.request_headers ?? {}, null, 2)} />
              <Field label="Request body" value={log.request_body ?? '(vazio)'} />
              <Field label="Response body" value={log.response_body ?? '(vazio)'} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <pre className="field-value">{value}</pre>
    </div>
  );
}
