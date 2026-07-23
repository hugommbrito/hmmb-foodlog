---
title: hmmb-foodlog — Evolução de UX/UI
status: final
created: 2026-06-29
updated: 2026-06-29
finalized: 2026-06-29
---

# PRD: hmmb-foodlog — Evolução de UX/UI

## 0. Propósito do Documento

Este PRD define os requisitos para a evolução da interface web do hmmb-foodlog — interface principal (uso pessoal do Hugo) e vista compartilhada (nutricionista). O problema central: hoje o usuário precisa abrir uma aba separada, aguardar uma chamada de IA e interpretar texto para entender como está a semana. Este documento cobre Design System, navegação e novas vistas de visualização. Nenhuma alteração de backend é necessária — todos os dados já estão disponíveis via APIs existentes.

---

## 1. Visão

O hmmb-foodlog já captura bem cada refeição via WhatsApp e permite revisão diária via web. O que falta é tornar esse histórico *visível como padrão* — não só como registros individuais. Um usuário que abre o app às 8h deve conseguir, em segundos e sem navegar, entender se está comendo bem essa semana. Um nutricionista que abre o link compartilhado deve conseguir escolher como quer ver os dados e chegar às suas próprias conclusões.

Esta evolução transforma a interface de um log funcional em um painel de saúde pessoal com identidade visual própria, navegação enxuta e múltiplas formas de visualização — incluindo uma **Parede de Fotos** que torna padrões alimentares identificáveis de forma imediata e intuitiva.

---

## 2. Usuário-Alvo

### 2.1 Jobs to Be Done

- Saber rapidamente como estou comendo esta semana sem gerar um relatório de IA
- Identificar padrões visuais nas minhas refeições (ex.: "jantar sempre pesado às 21h")
- Revisar e aceitar entradas do dia sem distração
- Compartilhar o histórico com o nutricionista de forma que ele consiga analisar como preferir
- Gerenciar tags de contexto e links compartilhados com agilidade

### 2.2 Jornadas-Chave

**UJ-1. Hugo verifica o padrão da semana antes de sair de casa.**
- **Persona + contexto:** Hugo, usuário único do app, abre no celular e quer entender a semana sem esperar IA.
- **Estado de entrada:** autenticado, aba Revisão ativa.
- **Caminho:** vê mini-resumo de macros do dia no topo → toca em "Painel" → seleciona "Parede de Fotos" → rola a grade dos últimos 7 dias, cada célula mostra foto + hora + kcal → identifica visualmente que os jantares de terça e quinta são os mais calóricos.
- **Clímax:** padrão identificado em menos de 30 segundos, sem interação com IA.
- **Resolução:** fecha o Painel e vai para Revisão para checar as entradas de hoje.
- **Edge case:** se o período não tem fotos (entradas manuais), a Parede exibe placeholder neutro com hora e kcal — não omite a entrada.

**UJ-2. Nutricionista analisa o histórico no link compartilhado.**
- **Persona + contexto:** profissional de nutrição, recebe o link antes da consulta, abre no desktop.
- **Estado de entrada:** sem autenticação Bearer; acessa via URL do token compartilhado.
- **Caminho:** vê o período → escolhe "Timeline" → rola as entradas em ordem cronológica com foto, hora, alimentos e macros → muda para "Padrões" (análise IA) → lê o Resumo do Período fixo no topo.
- **Clímax:** entende os hábitos do paciente sem pedir informações adicionais.
- **Resolução:** usa os dados como base para a consulta.

---

## 3. Glossário

