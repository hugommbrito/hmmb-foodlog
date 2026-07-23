---
title: 'Story 3.3 — Vista Timeline'
type: 'feature'
created: '2026-07-01'
status: 'done'
baseline_commit: 'e9ca389b159a0fedeb473317145ac9ee974e6cb4'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `TimelineView` é um stub que renderiza apenas skeletons para slots em loading e `null` para slots resolvidos — nenhum conteúdo real é exibido na vista Timeline do Painel.

**Approach:** Substituir o stub pela renderização real: separadores de dia + itens de entrada (thumbnail 64×64, hora, título, macros, tag pill) ordenados do mais antigo para o mais recente, agrupados por dia. Tags coloridas requerem carregar `fetchTags()` uma vez no `Dashboard`.

## Boundaries & Constraints

**Always:**
- Ordenação global: slots iterados em ordem natural (mais antigo → mais recente, conforme `getDashboardDays`)
- Dentro de cada slot `done`: entries ordenadas por `created_at` ascendente
- Separador de dia exibido somente para slots `done` com `entries.length > 0`
- Formato do label do separador: `"Seg 23/06"` (dia abreviado + dd/mm), usando `new Date(year, month-1, day)` para evitar shift de timezone
- Thumbnail: 64×64px, `object-fit: cover`, `border-radius: var(--radius-sm)`
- Entradas sem foto: placeholder `role="img"`, `aria-label="Sem foto"`, fundo `var(--border)`
- Hora via `toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })`
- Macros via `formatMacros(e.foods)` (já existente no código) — omitir se retornar `null`
- Tag pill: reusar `.tag-badge` com inline style `background: tag.color; color: textOn(tag.color)` quando `context_tag_id` resolve para tag conhecida; omitir se tag não encontrada
- Slot `loading`: um `<li className="skeleton-item" aria-hidden="true" />`
- Slot `error` ou slot `done` sem entries: não renderizar nada
- `fetchTags()` carregado uma única vez em `Dashboard` (mesmo padrão do `Review`)
- Nenhuma chamada a endpoint de IA

**Ask First:** nenhuma decisão depende de aprovação humana

