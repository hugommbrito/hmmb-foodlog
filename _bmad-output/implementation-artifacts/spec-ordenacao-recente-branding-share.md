---
title: 'Ordenação recente-primeiro, branding e polimento da página de Share'
type: 'feature'
created: '2026-07-28'
status: 'done'
route: 'one-shot'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** As 4 vistas (Parede de Fotos, Timeline, Calendário, Lista) não tinham um default de ordenação consistente entre a área logada e o link de share — algumas mostravam mais recente primeiro, outras mais antigo primeiro, dependendo da vista. Além disso, o app carecia de identidade de aba/favicon, o header do Share não deixava claro que era a visão do nutricionista, e a aba de análise de padrões de IA se misturava visualmente com as demais vistas sem nenhum aviso sobre sua natureza (IA, sem recomendação clínica).

**Approach:** Padronizar "mais recente → mais antigo" como default em todas as 4 vistas, respeitando as restrições de cada layout (Timeline: só ordem dos dias, pois as entradas são posicionadas por horário real; Calendário: só ordem dos meses, pois é uma grade convencional — mais o popup de dia). Trocar título da aba para "FoodLog" e adicionar favicon SVG. Atualizar o header do Share, renomear e destacar visualmente a aba "Padrões Alimentares", e adicionar um disclaimer fixo no topo dela.

</frozen-after-approval>

## Suggested Review Order

**Ordenação — helper compartilhado**

- Ponto de entrada: helper genérico usado por todas as vistas do Dashboard e do Share para consistência.
  [`App.tsx:131`](../../web/src/App.tsx#L131)

**Ordenação — Dashboard (App.tsx)**

- Timeline: só a ordem dos dias inverte (dia mais recente no topo); entradas continuam posicionadas pelo horário real na régua.
  [`App.tsx:628`](../../web/src/App.tsx#L628)

- Calendário: entradas do dia já chegam ordenadas ao montar o mapa, evitando sort repetido a cada célula renderizada.
  [`App.tsx:746`](../../web/src/App.tsx#L746)

- Calendário: meses em ordem decrescente (mês mais recente no topo), grade de dias dentro do mês inalterada.
  [`App.tsx:754`](../../web/src/App.tsx#L754)

**Ordenação — Share (Share.tsx)**

- Parede de Fotos: lista plana (sem seções de dia) reordenada com o mesmo helper do Dashboard.
  [`Share.tsx:356`](../../web/src/Share.tsx#L356)

- Timeline: ordenação explícita por chave de dia (`localeCompare` decrescente) em vez de depender da ordem de chegada do backend.
  [`Share.tsx:417`](../../web/src/Share.tsx#L417)

- Lista: mesma técnica explícita de ordenação por dia usada na Timeline, substituindo o `.reverse()` que dependia implicitamente da ordem ascendente do backend.
  [`Share.tsx:529`](../../web/src/Share.tsx#L529)

- Calendário: mesma estratégia do Dashboard — meses decrescentes, entradas do dia pré-ordenadas ao montar o mapa.
  [`Share.tsx:284`](../../web/src/Share.tsx#L284)

**Branding e header do Share**

- `<title>` simplificado para "FoodLog" e favicon SVG referenciado — vale para as duas rotas da SPA (Dashboard e Share).
  [`index.html:6`](../../web/index.html#L6)

- Header do Share deixa explícito que é a visão do profissional de saúde.
  [`Share.tsx:126`](../../web/src/Share.tsx#L126)

**Aba "Padrões Alimentares" — destaque e disclaimer**

- Renomeada e destacada com classe própria (`seg-btn-ai`) e ícone decorativo marcado `aria-hidden` para não poluir o nome acessível.
  [`Share.tsx:161`](../../web/src/Share.tsx#L161)

- Estilo do tab de IA: tingimento com `--accent-light` no estado de repouso, para se diferenciar das 4 vistas de dados desde antes de ser clicado.
  [`styles.css:333`](../../web/src/styles.css#L333)

- Disclaimer fixo no topo da aba, presente em todos os estados (carregando/erro/indisponível/ok) para nunca sumir por acidente.
  [`Share.tsx:232`](../../web/src/Share.tsx#L232)

- Estilo do disclaimer, reaproveitando o token de destaque `--accent-light`.
  [`styles.css:487`](../../web/src/styles.css#L487)

