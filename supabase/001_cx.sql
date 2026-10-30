-- Connections: the two tables the live game uses. Run once in the Supabase SQL
-- editor (or let a server admin apply it). The game works without them: the
-- model setting then falls back to DEFAULT_MODEL and nothing is cached.

-- Settings an admin can change from /admin.html (today: which model writes puzzles).
create table if not exists cx_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Every puzzle the model wrote, so the next visitor to pick the same paper on the
-- same day (or the same study topic) plays a saved one instead of paying for a
-- new call. mode is 'news' or 'study'; key is "paper:YYYY-MM-DD" or the topic.
create table if not exists cx_puzzles (
  id         uuid primary key default gen_random_uuid(),
  mode       text not null check (mode in ('news', 'study')),
  key        text not null,
  model      text not null,
  cost_usd   numeric,
  puzzle     jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cx_puzzles_lookup on cx_puzzles (mode, key, created_at desc);
create index if not exists cx_puzzles_day on cx_puzzles (created_at desc);

-- No public access: only the service role key, which lives on the server.
alter table cx_settings enable row level security;
alter table cx_puzzles  enable row level security;
