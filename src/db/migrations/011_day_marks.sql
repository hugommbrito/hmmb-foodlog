-- Marcação de dias: o usuário sinaliza um dia local (America/Sao_Paulo) como
-- intencionalmente não preenchido ('skipped') ou preenchido parcialmente
-- ('partial'). Dias marcados ficam FORA da análise de padrões por IA (relatório
-- semanal e link do nutricionista) para que uma lacuna proposital nunca seja
-- lida como jejum/refeição pulada, e aparecem sinalizados no calendário/lista.
-- Ausência de linha = dia normal. Idempotente: db:migrate re-roda cada .sql.
CREATE TABLE IF NOT EXISTS day_marks (
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE        NOT NULL,
  status     TEXT        NOT NULL CHECK (status IN ('skipped', 'partial')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