- **Entrada (Entry):** registro de refeição com foto(s), alimentos identificados pela IA e macros estimados.
- **Revisão:** aba principal da interface onde o usuário analisa e aceita as entradas do dia; ponto de entrada padrão após o login.
- **Aceitar:** ação que marca uma Entrada como revisada (`reviewed: true`); sinaliza que o usuário validou o que a IA identificou.
- **Parede de Fotos:** vista de grade que exibe fotos de múltiplas entradas com sobreposição de timestamp e kcal — projetada para identificação visual de padrões.
- **Timeline:** lista cronológica de entradas com miniatura da foto, hora, título e macros; marcadores de dia separam os grupos.
- **Painel:** aba que agrega múltiplas vistas do histórico alimentar (Parede de Fotos, Timeline, Macros por Dia) para análise de padrões.
- **Padrão alimentar:** recorrência observável nas entradas — horários habituais de refeição, tipos de alimento por contexto, variações de macros por dia da semana.
- **Mini-resumo:** barra compacta na aba Revisão com macros do dia atual e indicador visual dos últimos 7 dias.
- **Vista Compartilhada:** interface pública (sem autenticação Bearer) acessível pelo token do link, destinada ao nutricionista.
- **Confiança:** pontuação da IA (0–1) que indica certeza na identificação de alimentos; exibida via borda colorida no card, não como percentual.
- **Macros:** conjunto de kcal, proteína (P), gordura (G) e carboidrato (C) de uma entrada ou período.
- **Design System:** conjunto de tokens CSS (cor, tipografia, espaçamento) aplicado consistentemente em toda a interface.
- **Período:** intervalo de datas (ex.: 7d, 14d, 30d) selecionado pelo usuário para filtrar as vistas do Painel.

---

## 4. Features

### 4.1 Design System Refresh

**Descrição:** Estabelece identidade visual coesa substituindo a paleta e hierarquia tipográfica atuais. A interface usa cinzas neutros com fundo `#f6f7f9` e fonte do sistema sem distinção de peso. A nova identidade adota fundo quente, uma cor de destaque teal e hierarquia de peso tipográfico clara. [ASSUMPTION: teal `#0d9488` como cor de destaque — a validar com o usuário em revisão visual antes da implementação.]

**Requisitos Funcionais:**

#### FR-1: Tokens CSS de design
O sistema expõe um conjunto mínimo de tokens CSS no `:root` (`--accent`, `--accent-light`, `--bg`, `--card`, `--text`, `--muted`, `--border`, `--success`, `--warning`, `--danger`, `--radius-card`, `--radius-pill`, `--shadow-card`) substituindo valores hardcoded do CSS atual.

**Consequências (testáveis):**
- Alterar `--accent` em `:root` reflete em todos os componentes que o usam sem editar componentes individualmente.
- Todos os elementos interativos primários (botão de submit, tab ativa, chip ativo) usam `--accent`.

#### FR-2: Hierarquia tipográfica
Títulos de seção usam `font-weight: 700`; títulos de card, `600`; corpo, `400`; metadata (hora, macros secundários), `400` com `color: var(--muted)`. Tamanhos: H1 `1.25rem`, H2 `1.05rem`, body `0.95rem`, metadata `0.8rem`.

**Consequências (testáveis):**
- Todos os `<h1>` nos headers de aba têm `font-weight: 700`.
- Nenhum elemento de metadata (hora, macros) tem `font-weight > 400`.

#### FR-3: Botão primário com cor de destaque
O botão primário (submit, CTAs principais) usa `--accent` como background. O botão "link" usa `--muted` com hover em `--text`. O botão "Aceitar" nos cards usa `--accent`.

**Consequências (testáveis):**
- O botão "Aceitar" de um card não-revisado tem background `--accent`.
- Botões de ação destrutiva ("Excluir") usam `--danger` como cor de texto, sem background.

---

### 4.2 Reorganização da Navegação

**Descrição:** A aba "Auditoria" é removida do tab bar principal e passa a ser acessível via mecanismo secundário (URL direta ou link no rodapé). A nova ordem do tab bar é: **Revisão → Painel → Tags → Compartilhar → Relatório**. Realiza UJ-1.

**Requisitos Funcionais:**

#### FR-4: Remoção da Auditoria do tab bar
A aba "Auditoria" não aparece no `<nav className="tabs">`. O componente `<Audit>` continua existindo e é acessível via mecanismo secundário (ex.: querystring `?tab=audit` ou link no rodapé da página), mas não integra a navegação principal.

**Consequências (testáveis):**
- O tab bar exibe exatamente 5 abas: Revisão, Painel, Tags, Compartilhar, Relatório.
- O componente `<Audit>` renderiza sem erros quando acessado via mecanismo secundário.

#### FR-5: Nova aba Painel
Uma aba "Painel" é inserida na segunda posição do tab bar e renderiza o componente `<Dashboard>` descrito em §4.4.

