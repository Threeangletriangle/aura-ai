-- ============================================================
-- Aura AI — Migración inicial
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- Extensión UUID
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLA: profiles (extiende auth.users de Supabase)
-- ============================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text unique not null,
  plan_type     text not null default 'free' check (plan_type in ('free', 'creator', 'agency')),
  credits_kits  integer not null default 2,
  credits_videos integer not null default 0,
  stripe_customer_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Trigger: crear perfil automáticamente al registrar usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, plan_type, credits_kits, credits_videos)
  values (
    new.id,
    new.email,
    'free',
    2,   -- 2 kits gratuitos al inicio
    0
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- TABLA: products
-- ============================================================
create table public.products (
  id            bigserial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  name          text not null,
  description   text not null,
  media_urls    jsonb not null default '[]'::jsonb,  -- URLs en Supabase Storage
  created_at    timestamptz not null default now()
);

create index idx_products_user_id on public.products(user_id);

-- ============================================================
-- TABLA: kits
-- ============================================================
create table public.kits (
  id              bigserial primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  product_id      bigint references public.products(id) on delete set null,
  niche           text not null,
  target_audience text not null,
  tone            text not null,
  product_goal    text not null,
  platform_focus  text not null default 'instagram',
  generated_json  jsonb not null default '{}'::jsonb,
  tokens_used     integer,         -- para auditoría de costos
  cost_usd        numeric(8,6),    -- costo real de la llamada a Claude
  created_at      timestamptz not null default now()
);

create index idx_kits_user_id on public.kits(user_id);
create index idx_kits_product_id on public.kits(product_id);

-- ============================================================
-- TABLA: videos
-- ============================================================
create table public.videos (
  id              bigserial primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  avatar_id       text not null,
  script_text     text not null,
  heygen_video_id text,            -- ID del video en HeyGen
  video_url       text,            -- URL final cuando completed
  thumbnail_url   text,
  status          text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_videos_user_id on public.videos(user_id);
create index idx_videos_status on public.videos(status);

-- Trigger: actualizar updated_at en videos
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger videos_updated_at
  before update on public.videos
  for each row execute procedure public.handle_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Cada usuario solo ve sus datos
-- ============================================================

alter table public.profiles  enable row level security;
alter table public.products  enable row level security;
alter table public.kits      enable row level security;
alter table public.videos    enable row level security;

-- profiles
create policy "Usuario ve su propio perfil"
  on public.profiles for select using (auth.uid() = id);

create policy "Usuario actualiza su propio perfil"
  on public.profiles for update using (auth.uid() = id);

-- products
create policy "Usuario ve sus productos"
  on public.products for select using (auth.uid() = user_id);

create policy "Usuario crea productos"
  on public.products for insert with check (auth.uid() = user_id);

create policy "Usuario actualiza sus productos"
  on public.products for update using (auth.uid() = user_id);

create policy "Usuario elimina sus productos"
  on public.products for delete using (auth.uid() = user_id);

-- kits
create policy "Usuario ve sus kits"
  on public.kits for select using (auth.uid() = user_id);

create policy "Usuario crea kits"
  on public.kits for insert with check (auth.uid() = user_id);

-- videos
create policy "Usuario ve sus videos"
  on public.videos for select using (auth.uid() = user_id);

create policy "Usuario crea videos"
  on public.videos for insert with check (auth.uid() = user_id);

-- ============================================================
-- STORAGE: bucket para imágenes de productos
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  false,  -- privado, acceso via signed URLs
  5242880, -- 5MB máx por imagen
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- RLS para storage
create policy "Usuario sube sus propias imágenes"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Usuario ve sus propias imágenes"
  on storage.objects for select
  using (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Usuario elimina sus propias imágenes"
  on storage.objects for delete
  using (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);
