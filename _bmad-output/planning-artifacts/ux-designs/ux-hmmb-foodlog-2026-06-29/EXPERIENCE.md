---
title: hmmb-foodlog Experience
status: final
created: 2026-06-29
updated: 2026-06-29
sources:
  - _bmad-output/planning-artifacts/prds/prd-hmmb-foodlog-2026-06-29/prd.md
---

# hmmb-foodlog — Experience Spine

## Foundation

**Form-factor:** Web SPA exclusiva. Mobile-first (usuário principal abre no celular), desktop suportado. Nenhum app nativo.

**Plataforma:** React + Vite + TypeScript. Single-page, sem roteador externo — estado de navegação mantido em `useState` (tab ativa). Aba Auditoria acessível via `?tab=audit` na URL.

**Sistema de UI:** CSS custom properties (tokens) definidas em `:root`. Todos os componentes consomem tokens; nenhum valor de cor, espaçamento ou tipografia é hardcoded fora da declaração do token. Ver `{DESIGN.md}` para a lista completa de tokens, paleta e escala tipográfica.

**Dark mode:** Implementado exclusivamente via `@media (prefers-color-scheme: dark)`. Os tokens de cor fazem swap no nível `:root`; nenhum componente individual precisa de regra de dark mode própria. Sem toggle de usuário.

**Referência visual:** Toda especificação de cor, sombra, raio, tamanho e peso tipográfico está em `{DESIGN.md}`. Este arquivo descreve comportamento, estrutura e jornada — não medidas visuais.

---

## Information Architecture

| Surface | Acessada a partir de | Propósito |
|---|---|---|
| **Revisão** | Tab bar (posição 1) — aba padrão ao fazer login | Revisão e aceitação das entradas do dia; ponto de entrada principal |
| **Painel** | Tab bar (posição 2) | Visualização de padrões do histórico alimentar: Parede de Fotos e Timeline |
| **Tags** | Tab bar (posição 3) | Gerenciamento de tags de contexto (criar, editar, excluir) |
| **Compartilhar** | Tab bar (posição 4) | Criação e gestão de links compartilhados para o nutricionista |
| **Relatório** | Tab bar (posição 5) | Relatório semanal gerado por IA |
| **Auditoria** | URL direta `?tab=audit` ou link no rodapé | Log de requisições do backend; acesso técnico/diagnóstico |
| **Vista Compartilhada** | Link externo (URL do token) | Interface read-only para o nutricionista; sem autenticação Bearer |

**Nota sobre Auditoria:** o componente `<Audit>` é preservado e funcional, mas removido do tab bar principal para reduzir a carga cognitiva na navegação do dia a dia. O rodapé da página expõe o link discretamente.

---

## Voice and Tone

O app é pessoal, direto e sem julgamento. Microcopy em pt-BR. Registros alimentares são neutros — sem conotação positiva ou negativa sobre escolhas de comida. Feedback de ação é imediato e claro. Mensagens de erro descrevem o que aconteceu, não culpam o usuário.

| Contexto | Fazer | Não fazer |
|---|---|---|
| Estado vazio (sem entradas no dia) | "Nenhuma entrada neste dia." | "Você não registrou nada hoje." / "Comece agora!" |
| Estado vazio (filtro sem resultado) | "Nenhuma entrada para este filtro." | "Não encontramos nada com esse critério." |
| Sem registros no mini-resumo | "Sem registros neste dia." | "0 kcal · P 0g · G 0g · C 0g" |
| Entrada sem alimentos identificados | "IA não identificou alimentos." | "Erro na análise." / "Nenhum alimento encontrado." |
| Confirmação de revisão | "✓ Revisado" | "Aceito!" / "Parabéns!" / "Ótimo!" |
| Ação de aceitar | "Aceitar" | "Confirmar" / "Validar" / "Ok" |
| Ação de editar | "Corrigir" | "Editar" / "Alterar" |
| Ação de excluir | "Excluir" | "Deletar" / "Remover" |
| Botão de re-análise | "Re-analisar" | "Analisar novamente" / "Retry IA" |
| Cancelar edição inline | "Cancelar" | "Fechar" / "Voltar" |
| Separador de dia na Timeline | "Seg 23/06" (dia da semana abreviado + data) | "23/06/2026" / "Segunda-feira, 23 de junho" |
| Período de 7 dias (padrão Painel) | "7 dias" | "1 semana" / "últimos 7 dias" |
| Entrada sem foto | placeholder neutro (sem texto) | "Sem foto" / "Foto não disponível" |
| Confiança da IA | borda colorida + `aria-label` acessível | percentual visível em texto (ex.: "85%") |