**Consequências (testáveis):**
- A aba "Painel" fica marcada como `active` quando o tab `dashboard` está selecionado.
- Navegar para "Painel" não dispara nenhuma chamada ao endpoint de IA (`/report/weekly` ou `/shared/:token/patterns`).

---

### 4.3 Mini-Resumo na Aba de Revisão

**Descrição:** Barra compacta inserida abaixo dos controles de data na aba Revisão. Exibe macros totais do dia atual e um indicador visual dos últimos 7 dias. Não redireciona o foco da revisão — é um complemento que ocupa no máximo 48px de altura. Realiza UJ-1.

**Requisitos Funcionais:**

#### FR-6: Macros do dia no mini-resumo
O mini-resumo exibe os macros agregados das entradas do dia selecionado usando a função `dayTotals()` existente, apresentados de forma destacada acima dos cards. Quando não há entradas, exibe "Sem registros neste dia" em vez de zeros.

**Consequências (testáveis):**
- O mini-resumo usa os dados já carregados para o dia — nenhuma chamada de API adicional é gerada.
- "Sem registros neste dia" aparece quando `entries.length === 0` para o dia selecionado.

#### FR-7: Indicador de histórico recente (7 dias)
Uma fileira de 7 ícones/pontos representa os 7 dias anteriores ao dia selecionado. Cada ícone indica: sem registro (vazio/cinza), tem registro (preenchido em `--accent`), tem registros pendentes de revisão (preenchido em `--warning`). Clicar/tocar em um ponto navega para aquele dia na Revisão.

**Consequências (testáveis):**
- Os 7 pontos representam os 7 dias imediatamente anteriores ao dia selecionado no date picker.
- Clicar em um ponto altera o `date` state da Revisão para o dia correspondente.
- [ASSUMPTION: os dados dos 7 dias anteriores requerem chamadas ao `GET /entries?date=` — a estratégia de carregamento (paralela vs. lazy) é definida na implementação sem alterar o backend.]

---

### 4.4 Painel — Aba de Dashboard

**Descrição:** Nova aba com três vistas de visualização selecionáveis por segmented control: **Parede de Fotos**, **Timeline** e **Macros por Dia**. Um seletor de período (7d / 14d / 30d / personalizado) controla o intervalo para todas as vistas. Os dados vêm dos endpoints existentes. Realiza UJ-1.

**Requisitos Funcionais:**

#### FR-8: Seletor de período do Painel
O Painel oferece seleção de período (7d, 14d, 30d, personalizado). O período persiste enquanto o usuário alterna entre vistas dentro do Painel (Parede → Timeline → Macros e volta). O período máximo configurável é 90 dias.

**Consequências (testáveis):**
- Trocar de "7d" para "30d" e depois mudar de Parede para Timeline mantém "30d" selecionado.
- Selecionar "personalizado" exibe dois date pickers (início e fim) com o mesmo padrão de validação do endpoint existente.

#### FR-9: Vista Parede de Fotos
Grade responsiva (3 colunas no desktop, 2 no mobile) com uma célula por entrada no período selecionado. Cada célula exibe: a foto da entrada em `object-fit: cover`, sobreposição com hora (canto superior direito) e kcal da entrada (canto inferior esquerdo). Entradas sem foto exibem placeholder neutro com os mesmos metadados. Células ordenadas da mais recente para a mais antiga. Realiza UJ-1.

**Consequências (testáveis):**
- Entradas sem foto (`photos: []`) exibem placeholder — não são omitidas da grade.
- A célula não exibe o título da entrada; a foto é o elemento principal.
- A grade reflow para 2 colunas em viewport ≤ 480px.
- Todas as fotos carregam com `loading="lazy"`.
- [ASSUMPTION: clicar em uma célula abre um overlay com a foto ampliada + lista de alimentos. Comportamento alternativo (navegar para o dia na Revisão) a decidir na implementação — ver Q1 em §8.]

#### FR-10: Vista Timeline
Lista cronológica de entradas, da mais antiga para a mais recente, com marcadores de dia. Cada item exibe: miniatura da foto (64×64px) à esquerda, hora + título + macros totais à direita, e uma linha vertical conectando os itens do mesmo dia. Marcadores de dia (ex.: "Seg 23/06") separam grupos.

