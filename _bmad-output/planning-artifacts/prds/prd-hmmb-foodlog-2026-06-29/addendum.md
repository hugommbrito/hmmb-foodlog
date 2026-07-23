# Addendum — Decisões de Design e Contexto Técnico

## Direção Visual: Teal Health-Minimal

### Racional
- **Por que teal (`#0d9488`):** O verde atual (`#16a34a`) já está em uso no badge de confiança e em estados de sucesso. Teal oferece diferenciação, é associado a saúde/wellness (Oura, Loop Health), e tem contraste adequado em fundos quentes. Alternativa considerada: manter o verde existente e apenas refinar tipografia — rejeitado porque não resolve a ausência de identidade visual.
- **Fundo quente (`#fafaf9` vs. atual `#f6f7f9`):** A micro-diferença remove o tom azulado do cinza frio atual, tornando a interface menos clínica e mais pessoal.
- **Shadow em vez de border:** `box-shadow: 0 1px 3px rgba(0,0,0,0.07)` nos cards substitui a borda sólida atual, dando profundidade sem poluição visual. A borda pode ser mantida como fallback para telas com contraste alto.

### Tokens CSS propostos (referência para implementação)
```css
--accent:       #0d9488;
--accent-light: #ccfbf1;
--bg:           #fafaf9;
--card:         #ffffff;
--text:         #1c1f24;
--muted:        #6b7280;
--border:       #e5e7eb;
--success:      #16a34a;
--warning:      #f59e0b;
--danger:       #dc2626;
--neutral:      #9ca3af;
--radius-card:  12px;
--radius-pill:  999px;
--shadow-card:  0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.06);
```

---

## Estratégia de Dados para o Painel (FR-8 a FR-10)

O Painel precisa de entradas de múltiplos dias. O único endpoint relevante hoje é `GET /entries?date=YYYY-MM-DD`, que retorna as entradas de um dia com foods agregados.

**Estratégia MVP:** `Promise.all` de N requests paralelos ao abrir o Painel (ex.: 7 requests para 7d, 14 para 14d). Cada response é pequena (poucas entradas/dia). Aceitável dado o volume.

**Estratégia v2 (se performance degradar):** endpoint de range `GET /entries?from=&to=` retornando o período inteiro em uma query. Isso requereria alteração de backend — exceção documentada ao princípio "sem backend changes".

---

## Decisão sobre Biblioteca de Charts (FR-11)

FR-11 está fora do MVP. Quando implementado em v2, avaliar:
- **SVG puro** (zero deps): prefere-se para um gráfico de barras simples; complexidade está na escala do eixo Y e no tooltip.
- **Recharts** (~150kb gzip): mais popular no ecossistema React; pode ser excessivo para um gráfico.
- **Tremor** (~80kb): design-first, componentes React prontos; boa opção se a complexidade de charts crescer.

Decisão atual: SVG puro no MVP de FR-11. Rever se mais tipos de gráfico forem adicionados.

---

## Comportamento de Clique na Parede de Fotos (Q1 aberta)

Duas opções:

| Opção | Experiência | Complexidade |
|---|---|---|
| Overlay com foto ampliada + alimentos + macros | Fluida; mantém o usuário no Painel | Requer componente de modal/dialog |
| Navegar para Revisão no dia correspondente | Simples; reutiliza tela existente | Muda o contexto; o usuário perde a posição no Painel |

Recomendação: overlay. O usuário está em modo de análise no Painel; sair para a Revisão quebra o contexto. O componente de modal é reutilizável e simples dado que os dados já estão em memória.
