import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchShared, fetchSharedPatterns, ShareExpiredError, ShareInvalidError } from './api';
import { FoodRow, mealTotals } from './App';
import type { PatternsPayload, SharedEntry, SharedPayload } from './types';

// Local day key in the same timezone the backend filters on, so grouping matches
// the period boundaries exactly.
function spDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDateBR(d: string): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function spTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

// Months (inclusive) spanning [start, end], each as {y, m} (m is 1-based).
function monthsBetween(start: string, end: string): { y: number; m: number }[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const out: { y: number; m: number }[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push({ y, m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// Calendar cells for a month: leading nulls to align day 1 to its weekday, then
// one 'YYYY-MM-DD' per day. UTC math avoids local-tz drift in the grid layout.
function monthCells(y: number, m: number): (string | null)[] {
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(`${y}-${pad2(m)}-${pad2(d)}`);
  }
  return cells;
}

function monthLabel(y: number, m: number): string {
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type View = 'calendar' | 'list' | 'patterns';
type PatternsStatus = 'idle' | 'loading' | 'ok' | 'error' | 'gone';

export function PublicShare({ token }: { token: string }) {
  const [data, setData] = useState<SharedPayload | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'expired' | 'invalid' | 'error'>('loading');
  const [view, setView] = useState<View>('calendar');
  const [foodFilter, setFoodFilter] = useState('');

  // CAP-7b: pattern analysis is fetched lazily — only once the "Padrões" tab is
  // opened — so the calendar/list view never waits on (or pays for) the AI call.
  const [patterns, setPatterns] = useState<PatternsPayload | null>(null);
  const [patternsStatus, setPatternsStatus] = useState<PatternsStatus>('idle');
  // Dedupe guard for the lazy fetch. Using a ref (not the status) avoids a stuck
  // 'loading' state when the user toggles away mid-fetch: the request always runs
  // to completion (token is fixed for this view) and `onRetry` resets the ref.
  const patternsRequested = useRef(false);

  useEffect(() => {
    let active = true;
    fetchShared(token)
      .then((d) => {
        if (!active) return;
        setData(d);
        setStatus('ok');
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ShareExpiredError) setStatus('expired');
        else if (err instanceof ShareInvalidError) setStatus('invalid');
        else setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [token]);

  // Fetch patterns the first time the tab is opened. `onRetry` clears the ref to
  // allow a re-fetch. Backend caches, so any repeat is a cheap cache hit.
  useEffect(() => {
    if (view !== 'patterns' || patternsRequested.current) return;
    patternsRequested.current = true;
    setPatternsStatus('loading');
    fetchSharedPatterns(token)
      .then((p) => {
        setPatterns(p);
        setPatternsStatus('ok');
      })
      .catch((err) => {
        if (err instanceof ShareExpiredError || err instanceof ShareInvalidError) setPatternsStatus('gone');
        else setPatternsStatus('error');
      });
    // patternsStatus is a dep so `onRetry` (idle reset) re-triggers; the ref guard
    // prevents this from re-fetching on the idle→loading→ok transitions.
  }, [view, patternsStatus, token]);

  // CAP-8: client-side filter by food name — no extra network call needed since
  // the full period payload is already loaded.
  const filteredEntries = useMemo(() => {
    if (!data) return [];
    const q = foodFilter.trim().toLowerCase();
    if (q.length < 2) return data.entries;
    return data.entries.filter((e) =>
      e.foods.some((f) => f.description.toLowerCase().includes(q))
    );
  }, [data, foodFilter]);

  if (status === 'loading') {
    return (
      <div className="public">
        <div className="banner">Carregando…</div>
      </div>
    );
  }

  if (status !== 'ok' || !data) {
    const msg =
      status === 'expired'
        ? 'Este link expirou. Peça um novo ao paciente.'
        : status === 'invalid'
          ? 'Link inválido ou revogado.'
          : 'Não foi possível carregar o link.';
    return (
      <div className="public">
        <div className="gate">
          <h1>FoodLog</h1>
          <p>{msg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public">
      <header className="public-head">
        <h1>Histórico alimentar</h1>
        <p className="period">
          {fmtDateBR(data.period_start)} — {fmtDateBR(data.period_end)}
        </p>
        <div className="seg">
          <button
            type="button"
            className={view === 'calendar' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setView('calendar')}
          >
            Calendário
          </button>
          <button
            type="button"
            className={view === 'list' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setView('list')}
          >
            Lista
          </button>
          <button
            type="button"
            className={view === 'patterns' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setView('patterns')}
          >
            Padrões
          </button>
        </div>
        {view !== 'patterns' && (
          <div className="search-bar">
            <input
              type="search"
              placeholder="Filtrar por alimento…"
              value={foodFilter}
              onChange={(e) => setFoodFilter(e.target.value)}
            />
            {foodFilter && (
              <button type="button" className="link" onClick={() => setFoodFilter('')}>
                Limpar
              </button>
            )}
            {foodFilter.trim().length >= 2 && (
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                {filteredEntries.length} resultado(s)
              </span>
            )}
          </div>
        )}
      </header>

      {view === 'patterns' ? (
        <PatternsView
          status={patternsStatus}
          data={patterns}
          onRetry={() => {
            patternsRequested.current = false;
            setPatternsStatus('idle');
          }}
        />
      ) : filteredEntries.length === 0 ? (
        <div className="empty">
          {foodFilter.trim().length >= 2
            ? `Nenhum resultado para "${foodFilter.trim()}".`
            : 'Sem registros neste período.'}
        </div>
      ) : view === 'calendar' ? (
        <CalendarView entries={filteredEntries} start={data.period_start} end={data.period_end} />
      ) : (
        <ListView entries={filteredEntries} />
      )}
    </div>
  );
}

function PatternsView({
  status,
  data,
  onRetry,
}: {
  status: PatternsStatus;
  data: PatternsPayload | null;
  onRetry: () => void;
}) {
  if (status === 'idle' || status === 'loading') {
    return <div className="banner">Analisando padrões com IA…</div>;
  }
  if (status === 'gone') {
    return <div className="empty">Link indisponível.</div>;
  }
  if (status === 'error') {
    return (
      <div className="empty">
        <p>Não foi possível gerar a análise.</p>
        <button type="button" className="seg-btn" onClick={onRetry}>
          Tentar de novo
        </button>
      </div>
    );
  }
  // status === 'ok'
  if (!data || data.insufficient || !data.analysis || data.analysis.observations.length === 0) {
    return <div className="empty">Dados insuficientes para a análise de padrões neste período.</div>;
  }
  const { observations, summary } = data.analysis;
  return (
    <div className="patterns">
      {summary && <p className="patterns-summary">{summary}</p>}
      <ul className="pattern-list">
        {observations.map((o, i) => (
          <li className="pattern-card" key={i}>
            <span className="pattern-cat">{o.category}</span>
            <strong className="pattern-title">{o.title}</strong>
            <p className="pattern-detail">{o.detail}</p>
          </li>
        ))}
      </ul>
      <p className="patterns-meta">Análise gerada por IA a partir dos registros do período.</p>
    </div>
  );
}

function CalendarView({
  entries,
  start,
  end,
}: {
  entries: SharedEntry[];
  start: string;
  end: string;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, SharedEntry[]>();
    for (const e of entries) {
      const key = spDate(e.created_at);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [entries]);

  const months = useMemo(() => monthsBetween(start, end), [start, end]);

  return (
    <div className="cal-wrap">
      {months.map(({ y, m }) => (
        <div className="cal-month" key={`${y}-${m}`}>
          <h2 className="cal-title">{monthLabel(y, m)}</h2>
          <div className="cal-grid">
            {WEEKDAYS.map((w, i) => (
              <div className="cal-weekday" key={i}>
                {w}
              </div>
            ))}
            {monthCells(y, m).map((day, i) => {
              if (day === null) {
                return <div className="cal-cell empty" key={`b${i}`} />;
              }
              const inRange = day >= start && day <= end;
              const dayEntries = byDay.get(day) ?? [];
              const thumbs = dayEntries.map((e) => e.photos[0]).filter(Boolean).slice(0, 3);
              const overflow = dayEntries.length - thumbs.length;
              return (
                <div className={`cal-cell ${inRange ? '' : 'out'}`} key={day}>
                  <span className="cal-day">{Number(day.slice(8))}</span>
                  {thumbs.length > 0 && (
                    <div className="cal-thumbs">
                      {thumbs.map((url, j) => (
                        <img key={j} src={url} alt="" loading="lazy" />
                      ))}
                      {overflow > 0 && <span className="cal-more">+{overflow}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListView({ entries }: { entries: SharedEntry[] }) {
  // Entries arrive chronological (asc). Group by local day, with a per-day macro total.
  const days = useMemo(() => {
    const map = new Map<string, SharedEntry[]>();
    for (const e of entries) {
      const key = spDate(e.created_at);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return Array.from(map.entries());
  }, [entries]);

  return (
    <div className="shared-list">
      {days.map(([day, dayEntries]) => {
        const dayTotals = mealTotals(dayEntries.flatMap((e) => e.foods));
        return (
          <section className="shared-day" key={day}>
            <div className="shared-day-head">
              <h2>{fmtDateBR(day)}</h2>
              {dayTotals && <span className="totals">{dayTotals}</span>}
            </div>
            <ul className="cards">
              {dayEntries.map((entry) => (
                <li className="card" key={entry.id}>
                  <div className="photos">
                    {entry.photos.length > 0
                      ? entry.photos.map((url, i) => (
                          <img key={i} src={url} alt={`Foto ${i + 1}`} loading="lazy" />
                        ))
                      : <div className="photo-placeholder" aria-hidden="true" />}
                  </div>
                  <div className="card-body">
                    <div className="card-head">
                      <div>
                        <strong>{entry.title ?? 'Sem título'}</strong>
                        <span className="time">{spTime(entry.created_at)}</span>
                        {entry.context && <span className="ctx-tag">{entry.context}</span>}
                      </div>
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
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