**Consequências (testáveis):**
- Entradas sem foto exibem o placeholder no tamanho 64×64px.
- Marcadores de dia são inseridos antes do primeiro item de cada novo dia.
- A lista é rolável sem paginação; o contexto (tag) da entrada aparece ao lado do título, se disponível.

#### FR-11: Vista Macros por Dia *(fora do MVP — v2)*
Gráfico de barras (kcal/dia) implementado em SVG/CSS puro, sem biblioteca externa. Dias sem registro aparecem como barras de altura zero. Tooltip com kcal, P, G e C ao hover/toque. [NOTE FOR PM]: incluir no MVP se FR-8 a FR-10 forem concluídos antes do prazo.

---

### 4.5 Redesign dos Cards de Entrada

**Descrição:** Os cards na aba Revisão recebem revisão visual que melhora a hierarquia de informação sem alterar funcionalidade. Foto maior, confiança expressa via borda colorida (não badge de %), estado "revisado" sem degradação de opacidade.

**Requisitos Funcionais:**

#### FR-12: Foto do card maior no desktop
A coluna de fotos dos cards tem `flex-basis: 200px` em viewports > 480px (era 160px). O comportamento responsive atual (foto em linha no mobile) é mantido.

**Consequências (testáveis):**
- Em viewport > 480px, a coluna de foto ocupa 200px de largura com `object-fit: cover`.
- Em viewport ≤ 480px, o layout e dimensões da foto são iguais ao comportamento atual.

#### FR-13: Confiança via borda esquerda colorida
O card ganha uma borda esquerda de 4px (cor mapeada para as mesmas classes `conf-*` atuais: verde/neutro/âmbar/vermelho). O badge de percentual é removido do layout padrão. O valor numérico de confiança fica acessível via `title` ou `aria-label` no elemento de borda.

**Consequências (testáveis):**
- Nenhum elemento exibe o percentual de confiança como texto visível no estado padrão do card.
- A borda esquerda colorida usa as mesmas variáveis CSS `--success`, `--warning`, `--danger`, `--neutral` do Design System.
- Usuários de leitores de tela acessam o valor de confiança via atributo acessível no elemento de borda.

#### FR-14: Estado "revisado" sem opacidade reduzida
Cards com `reviewed: true` não usam `opacity: 0.65`. Em vez disso, exibem um ícone ✓ sobreposto ao canto superior esquerdo da foto. O botão "Aceitar" é substituído por "✓ Revisado" (texto estático, sem ação). Os botões "Corrigir" e "Excluir" permanecem disponíveis.

**Consequências (testáveis):**
- A foto de um card revisado tem a mesma luminosidade que um não-revisado.
- O ícone ✓ sobrepõe a foto sem ocupar espaço de layout (posicionamento absoluto).
- Cards revisados ainda exibem "Corrigir" e "Excluir".

---

### 4.6 Vista Compartilhada Multi-Modo (Nutricionista)

**Descrição:** A vista pública (`PublicShare`) ganha duas novas vistas além de Calendário e Lista: **Timeline** (read-only, mesmo formato de FR-10) e um **Resumo do Período** (card fixo no topo de qualquer vista). Dá ao nutricionista múltiplos ângulos de análise sem depender do relatório de IA. Realiza UJ-2.

**Requisitos Funcionais:**

#### FR-15: Timeline na vista compartilhada *(fora do MVP — v2)*
O segmented control da `PublicShare` adiciona a opção "Timeline" renderizando as entradas no formato de FR-10, sem nenhum controle de edição. O contexto (tag) da entrada aparece ao lado da hora, se disponível. [NOTE FOR PM]: implementação simples dado que o componente de Timeline é criado em FR-10.

#### FR-16: Resumo do Período na vista compartilhada *(fora do MVP — v2)*
Card compacto fixo acima do segmented control de vistas exibindo: total de entradas no período, média de kcal/dia, e contextos mais frequentes (top 2). Calculado client-side a partir de `data.entries` já carregado — sem chamada de API adicional. Se nenhuma entrada tem kcal, a linha de kcal exibe "—".

#### FR-17: Melhorias no Calendário compartilhado *(pode entrar no MVP — ver §6.2)*
Células do calendário passam de `min-height: 56px` para `72px`. Miniaturas de foto passam de 16×16px para 24×24px. Dias com entradas mas sem foto mostram um ponto colorido (`--accent`) em vez de célula vazia.

