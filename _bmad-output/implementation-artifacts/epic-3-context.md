# Epic 3 Context: Painel de Padrões Alimentares

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Criar o Painel (Dashboard) que permite a Hugo identificar visualmente padrões alimentares ao longo do tempo sem precisar de IA. O Painel oferece seletor de período (7d / 14d / 30d / personalizado), duas vistas de visualização — Parede de Fotos (grade responsiva com overlay modal) e Timeline (lista cronológica com separadores de dia) — e busca todos os dados via `Promise.all` de N requests paralelos a `GET /entries?date=`. Nenhum endpoint novo é criado no backend.

## Stories

- Story 3.1: Estrutura do Painel e Seletor de Período
- Story 3.2: Vista Parede de Fotos com Overlay Modal
- Story 3.3: Vista Timeline

## Requirements & Constraints

**Seletor de período:**
- Opções: 7d, 14d, 30d, personalizado. Padrão ao abrir: 7d.
- "Personalizado": dois date pickers (início e fim). Período máximo: 90 dias. Datas futuras não selecionáveis.
- Período persiste ao alternar entre vistas (Parede de Fotos ↔ Timeline) via segmented control.

**Busca de dados:**
- `Promise.all` de N requests paralelos a `GET /entries?date=YYYY-MM-DD` — um request por dia do período.
- Cada célula/item resolve de forma independente (skeleton até a resposta chegar).
- Nenhuma chamada a endpoints de IA (`/report/weekly`, `/shared/:token/patterns`).

**Parede de Fotos:**
- Grade responsiva: 2 colunas ≤480px, 3 colunas 481–1023px, 4 colunas ≥1024px.
- Cada célula: `aspect-ratio: 1/1`, `object-fit: cover`, scrim `rgba(0,0,0,.45)` com hora (top-right) e kcal (bottom-left) em texto branco meta size.
- Entradas sem foto: placeholder com `var(--border)` bg, ícone centralizado em `var(--muted)`, mesmo overlay. Entrada não omitida.
- Ordenação: mais recente → mais antiga (topo-esquerda → baixo-direita).
- Todas as imagens com `loading="lazy"`.

**Overlay modal (Parede de Fotos):**
- Backdrop full-screen `rgba(0,0,0,.75)`. Sheet centralizado `max-width: 480px`, `border-radius: var(--radius-card)`, `var(--card)` bg.
- Foto no topo em largura total, `object-fit: cover`. Food list scrollável abaixo.
- Botão fechar `aria-label="Fechar"` (top-right do sheet). Focus trap. Fechar no Escape e no clique do backdrop.

**Timeline:**
- Ordenação: mais antiga → mais recente, agrupada por dia.
- Separador de dia: label "Seg 23/06" em `var(--muted)`, `0.8rem`, `font-weight: 600` + hairline `1px solid var(--border)` full-width. Margin-top `var(--space-4)`, margin-bottom `var(--space-3)`. Elemento visual, não interativo.
- Cada item: thumbnail 64×64px à esquerda (`object-fit: cover`), à direita: hora + título + macros totais (kcal, P, C, F). Tag de contexto como pill colorido ao lado do título, se disponível.
- Rolável sem paginação — todos os itens do período carregados.

**Loading states:**
- Células da Parede e itens da Timeline em skeleton enquanto API responde.
- Cada item resolve de forma independente (não espera todos).

**Acessibilidade:**
- `role="img"` + `aria-label="Sem foto"` em placeholders.
- `alt` descritivo em fotos da Parede.
- Focus trap no modal, foco via teclado em ordem natural.
- Botão fechar do modal com `aria-label="Fechar"`.

## Technical Decisions

- **Stack:** React + Vite + TypeScript; CSS custom properties; sem roteador externo; navegação por `useState`.
- **Dashboard state:** seletor de período e vista ativa (Parede/Timeline) vivem no componente `<Dashboard>`. O período não é resetado ao trocar de vista.
- **Busca por dia:** N requests `fetchEntries(date)` via `Promise.all`, onde N = número de dias do período. Reutilizar `fetchEntries` existente de `api.ts` — zero endpoints novos.
- **Skeleton:** componentes skeleton em CSS puro (animation via `@keyframes shimmer`) — sem biblioteca externa.
- **Período personalizado:** datas calculadas no cliente; datas futuras filtradas antes de montar o array de dias.
- **Tokens já disponíveis:** Epic 1 e Epic 2 entregaram todos os tokens CSS, componentes base (botões, chips, segmented control) e placeholder universal de foto. Epic 3 apenas consome.

## UX & Interaction Patterns

**Segmented control — Parede / Timeline:**
- Reutilizar o componente `SegmentedControl` do Epic 1.
- Opção ativa persistida enquanto usuário alterna período.

**Photo wall cell — empty state:**
- Placeholder: `role="img"`, `aria-label="Sem foto"`, ícone neutro centralizado, fundo `var(--border)`.

**Timeline day separator:**
- Label + hairline em linha única: label à esquerda, hairline preenche o restante da largura.

**Microcopy pt-BR:**
- "Parede de Fotos" / "Timeline" (segmented control)
- "7 dias" / "14 dias" / "30 dias" / "Personalizado" (seletor de período)
- "Sem registros neste período." (estado vazio)
- "Sem foto" (aria-label placeholder)

## Cross-Story Dependencies

- **Epic 1 → Epic 3 inteiro:** tokens CSS e componentes base (SegmentedControl, Chip, botões) devem estar em produção.
- **Epic 2 (Story 2.1) → Epic 3:** o componente `<Dashboard>` stub criado em Story 2.1 é expandido aqui. O tab bar já existe.
- **Story 3.1 → Stories 3.2 e 3.3:** a estrutura do Painel com seletor de período e `useDashboard` state hook deve existir antes das vistas de conteúdo.
- **Story 3.2 e Story 3.3 são independentes entre si** após 3.1.
