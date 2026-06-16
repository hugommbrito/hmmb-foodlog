CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  photos TEXT[] NOT NULL,
  title TEXT,
  context TEXT CHECK (context IN ('casa', 'restaurante', 'trabalho', 'rua')),
  ai_confidence_overall FLOAT DEFAULT 0.0,
  reviewed BOOL DEFAULT false,
  ai_cycles INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_user_id_created_at
  ON entries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS food_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity TEXT,
  kcal FLOAT,
  protein_g FLOAT,
  fat_g FLOAT,
  carbs_g FLOAT,
  confidence FLOAT NOT NULL
);
