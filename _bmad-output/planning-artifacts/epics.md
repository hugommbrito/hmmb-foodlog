---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories", "step-04-final-validation"]
inputDocuments:
  - "_bmad-output/planning-artifacts/prds/prd-hmmb-foodlog-2026-06-29/prd.md"
  - "_bmad-output/planning-artifacts/prds/prd-hmmb-foodlog-2026-06-29/addendum.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-hmmb-foodlog-2026-06-29/DESIGN.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-hmmb-foodlog-2026-06-29/EXPERIENCE.md"
  - "_bmad-output/project-context.md"
---

# hmmb-foodlog - Epic Breakdown

## Overview

Este documento fornece o breakdown completo de épicos e histórias para o hmmb-foodlog, decompondo os requisitos do PRD, UX Design e contexto técnico do projeto em histórias implementáveis.

Escopo: evolução de UX/UI da interface web — Design System, navegação, novas vistas de visualização (Parede de Fotos, Timeline, Mini-resumo). Nenhuma alteração de backend.

---

## Requirements Inventory

### Functional Requirements

FR-1: **Tokens CSS de design** — O sistema expõe um conjunto mínimo de tokens CSS no `:root` (`--accent`, `--accent-light`, `--bg`, `--card`, `--text`, `--muted`, `--border`, `--success`, `--warning`, `--danger`, `--neutral`, `--radius-card`, `--radius-pill`, `--radius-input`, `--radius-sm`, `--shadow-card` e todos os tokens de espaçamento `--space-1` a `--space-6`) substituindo valores hardcoded do CSS atual.

FR-2: **Hierarquia tipográfica** — Títulos de seção usam `font-weight: 700`; títulos de card, `600`; corpo, `400`; metadata (hora, macros secundários), `400` com `color: var(--muted)`. Tamanhos: H1 `1.25rem`, H2 `1.05rem`, body `0.95rem`, metadata `0.8rem`.

FR-3: **Botão primário com cor de destaque** — O botão primário (submit, CTAs principais) usa `--accent` como background com texto branco. O botão "link" usa `--muted` com hover em `--text`. O botão "Excluir" usa `--danger` como cor de texto, sem background.

FR-4: **Remoção da Auditoria do tab bar** — A aba "Auditoria" não aparece no `<nav>` de tabs. O componente `<Audit>` continua existindo e é acessível via `?tab=audit` na URL ou link discreto no rodapé da página.

FR-5: **Nova aba Painel** — Uma aba "Painel" é inserida na segunda posição do tab bar e renderiza o componente `<Dashboard>`. O tab bar exibe exatamente 5 abas: Revisão, Painel, Tags, Compartilhar, Relatório.

FR-6: **Macros do dia no mini-resumo** — O mini-resumo exibe os macros agregados das entradas do dia selecionado usando `dayTotals()` (sem chamada de API adicional). Quando não há entradas, exibe "Sem registros neste dia" em vez de zeros.

FR-7: **Indicador de histórico recente (7 dias)** — Fileira de 7 pontos representando os 7 dias anteriores ao dia selecionado. Estados: vazio/cinza (sem entrada), preenchido `--accent` (tem entradas), preenchido `--warning` (tem entradas pendentes de revisão). Clicar em um ponto navega para aquele dia na Revisão. Os 7 pontos fazem 7 chamadas paralelas a `GET /entries?date=` e resolvem de forma independente.

FR-8: **Seletor de período do Painel** — O Painel oferece seleção de período (7d, 14d, 30d, personalizado). O período persiste enquanto o usuário alterna entre vistas dentro do Painel. O período máximo configurável é 90 dias. "Personalizado" exibe dois date pickers (início e fim).

FR-9: **Vista Parede de Fotos** — Grade responsiva (2 colunas ≤480px, 3 colunas 481–1023px, 4 colunas ≥1024px) com uma célula por entrada no período selecionado. Cada célula: foto em `object-fit: cover` com aspect-ratio 1:1, overlay com hora (canto superior direito) e kcal (canto inferior esquerdo) em scrim escuro. Entradas sem foto exibem placeholder neutro com mesmo overlay. Clicar em uma célula abre overlay modal com foto ampliada + lista de alimentos + macros. Células ordenadas da mais recente para a mais antiga. Todas as fotos com `loading="lazy"`.

FR-10: **Vista Timeline** — Lista cronológica de entradas (mais antiga → mais recente) com marcadores de dia. Cada item: thumbnail 64×64px à esquerda, hora + título + macros totais à direita, tag de contexto como pill ao lado do título se disponível. Marcadores de dia ("Seg 23/06" com hairline divider) separam grupos. Lista rolável sem paginação.