---

## Component Patterns

| Componente | Uso | Regras comportamentais |
|---|---|---|
| **Tab bar** | Navegação principal entre as 5 abas | Sticky no topo, `z-index: 2`, fundo `--bg`. Exatamente 5 abas visíveis. Aba ativa marcada com `active`. Auditoria nunca aparece aqui. |
| **Segmented control** | Seleção de período no Painel; seleção de vista (Parede / Timeline) no Painel; filtro de tags na Revisão | Sempre renderiza todas as opções. Seleção única. Nenhuma opção pode ficar desmarcada (sempre há uma ativa). |
| **Date picker** | Seleção de data na Revisão; datas início/fim no período personalizado do Painel | Padrão: data atual no fuso America/Sao_Paulo. Sem datas futuras. |
| **Sort toggle** | Ordenação das entradas na Revisão (mais recente / mais antiga) | Estado persiste enquanto a aba Revisão está montada. Ícone indica direção atual. |
| **Search bar** | Busca de entradas na Revisão | Ativa com ≥ 2 caracteres, debounced 300ms. Enquanto ativa, o filtro por tag é ocultado. Limpar o campo retorna ao estado padrão. |
| **Mini-resumo** | Barra compacta no topo da lista da Revisão | Máx. 48px de altura. Esquerda: macros totais do dia. Direita: 7 pontos de histórico. Não gera chamada de API extra para os macros (usa dados já carregados). Os 7 pontos fazem 7 chamadas paralelas a `GET /entries?date=`. |
| **Ponto de histórico (dot)** | 7 pontos no mini-resumo | Estados: vazio/cinza = sem entradas; preenchido `--accent` = tem entradas; preenchido `--warning` = tem entradas pendentes de revisão. Cada ponto navega para aquele dia na Revisão ao ser tocado. |
| **Entry card** | Exibição de uma entrada na Revisão | Ver seção "State Patterns". Foto à esquerda (`flex: 0 0 200px` em >480px). Borda esquerda colorida indica confiança da IA. |
| **Overlay modal (Parede de Fotos)** | Expansão de célula da Parede de Fotos ao tocar | Backdrop full-screen escuro. Sheet centralizado, max 480px de largura. Conteúdo: foto ampliada, título + hora da entrada, macros, lista de alimentos. Fecha ao tocar no backdrop ou no botão de fechar. |
| **Célula da Parede de Fotos** | Grade do Painel, vista Parede | `aspect-ratio: 1`, `object-fit: cover`. Overlay escuro com hora (canto superior direito) e kcal (canto inferior esquerdo), texto branco. Entradas sem foto: placeholder neutro com mesmo overlay. |
| **Item de Timeline** | Lista do Painel, vista Timeline | Thumbnail 64×64px à esquerda. Hora + título + macros à direita. Tag de contexto como pill colorido ao lado do título, se disponível. |
| **Separador de dia (Timeline)** | Agrupamento por dia na vista Timeline | Label "Seg 23/06" com hairline divider. Inserido antes do primeiro item de cada novo dia. |
| **Formulário de correção inline** | Estado "Editing" do entry card | Substitui a lista de alimentos no corpo do card. Campos: description + quantity por item de alimento; textarea para nota livre; botão primário "Re-analisar"; link "Cancelar". |
| **Botão primário** | CTAs principais: "Aceitar", "Re-analisar", "Novo registro" | Background `--accent`. Ver `{DESIGN.md}` para dimensões. |
| **Botão link** | Ações secundárias: "Corrigir", "Cancelar" | Sem background; cor `--muted` com hover em `--text`. |
| **Botão destrutivo** | "Excluir" | Sem background; cor `--danger` como texto. Nunca usa `--danger` como background. |
| **Tag pill** | Exibição de tag de contexto em cards e Timeline | Background da cor da tag; texto calculado (`textOn(hex)`) para contraste. `border-radius: var(--radius-pill)`. |
| **Placeholder de foto** | Entradas sem foto, em todos os contextos | Dimensões idênticas à foto que substituiria. Ícone neutro centralizado, sem texto. |

---

## State Patterns

