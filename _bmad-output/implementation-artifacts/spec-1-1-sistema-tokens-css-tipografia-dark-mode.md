---
title: 'Story 1.1 — Sistema de Tokens CSS, Tipografia e Dark Mode'
type: 'feature'
created: '2026-06-29'
status: 'done'
baseline_commit: '47bc8f03eb67e206fb959e8a700edd2141bbd8d3'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `web/src/styles.css` tem cobertura parcial de tokens (9 cores, sem espaçamento/forma/sombra), valores hardcoded espalhados por todo o arquivo, e nenhum dark mode ou escala tipográfica formal. Trocar a cor de destaque exige editar múltiplos seletores.

**Approach:** Substituir o bloco `:root` pelo conjunto completo de tokens do design system, adicionar swap automático de dark mode via `@media (prefers-color-scheme: dark)`, estabelecer a escala tipográfica globalmente, e migrar todos os valores hardcoded de `styles.css` para referências a tokens.

## Boundaries & Constraints

**Always:**
- Todos os valores de cor, espaçamento e forma declarados exclusivamente em `:root` — componentes apenas consomem via `var(...)`
- Dark mode exclusivamente via `@media (prefers-color-scheme: dark) { :root { ... } }` — zero regras de dark mode em seletores de componente
- `--accent: #0284c7` (sky blue) — não teal
- Renomear `--green` → `--success`, `--amber` → `--warning`, `--red` → `--danger`; atualizar todas as ocorrências de `var(--green)`, `var(--amber)`, `var(--red)` em `styles.css`
- Escala de espaçamento estritamente 4px: `--space-1: 4px` … `--space-6: 32px`; todos os padding/gap/margin hardcoded migrados para tokens
- `#fff` / `white` é aceitável SOMENTE como `color` em texto sobre superfícies sempre coloridas (badges, botão primário — branco semanticamente invariante ao modo); `#000` é aceitável no fundo da coluna de fotos

**Ask First:** nenhuma decisão pendente

**Never:**
- Toggle de dark mode para o usuário — somente `prefers-color-scheme`
- Regras `@media (prefers-color-scheme: dark)` em seletores fora de `:root`
- Valores de espaçamento fora da grade 4px (ex.: `10px`, `15px`, `24px` raw)
- Font URLs externas — manter system font stack já presente em `body`
- Alterações em `App.tsx`, `Share.tsx`, `api.ts`, `types.ts` ou qualquer arquivo `.tsx`/`.ts` — somente `styles.css`

</frozen-after-approval>

## Code Map

- `web/src/styles.css` — único arquivo CSS do app; todas as alterações desta story aqui. 441 linhas; `:root` atual nas linhas 1–11 (9 tokens parciais)

## Tasks & Acceptance

**Execution:**
- [x] `web/src/styles.css` -- Substituir bloco `:root` completo (linhas 1–11) com todos os tokens obrigatórios (11 cores light mode, 5 shape tokens, 6 spacing tokens, `--shadow-card`); adicionar `@media (prefers-color-scheme: dark) { :root { ... } }` com swap dos 11 tokens de cor após o bloco `:root`; adicionar escala tipográfica em `body` (`font-size: 0.95rem`) e seletores `h1`, `h2`; substituir todos os hex hardcoded e valores de spacing por referências a tokens; atualizar `var(--green)` → `var(--success)`, `var(--amber)` → `var(--warning)`, `var(--red)` → `var(--danger)` em todo o arquivo -- elimina fonte dupla de verdade e habilita dark mode automático

**Acceptance Criteria:**

- Given app carregado em modo claro, when inspeciono `:root` via DevTools, then contém: `--accent: #0284c7`, `--accent-light: #e0f2fe`, `--bg: #f7f9fb`, `--card: #ffffff`, `--text: #1a1c1e`, `--muted: #6b7280`, `--border: #e2e8f0`, `--success: #16a34a`, `--warning: #f59e0b`, `--danger: #dc2626`, `--neutral: #9ca3af`, `--radius-card: 12px`, `--radius-input: 8px`, `--radius-pill: 999px`, `--radius-sm: 6px`, `--shadow-card`, `--space-1: 4px` a `--space-6: 32px`

- Given OS configurado em dark mode, when app carrega, then tokens de cor fazem swap para: `--bg: #18181b`, `--card: #232329`, `--text: #f4f4f5`, `--muted: #8b8b99`, `--border: #3a3a46`, `--accent: #2da6e4`, `--accent-light: #0d2538`, `--success: #4ade80`, `--warning: #fbbf24`, `--danger: #f87171`, `--neutral: #71717a`

