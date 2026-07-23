# FoodLog — Web app de revisão diária (CAP-3)

SPA React + Vite para revisar e aceitar as entradas alimentares do dia. Consome a API REST do backend Fastify, autenticando via `api_token` (Bearer).

## Rodar

```bash
cd web
npm install
cp .env.example .env   # ajuste VITE_API_BASE_URL se o backend não estiver em localhost:3000
npm run dev            # http://localhost:5173
```

O backend precisa estar rodando (`npm run dev` na raiz) e permitir a origem do web app no CORS — defina `WEB_APP_ORIGIN=http://localhost:5173` no `.env` da raiz, ou deixe ausente para refletir qualquer origem.

## Uso

1. Cole o `api_token` (mesmo token do endpoint de captura) no gate inicial — fica salvo no `localStorage`.
2. A tela mostra as entradas do dia local (America/Sao_Paulo), com fotos, alimentos/macros da IA e cores por nível de confiança (verde ≥85% / neutro 70–84% / amarelo <70% / vermelho 0%).
3. Toque em **Aceitar** para marcar a entrada como revisada.

## Build

```bash
npm run build   # tsc -b && vite build → dist/
```