FR-11: **Vista Macros por Dia** *(fora do MVP — v2)* — Gráfico de barras kcal/dia em SVG/CSS puro, sem biblioteca externa. Dias sem registro: barras de altura zero. Tooltip com kcal, P, G e C ao hover/toque.

FR-12: **Foto do card maior no desktop** — A coluna de fotos dos cards tem `flex: 0 0 200px` em viewports > 480px. Em ≤480px, o layout empilha (foto em cima, texto embaixo).

FR-13: **Confiança via borda esquerda colorida** — O card ganha borda esquerda de 4px mapeada para classes `conf-high`/`conf-mid`/`conf-low`/`conf-zero` usando `--success`/`--neutral`/`--warning`/`--danger`. O badge de percentual é removido. O valor numérico de confiança fica acessível via `aria-label` no elemento de borda.

FR-14: **Estado "revisado" sem opacidade reduzida** — Cards com `reviewed: true` não usam `opacity: 0.65`. Exibem ícone ✓ (`aria-hidden="true"`) sobreposto ao canto superior esquerdo da foto (posicionamento absoluto). O botão "Aceitar" é substituído por "✓ Revisado" (texto estático, sem ação). Botões "Corrigir" e "Excluir" permanecem.

FR-15: **Timeline na vista compartilhada** *(fora do MVP — v2)* — `PublicShare` adiciona opção "Timeline" no segmented control, renderizando as entradas no formato de FR-10, sem controles de edição.

FR-16: **Resumo do Período na vista compartilhada** *(fora do MVP — v2)* — Card compacto fixo acima do segmented control: total de entradas, média de kcal/dia, top 2 contextos mais frequentes. Calculado client-side.

FR-17: **Melhorias no Calendário compartilhado** *(pode entrar no MVP)* — Células do calendário `min-height: 72px` em viewport ≥ 760px. Miniaturas de foto 24×24px. Dias com entradas mas sem foto mostram ponto de 8px em `--accent`.

---

### NonFunctional Requirements

NFR-1: **Zero alterações de backend** — Nenhuma migration, rota nova ou endpoint novo. Todos os dados vêm de APIs existentes.

NFR-2: **Stack frontend** — React + Vite + TypeScript. SPA sem roteador externo; navegação por `useState` (tab ativa). Os dados do Painel são buscados via `Promise.all` de N requests paralelos a `GET /entries?date=YYYY-MM-DD`.

NFR-3: **Design tokens obrigatórios** — Nenhum valor de cor, espaçamento ou tipografia deve ser hardcoded fora da declaração do token em `:root`. Todos os componentes consomem tokens CSS.

NFR-4: **Dark mode automático** — Implementado exclusivamente via `@media (prefers-color-scheme: dark)`. Os tokens de cor fazem swap no `:root`. Nenhum toggle de usuário.

NFR-5: **Escala de espaçamento 4px** — Todos os gaps, paddings e margins devem ser múltiplos de 4px (`--space-1` a `--space-6`). Nenhum valor arbitrário (ex.: 10px, 15px).

NFR-6: **Shell max-width** — App shell limitado a `max-width: 720px` centralizado no viewport, com `16px` de margem horizontal em todos os breakpoints.

NFR-7: **Performance de imagens** — Todas as imagens na Parede de Fotos carregam com `loading="lazy"`.

NFR-8: **Acessibilidade mínima** — Todo botão de ação tem label de texto legível; ícones decorativos têm `aria-hidden="true"`; focus trap no modal; foco via teclado em ordem de leitura natural.

---

### Additional Requirements

(Extraídos do projeto-contexto, addendum e decisões técnicas existentes)

- **Stack:** React + Vite + TypeScript; CSS custom properties; sem roteador externo
- **Tokens de cor finais:** conforme DESIGN.md — `--accent: #0284c7` (sky blue), não `#0d9488` (teal do PRD substituído pelo DESIGN.md)
- **Dark mode:** palette D4 Neutral conforme tabela do DESIGN.md
- **Clique na Parede de Fotos:** overlay modal (decisão do addendum — mais fluido, mantém contexto do Painel)
- **Dados do Painel:** `Promise.all` de N requests paralelos a `GET /entries?date=`; sem endpoint de range por ora
- **Auditoria:** componente preservado, acessível via `?tab=audit` e link no rodapé
- **Microcopy:** pt-BR, conforme tabela de Voice and Tone do EXPERIENCE.md
- **Sem gráfico de macros no MVP:** FR-11 é v2; SVG puro quando implementado

---

### UX Design Requirements

