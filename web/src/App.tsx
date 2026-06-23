import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptEntry,
  clearToken,
  fetchEntries,
  getToken,
  setToken,
  UnauthorizedError,
} from './api';
import type { EntryWithFoods, FoodItem } from './types';

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

export function App() {
  const [token, setTokenState] = useState<string | null>(getToken());

  if (!token) {
    return <TokenGate onSave={(t) => { setToken(t); setTokenState(t); }} />;
  }
  return <Review onLogout={() => { clearToken(); setTokenState(null); }} />;
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
          <EntryCard key={entry.id} entry={entry} onAccept={handleAccept} />
        ))}
      </ul>
    </div>
  );
}

function EntryCard({
  entry,
  onAccept,
}: {
  entry: EntryWithFoods;
  onAccept: (id: string) => void;
}) {
  const time = new Date(entry.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
        </div>
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
