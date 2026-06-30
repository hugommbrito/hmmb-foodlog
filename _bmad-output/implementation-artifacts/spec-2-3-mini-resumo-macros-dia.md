---
title: 'Story 2.3 — Mini-resumo de Macros do Dia'
type: 'feature'
created: '2026-06-29'
status: 'done'
baseline_commit: '0558ea52fdcbbe676d1e9a4c04f84848da237e16'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O elemento `day-summary` atual exibe contagem de entradas + string de macros como uma linha combinada (`"2 entradas  1234 kcal · P 50g · G 45g · C Zg"`), é escondido quando não há entradas, e usa `font-size: 1rem; font-weight: 600` — sem distinção visual entre label e valor e sem estado vazio acessível.

**Approach:** Redesenhar o `day-summary` como mini-resumo de macros: macros individuais com label/valor visualmente distintos (kcal, P, C, G), sempre visível quando não carregando (mesmo sem entradas), exibindo "Sem registros neste dia." no estado vazio. Preparar o lado direito para os 7 pontos da Story 2.4.

## Boundaries & Constraints

**Always:**
- Usar `sumMacros(dayFoods, key)` para cada macro — `dayFoods = entries.flatMap(e => e.foods)`, sem chamada de API adicional
- Calcular sobre `entries` (todas as entradas do dia), não sobre `visible` (filtrado por tag) — o mini-resumo é um total do dia
- Mostrar o mini-resumo SEMPRE que `!loading && !error && !isSearchMode` — independente de `entries.length`
- Estado vazio: `entries.length === 0` → exibir `"Sem registros neste dia."` em vez de zeros ou mini-resumo em branco
- Card styling mantido: `background: var(--card)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-card)` (já existe no CSS, não alterar)
- Labels de macro (`kcal`, `P`, `C`, `G`): `font-size: 0.8rem; color: var(--muted)`
- Valores de macro: `font-size: 0.95rem` (sem font-weight extra)
- Altura máxima 48px em mobile — wrapping permitido via `flex-wrap`
- Remover variável `summary` (useMemo sobre `dayTotals(visible)`) — obsoleta após o redesign

**Ask First:**
- Se quiser manter o count de entradas visíveis ("2 entradas") junto com os macros no mini-resumo