UX-DR1: Implementar sistema completo de tokens CSS em `:root` — 14 tokens light mode + 11 tokens dark mode conforme DESIGN.md, incluindo cores, tipografia, raios, espaçamento e sombra.

UX-DR2: Implementar dark mode automático via `@media (prefers-color-scheme: dark)` com swap dos tokens no `:root` (paleta D4 Neutral). Nenhum componente precisa de regra de dark mode própria.

UX-DR3: Implementar Tab bar sticky: `height: 48px`, `z-index: 2`, fundo `--bg`, active tab com `color: --accent` e `border-bottom: 2px solid --accent`. Exatamente 5 abas. Auditoria nunca visível aqui.

UX-DR4: Implementar Entry card redesenhado: `--radius-card`, `--shadow-card`, borda esquerda 4px colorida por confiança, layout horizontal (foto `flex: 0 0 200px`) em >480px e empilhado em ≤480px, padding `--space-4`.

UX-DR5: Implementar 4 classes de borda de confiança (`conf-high` → `--success`, `conf-mid` → `--neutral`, `conf-low` → `--warning`, `conf-zero` → `--danger`), com `aria-label` numérico no elemento de borda. Sem badge de percentual visível.

UX-DR6: Implementar componentes de botão: primary (`--accent` bg, branco, `--radius-input`), link (sem bg, `--muted`, hover `--text`), danger (sem bg, `--danger` text only). No máximo um botão primário por tela.

UX-DR7: Implementar componente Chip: inativo com `1px solid --border` e texto `--muted`; ativo com bg `--accent` e texto branco; `--radius-pill`; meta size (`0.8rem`).

UX-DR8: Implementar componente Segmented control: pill-row com `--border` bg; item ativo com `border: 1px solid --accent`, `color: --accent`, `font-weight: 600`; seleção única, sempre uma opção ativa.

UX-DR9: Implementar Photo wall cell: `aspect-ratio: 1/1`, `object-fit: cover`, overlay scrim `rgba(0,0,0,.45)` com hora (canto superior direito) e kcal (canto inferior esquerdo) em texto branco meta. Placeholder: bg `--border`, ícone centralizado em `--muted`.

UX-DR10: Implementar Photo overlay modal: backdrop `rgba(0,0,0,.75)` full-screen, sheet `max-width: 480px` centralizado, `--radius-card`, `--shadow-card`, foto no topo em largura total, food list scrollável, botão close `aria-label="Close"`, focus trap, fechar em Escape e clique no backdrop.

UX-DR11: Implementar Mini-summary bar: `--card` bg, `1px solid --border`, `--radius-card`, macros (kcal, P, C, F) à esquerda, 7 dots à direita, max 48px height (wrapping permitido no mobile).

UX-DR12: Implementar 7 pontos de histórico no mini-resumo: 3 estados (vazio = `--border`, tem entradas = `--accent`, tem pendentes = `--warning`), cada ponto com `aria-label` descritivo ("Seg 23/06: 3 entradas, 1 pendente"), clicável para navegar ao dia. Cada ponto resolve de forma independente conforme API responde.

UX-DR13: Implementar Day separator para Timeline: label "Seg 23/06" em `--muted`, `0.8rem`, `font-weight: 600` + hairline `1px solid --border` full-width; `--space-4` margin-top, `--space-3` margin-bottom.

UX-DR14: Implementar estado de loading no Painel: células da Parede e itens da Timeline em estado skeleton enquanto API responde.

UX-DR15: Implementar estado de loading independente para cada ponto de histórico do mini-resumo: ponto em estado neutro/skeleton até a resposta do dia chegar.

UX-DR16: Implementar acessibilidade completa: `aria-label` na borda de confiança, `aria-hidden` em ícones decorativos, `role="img"` + `aria-label="Sem foto"` em placeholders, `alt` descritivo em fotos da Parede, `aria-label` nos pontos de histórico, focus trap no modal, foco via teclado em ordem natural.

UX-DR17: Implementar Auditoria acessível via `?tab=audit` na URL e link discreto no rodapé da página.

UX-DR18: Implementar Tag badge: pill `--radius-pill`, bg da cor da tag, texto calculado por luminância via `textOn(hex)` para garantir contraste, meta size.

UX-DR19: Implementar Placeholder de foto universal: `role="img"`, `aria-label="Sem foto"`, ícone neutro centralizado, dimensões idênticas à foto que substitui, em todos os contextos (card, Parede, Timeline).

