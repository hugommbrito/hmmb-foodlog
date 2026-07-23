# Epic 1 Context: Design System & Identidade Visual

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Estabelecer um design system completo com tokens CSS consistentes, hierarquia tipográfica clara e dark mode automático. Esta é a fundação técnica que desbloqueia todos os épicos seguintes — nenhum componente pode ser implementado corretamente sem os tokens em vigor. O resultado é uma interface visualmente coesa onde trocar `--accent` no `:root` reflete em todos os elementos interativos sem editar componentes individualmente.

## Stories

- Story 1.1: Sistema de Tokens CSS, Tipografia e Dark Mode
- Story 1.2: Componentes Base — Botões, Chips e Segmented Control

## Requirements & Constraints

**Tokens obrigatórios no `:root` (light mode):**
- Cores: `--accent: #0284c7`, `--accent-light: #e0f2fe`, `--bg: #f7f9fb`, `--card: #ffffff`, `--text: #1a1c1e`, `--muted: #6b7280`, `--border: #e2e8f0`, `--success: #16a34a`, `--warning: #f59e0b`, `--danger: #dc2626`, `--neutral: #9ca3af`
- Forma: `--radius-card: 12px`, `--radius-input: 8px`, `--radius-pill: 999px`, `--radius-sm: 6px`, `--shadow-card: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06)`
- Espaçamento: `--space-1: 4px` … `--space-6: 32px`

**Dark mode (paleta D4 Neutral) — swap exclusivo no `:root` via `@media (prefers-color-scheme: dark)`:**
`--bg: #18181b`, `--card: #232329`, `--text: #f4f4f5`, `--muted: #8b8b99`, `--border: #3a3a46`, `--accent: #2da6e4`, `--accent-light: #0d2538`, `--success: #4ade80`, `--warning: #fbbf24`, `--danger: #f87171`, `--neutral: #71717a`

**Regras absolutas:**
- Nenhum valor de cor, espaçamento ou tipografia pode ser hardcoded fora da declaração de token no `:root`. Todos os componentes consomem tokens CSS.
- Nenhum componente individual precisa de regra de dark mode própria — o swap acontece apenas no `:root`.
- Nenhum toggle de dark mode para o usuário.
- Escala de espaçamento estritamente 4px-based (`--space-1` a `--space-6`). Nenhum valor arbitrário (ex.: 10px, 15px).
- Nenhum uso de gradientes em nenhuma superfície.

**Hierarquia tipográfica:**
- H1: `1.25rem / font-weight: 700` — headings de seção/tela; no máximo um H1 no viewport visível
- H2: `1.05rem / font-weight: 600` — títulos de card
- Body: `0.95rem / font-weight: 400` — conteúdo legível principal
- Meta: `0.8rem / font-weight: 400 / color: var(--muted)` — timestamps, labels de macros, metadata; nunca para conteúdo primário
- Font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (sem fonte externa)

## Technical Decisions

- **Stack:** React + Vite + TypeScript; CSS custom properties; sem roteador externo; navegação por `useState`.
- **Tokens como fonte única de verdade:** o CSS gerado neste épico é o contrato visual de toda a aplicação. Epics 2, 3 e 4 consumem esses tokens sem redefinir nenhum valor.
- **Nota sobre `--accent`:** o PRD original propunha teal (`#0d9488`). O DESIGN.md final define sky blue (`#0284c7`). O valor correto a implementar é `#0284c7`.
- **`--shadow-card`** substitui bordas sólidas em cards como sinal de profundidade. Sombra aplicada apenas em cards e modal sheets — nunca em botões, chips ou abas.
- **`--danger` nunca como background fill** — apenas como cor de texto em ações destrutivas.

## UX & Interaction Patterns

**Botão primário:**
- Background `var(--accent)`, texto branco, `font-weight: 600`, `border-radius: var(--radius-input)`
- Padding: `var(--space-2)` vertical × `var(--space-4)` horizontal
- Disabled: `opacity: 0.4`, cursor `not-allowed`
- Máximo de um botão primário visível por tela

**Botão link (ações secundárias):**
- Sem background, cor `var(--muted)`, hover transiciona para `var(--text)`
- Sem border; padding `var(--space-2)` × `var(--space-3)`

**Botão destrutivo (Excluir):**
- Sem background fill, cor de texto `var(--danger)`; `--danger` nunca como background

**Chip (filtros):**
- Inativo: `border: 1px solid var(--border)`, texto `var(--muted)`, `border-radius: var(--radius-pill)`, `font-size: 0.8rem`
- Ativo: background `var(--accent)`, texto branco, mesmo `border-radius`
- Múltiplos chips podem estar ativos simultaneamente

**Segmented control (seleção exclusiva):**
- Container pill-shaped com fundo `var(--border)`
- Item ativo: `border: 1px solid var(--accent)`, `color: var(--accent)`, `font-weight: 600`
- Sempre exatamente uma opção ativa; seleção não pode ser desmarcada

**Microcopy pt-BR relevante para ações de botão:**
- Aceitar / Corrigir / Excluir / Re-analisar / Cancelar (conforme tabela Voice and Tone do EXPERIENCE.md)

## Cross-Story Dependencies

Story 1.1 deve ser concluída antes de Story 1.2 — os tokens de cor, espaçamento e forma declarados em 1.1 são consumidos diretamente pelos estilos dos componentes de 1.2.

Os tokens e componentes deste épico são pré-requisito para todos os épicos subsequentes (Epics 2, 3 e 4). Nenhuma story dos épicos seguintes deve ser iniciada sem os tokens do Epic 1 em produção.