| Estado | Surface | Tratamento |
|---|---|---|
| **Pendente de revisão** (`reviewed: false`) | Entry card (Revisão) | Borda esquerda colorida (cor mapeada por `confClass`). Botão "Aceitar" primário visível. Botões "Corrigir" e "Excluir" visíveis. |
| **Revisado** (`reviewed: true`) | Entry card (Revisão) | Ícone ✓ sobreposto ao canto superior esquerdo da foto (posição absoluta, sem impacto de layout). Foto com mesma luminosidade que card pendente (sem `opacity: 0.65`). "Aceitar" substituído por "✓ Revisado" (texto estático, sem ação). "Corrigir" e "Excluir" permanecem. |
| **Editando** | Entry card (Revisão) | Lista de alimentos substituída pelo formulário de correção inline. Demais elementos do card permanecem visíveis. |
| **Sem alimentos identificados** | Entry card (Revisão) | Texto "IA não identificou alimentos." em `--danger`. Botões de ação normais. |
| **Sem foto** | Entry card (Revisão), Parede de Fotos, Timeline | Placeholder neutro com mesmas dimensões. Nunca omitido. |
| **Sem entradas no dia** | Aba Revisão | Texto "Nenhuma entrada neste dia." centralizado na área de lista. |
| **Filtro sem resultado** | Aba Revisão (filtro de tag ativo) | Texto "Nenhuma entrada para este filtro." centralizado na área de lista. |
| **Busca ativa** | Aba Revisão | Filtro de tag oculto. Resultados filtrados por query. Ao limpar query, filtro de tag volta a ser exibido. |
| **Modo busca inativo** (< 2 chars) | Aba Revisão | Filtro de tag segmented control visível (se existirem tags). |
| **Painel — carregando** | Aba Painel | Cada célula da grade ou item de timeline renderiza em estado de loading até a resposta da API chegar. |
| **Ponto de histórico — carregando** | Mini-resumo | Ponto exibido em estado neutro/esqueleto até a resposta do dia correspondente chegar. Cada ponto resolve de forma independente. |
| **Vista Compartilhada — sem foto, dias com entrada** | Calendário da PublicShare | Ponto de 8px em `--accent` no centro da célula, em vez de célula vazia. |
| **Erro de autenticação** | Qualquer aba | Banner de erro; opção de re-login. |

---

## Interaction Primitives

- **Tap/clique em aba:** troca a aba ativa imediatamente, sem animação de transição de página.
- **Tap em ponto de histórico:** navega para aquele dia na Revisão (altera o `date` state).
- **Tap em célula da Parede de Fotos:** abre o overlay modal com foto ampliada + detalhes da entrada.
- **Tap no backdrop do modal:** fecha o modal.
- **Tap em "Aceitar":** aceita a entrada; o card transita para estado "Revisado" sem recarregar a lista.
- **Tap em "Corrigir":** o card entra no estado "Editando" inline.
- **Tap em "Cancelar" (edição):** descarta o formulário inline e volta ao estado anterior do card.
- **Tap em "Re-analisar":** envia a correção e aguarda; o card mostra estado de loading durante a chamada.
- **Tap em "Excluir":** remove a entrada da lista imediatamente (optimistic UI ou confirmação, a decidir na implementação).
- **Tap em separador de dia (Timeline):** nenhuma ação — é elemento visual, não interativo.
- **Scroll na Parede de Fotos e na Timeline:** scroll nativo, sem paginação, sem carregamento incremental.
- **Debounce na busca:** 300ms a partir do último caractere digitado antes de filtrar.
- **Seleção de período personalizado:** dois date pickers (início e fim); máx. 90 dias entre eles.

**Proibido:**
- Nenhuma chamada à IA ao abrir a aba Painel.
- Nenhuma chamada de API extra para calcular macros do mini-resumo (usa `dayTotals()` com dados já carregados).
- Nenhum percentual de confiança exibido como texto visível no estado padrão do card.
- Nenhuma redução de `opacity` para indicar estado revisado.
- Drag-to-reorder ou gestos de swipe não são implementados.

---

## Accessibility Floor

- Borda esquerda colorida do card (confiança da IA) expõe o valor numérico via `aria-label` ou atributo `title` no elemento de borda — usuários de leitores de tela acessam a informação sem depender da cor.
- Todo botão de ação tem label de texto legível (não apenas ícone); ícones decorativos recebem `aria-hidden="true"`.
- O ícone ✓ sobreposto à foto do card revisado é decorativo (`aria-hidden="true"`); o estado "revisado" é comunicado pelo texto "✓ Revisado" no corpo do card.
- Pontos de histórico no mini-resumo têm `aria-label` descrevendo o dia e o estado (ex.: "Segunda-feira 23/06: 3 entradas, 1 pendente").
- Células da Parede de Fotos têm `alt` descritivo na imagem (hora + título da entrada).
- Placeholder de foto tem `role="img"` e `aria-label="Sem foto"`.
- Contraste mínimo e tamanhos de fonte definidos em `{DESIGN.md}`.
- Foco via teclado segue ordem de leitura natural (tab bar → controles → lista).
- Modal da Parede de Fotos captura o foco (focus trap) enquanto aberto; `Escape` fecha o modal.