**Never:**
- Chamar qualquer API no componente
- Modificar o `day-summary` na branch de search mode (linhas 557–562) — essa seção exibe resultados de busca e não faz parte desta story
- Remover ou alterar os estados de loading/error/empty da lista (`"Carregando…"`, `"Nenhuma entrada neste dia."`, `"Nenhuma entrada para este filtro."`) — são distintos do mini-resumo

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dia com entradas e macros completos | `entries.length > 0`, `foods` com `kcal/protein_g/fat_g/carbs_g` não-nulos | Mini-resumo mostra 4 macro-items com label + valor | — |
| Dia sem entradas | `entries.length === 0` | Mini-resumo mostra "Sem registros neste dia." | — |
| Dia com entradas mas sem foods | `entries.length > 0`, todos `e.foods === []` | Mini-resumo visível, nenhum macro-item renderizado (todos são `null`) | — |
| Troca de data | `setDate(novaData)` chamado | Macros atualizam imediatamente com `entries` do novo dia (sem nova chamada de API) | — |
| Loading em curso | `loading === true` | Mini-resumo não é renderizado | — |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:83–91` — `sumMacros()` — função auxiliar que agrega um macro específico de uma lista de foods; acessível no escopo do arquivo
- `web/src/App.tsx:119–123` — `dayTotals()` — exportada, calcula string de macros; usada para `summary` que será removido
- `web/src/App.tsx:455–466` — `visible` useMemo + `summary` useMemo — `summary` será removido; `visible` não alterado
- `web/src/App.tsx:580–597` — bloco condicional do `day-summary` no modo normal — será substituído integralmente
- `web/src/styles.css:127–140` — `.day-summary`, `.day-summary-count`, `.day-summary-totals` — `count` e `totals` serão removidos; adicionar novas classes

## Tasks & Acceptance

**Execution:**
- [x] `web/src/App.tsx` — Remover `const summary = useMemo(() => dayTotals(visible), [visible]);` (linha ~466); adicionar 2 useMemos: `const dayFoods = useMemo(() => entries.flatMap(e => e.foods), [entries]);` e `const [dayKcal, dayProtein, dayCarbs, dayFat] = useMemo(() => [sumMacros(dayFoods, 'kcal'), sumMacros(dayFoods, 'protein_g'), sumMacros(dayFoods, 'carbs_g'), sumMacros(dayFoods, 'fat_g')], [dayFoods]);` — substitui cálculo de macro string por valores individuais
- [x] `web/src/App.tsx` — Substituir o bloco `{!loading && !error && visible.length > 0 && (<div className="day-summary">…</div>)}` (linhas 590–597) pelo mini-resumo redesenhado: condição `{!loading && !error && (<div className="day-summary">…</div>)}` com: (a) quando `entries.length === 0` → `<span className="day-summary-empty">Sem registros neste dia.</span>`; (b) caso contrário → `<div className="day-summary-macros">` com um `.macro-item` para cada macro não-nulo, cada item contendo `<span className="macro-label">{label}</span>` e `<span className="macro-value">{valor}</span>` — satisfaz todos os ACs de layout e estado vazio
- [x] `web/src/styles.css` — Remover `.day-summary-count` e `.day-summary-totals`; adicionar: `.day-summary-macros { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }`, `.macro-item { display: flex; flex-direction: column; align-items: center; gap: 1px; }`, `.macro-label { font-size: 0.8rem; color: var(--muted); }`, `.macro-value { font-size: 0.95rem; }`, `.day-summary-empty { font-size: 0.95rem; color: var(--muted); }` — satisfaz especificações de tipografia e layout

**Acceptance Criteria:**
- Dado a aba Revisão com entradas carregadas, quando visualizo o mini-resumo, então ele exibe os valores de kcal, P, C e G como itens separados com labels em `font-size: 0.8rem; color: var(--muted)` e valores em `font-size: 0.95rem`
- Dado a aba Revisão com `entries.length === 0`, quando visualizo o mini-resumo, então ele exibe "Sem registros neste dia." em vez de zeros ou mini-resumo em branco
- Dado o mini-resumo renderizado, quando troco o dia selecionado, então os macros atualizam instantaneamente sem chamada de API
- Dado a aba Revisão em modo de loading (`loading === true`), quando visualizo a área do mini-resumo, então ele não é renderizado
- Dado qualquer estado da aba Revisão, quando o mini-resumo é exibido, então o card styling permanece: `background: var(--card)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-card)`
- Dado a seção de day-summary no search mode (linhas 557–562), quando busco por um alimento, então ela continua funcionando sem regressão

## Design Notes

O mini-resumo exibe os macros sobre `entries` (todos do dia), não sobre `visible` (filtrado). Isso é intencional: o mini-resumo é um total do dia, independente do filtro de tag ativo. O elemento existe no mesmo local físico (entre `<header>` e `<ul className="cards">`).

Estrutura JSX alvo do bloco:
```tsx
{!loading && !error && (
  <div className="day-summary">
    {entries.length === 0 ? (
      <span className="day-summary-empty">Sem registros neste dia.</span>
    ) : (
      <div className="day-summary-macros">
        {dayKcal != null && (
          <span className="macro-item">
            <span className="macro-label">kcal</span>
            <span className="macro-value">{Math.round(dayKcal)}</span>
          </span>
        )}
        {dayProtein != null && (
          <span className="macro-item">
            <span className="macro-label">P</span>
            <span className="macro-value">{Math.round(dayProtein)}g</span>
          </span>
        )}
        {dayCarbs != null && (
          <span className="macro-item">
            <span className="macro-label">C</span>
            <span className="macro-value">{Math.round(dayCarbs)}g</span>
          </span>
        )}
        {dayFat != null && (
          <span className="macro-item">
            <span className="macro-label">G</span>
            <span className="macro-value">{Math.round(dayFat)}g</span>
          </span>
        )}
      </div>
    )}
    {/* Área direita reservada para os 7 pontos da Story 2.4 */}
  </div>
)}
```

## Spec Change Log

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros TypeScript; build bem-sucedido

## Suggested Review Order

**Cálculo de macros — lógica central**

- Memos individuais por macro, calculados sobre `entries` (dia inteiro, não filtrado por tag)
  [`App.tsx:464`](../../web/src/App.tsx#L464)

**Renderização do mini-resumo — estados e layout**

- Condição `!loading && !error` — sempre visível; empty state vs. macro-items
  [`App.tsx:598`](../../web/src/App.tsx#L598)

- Estado vazio: "Sem registros neste dia." quando `entries.length === 0`
  [`App.tsx:600`](../../web/src/App.tsx#L600)

- Macro-items condicionais `!= null` — cada macro só renderiza quando tem dado real
  [`App.tsx:604`](../../web/src/App.tsx#L604)

**CSS — tipografia e layout do mini-resumo**

- `.macro-label` (0.8rem, muted) e `.macro-value` (0.95rem) — distinção label/valor
  [`styles.css:148`](../../web/src/styles.css#L148)

- `.day-summary-macros` flex row + `.macro-item` flex column — estrutura de grid de macros
  [`styles.css:141`](../../web/src/styles.css#L141)
