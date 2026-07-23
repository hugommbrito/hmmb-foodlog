---
title: 'Story 2.1 — Reorganização da Navegação (Tab Bar)'
type: 'feature'
created: '2026-06-29'
status: 'done'
baseline_commit: '7e46363e5aaa49163a52c6be12b905439ae8e666'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O tab bar atual exibe Auditoria como aba visível do dia a dia, não tem aba Painel, e `.tab.active` usa `--text` em vez de `--accent` — quebrando o design system. Não há leitura de `?tab=audit` na URL nem link no rodapé para acesso técnico.

**Approach:** Reorganizar `Shell` em `App.tsx` para 5 abas na ordem correta (Revisão, Painel, Tags, Compartilhar, Relatório), adicionar stub `<Dashboard>`, mover Auditoria para leitura de URL + link no rodapé, e corrigir `.tab.active` para usar `--accent`.

## Boundaries & Constraints

**Always:**
- Tab bar exibe exatamente 5 abas: Revisão, Painel, Tags, Compartilhar, Relatório (nesta ordem)
- Auditoria nunca aparece como botão no nav; permanece acessível via `?tab=audit` e link no rodapé
- Dashboard stub: renderiza apenas título "Painel" — nenhuma chamada de API ou IA
- Cor ativa do tab: `color: var(--accent)` + `border-bottom: 2px solid var(--accent)` (não `--text`)
- Componente `<Audit>` permanece intacto e funcional
- Microcopy em pt-BR; labels: "Revisão", "Painel", "Tags", "Compartilhar", "Relatório"
- Estado do tipo `Tab` inclui `'audit'` para suportar a navegação via URL

**Ask First:**
- Se o link de rodapé para Auditoria precisar de estilo ou posição diferente do descrito

**Never:**
- Chamar qualquer endpoint de API no `<Dashboard>` stub
- Adicionar roteador externo (react-router etc.)
- Modificar backend
- Remover o tipo `'audit'` do union — deve permanecer para que o set via URL funcione

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| URL limpa | `window.location.search` vazio | tab padrão `'review'` | — |
| URL com `?tab=audit` | `URLSearchParams.get('tab') === 'audit'` | tab seta para `'audit'`, `<Audit>` renderiza | Se valor inválido: ignorar, manter `'review'` |
| Clicar em "Painel" | `tab === 'dashboard'` | `<Dashboard>` stub renderiza; nenhuma chamada de rede | — |
| Clicar no link do rodapé "Auditoria" | usuário clica no link | `setTab('audit')` chamado; `<Audit>` renderiza | — |
| Tab bar com 5 abas | qualquer tab ativa | apenas o botão da aba ativa tem `active` class | — |

</frozen-after-approval>

## Code Map

- `web/src/App.tsx:146` — `type Tab` union atual: `'review' | 'tags' | 'share' | 'audit' | 'report'`
- `web/src/App.tsx:162-205` — componente `Shell`: estado `tab`, nav buttons, renderização condicional
- `web/src/App.tsx:1569-1686` — componente `Audit` (mantido intacto)
- `web/src/styles.css:107-112` — `.tab` e `.tab.active` (cor ativa atual usa `--text`)

## Tasks & Acceptance

