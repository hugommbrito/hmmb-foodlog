import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchShared, fetchSharedPatterns, ShareExpiredError, ShareInvalidError } from './api';
import { DayModal, FoodRow, mealTotals } from './App';
import type { DayEntry } from './App';
import type { PatternsPayload, SharedEntry, SharedPayload } from './types';
import { monthsBetween, monthCells, monthLabel } from './calendarUtils';

// Local day key in the same timezone the backend filters on, so grouping matches
// the period boundaries exactly.
function spDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
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

type View = 'calendar' | 'list' | 'patterns' | 'photowall' | 'timeline';
type PatternsStatus = 'idle' | 'loading' | 'ok' | 'error' | 'gone';

export function PublicShare({ token }: { token: string }) {
  const [data, setData] = useState<SharedPayload | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'expired' | 'invalid' | 'error'>('loading');
  const [view, setView] = useState<View>('calendar');
  const [foodFilter, setFoodFilter] = useState('');
  const [dayModal, setDayModal] = useState<DayEntry[] | null>(null);

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
            className={view === 'photowall' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setView('photowall')}
          >
            Parede de Fotos
          </button>
          <button
            type="button"
            className={view === 'timeline' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setView('timeline')}
          >
            Timeline
          </button>
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
        <CalendarView
          entries={filteredEntries}
          start={data.period_start}
          end={data.period_end}
          onDayClick={(dayEntries) => setDayModal(dayEntries)}
        />
      ) : view === 'photowall' ? (
        <SharePhotoWallView entries={filteredEntries} />
      ) : view === 'timeline' ? (
        <ShareTimelineView entries={filteredEntries} />
      ) : (
        <ListView entries={filteredEntries} />
      )}
      {dayModal && <DayModal entries={dayModal} onClose={() => setDayModal(null)} />}
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
  onDayClick,
}: {
  entries: SharedEntry[];
  start: string;
  end: string;
  onDayClick?: (dayEntries: SharedEntry[]) => void;
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
              const hasEntriesNoPhoto = inRange && dayEntries.length > 0 && thumbs.length === 0;
              const clickable = inRange && dayEntries.length > 0 && !!onDayClick;
              const cls = `cal-cell${inRange ? '' : ' out'}`;
              const inner = (
                <>
                  <span className="cal-day">{Number(day.slice(8))}</span>
                  {thumbs.length > 0 && (
                    <div className="cal-thumbs">
                      {thumbs.map((url, j) => (
                        <img key={j} src={url} alt="" loading="lazy" />
                      ))}
                      {overflow > 0 && <span className="cal-more">+{overflow}</span>}
                    </div>
                  )}
                  {hasEntriesNoPhoto && <div className="cal-dot" aria-label="Tem entradas sem foto" />}
                </>
              );
              return clickable
                ? <button className={cls} key={day} onClick={() => onDayClick(dayEntries)}>{inner}</button>
                : <div className={cls} key={day}>{inner}</div>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SharePhotoWallView({ entries }: { entries: SharedEntry[] }) {
  return (
    <div className="photowall-grid">
      {entries.map((e) => {
        const time = new Date(e.created_at).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
        });
        const kcal = e.foods.reduce<number | null>((s, f) => f.kcal != null ? (s ?? 0) + f.kcal : s, null);
        const kcalLabel = kcal != null ? `${Math.round(kcal)} kcal` : '–';
        const extraPhotos = e.photos.slice(1, 3);
        const extraOverflow = e.photos.length > 3 ? e.photos.length - 3 : 0;
        return (
          <div key={e.id} className="photowall-cell" style={{ cursor: 'default' }}>
            {e.photos.length > 0
              ? <img src={e.photos[0]} loading="lazy" alt={e.title ?? 'Foto da refeição'} />
              : <div className="photowall-cell-ph" role="img" aria-label="Sem foto" />
            }
            <div className="photowall-scrim" aria-hidden="true" />
            <span className="photowall-time">{time}</span>
            <span className="photowall-kcal">{kcalLabel}</span>
            {extraPhotos.length > 0 && (
              <div className="photowall-extra-strip" aria-hidden="true">
                {extraPhotos.map((url, i) => (
                  <img key={i} src={url} alt="" loading="lazy" />
                ))}
                {extraOverflow > 0 && (
                  <span className="photowall-extra-badge">+{extraOverflow}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const SHR_START = 6;
const SHR_END = 23;
const SHR_TOTAL = (SHR_END - SHR_START) * 4;
const SHR_WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SHR_TICKS = Array.from({ length: SHR_TOTAL + 1 }, (_, i) => {
  const isHour = i % 4 === 0;
  const hour = SHR_START + Math.floor(i / 4);
  return { i, isHour, hour, showLabel: isHour && i % 8 === 0 };
});

function ShareTimelineView({ entries }: { entries: SharedEntry[] }) {
  const [modal, setModal] = useState<SharedEntry | null>(null);

  const days = useMemo(() => {
    const map = new Map<string, SharedEntry[]>();
    for (const e of entries) {
      const key = spDate(e.created_at);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  function dayLabel(dateStr: string): [string, string, boolean] {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = dt.getDay();
    return [
      SHR_WEEKDAYS[dow],
      `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`,
      dow === 0 || dow === 6,
    ];
  }

  function entryToSlot(iso: string): number {
    const [h, m] = spTime(iso).split(':').map(Number);
    const slot = (h - SHR_START) * 4 + Math.floor(m / 15);
    return Math.max(0, Math.min(SHR_TOTAL - 1, slot));
  }

  return (
    <>
      <div className="rtl-wrap">
        {days.map(([day, dayEntries]) => {
          const [weekday, datePart, isWeekend] = dayLabel(day);
          const sorted = [...dayEntries].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );

          const grouped = new Map<number, SharedEntry[]>();
          for (const e of sorted) {
            const s = entryToSlot(e.created_at);
            if (!grouped.has(s)) grouped.set(s, []);
            grouped.get(s)!.push(e);
          }

          const maxStack = Math.max(
            ...Array.from(grouped.values()).map((g) =>
              g.reduce((n, e) => n + Math.max(1, e.photos.length), 0),
            ),
          );
          const entriesHeight = maxStack * 66 + (maxStack - 1) * 4 + 12;

          return (
            <div key={day} className={`rtl-day${isWeekend ? ' rtl-day-weekend' : ''}`}>
              <div className="rtl-label" aria-label={`${weekday} ${datePart}`}>
                <span className="rtl-label-day">{weekday}</span>
                <span className="rtl-label-date">{datePart}</span>
              </div>
              <div className="rtl-content">
                <div className="rtl-inner">
                  <div className="rtl-ruler" role="presentation" aria-hidden="true">
                    {SHR_TICKS.map(({ i, isHour, hour, showLabel }) => (
                      <div key={i} className={`rtl-tick${isHour ? ' rtl-tick-hour' : ''}${grouped.has(i) ? ' rtl-tick-active' : ''}`}>
                        {showLabel && (
                          <span className="rtl-hour-label">{String(hour).padStart(2, '0')}</span>
                        )}
                        <span className="rtl-tick-mark" />
                      </div>
                    ))}
                  </div>
                  <div className="rtl-entries" style={{ height: entriesHeight }}>
                    {Array.from(grouped.entries()).map(([slotIdx, slotEntries]) => (
                      <div
                        key={slotIdx}
                        className="rtl-entry-group"
                        style={{ left: `${(slotIdx / SHR_TOTAL) * 100}%` }}
                      >
                        {slotEntries.flatMap((e) => {
                          const photos = e.photos.length > 0 ? e.photos : [null];
                          return photos.map((photo, pi) => (
                            <button
                              key={`${e.id}-${pi}`}
                              className="rtl-card"
                              onClick={() => setModal(e)}
                              aria-label={e.title ?? 'Ver refeição'}
                            >
                              {photo ? (
                                <img src={photo} alt={e.title ?? 'Foto'} loading="lazy" />
                              ) : (
                                <div className="rtl-card-ph" role="img" aria-label="Sem foto" />
                              )}
                            </button>
                          ));
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {modal && <DayModal entries={[modal]} onClose={() => setModal(null)} />}
    </>
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
