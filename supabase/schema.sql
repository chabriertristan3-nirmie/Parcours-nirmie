-- Tables du générateur NirmieRoute.
--
-- À exécuter une fois dans l'éditeur SQL de Supabase (Dashboard > SQL Editor).
-- Tables volontairement séparées de celles de l'application : le générateur
-- écrit ici, l'app Nirmie lit (ou copie) ce dont elle a besoin.

create table if not exists public.generator_packs (
  id          text primary key,
  city        text not null,
  route_count integer not null default 0,
  config      jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.generator_routes (
  id              text primary key,
  pack_id         text references public.generator_packs (id) on delete cascade,
  city            text not null,
  title           text not null,
  theme           text,
  travel_mode     text not null default 'walk' check (travel_mode in ('walk', 'bike')),
  intro           text,
  distance_km     numeric,
  walking_minutes integer,
  visit_minutes   integer,
  total_minutes   integer,
  stops_count     integer,
  is_loop         boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists public.generator_steps (
  id                   text primary key,
  route_id             text not null references public.generator_routes (id) on delete cascade,
  poi_id               text not null,
  step_number          integer not null,
  name                 text not null,
  subtype              text,
  theme                text,
  lat                  double precision not null,
  lng                  double precision not null,
  address              text,
  notoriety            integer,
  visit_minutes        integer,
  distance_from_prev_m integer,
  description          text,
  anecdote             text,
  wikidata             text,
  wikipedia            text,
  website              text,
  source               text
);

create index if not exists generator_routes_city_idx on public.generator_routes (city);
create index if not exists generator_steps_route_idx on public.generator_steps (route_id);
create index if not exists generator_steps_poi_idx on public.generator_steps (poi_id);

-- Sécurité d'accès (RLS).
-- Le générateur écrit avec la clé anon : on n'autorise que l'insertion et la
-- mise à jour sur ces trois tables, rien d'autre. Durcissez (rôle authenticated,
-- politique par utilisateur…) si l'outil sort du cadre interne.
alter table public.generator_packs enable row level security;
alter table public.generator_routes enable row level security;
alter table public.generator_steps enable row level security;

drop policy if exists generator_packs_write on public.generator_packs;
create policy generator_packs_write on public.generator_packs
  for all using (true) with check (true);

drop policy if exists generator_routes_write on public.generator_routes;
create policy generator_routes_write on public.generator_routes
  for all using (true) with check (true);

drop policy if exists generator_steps_write on public.generator_steps;
create policy generator_steps_write on public.generator_steps
  for all using (true) with check (true);
