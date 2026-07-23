---
title: 'Story 2.4 — Indicador de Histórico dos 7 Dias'
type: 'feature'
created: '2026-06-29'
status: 'done'
baseline_commit: '182058dff76a786810540b8ab390a1fa34cbf832'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O mini-resumo do dia não oferece nenhuma indicação visual de quais dias recentes têm registros pendentes, forçando Hugo a navegar dia a dia para descobrir lacunas no histórico.

**Approach:** Adicionar uma fileira de 7 pontos clicáveis no lado direito do `.day-summary`, um por dia anterior ao dia selecionado. Cada ponto busca `GET /entries?date=` de forma independente e exibe cor conforme o status (vazio, revisado, pendente). Clicar num ponto navega para aquele dia.

## Boundaries & Constraints

**Always:**
- Os 7 pontos representam os 7 dias imediatamente anteriores ao `date` selecionado (não inclui o dia atual)
- Cores: sem entradas → `var(--border)`, todas revisadas → `var(--accent)`, tem pendentes → `var(--warning)`
- Antes da resposta chegar: ponto em `status: 'loading'` com opacidade reduzida
- 7 chamadas paralelas independentes via `fetchEntries(date)` — cada ponto resolve seu slot de forma isolada (não espera os outros)
- `aria-label` descritivo em cada ponto: ex. `"Segunda-feira 23/06: 3 entradas, 1 pendente de revisão"`
- Clicar num ponto chama `setDate(dotDate)` — atualiza o dia selecionado na Revisão
- Reutilizar `fetchEntries` de `api.ts` — zero chamadas a APIs ou endpoints novos
- Cancellation flag (`let cancelled = false`) no `useEffect` para evitar race condition ao trocar datas rapidamente

**Ask First:**
- Se quiser bloquear o clique em ponto ainda em `status: 'loading'`