UX-DR20: Implementar layout responsivo completo: ≤480px (cards empilhados, Parede 2 colunas, tabs com labels curtos), 481–1023px (cards horizontais foto 200px, Parede 3 colunas), ≥1024px (Parede 4 colunas, shell 720px centralizado).

UX-DR21: Implementar microcopy pt-BR conforme tabela Voice and Tone: "Nenhuma entrada neste dia.", "✓ Revisado", "Aceitar", "Corrigir", "Excluir", "Re-analisar", separadores "Seg 23/06", etc.

---

### FR Coverage Map

| FR | Épico | Descrição |
|---|---|---|
| FR-1 | Epic 1 | Tokens CSS em `:root` |
| FR-2 | Epic 1 | Hierarquia tipográfica |
| FR-3 | Epic 1 | Botões com tokens de cor |
| FR-4 | Epic 2 | Auditoria removida do tab bar |
| FR-5 | Epic 2 | Nova aba Painel no tab bar (stub) |
| FR-6 | Epic 2 | Macros do dia no mini-resumo |
| FR-7 | Epic 2 | Indicador de 7 dias no mini-resumo |
| FR-8 | Epic 3 | Seletor de período do Painel |
| FR-9 | Epic 3 | Vista Parede de Fotos |
| FR-10 | Epic 3 | Vista Timeline |
| FR-11 | v2 | Vista Macros por Dia (fora do MVP) |
| FR-12 | Epic 2 | Foto do card maior no desktop (200px) |
| FR-13 | Epic 2 | Confiança via borda esquerda colorida |
| FR-14 | Epic 2 | Estado "revisado" sem opacidade |
| FR-15 | v2 | Timeline na vista compartilhada |
| FR-16 | v2 | Resumo do período na vista compartilhada |
| FR-17 | Epic 4 | Melhorias no Calendário compartilhado |

---

## Epic List

### Epic 1: Design System & Identidade Visual
Hugo e o nutricionista interagem com uma interface visualmente coesa, com tokens CSS consistentes, tipografia hierárquica e dark mode automático.
**FRs cobertos:** FR-1, FR-2, FR-3
**UX-DRs cobertos:** UX-DR1, UX-DR2, UX-DR6, UX-DR7, UX-DR8

### Epic 2: Tela de Revisão Aprimorada
Hugo revisa entradas diárias com navegação enxuta, cards visualmente claros e contexto imediato do dia — tudo sem esperar por IA.
**FRs cobertos:** FR-4, FR-5, FR-6, FR-7, FR-12, FR-13, FR-14
**UX-DRs cobertos:** UX-DR3, UX-DR4, UX-DR5, UX-DR9, UX-DR10, UX-DR11, UX-DR12, UX-DR15, UX-DR17, UX-DR19, UX-DR20, UX-DR21

### Epic 3: Painel de Padrões Alimentares
Hugo identifica visualmente padrões alimentares ao longo do tempo (Parede de Fotos + Timeline) sem precisar de IA.
**FRs cobertos:** FR-8, FR-9, FR-10
**UX-DRs cobertos:** UX-DR13, UX-DR14, UX-DR16

### Epic 4: Vista Compartilhada para o Nutricionista *(pode entrar no MVP)*
O nutricionista lê o calendário compartilhado com mais clareza, identificando rapidamente dias com e sem fotos.
**FRs cobertos:** FR-17
**UX-DRs cobertos:** UX-DR18

---

## Epic 1: Design System & Identidade Visual

Hugo e o nutricionista interagem com uma interface visualmente coesa, com tokens CSS consistentes, tipografia hierárquica e dark mode automático.

### Story 1.1: Sistema de Tokens CSS, Tipografia e Dark Mode

Como **usuário do app**,
quero que a interface use um sistema consistente de tokens CSS e tipografia hierárquica,
para que a identidade visual seja coesa e o dark mode funcione automaticamente de acordo com minha preferência do sistema operacional.

**Acceptance Criteria:**

