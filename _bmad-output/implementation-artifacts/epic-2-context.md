# Epic 2 Context: Tela de Revisão Aprimorada

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Reformular a experiência de revisão diária de Hugo: navegação principal enxuta com exatamente 5 abas (removendo Auditoria do tab bar), entry cards visualmente claros com foto maior, confiança expressa via borda esquerda colorida (não badge), estado "revisado" sem degradação de opacidade, e mini-resumo de macros do dia com indicador visual dos 7 dias anteriores. O resultado é uma interface onde Hugo avalia o dia em segundos sem ruído visual e sem esperar por IA.

## Stories

- Story 2.1: Reorganização da Navegação (Tab Bar)
- Story 2.2: Redesign do Entry Card
- Story 2.3: Mini-resumo de Macros do Dia
- Story 2.4: Indicador de Histórico dos 7 Dias

## Requirements & Constraints

**Tab bar:**
- Exatamente 5 abas, nesta ordem: Revisão, Painel, Tags, Compartilhar, Relatório
- Auditoria nunca aparece no tab bar — o componente `<Audit>` é preservado e acessível via `?tab=audit` na URL
- Link discreto para Auditoria no rodapé da página (não no nav)
- Tab bar: sticky no topo, `z-index: 2`, fundo `var(--bg)`, aba ativa com `color: var(--accent)` e `border-bottom: 2px solid var(--accent)`
- Aba "Painel" renderiza `<Dashboard>` — pode ser placeholder para Story 2.1; conteúdo completo no Epic 3

**Entry card (desktop > 480px):**
- Coluna de foto com `flex: 0 0 200px`, `object-fit: cover`
- Layout empilhado em ≤ 480px (foto 100% width em cima, texto abaixo)
- `border-radius: var(--radius-card)`, `box-shadow: var(--shadow-card)`, `padding: var(--space-4)`

**Confiança via borda:**
- Borda esquerda de 4px mapeada: `conf-high` → `var(--success)`, `conf-mid` → `var(--neutral)`, `conf-low` → `var(--warning)`, `conf-zero` → `var(--danger)`
- Nenhum percentual de confiança visível em texto; valor acessível via `aria-label` no elemento de borda
- O badge de percentual existente é removido

**Estado "revisado":**
- Cards com `reviewed: true` não usam `opacity: 0.65` — luminosidade idêntica ao card não-revisado
- Ícone ✓ sobreposto ao canto superior esquerdo da foto (`position: absolute`, `aria-hidden="true"`)
- Botão "Aceitar" substituído por texto estático "✓ Revisado" (sem ação); botões "Corrigir" e "Excluir" permanecem

**Mini-resumo:**
- Macros totais do dia (kcal, P, C, F) calculados por `dayTotals(entries)` — sem chamada de API adicional
- Fundo `var(--card)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-card)`
- Labels de macros: `font-size: 0.8rem`, `color: var(--muted)`; valores: `font-size: 0.95rem`
- Altura máx. 48px em mobile (wrapping permitido)
- Quando `entries.length === 0`: exibe "Sem registros neste dia." em vez de zeros

**7 pontos de histórico:**
- Fileira de 7 pontos no lado direito do mini-resumo, um por dia anterior ao dia selecionado
- Estados: sem entradas → `var(--border)`; tem entradas (todas revisadas) → `var(--accent)`; tem entradas pendentes → `var(--warning)`
- Cada ponto: 7 chamadas paralelas a `GET /entries?date=YYYY-MM-DD` resolvidas de forma independente
- Antes da resposta: ponto em estado skeleton/neutro
- `aria-label` descritivo: ex. `"Segunda-feira 23/06: 3 entradas, 1 pendente de revisão"`
- Clicar num ponto atualiza o `date` state da Revisão para aquele dia

**Placeholder universal de foto:**
- `role="img"`, `aria-label="Sem foto"`, ícone neutro centralizado
- Mesmas dimensões da foto que substitui (card, mini-resumo, timeline)

**Acessibilidade:**
- `aria-label` na borda de confiança com valor numérico
- Ícones decorativos com `aria-hidden="true"`
- Foco via teclado em ordem natural
- Todo botão com label de texto legível

## Technical Decisions

- **Stack:** React + Vite + TypeScript; CSS custom properties; sem roteador externo; navegação por `useState` (tab ativa)
- **Auditoria via URL:** leitura de `?tab=audit` com `window.location.search` ou `URLSearchParams` no mount — sem roteador externo
- **dayTotals():** função client-side que agrega macros das entries já carregadas — não faz chamada de API
- **7 pontos paralelos:** `Promise.all` de 7 requests a `GET /entries?date=` com resolução independente por ponto (não espera todos)
- **Classes de confiança:** `conf-high` / `conf-mid` / `conf-low` / `conf-zero` mapeadas para tokens de cor via CSS
- **`--danger` nunca como background fill** — apenas como cor de texto ou borda
- **Epic 1 (tokens + componentes base) como pré-requisito:** todos os tokens CSS e classes de componente (`.btn.primary`, `.chip`, `.seg-control`) já estão em `styles.css`

## UX & Interaction Patterns

**Tab bar:**
- Sticky no topo, `height: 48px`, `z-index: 2`
- Aba ativa: `color: var(--accent)` + `border-bottom: 2px solid var(--accent)`
- Abas inativas: `color: var(--muted)`
- Auditoria: link discreto no rodapé (texto "Auditoria" ou ícone com label acessível)

**Entry card — layout responsivo:**
- `> 480px`: horizontal — foto à esquerda `200px`, texto à direita
- `≤ 480px`: empilhado — foto 100% width em cima, texto abaixo

**Mini-resumo — posição e atualização:**
- Abaixo dos controles de data, acima da lista de entradas
- Atualiza imediatamente ao trocar de dia (usa dados já carregados)

**Microcopy pt-BR relevante:**
- "Aceitar" / "Corrigir" / "Excluir" / "Re-analisar" / "Cancelar"
- "✓ Revisado" (estado pós-revisão, sem ação)
- "Sem registros neste dia." (mini-resumo vazio)
- "Nenhuma entrada neste dia." (lista vazia)
- "Sem foto" (aria-label do placeholder)

## Cross-Story Dependencies

- **Epic 1 → Epic 2 inteiro:** tokens CSS e componentes base (botões, chips, segmented control) devem estar em produção antes de qualquer story do Epic 2.
- **Story 2.1 → Stories 2.2–2.4:** o tab bar reorganizado (com aba Painel como stub) é a base estrutural; não há bloqueio técnico estrito entre 2.2–2.4.
- **Story 2.3 → Story 2.4:** o mini-resumo (container visual) deve existir antes de adicionar os 7 pontos de histórico dentro dele.
- **Epic 2 → Epic 3:** o stub `<Dashboard>` criado em Story 2.1 é expandido no Epic 3 com conteúdo real.