**Never:**
- Alterar `DashboardSlot`, `getDashboardDays`, `Dashboard` useEffect de entries
- Modificar `PhotoWallView` ou `PhotoWallModal`
- Usar biblioteca externa para qualquer elemento visual
- Fazer chamadas a `/report/weekly` ou `/shared/:token/patterns`

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slot loading | `status: 'loading'` | Um `<li className="skeleton-item">` com animação shimmer | — |
| Slot done, 2 entries com foto | `done`, entries sorted asc by `created_at` | Separador "Ter 01/07" + 2 `.tl-item` com `<img>`, hora, título, macros | — |
| Entry sem foto | `entry.photos: []` | Thumbnail é `.tl-thumb-ph` com `role="img"` e `aria-label="Sem foto"` | — |
| Entry com tag | `context_tag_id` resolve em `tags` | Pill `.tag-badge` com `background: tag.color`, texto calculado via `textOn` | — |
| Entry sem tag | `context_tag_id: null` ou não encontrado | Nenhum pill renderizado | — |
| Entry sem foods | `foods: []` | `formatMacros` retorna `null` → linha de macros omitida | — |
| Slot done sem entries | `entries: []` | Nenhuma renderização (nem separador) | — |
| Slot error | `status: 'error'` | Nenhuma renderização | — |
| fetchTags falha | erro de rede | `tags` permanece `[]`; tags simplesmente não aparecem — view ainda funciona | — |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:476-486` — `TimelineView` stub a substituir; assinatura atual: `{ slots: DashboardSlot[] }`
- `web/src/App.tsx:267-295` — `Dashboard` function — adicionar `tags` state + `fetchTags` effect; passar `tags` para `TimelineView`
- `web/src/App.tsx:83` — `sumMacros` — não usar diretamente; usar `formatMacros` (linha 95)
- `web/src/App.tsx:95` — `formatMacros(foods)` → string ou null — usar para linha de macros
- `web/src/App.tsx:136` — `textOn(hex)` — usar para cor de texto do tag pill
- `web/src/App.tsx:13` — `fetchTags` já importado de `api.ts`
- `web/src/types.ts:17-21` — `ContextTag { id, name, color }` — interface do tag
- `web/src/styles.css:573-578` — `.skeleton-item` — 64px, shimmer — não alterar
- `web/src/styles.css:592-599` — `.timeline-list` — flex column, gap `var(--space-2)` — não alterar
- `web/src/styles.css:394-401` — `.tag-badge` — pill styles — reusar via className

## Tasks & Acceptance

**Execution:**

- [x] `web/src/App.tsx` — Em `Dashboard` (linha 268): adicionar `const [tags, setTags] = useState<ContextTag[]>([])`. Adicionar `useEffect(() => { fetchTags().then(setTags).catch((err) => { if (err instanceof UnauthorizedError) onLogout(); }); }, [onLogout])`. Na linha ~360 onde `TimelineView` é renderizado, passar `tags`: `<TimelineView slots={slots} tags={tags} />`.

- [x] `web/src/App.tsx` — Substituir `TimelineView` (linhas 476-486) pela implementação completa: assinatura `({ slots, tags }: { slots: DashboardSlot[]; tags: ContextTag[] })`. Helper interno `dayLabel(dateStr: string)` que parseia `"YYYY-MM-DD"` com `new Date(year, month-1, day)` e retorna `"Seg 23/06"` usando array `['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']`. Retornar `<ul className="timeline-list">` com `slots.map(slot => ...)`: (a) `loading` → `<li key={slot.date} className="skeleton-item" aria-hidden="true" />`; (b) `error` ou `entries.length === 0` → `null`; (c) `done` com entries → `<React.Fragment key={slot.date}>` com `<li className="tl-sep" aria-hidden="true"><span className="tl-sep-label">{dayLabel(slot.date)}</span><span className="tl-sep-line" /></li>` seguido de entries ordenadas por `created_at` asc: para cada entry `e`, `<li key={e.id} className="tl-item">`: thumbnail (se `e.photos.length > 0` → `<img className="tl-thumb" src={e.photos[0]} alt={e.title ?? 'Foto da refeição'} loading="lazy" />`, senão → `<div className="tl-thumb tl-thumb-ph" role="img" aria-label="Sem foto" />`); depois `<div className="tl-body">` com: `<span className="tl-time">{toLocaleTimeString}</span>`, `<div className="tl-title-row">` com `<span className="tl-title">{e.title ?? '—'}</span>` e pill tag se disponível, `{macros && <div className="tl-macros">{macros}</div>}` onde `macros = formatMacros(e.foods)`. Tag pill: `const tag = e.context_tag_id ? new Map(tags.map(t=>[t.id,t])).get(e.context_tag_id) : undefined` — se `tag`: `<span className="tag-badge tl-tag" style={{ background: tag.color, color: textOn(tag.color) }}>{tag.name}</span>`. Garantir que `React` (para `Fragment`) está importado ou usar `<>` alternativo.

- [x] `web/src/styles.css` — Adicionar ao fim do arquivo, após as regras do photo wall modal:
  `.tl-sep` (display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); margin-bottom: var(--space-3)),
  `.tl-sep-label` (font-size: 0.8rem; font-weight: 600; color: var(--muted); white-space: nowrap),
  `.tl-sep-line` (flex: 1; height: 1px; background: var(--border)),
  `.tl-item` (display: flex; gap: var(--space-3); align-items: flex-start),
  `.tl-thumb` (width: 64px; height: 64px; object-fit: cover; flex: none; border-radius: var(--radius-sm); display: block),
  `.tl-thumb-ph` (background: var(--border)),
  `.tl-body` (flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1)),
  `.tl-time` (font-size: 0.8rem; color: var(--muted)),
  `.tl-title-row` (display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap),
  `.tl-title` (font-size: 0.95rem; font-weight: 600; color: var(--text)),
  `.tl-macros` (font-size: 0.8rem; color: var(--muted)),
  `.tl-tag` (flex: none)

**Acceptance Criteria:**

- Dado Painel com period=7d e todos slots resolvidos, quando visualizo a Timeline, então as entradas do dia mais antigo aparecem primeiro e as do dia mais recente por último
- Dado dois dias com entradas, quando visualizo a Timeline, então há um separador "Seg 23/06" com hairline à direita antes de cada grupo de dia
- Dado um separador de dia, quando o visualizo, então tem `font-size: 0.8rem`, `font-weight: 600`, `color: var(--muted)`, `margin-top: var(--space-4)` e `margin-bottom: var(--space-3)`
- Dado um item de Timeline, quando o visualizo, então há thumbnail 64×64 à esquerda, e à direita: hora da entrada, título, e macros em `font-size: 0.8rem`
- Dado uma entry com foto, quando o item é renderizado, então `<img loading="lazy" className="tl-thumb">` com `object-fit: cover` está presente
- Dado uma entry sem foto, quando o item é renderizado, então o placeholder tem `role="img"` e `aria-label="Sem foto"` com fundo `var(--border)`
- Dado uma entry com `context_tag_id` presente e tag no estado, quando o item é renderizado, então pill `.tag-badge` aparece ao lado do título com background na cor da tag
- Dado um slot em loading, quando visualizo, então um `.skeleton-item` com animação shimmer está presente
- Dado um slot done sem entries, quando visualizo, então nenhum separador ou item é renderizado para aquele dia
- Dado um slot com status error, quando visualizo, então nenhum item é renderizado para aquele dia

## Design Notes

`dayLabel` usa `new Date(year, month-1, day)` (construtor local, não ISO) para evitar o UTC-midnight shift que faria `new Date('2026-06-23')` aparecer como "22/06" em UTC-3. O array `['Dom','Seg',...]` garante abreviações pt-BR sem depender de locale do browser.

O `Map` de `tags` → id é construído inline dentro de `TimelineView` a partir da prop `tags` — sem necessidade de `useMemo` dado que a prop é estável e a lista de tags raramente muda.

Slots com `entries.length === 0` são silenciados (sem "dia vazio") — o Dashboard já exibe o estado global "Sem registros neste período." quando todos os slots estão done e vazios.

## Spec Change Log

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros TypeScript; build bem-sucedido

## Suggested Review Order

**Dados — Dashboard carrega tags para colorir pills**

- Tags state + fetchTags effect: mesmo padrão de Review, não-fatal se falhar
  [`App.tsx:273`](../../web/src/App.tsx#L273)

- TimelineView recebe tags como prop; tagsById é Map inline por slot
  [`App.tsx:483`](../../web/src/App.tsx#L483)

**Separadores de dia**

- dayLabel usa `new Date(y, m-1, d)` local para evitar UTC shift de timezone
  [`App.tsx:487`](../../web/src/App.tsx#L487)

- Separador `<li className="tl-sep">` — label + hairline; `aria-hidden` pois visual
  [`App.tsx:507`](../../web/src/App.tsx#L507)

**Itens da timeline**

- Entry `<li className="tl-item">`: thumbnail 64×64, tl-body, hora, título, macros, tag pill
  [`App.tsx:520`](../../web/src/App.tsx#L520)

- Placeholder `tl-thumb-ph` com `role="img"` e `aria-label="Sem foto"` quando sem foto
  [`App.tsx:529`](../../web/src/App.tsx#L529)

- Tag pill reutiliza `.tag-badge` com inline style + `textOn(hex)` para contraste
  [`App.tsx:535`](../../web/src/App.tsx#L535)

**CSS — novas classes da Timeline**

- `.tl-sep`, `.tl-sep-label`, `.tl-sep-line` — separador de dia com hairline flex
  [`styles.css:737`](../../web/src/styles.css#L737)

- `.tl-item`, `.tl-thumb`, `.tl-thumb-ph`, `.tl-body`, `.tl-time`, `.tl-title-row`, `.tl-title`, `.tl-macros`, `.tl-tag`
  [`styles.css:755`](../../web/src/styles.css#L755)