**Given** o app é carregado em qualquer tela
**When** inspeciono o seletor CSS `:root`
**Then** ele contém todos os tokens de cor light mode: `--accent` (#0284c7), `--accent-light` (#e0f2fe), `--bg` (#f7f9fb), `--card` (#ffffff), `--text` (#1a1c1e), `--muted` (#6b7280), `--border` (#e2e8f0), `--success` (#16a34a), `--warning` (#f59e0b), `--danger` (#dc2626), `--neutral` (#9ca3af)
**And** os tokens de forma: `--radius-card` (12px), `--radius-input` (8px), `--radius-pill` (999px), `--radius-sm` (6px), `--shadow-card`
**And** os tokens de espaçamento: `--space-1` (4px) a `--space-6` (32px)
**And** nenhum valor de cor, espaçamento ou tipografia está hardcoded fora da declaração de token em `:root`

**Given** o OS está em modo claro (padrão)
**When** visualizo elementos de texto na interface
**Then** headings `<h1>` têm `font-weight: 700` e `font-size: 1.25rem`
**And** headings `<h2>` têm `font-weight: 600` e `font-size: 1.05rem`
**And** texto corpo tem `font-weight: 400` e `font-size: 0.95rem`
**And** elementos de metadata (timestamps, labels de macros) têm `font-size: 0.8rem` e `color: var(--muted)`
**And** nenhum elemento de metadata tem `font-weight > 400`

**Given** o OS está configurado em dark mode (`prefers-color-scheme: dark`)
**When** o app é carregado
**Then** os tokens fazem swap para: `--bg` (#18181b), `--card` (#232329), `--text` (#f4f4f5), `--muted` (#8b8b99), `--border` (#3a3a46), `--accent` (#2da6e4), `--accent-light` (#0d2538), `--success` (#4ade80), `--warning` (#fbbf24), `--danger` (#f87171), `--neutral` (#71717a)
**And** nenhum componente individual requer regras CSS próprias de dark mode
**And** alterar `--accent` no `:root` reflete em todos os elementos primários sem editar componentes

---

### Story 1.2: Componentes Base — Botões, Chips e Segmented Control

Como **usuário do app**,
quero que botões de ação, chips de filtro e segmented controls sejam visualmente distintos e consistentes,
para que eu identifique ações primárias e alterne entre modos com clareza imediata.

**Acceptance Criteria:**

**Given** um botão primário ("Aceitar", "Re-analisar") em estado default
**When** o visualizo
**Then** tem background `var(--accent)`, texto branco, `font-weight: 600`, `border-radius: var(--radius-input)`, padding `var(--space-2)` vertical e `var(--space-4)` horizontal
**And** no máximo um botão primário está visível por tela ao mesmo tempo

**Given** um botão primário em estado disabled
**When** o visualizo
**Then** sua opacidade é `0.4` e cursor é `not-allowed`

**Given** um botão link ("Corrigir", "Cancelar")
**When** o visualizo
**Then** não tem background, cor é `var(--muted)`, e ao hover transiciona para `var(--text)`

**Given** um botão destrutivo ("Excluir")
**When** o visualizo
**Then** não tem background fill, cor do texto é `var(--danger)`, e `--danger` nunca é usado como background

**Given** um componente Chip em estado inativo
**When** o visualizo
**Then** tem `border: 1px solid var(--border)`, texto `var(--muted)`, `border-radius: var(--radius-pill)`, `font-size: 0.8rem`

**Given** um componente Chip em estado ativo
**When** clico/toco nele
**Then** transiciona para background `var(--accent)` e texto branco, mantendo `border-radius: var(--radius-pill)`

**Given** um componente Segmented Control
**When** o visualizo
**Then** renderiza todas as opções, com o item ativo tendo `border: 1px solid var(--accent)`, `color: var(--accent)`, `font-weight: 600`
**And** exatamente uma opção está sempre ativa (nenhuma pode ser desmarcada)

---

## Epic 2: Tela de Revisão Aprimorada

Hugo revisa entradas diárias com navegação enxuta, cards visualmente claros e contexto imediato do dia — tudo sem esperar por IA.

### Story 2.1: Reorganização da Navegação (Tab Bar)

Como **usuário do app**,
quero que a navegação principal tenha 5 abas claras sem a aba de Auditoria,
para que eu acesse as funcionalidades do dia a dia sem ruído visual, mantendo acesso técnico à auditoria quando necessário.

**Acceptance Criteria:**

**Given** o app está carregado e autenticado
**When** visualizo o tab bar
**Then** ele exibe exatamente 5 abas na ordem: Revisão, Painel, Tags, Compartilhar, Relatório
**And** a aba "Auditoria" não está visível no tab bar

**Given** o tab bar com 5 abas
**When** clico em qualquer aba
**Then** ela fica marcada como ativa com `color: var(--accent)` e `border-bottom: 2px solid var(--accent)`
**And** as demais abas ficam com `color: var(--muted)`

**Given** a aba "Painel" no tab bar
**When** clico nela
**Then** o componente `<Dashboard>` é renderizado (pode ser um placeholder com o título "Painel" para esta story — o conteúdo completo vem no Epic 3)
**And** navegar para o Painel não dispara nenhuma chamada ao endpoint de IA

**Given** a necessidade de acessar a Auditoria
**When** acesso a URL com `?tab=audit`
**Then** o componente `<Audit>` é renderizado sem erros
**And** o tab bar continua exibindo as 5 abas normais (Auditoria não aparece como aba ativa no nav)

**Given** o rodapé da página
**When** o visualizo
**Then** há um link discreto para a Auditoria (texto "Auditoria" ou ícone com label acessível)

---

### Story 2.2: Redesign do Entry Card

Como **usuário do app**,
quero que os cards de entrada tenham foto maior, confiança expressa via borda colorida e estado revisado sem degradação visual,
para que eu avalie o conteúdo de cada refeição com mais clareza e menos ruído.

**Acceptance Criteria:**

**Given** um entry card em viewport > 480px
**When** o visualizo
**Then** a coluna de foto tem `flex: 0 0 200px` com `object-fit: cover`
**And** o card tem `border-radius: var(--radius-card)`, `box-shadow: var(--shadow-card)` e `padding: var(--space-4)` em todos os lados

**Given** um entry card em viewport ≤ 480px
**When** o visualizo
**Then** o layout é empilhado: foto em cima (largura 100%), texto abaixo
**And** as dimensões e funcionamento da foto são iguais ao comportamento anterior no mobile

**Given** um entry card com `ai_confidence_overall` de qualquer valor
**When** o visualizo
**Then** o card tem borda esquerda de 4px com cor mapeada: `conf-high` → `var(--success)`, `conf-mid` → `var(--neutral)`, `conf-low` → `var(--warning)`, `conf-zero` → `var(--danger)`
**And** nenhum elemento exibe o percentual de confiança como texto visível no estado padrão
**And** o elemento da borda tem `aria-label` com o valor numérico de confiança (ex.: `aria-label="Confiança da IA: 0.87"`)

**Given** um entry card com `reviewed: true`
**When** o visualizo
**Then** a foto tem a mesma luminosidade que um card não-revisado (sem `opacity: 0.65`)
**And** um ícone ✓ está sobreposto ao canto superior esquerdo da foto com `position: absolute` e `aria-hidden="true"`
**And** o botão "Aceitar" é substituído por texto estático "✓ Revisado" (sem ação ao clicar)
**And** os botões "Corrigir" e "Excluir" permanecem visíveis e funcionais

**Given** um entry card com `reviewed: false`
**When** o visualizo
**Then** o botão "Aceitar" tem background `var(--accent)` (botão primário) e texto "Aceitar"

**Given** uma entrada sem foto (`photos: []`)
**When** é exibida em um entry card
**Then** um placeholder é exibido com as mesmas dimensões da foto, `role="img"`, `aria-label="Sem foto"` e ícone neutro centralizado

**Given** uma entrada com tag de contexto
**When** o card é exibido
**Then** a tag aparece como pill com background da cor da tag e texto calculado por luminância (`textOn(hex)`) para garantir contraste, `border-radius: var(--radius-pill)`, `font-size: 0.8rem`

**Given** qualquer botão de ação no card
**When** o visualizo
**Then** ele tem label de texto legível (não apenas ícone)
**And** ícones decorativos têm `aria-hidden="true"`

---

### Story 2.3: Mini-resumo de Macros do Dia

Como **usuário do app**,
quero ver os macros totais do dia atual logo acima dos cards de entrada,
para que eu entenda meu consumo de hoje em segundos sem precisar abrir nenhum card.

**Acceptance Criteria:**

**Given** a aba Revisão com entradas carregadas para o dia selecionado
**When** visualizo o mini-resumo abaixo dos controles de data
**Then** ele exibe os totais agregados de kcal, P, C e F calculados por `dayTotals(entries)` (sem chamada de API adicional)
**And** o mini-resumo tem background `var(--card)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-card)`
**And** labels de macros (kcal, P, C, F) usam `font-size: 0.8rem` e `color: var(--muted)`
**And** valores de macros usam `font-size: 0.95rem` (body size)
**And** a altura total do mini-resumo não ultrapassa 48px em mobile

**Given** a aba Revisão com `entries.length === 0` para o dia selecionado
**When** visualizo o mini-resumo
**Then** ele exibe "Sem registros neste dia." em vez de zeros

**Given** o mini-resumo renderizado
**When** troco o dia selecionado no date picker
**Then** os macros atualizam instantaneamente para o novo dia usando os dados já carregados (sem nova chamada de API)

---

### Story 2.4: Indicador de Histórico dos 7 Dias

Como **usuário do app**,
quero ver um indicador visual dos 7 dias anteriores no mini-resumo,
para que eu identifique de relance quais dias têm registros pendentes sem navegar manualmente.

**Acceptance Criteria:**

**Given** o mini-resumo na aba Revisão
**When** o visualizo
**Then** há uma fileira de 7 pontos no lado direito, representando os 7 dias imediatamente anteriores ao dia selecionado

**Given** um ponto de histórico carregado para um dia sem entradas
**When** o visualizo
**Then** ele tem cor `var(--border)` (vazio/cinza)

**Given** um ponto de histórico carregado para um dia com entradas, todas revisadas
**When** o visualizo
**Then** ele tem cor `var(--accent)` (preenchido azul)

**Given** um ponto de histórico carregado para um dia com entradas pendentes de revisão (`reviewed: false`)
**When** o visualizo
**Then** ele tem cor `var(--warning)` (preenchido âmbar)

**Given** os 7 pontos ao carregar o mini-resumo
**When** as respostas da API chegam
**Then** cada ponto resolve de forma independente (não espera todos os outros)
**And** antes da resposta chegar, o ponto é exibido em estado neutro/skeleton

**Given** qualquer ponto de histórico
**When** o visualizo
**Then** ele tem `aria-label` descritivo (ex.: `aria-label="Segunda-feira 23/06: 3 entradas, 1 pendente de revisão"`)

**Given** um ponto de histórico
**When** clico/toco nele
**Then** o `date` state da Revisão é atualizado para o dia correspondente
**And** a lista de entradas exibe as entradas daquele dia

---

## Epic 3: Painel de Padrões Alimentares

Hugo identifica visualmente padrões alimentares ao longo do tempo (Parede de Fotos + Timeline) sem precisar de IA.

### Story 3.1: Estrutura do Painel e Seletor de Período

Como **usuário do app**,
quero que a aba Painel tenha um seletor de período e alterne entre vistas de visualização,
para que eu controle o intervalo de tempo que quero analisar e navegue entre os modos sem perder meu período selecionado.

**Acceptance Criteria:**

**Given** a aba Painel está ativa
**When** a visualizo
**Then** há um seletor de período com as opções: 7d, 14d, 30d, personalizado
**And** o período padrão ao abrir pela primeira vez é 7d

**Given** o seletor de período
**When** seleciono "personalizado"
**Then** dois date pickers (início e fim) são exibidos
**And** o período máximo entre início e fim é 90 dias
**And** datas futuras não são selecionáveis

**Given** o período selecionado (ex.: 30d)
**When** alterno entre as vistas Parede de Fotos e Timeline via segmented control
**Then** o período "30d" permanece selecionado
**And** os dados exibidos na nova vista correspondem ao mesmo período

**Given** o Painel com período selecionado
**When** os dados estão sendo carregados (Promise.all de N requests paralelos a `GET /entries?date=`)
**Then** cada célula/item exibe estado de loading (skeleton) de forma independente, resolvendo conforme cada resposta chega

**Given** a aba Painel renderizada
**When** analiso as chamadas de rede
**Then** nenhuma chamada ao endpoint de IA (`/report/weekly` ou `/shared/:token/patterns`) é feita

---

### Story 3.2: Vista Parede de Fotos com Overlay Modal

Como **usuário do app**,
quero ver uma grade de fotos das minhas refeições com hora e kcal sobrepostos, e poder ampliar qualquer entrada para ver seus detalhes,
para que eu identifique padrões alimentares visualmente em segundos.

**Acceptance Criteria:**

**Given** a vista Parede de Fotos com período selecionado
**When** a visualizo em viewport ≤ 480px
**Then** a grade exibe 2 colunas

**Given** a vista Parede de Fotos em viewport 481–1023px
**When** a visualizo
**Then** a grade exibe 3 colunas

**Given** a vista Parede de Fotos em viewport ≥ 1024px
**When** a visualizo
**Then** a grade exibe 4 colunas

**Given** qualquer célula da grade com foto
**When** a visualizo
**Then** a foto preenche a célula com `aspect-ratio: 1/1` e `object-fit: cover`
**And** há overlay escuro (`rgba(0,0,0,.45)`) com hora no canto superior direito e kcal no canto inferior esquerdo, ambos em texto branco `font-size: 0.8rem`
**And** a imagem carrega com `loading="lazy"`

**Given** uma entrada sem foto no período
**When** a célula correspondente é renderizada na grade
**Then** ela exibe um placeholder com fundo `var(--border)`, ícone centralizado em `var(--muted)` e o mesmo overlay de hora/kcal
**And** a entrada não é omitida da grade

**Given** as células da grade ordenadas
**When** as visualizo
**Then** estão ordenadas da mais recente (topo-esquerda) para a mais antiga

**Given** o usuário clica/toca em qualquer célula da grade
**When** a ação acontece
**Then** um overlay modal abre com: backdrop full-screen `rgba(0,0,0,.75)`, sheet centralizado `max-width: 480px`, `border-radius: var(--radius-card)`, foto ampliada no topo em largura total, e lista de alimentos scrollável abaixo da foto

**Given** o overlay modal aberto
**When** clico/toco no backdrop
**Then** o modal fecha

**Given** o overlay modal aberto
**When** pressiono a tecla Escape
**Then** o modal fecha

**Given** o overlay modal aberto
**When** o foco de teclado está ativo
**Then** o foco é capturado dentro do modal (focus trap) e não escapa para elementos por baixo
**And** há um botão de fechar com `aria-label="Fechar"` no canto superior direito do sheet

**Given** cada imagem na grade (elemento `<img>`)
**When** não há foto disponível
**Then** o placeholder tem `role="img"` e `aria-label="Sem foto"`

---

### Story 3.3: Vista Timeline

Como **usuário do app**,
quero ver uma lista cronológica das minhas entradas com separadores de dia, thumbnail, hora, macros e tag de contexto,
para que eu acompanhe o histórico alimentar em ordem temporal e identifique padrões por período do dia.

**Acceptance Criteria:**

**Given** a vista Timeline com período selecionado
**When** a visualizo
**Then** as entradas são listadas da mais antiga para a mais recente, agrupadas por dia

**Given** a Timeline com múltiplas entradas em dias diferentes
**When** a visualizo
**Then** antes do primeiro item de cada novo dia há um separador com label "Seg 23/06" (dia da semana abreviado + data)
**And** o separador tem texto `font-size: 0.8rem`, `font-weight: 600`, `color: var(--muted)` com hairline `1px solid var(--border)` full-width ao lado
**And** margem superior de `var(--space-4)` e margem inferior de `var(--space-3)` no separador
**And** o separador é elemento visual, não interativo

**Given** cada item da Timeline
**When** o visualizo
**Then** há um thumbnail de 64×64px à esquerda com `object-fit: cover`
**And** à direita: hora da entrada, título da entrada, e macros totais (kcal, P, C, F)
**And** se a entrada tem tag de contexto, ela aparece como pill colorido ao lado do título (usando o componente tag badge do Epic 2)

**Given** uma entrada sem foto em um item da Timeline
**When** o visualizo
**Then** o thumbnail exibe o placeholder neutro de 64×64px com `role="img"` e `aria-label="Sem foto"`

**Given** a Timeline completa para o período
**When** a percorro
**Then** é rolável sem paginação — todos os itens do período estão carregados

**Given** os itens da Timeline carregando
**When** os dados ainda não chegaram
**Then** cada item exibe estado skeleton de forma independente, resolvendo conforme cada resposta chega

---

## Epic 4: Vista Compartilhada para o Nutricionista

O nutricionista lê o calendário compartilhado com mais clareza, identificando rapidamente dias com e sem fotos.

### Story 4.1: Calendário Aprimorado na Vista Compartilhada

Como **nutricionista**,
quero que o calendário compartilhado tenha células maiores, miniaturas de foto maiores e um indicador visual em dias sem foto,
para que eu leia o histórico alimentar do paciente com mais clareza antes da consulta.

**Acceptance Criteria:**

**Given** a Vista Compartilhada (`/shared/:token`) aberta em viewport ≥ 760px
**When** visualizo o calendário
**Then** cada célula de dia tem `min-height: 72px`
**And** as miniaturas de foto nos dias com entradas têm exatamente 24×24px

**Given** a Vista Compartilhada em viewport < 760px
**When** visualizo o calendário
**Then** o comportamento das células é igual ao comportamento anterior (sem regressão)

**Given** um dia com entradas mas sem foto (`photos: []` em todas as entradas do dia)
**When** a célula correspondente é exibida no calendário
**Then** um ponto de 8px com cor `var(--accent)` é exibido no centro da célula
**And** a célula não fica vazia

**Given** um dia sem nenhuma entrada
**When** a célula correspondente é exibida no calendário
**Then** a célula permanece vazia (sem ponto)

**Given** um dia com pelo menos uma entrada com foto
**When** a célula correspondente é exibida no calendário
**Then** a miniatura de 24×24px é exibida normalmente (sem o ponto de acento)

**Given** o link compartilhado com token válido e não expirado
**When** acesso a Vista Compartilhada
**Then** não é necessária autenticação Bearer
**And** as melhorias visuais do calendário são aplicadas sem regressão no restante da vista (lista, padrões)
