-- Optional Supabase migration (for production deploy).
-- Local MVP uses .data/db.json — no Postgres required to run.

create extension if not exists vector;

create table if not exists users (
  id uuid primary key,
  email text unique not null,
  name text,
  created_at timestamptz default now()
);

create table if not exists model_weights (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,
  weights jsonb not null,
  trained_on_review_count int default 0,
  held_out_log_loss float,
  trained_at timestamptz default now()
);

create table if not exists materials (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,
  title text not null,
  status text not null,
  storage_path text,
  created_at timestamptz default now()
);

create table if not exists chunks (
  id uuid primary key,
  material_id uuid references materials(id) on delete cascade,
  content text not null,
  embedding vector(384)
);

create table if not exists concepts (
  id uuid primary key,
  material_id uuid references materials(id) on delete cascade,
  title text not null,
  definition text,
  recall_probability float default 0.5,
  half_life_days float default 3,
  correct_streak int default 0,
  incorrect_count int default 0,
  last_reviewed_at timestamptz
);

create table if not exists cards (
  id uuid primary key,
  concept_id uuid references concepts(id) on delete cascade,
  front text not null,
  back text not null
);

create table if not exists reviews (
  id uuid primary key,
  card_id uuid references cards(id) on delete cascade,
  correct boolean not null,
  days_since_last_review float,
  reviewed_at timestamptz default now()
);
