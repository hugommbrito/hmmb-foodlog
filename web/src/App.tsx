import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptEntry,
  clearToken,
  createTag,
  deleteEntry,
  deleteTag,
  fetchEntries,
  fetchRequestLogs,
  fetchTags,
  getToken,
  purgeRequestLogs,
  reanalyzeEntry,
  renameTag,
  setEntryContext,
  setToken,
  UnauthorizedError,
} from './api';
import type { ContextTag, EntryWithFoods, FoodItem, ReanalyzeRequest, RequestLog } from './types';

// YYYY-MM-DD for "today", pinned to the same timezone the backend filters on
// (America/Sao_Paulo) so the default day matches regardless of the device tz.
function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// Confidence thresholds from the data-model contract.
function confClass(c: number | null): string {
  if (c === null) return 'conf-none';
  if (c === 0) return 'conf-zero';
  if (c >= 0.85) return 'conf-high';
  if (c >= 0.7) return 'conf-mid';
  return 'conf-low';
}

function pct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

// Meal totals from the AI-identified foods. Weight is intentionally omitted:
// `quantity` is free text (e.g. "1 prato"), not a numeric field. A macro that is
// null across every food is omitted (not shown as "0", which would imply data the
// AI never computed); non-finite values are ignored. Returns null when there is
// nothing to show so the row can be skipped — mirrors FoodRow's macro rendering.
function mealTotals(foods: FoodItem[]): string | null {
  if (foods.length === 0) return null;
  const sum = (k: 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g'): number | null => {
    const vals = foods
      .map((f) => f[k])
      .filter((v): v is number => v != null && Number.isFinite(v));
    return vals.length > 0 ? vals.reduce((a, v) => a + v, 0) : null;
  };
  const kcal = sum('kcal');
  const protein = sum('protein_g');
  const fat = sum('fat_g');
  const carbs = sum('carbs_g');
  const parts = [
    kcal != null ? `${Math.round(kcal)} kcal` : null,
    protein != null ? `P ${Math.round(protein)}g` : null,
    fat != null ? `G ${Math.round(fat)}g` : null,
    carbs != null ? `C ${Math.round(carbs)}g` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// Unreviewed first; within each group, lowest confidence (0.0 included) on top.
function sortForReview(list: EntryWithFoods[]): EntryWithFoods[] {
  return [...list].sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    return a.ai_confidence_overall - b.ai_confidence_overall;
  });
}

type Tab = 'review' | 'tags' | 'audit';

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
          className={tab === 'audit' ? 'tab active' : 'tab'}
          onClick={() => setTab('audit')}
        >
          Auditoria
        </button>
      </nav>
      {tab === 'review' && <Review onLogout={onLogout} />}
      {tab === 'tags' && <TagsManager onLogout={onLogout} />}
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setEntries(sortForReview(data));
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

  const handleAccept = useCallback(
    async (id: string) => {
      try {
        await acceptEntry(id);
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, reviewed: true } : e))
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

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Excluir esta entrada e seus alimentos? Não dá para desfazer.')) {
        return;
      }
      try {
        await deleteEntry(id);
        setEntries((prev) => prev.filter((e) => e.id !== id));
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
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, ...view } : e))
        );
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

  const pending = useMemo(() => entries.filter((e) => !e.reviewed).length, [entries]);

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
          <span className="pending">{pending} pendente(s)</span>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="banner">Carregando…</div>}
      {!loading && !error && entries.length === 0 && (
        <div className="empty">Nenhuma entrada neste dia.</div>
      )}

      <ul className="cards">
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            tags={tags}
            onAccept={handleAccept}
            onReanalyze={handleReanalyze}
            onDelete={handleDelete}
            onSetContext={handleSetContext}
          />
        ))}
      </ul>
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
  onAccept,
  onReanalyze,
  onDelete,
  onSetContext,
}: {
  entry: EntryWithFoods;
  tags: ContextTag[];
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
              <div className="context-chips">
                {tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={entry.context_tag_id === t.id ? 'chip active' : 'chip'}
                    onClick={() =>
                      onSetContext(entry.id, entry.context_tag_id === t.id ? null : t.id)
                    }
                  >
                    {t.name}
                  </button>
                ))}
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

function FoodRow({ food }: { food: FoodItem }) {
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
      const tag = await createTag(name);
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
      const tag = await renameTag(id, name);
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
