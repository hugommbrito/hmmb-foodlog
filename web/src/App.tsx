import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptEntry,
  clearToken,
  fetchEntries,
  fetchRequestLogs,
  getToken,
  purgeRequestLogs,
  reanalyzeEntry,
  setToken,
  UnauthorizedError,
} from './api';
import type { EntryWithFoods, FoodItem, ReanalyzeRequest, RequestLog } from './types';

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

// Unreviewed first; within each group, lowest confidence (0.0 included) on top.
function sortForReview(list: EntryWithFoods[]): EntryWithFoods[] {
  return [...list].sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
    return a.ai_confidence_overall - b.ai_confidence_overall;
  });
}

type Tab = 'review' | 'audit';

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
          className={tab === 'audit' ? 'tab active' : 'tab'}
          onClick={() => setTab('audit')}
        >
          Auditoria
        </button>
      </nav>
      {tab === 'review' ? <Review onLogout={onLogout} /> : <Audit onLogout={onLogout} />}
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            onAccept={handleAccept}
            onReanalyze={handleReanalyze}
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
  onAccept,
  onReanalyze,
}: {
  entry: EntryWithFoods;
  onAccept: (id: string) => void;
  onReanalyze: (id: string, payload: ReanalyzeRequest) => Promise<void>;
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
            <strong>{entry.title ?? 'Sem título'}</strong>
            <span className="time">{time}</span>
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
            <div className="actions">
              {entry.reviewed ? (
                <span className="accepted">✓ Revisado</span>
              ) : (
                <button onClick={() => onAccept(entry.id)}>Aceitar</button>
              )}
              <button className="link" onClick={startEdit}>Corrigir</button>
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