**Execution:**
- [x] `web/src/App.tsx` — Atualizar `type Tab` para `'review' | 'dashboard' | 'tags' | 'share' | 'report' | 'audit'` — adiciona o valor dashboard e mantém audit para acesso via URL
- [x] `web/src/App.tsx` — No componente `Shell`: adicionar `useEffect` que lê `URLSearchParams` no mount e seta `tab` para `'audit'` se `?tab=audit` estiver presente (ignorar qualquer outro valor de query param inválido)
- [x] `web/src/App.tsx` — No componente `Shell`: substituir os 5 botões do nav pela nova ordem com `<Audit>` removido — Revisão, Painel, Tags, Compartilhar, Relatório
- [x] `web/src/App.tsx` — No componente `Shell`: adicionar renderização condicional `{tab === 'dashboard' && <Dashboard onLogout={onLogout} />}` ao lado das demais condicionais
- [x] `web/src/App.tsx` — No componente `Shell`: adicionar rodapé (`<footer>`) com link `<button>` que chama `setTab('audit')`, texto "Auditoria", estilo discreto (`color: var(--muted)`, `font-size: 0.8rem`)
- [x] `web/src/App.tsx` — Adicionar componente `Dashboard` stub: `function Dashboard({ onLogout }: { onLogout: () => void }) { return <div className="dashboard-stub"><h1>Painel</h1></div>; }` — sem qualquer chamada de API
- [x] `web/src/styles.css` — Atualizar `.tab.active`: trocar `color: var(--text)` por `color: var(--accent)` e `border-bottom-color: var(--text)` por `border-bottom-color: var(--accent)` — alinha com o design system

**Acceptance Criteria:**
- Dado o app carregado sem query params, quando visualizo o nav, então ele exibe exatamente 5 botões: Revisão, Painel, Tags, Compartilhar, Relatório — sem botão Auditoria
- Dado o app carregado com `?tab=audit`, quando o mount ocorre, então o componente `<Audit>` é renderizado e o tab bar continua exibindo as 5 abas normais (nenhum botão "Auditoria" marcado como active)
- Dado o rodapé da página, quando clico no link "Auditoria", então `<Audit>` é renderizado
- Dado a aba Painel ativa, quando inspeciono as chamadas de rede, então nenhuma requisição a endpoints de IA ou de entries é disparada
- Dado qualquer aba ativa, quando inspeciono o estilo, então `.tab.active` tem `color: var(--accent)` e `border-bottom-color: var(--accent)`

## Design Notes

O `useEffect` para leitura de URL deve ser executado apenas no mount (`[]` como dependência). Não é necessário `pushState` nem sincronização contínua da URL — o objetivo é apenas o acesso técnico inicial via `?tab=audit`.

O botão no rodapé para Auditoria usa `<button>` (não `<a href>`) para manter o padrão de navegação por `setState` existente no app.

## Verification

**Commands:**
- `cd web && npm run build` -- expected: zero erros de TypeScript; build bem-sucedido

**Manual checks (if no CLI):**
- Abrir o app → nav exibe exatamente 5 abas na ordem correta; aba ativa tem cor azul (`--accent`)
- Acessar `?tab=audit` → Auditoria renderiza; 5 abas no nav intactas (nenhuma marcada como "Auditoria")
- Clicar em "Painel" → exibe heading "Painel"; nenhuma requisição de rede iniciada
- Clicar no link "Auditoria" no rodapé → Auditoria renderiza

## Suggested Review Order

**Estado e inicialização da navegação**

- Tipo `Tab` atualizado — `'dashboard'` adicionado, `'audit'` mantido para URL
  [`App.tsx:146`](../../web/src/App.tsx#L146)

- `useEffect` que lê `?tab=audit` no mount e limpa o param da URL via `replaceState`
  [`App.tsx:165`](../../web/src/App.tsx#L165)

**Reestruturação do tab bar**

- Nav com 5 botões na nova ordem — Painel inserido, Auditoria removida
  [`App.tsx:175`](../../web/src/App.tsx#L175)

- Renderização condicional de `<Dashboard>` ao lado dos demais componentes
  [`App.tsx:208`](../../web/src/App.tsx#L208)

**Novos elementos de UI**

- Footer com botão discreto para Auditoria (`setTab('audit')`)
  [`App.tsx:213`](../../web/src/App.tsx#L213)

- Componente `Dashboard` stub — heading "Painel" sem chamadas de rede
  [`App.tsx:226`](../../web/src/App.tsx#L226)

**Estilo**

- `.tab.active` corrigido de `--text` para `--accent`
  [`styles.css:112`](../../web/src/styles.css#L112)