**Never:**
- Criar endpoint novo no backend (constraint NFR-1)
- Modificar `fetchEntries` em `api.ts`
- Alterar os estados `loading`/`error` da lista principal de entradas
- Usar `var(--danger)` nos pontos — não mapeado para nenhum estado do indicador
- Renderizar os pontos quando `loading === true` (o container `.day-summary` já é ocultado nesse caso)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dia com todas entradas revisadas | `entries.every(e => e.reviewed)` | Ponto: `var(--accent)` | — |
| Dia com ≥1 entrada pendente | `entries.some(e => !e.reviewed)` | Ponto: `var(--warning)` | — |
| Dia sem entradas | `entries.length === 0` | Ponto: `var(--border)` | — |
| Fetch em voo | promise não resolvida | Ponto: `var(--border)` com `opacity: 0.5` | — |
| Erro no fetch de um ponto | promise rejeitada | Ponto cai para `status: 'empty'` | Erro silencioso — não afeta outros pontos |
| Troca rápida de dia | `setDate()` chamado antes de todos os fetches resolverem | Flag `cancelled` evita `setHistoryDots` fora de contexto | Fetches anteriores descartados via flag |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:38–40` — `todayLocal()` — referência para subtração de datas em YYYY-MM-DD
- `web/src/App.tsx:261` — `const [date, setDate] = useState<string>(todayLocal())` — estado do dia selecionado
- `web/src/App.tsx:287–306` — `load` callback — pattern de uso de `fetchEntries`
- `web/src/App.tsx:598–632` — bloco `.day-summary` — slot `{/* Área reservada… */}` na linha ~630
- `web/src/api.ts:63` — `fetchEntries(date?)` — retorna `EntryWithFoods[]`; reutilizar para cada ponto
- `web/src/styles.css:127–154` — `.day-summary` com `justify-content: space-between` já posiciona direita

## Tasks & Acceptance

**Execution:**
- [x] `web/src/App.tsx` — Adicionar type `HistoryDot = { date: string; status: 'loading' | 'empty' | 'reviewed' | 'pending'; total: number; pending: number }` próximo às declarações de estado (~linha 261). Adicionar helper `dotAriaLabel(dot: HistoryDot): string` que retorna `"Dia-da-semana DD/MM: N entrada(s), M pendente(s)"` usando `new Date(dot.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })` e pluraliza corretamente; para `status: 'loading'`, retorna `"Dia-da-semana DD/MM: carregando"`. Adicionar helper `sevenDaysBefore(dateStr: string): string[]` que retorna 7 datas YYYY-MM-DD (day-1 … day-7) usando aritmética `setDate(getDate() - i)` com offset `T12:00:00` para evitar DST.
- [x] `web/src/App.tsx` — Adicionar `const [historyDots, setHistoryDots] = useState<HistoryDot[]>([])` junto aos outros estados. Adicionar `useEffect` dependente de `[date]` que: (a) inicializa `setHistoryDots(dates.map(d => ({ date: d, status: 'loading', total: 0, pending: 0 })))`; (b) para cada data, chama `fetchEntries(d).then(entries => { if (cancelled) return; const p = entries.filter(e => !e.reviewed).length; setHistoryDots(prev => { const n = [...prev]; n[idx] = { date: d, status: entries.length === 0 ? 'empty' : p > 0 ? 'pending' : 'reviewed', total: entries.length, pending: p }; return n; }); }).catch(() => { if (cancelled) return; setHistoryDots(prev => { … n[idx] = { date: d, status: 'empty', total: 0, pending: 0 }; return n; }); })`. Cleanup: `return () => { cancelled = true; }`.
- [x] `web/src/App.tsx` — Substituir o comentário `{/* Área reservada para os 7 pontos de histórico — Story 2.4 */}` (~linha 630) por: `<div className="day-history-dots">{historyDots.map(dot => (<button key={dot.date} className={...} aria-label={dotAriaLabel(dot)} onClick={() => setDate(dot.date)} />))}</div>`.
- [x] `web/src/styles.css` — Adicionar depois de `.day-summary-count { … }`: `.day-history-dots`, `.history-dot` e variantes `.loading`, `.reviewed`, `.pending`.

**Acceptance Criteria:**
- Dado o mini-resumo com `date` selecionado, quando visualizo os pontos, então há exatamente 7 pontos à direita, um por cada dia anterior ao dia selecionado
- Dado um ponto cujo dia não tem entradas, quando carregado, então a cor é `var(--border)`
- Dado um ponto cujo dia tem todas as entradas revisadas, quando carregado, então a cor é `var(--accent)`
- Dado um ponto cujo dia tem entradas pendentes (`reviewed: false`), quando carregado, então a cor é `var(--warning)`
- Dado os pontos ao trocar o dia selecionado, quando `setDate()` é chamado, então todos os 7 pontos voltam ao estado loading e 7 novos fetches iniciam
- Dado qualquer ponto, quando clico nele, então o `date` state muda para a data do ponto e a lista de entradas atualiza
- Dado o fetch de um ponto falhar, quando a resposta chega com erro, então apenas aquele ponto fica como `status: 'empty'`; os demais não são afetados
- Dado qualquer ponto carregado, quando visualizo o `aria-label`, então ele descreve o dia da semana, a data e a contagem de entradas/pendentes

## Design Notes

Atualização imutável por slot — nunca substituir o array inteiro de dentro de um `.then()` concorrente:
```ts
setHistoryDots(prev => {
  const next = [...prev];
  next[idx] = { date: d, status, total, pending };
  return next;
});
```

Cancellation pattern para evitar `setHistoryDots` em componente desmontado ou após nova troca de data:
```ts
useEffect(() => {
  let cancelled = false;
  const dates = sevenDaysBefore(date);
  setHistoryDots(dates.map(d => ({ date: d, status: 'loading', total: 0, pending: 0 })));
  dates.forEach((d, idx) => {
    fetchEntries(d)
      .then(entries => { if (!cancelled) { /* update slot idx */ } })
      .catch(()  => { if (!cancelled) { /* set empty  */ } });
  });
  return () => { cancelled = true; };
}, [date]);
```

## Spec Change Log

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros TypeScript; build bem-sucedido

## Suggested Review Order

**Fetch orchestration — lógica central e ponto de entrada**

- `useEffect` com 7 fetches paralelos, cancellation flag e atualização imutável por slot
  [`App.tsx:371`](../../web/src/App.tsx#L371)

- `sevenDaysBefore` — subtração de datas com getters locais (evita off-by-one UTC)
  [`App.tsx:267`](../../web/src/App.tsx#L267)

**Estado e modelo de dados**

- `HistoryDot` type — 4 campos; `status` discrimina os 4 estados do ponto
  [`App.tsx:260`](../../web/src/App.tsx#L260)

- Estado `historyDots` — inicializado como array vazio; populado pelo useEffect
  [`App.tsx:301`](../../web/src/App.tsx#L301)

- `dotAriaLabel` — pluralização pt-BR para o label acessível de cada ponto
  [`App.tsx:278`](../../web/src/App.tsx#L278)

**Render e CSS**

- JSX dos 7 `<button>` no slot reservado do `.day-summary`
  [`App.tsx:696`](../../web/src/App.tsx#L696)

- `.history-dot` + variantes `.loading`, `.reviewed`, `.pending`
  [`styles.css:155`](../../web/src/styles.css#L155)