**Consequências (testáveis):**
- Em viewport ≥ 760px, cada célula do calendário tem `min-height: 72px`.
- Dias sem foto mas com entradas exibem um ponto de 8px em `--accent`.

---

## 5. Non-Goals (Explícitos)

- Nenhuma alteração de backend (nenhuma migration, rota nova ou endpoint novo)
- Nenhuma alteração de autenticação (sem OAuth, login social, etc.)
- Nenhum frontend mobile nativo (React Native, Flutter etc.)
- Não implementar gráfico de macronutrientes por barra individualmente (apenas kcal no eixo de FR-11; P/G/C no tooltip)
- Não implementar notificações push nem lembretes
- Não implementar exportação de dados
- A aba Auditoria não é reformulada — apenas retirada do acesso principal
- Não implementar dark mode nesta iteração

---

## 6. Escopo MVP

### 6.1 Em Escopo

- **FR-1 a FR-3** — Design System (fundação; desbloqueiam tudo)
- **FR-4 a FR-5** — Reorganização da Navegação (tab bar + nova aba Painel)
- **FR-6 a FR-7** — Mini-resumo na Revisão (resolve o ponto de atrito mais citado)
- **FR-8 a FR-10** — Painel: período + Parede de Fotos + Timeline (core da visão de padrões)
- **FR-12 a FR-14** — Redesign dos cards (melhoria visual imediata na tela mais usada)

### 6.2 Fora do Escopo MVP (v2)

- **FR-11** — Vista Macros por Dia: útil, mas o gráfico SVG puro tem complexidade considerável; adiado para depois da validação das vistas de Foto/Timeline.
- **FR-15 a FR-16** — Vista Compartilhada (Timeline + Resumo): melhoria importante para o nutricionista, mas a vista compartilhada atual ainda funciona. Hugo é o usuário principal.
- **FR-17** — Melhorias no Calendário compartilhado: [NOTE FOR PM] implementação simples (apenas CSS + leve ajuste de layout). Pode ser incluído no MVP se os FRs do Painel avançarem antes do previsto.

---

## 7. Métricas de Sucesso

Projeto pessoal — sucesso é comportamental.

**Primária**
- **SM-1:** Hugo abre a aba "Painel" pelo menos 3× por semana nas primeiras 4 semanas após o lançamento. Valida FR-8 a FR-10 e UJ-1.

**Secundária**
- **SM-2:** A aba "Relatório" (que requer IA) é aberta com menos frequência do que "Painel" após o lançamento — sinal de que o Painel resolve a visão geral sem custo de IA. Valida FR-8 a FR-10.

**Counter-metric (não otimizar)**
- **SM-C1:** O tempo médio na aba Revisão não aumenta após o lançamento — o mini-resumo não deve adicionar distração. Contrabalança SM-1.

---

## 8. Questões Abertas

1. **Comportamento de clique na Parede de Fotos (FR-9):** ao tocar em uma célula, o ideal é abrir um overlay com a foto ampliada + lista de alimentos e macros, ou navegar para a aba Revisão no dia correspondente? O overlay é mais fluido mas adiciona complexidade; a navegação é mais simples mas perde contexto do Painel.
2. **Estratégia de carregamento do indicador de 7 dias (FR-7):** 7 requests paralelos ao `GET /entries?date=` é aceitável no mobile? Avaliar se o volume de requests impacta a performance antes de implementar.
3. **Período padrão do Painel ao abrir pela primeira vez:** 7d ou 14d? (FR-8)
4. **Número de colunas na Parede de Fotos em telas grandes:** 3 colunas pode deixar as fotos pequenas em viewport ≥ 1024px. Avaliar 4 colunas acima de 1024px. (FR-9)

---

## 9. Índice de Assumptions

- **§4.1 / FR-1:** Teal (`#0d9488`) como cor de destaque — a validar com revisão visual antes da implementação.
- **§4.3 / FR-7:** Estratégia de carregamento dos dados dos 7 dias — definida na implementação sem alterar o backend.
- **§4.4 / FR-9:** Comportamento de clique nas células da Parede de Fotos — overlay vs. navegação para Revisão. Ver Q1 em §8.
- **§4.4 / FR-11:** Kcal como única métrica primária no gráfico; P/G/C apenas no tooltip.