---

## Responsive & Platform

| Breakpoint | Comportamento |
|---|---|
| **≤ 480px** (mobile) | Cards em layout empilhado (foto em cima, corpo embaixo). Foto da Revisão: largura 100%, altura 140px (placeholder) ou auto (foto real). Parede de Fotos: 2 colunas. Tab bar: todas as 5 abas visíveis; labels curtos se necessário. |
| **481–1023px** (tablet/desktop médio) | Cards em layout horizontal: foto `flex: 0 0 200px` à esquerda. Parede de Fotos: 3 colunas. |
| **≥ 1024px** (desktop grande) | Cards: mesma estrutura de 481–1023px. Parede de Fotos: 4 colunas. Shell max-width 720px, centralizado. |

**Outros comportamentos responsivos:**
- Tab bar: sticky no topo em todos os breakpoints.
- Mini-resumo: layout flex, wrapping permitido — nunca ultrapassa 48px de altura em mobile (macros em linha única, dots em linha única).
- Modal da Parede de Fotos: max-width 480px, centralizado com backdrop full-screen em todos os breakpoints.
- Timeline: lista única em todos os breakpoints; thumbnail 64×64px fixo.
- Imagens da Parede de Fotos: todas com `loading="lazy"`.
- Vista Compartilhada (PublicShare): células do calendário `min-height: 72px` em viewport ≥ 760px; thumbnail 24×24px.

---

## Key Flows

### UJ-1 — Hugo verifica o padrão da semana antes de sair de casa

**Persona:** Hugo, usuário único do app, celular, 8h da manhã.

1. Abre o app. A aba Revisão é exibida com as entradas de hoje.
2. O mini-resumo aparece abaixo dos controles: lado esquerdo mostra os macros totais do dia (calculados de `dayTotals(entries)`, sem chamada extra); lado direito mostra 7 pontos dos dias anteriores, cada um resolvendo de forma independente conforme as respostas chegam.
3. Hugo lê os macros de hoje no mini-resumo em menos de 2 segundos — sem abrir nenhum card.
4. Toca na aba **Painel**. Nenhuma chamada à IA é feita.
5. O Painel abre na vista **Parede de Fotos**, período padrão de 7 dias.
6. A grade exibe 2 colunas (mobile). Cada célula mostra a foto em `object-fit: cover` com overlay: hora no canto superior direito, kcal no canto inferior esquerdo.
7. Hugo rola a grade. Entradas sem foto aparecem como placeholder neutro com os mesmos metadados — não são omitidas.
8. **Clímax:** Hugo identifica que os jantares de terça e quinta têm o kcal mais alto — padrão visual imediato, em menos de 30 segundos, sem IA, sem navegar entre dias.
9. Toca em uma célula de terça. O modal abre: foto ampliada, título, hora, macros e lista de alimentos.
10. Fecha o modal tocando no backdrop.
11. Volta para a aba **Revisão** para checar as entradas de hoje.

**Edge case:** se o período não tiver nenhuma foto, a Parede exibe somente placeholders com hora e kcal. A experiência de identificação de padrões via metadados ainda funciona.

---

### UJ-2 — Nutricionista analisa o histórico no link compartilhado

**Persona:** Nutricionista, desktop, recebe o link antes da consulta, sem autenticação Bearer.

1. Abre a URL do link compartilhado no navegador.
2. A Vista Compartilhada renderiza o período padrão no modo Calendário.
3. As células do calendário têm `min-height: 72px`; dias com entradas e foto exibem thumbnail 24×24px; dias com entradas mas sem foto exibem ponto de 8px em `--accent`.
4. O nutricionista muda para a vista **Lista** (segmented control). Cada entrada exibe foto, hora, alimentos identificados e macros.
5. O nutricionista muda para a vista **Padrões** (análise IA). O resumo do período gerado pela IA é exibido.
6. **Clímax:** o nutricionista entende os hábitos alimentares do paciente — horários, tipos de alimento, variações de macros — sem precisar pedir dados adicionais, usando o histórico completo do link compartilhado como base para a consulta.