- Given OS em dark mode, when inspeciono seletores de componente em `styles.css`, then nenhum seletor (exceto `:root`) contém regras dentro de `@media (prefers-color-scheme: dark)`

- Given `styles.css`, when executo `grep -n '#[0-9a-fA-F]\{3,6\}' web/src/styles.css`, then todas as ocorrências estão dentro do bloco `:root` ou são `#fff` / `#000` em contextos invariantes

- Given `styles.css`, when executo `grep 'var(--green)\|var(--amber)\|var(--red)' web/src/styles.css`, then zero resultados

- Given qualquer `h1` renderizado na interface, when inspecionado, then `font-size: 1.25rem` e `font-weight: 700`

- Given qualquer `h2` renderizado na interface, when inspecionado, then `font-size: 1.05rem` e `font-weight: 600`

- Given elemento `body`, when inspecionado, then `font-size: 0.95rem` e `font-weight: 400`

- Given alteração de `--accent` em `:root` para qualquer cor arbitrária, when inspeciono o botão primário e outros elementos que consomem `--accent`, then todos refletem a nova cor sem editar seletores individuais

## Design Notes

**Token renaming:** Os nomes atuais (`--green`, `--amber`, `--red`) são descritivos de cor; os novos nomes (`--success`, `--warning`, `--danger`) são semânticos. Não adicionar aliases de retrocompatibilidade — remover os nomes antigos completamente.

**Banners de notificação:** `.banner` (background info) usa `var(--accent-light)` — `#e0f2fe` no light mode, `#0d2538` no dark mode (ambos semanticamente corretos). `.banner.error` não tem token direto; usar `color-mix(in srgb, var(--danger) 12%, var(--card))` — produz vermelho suave no light e vermelho escuro no dark sem valor hardcoded.

**Espaçamento de botão:** `padding: 10px 16px` atual migra para `var(--space-2) var(--space-4)` (8px 16px) — diferença de 2px visualmente imperceptível e correta pela grade.

**`--shadow-card`:** valor: `0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06)` — `rgba()` com channel de cor é diferente de hex hardcoded; aceitável conforme a regra (restrição é sobre cores de UI, não sombras).

## Verification

**Commands:**
- `grep -n '#[0-9a-fA-F]\{3,6\}' web/src/styles.css` -- expected: ocorrências somente dentro do bloco `:root` + `#fff`/`#000` documentados
- `grep -n 'var(--green)\|var(--amber)\|var(--red)' web/src/styles.css` -- expected: zero resultados
- `grep -n '10px\|15px\|24px\|14px\|36px' web/src/styles.css` -- expected: zero resultados (todos migrados para tokens)

## Suggested Review Order

**Token Foundation — fonte única de verdade**

- Token de cor semântico adicionado para banner de erro; substitui `color-mix()` eliminando gap de compat Safari < 16.2
  [`styles.css:14`](../../web/src/styles.css#L14)

- Bloco `:root` completo — 27 tokens; trocar qualquer valor aqui reflete em toda a UI sem editar componentes
  [`styles.css:1`](../../web/src/styles.css#L1)

- Dark mode swap exclusivamente em `:root`; zero regras de dark mode em seletores de componente
  [`styles.css:30`](../../web/src/styles.css#L30)

- Token `--surface-danger` no dark mode — `#3d1f1f` garante contraste texto/fundo em dark sem `color-mix()`
  [`styles.css:43`](../../web/src/styles.css#L43)

**Tipografia global**

- `body` com `font-size: 0.95rem` e `font-weight: 400` — base da escala tipográfica
  [`styles.css:49`](../../web/src/styles.css#L49)

- `h1` e `h2` globais (700/1.25rem e 600/1.05rem); `.header-row h1` restaura margem vertical do header
  [`styles.css:58`](../../web/src/styles.css#L58)

**Mudança visual mais impactante — botão primário**

- `button` migra de `#1c1f24` (preto) para `var(--accent)` (sky blue) — mudança visual imediata em toda a UI
  [`styles.css:68`](../../web/src/styles.css#L68)

**Componentes críticos corrigidos na revisão**

- `.banner.error` usa `var(--surface-danger)` — erro renderiza vermelho suave em todos os browsers e modos
  [`styles.css:120`](../../web/src/styles.css#L120)

- `.field-value` usa `var(--border)` — code blocks visualmente distintos do card em dark mode
  [`styles.css:290`](../../web/src/styles.css#L290)
