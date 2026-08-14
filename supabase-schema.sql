-- =========================================================
-- Disturbio Records — Esquema de base de datos (Supabase)
-- Ejecutar completo en: Supabase Dashboard > SQL Editor
-- =========================================================

-- Extensión para generar UUIDs
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- Tabla: eventos
-- ---------------------------------------------------------
create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha text not null,
  lugar text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Tabla: entradas (cada fila = una compra/reserva recibida por mail)
-- ---------------------------------------------------------
create table if not exists public.entradas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  titular text not null,
  email text not null,
  cantidad int not null check (cantidad >= 1),
  asistentes jsonb not null default '[]'::jsonb, -- array de nombres
  comprobante_path text, -- path dentro del bucket "comprobantes"
  estado text not null default 'pendiente' check (estado in ('pendiente','enviado')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Tabla: tickets (un ticket = un QR = un asistente)
-- ---------------------------------------------------------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  entrada_id uuid not null references public.entradas(id) on delete cascade,
  evento_id uuid not null references public.eventos(id) on delete cascade,
  nombre text not null,
  codigo text not null unique,
  escaneado boolean not null default false,
  escaneado_por text,
  escaneado_en timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Tabla: staff_roles (vincula usuarios de Supabase Auth a un rol)
-- rol: 'puerta' (staff que escanea) | 'maestro' (cuenta admin del sello)
-- ---------------------------------------------------------
create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  rol text not null check (rol in ('puerta','maestro')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Índices útiles
-- ---------------------------------------------------------
create index if not exists idx_entradas_evento on public.entradas(evento_id);
create index if not exists idx_tickets_evento on public.tickets(evento_id);
create index if not exists idx_tickets_codigo on public.tickets(codigo);

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table public.eventos enable row level security;
alter table public.entradas enable row level security;
alter table public.tickets enable row level security;
alter table public.staff_roles enable row level security;

-- --- eventos ---
-- Cualquiera (incluso el sitio público, sin login) puede LEER eventos activos
create policy "eventos_select_publico"
  on public.eventos for select
  using (activo = true);

-- Solo staff autenticado (cualquier rol) puede leer todos los eventos
create policy "eventos_select_staff"
  on public.eventos for select
  to authenticated
  using (exists (select 1 from public.staff_roles where user_id = auth.uid()));

-- Solo la cuenta maestra puede crear/editar eventos
create policy "eventos_insert_maestro"
  on public.eventos for insert
  to authenticated
  with check (exists (select 1 from public.staff_roles where user_id = auth.uid() and rol = 'maestro'));

create policy "eventos_update_maestro"
  on public.eventos for update
  to authenticated
  using (exists (select 1 from public.staff_roles where user_id = auth.uid() and rol = 'maestro'));

-- --- entradas ---
-- El público (sin login) SOLO puede insertar (comprar entrada), nunca leer ni actualizar
create policy "entradas_insert_publico"
  on public.entradas for insert
  to anon
  with check (true);

-- Solo la cuenta maestra puede leer/actualizar entradas (privacidad de compradores)
create policy "entradas_select_maestro"
  on public.entradas for select
  to authenticated
  using (exists (select 1 from public.staff_roles where user_id = auth.uid() and rol = 'maestro'));

create policy "entradas_update_maestro"
  on public.entradas for update
  to authenticated
  using (exists (select 1 from public.staff_roles where user_id = auth.uid() and rol = 'maestro'));

-- --- tickets ---
-- Staff de puerta y maestro pueden leer tickets (para escanear y ver listados)
create policy "tickets_select_staff"
  on public.tickets for select
  to authenticated
  using (exists (select 1 from public.staff_roles where user_id = auth.uid()));

-- Staff de puerta y maestro pueden marcar como escaneado
create policy "tickets_update_staff"
  on public.tickets for update
  to authenticated
  using (exists (select 1 from public.staff_roles where user_id = auth.uid()));

-- Los tickets se insertan solo desde la Edge Function (service role), no desde el cliente
-- (no se crea policy de insert para authenticated/anon a propósito)

-- --- staff_roles ---
-- Cada usuario puede leer su propio rol (para saber si es puerta o maestro al loguearse)
create policy "staff_roles_select_propio"
  on public.staff_roles for select
  to authenticated
  using (user_id = auth.uid());

-- =========================================================
-- STORAGE: bucket privado para comprobantes de transferencia
-- =========================================================
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- El público puede SUBIR comprobantes (pero no listar ni leer)
create policy "comprobantes_insert_publico"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'comprobantes');

-- Solo la cuenta maestra puede leer/descargar comprobantes
create policy "comprobantes_select_maestro"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'comprobantes'
    and exists (select 1 from public.staff_roles where user_id = auth.uid() and rol = 'maestro')
  );

-- =========================================================
-- Datos de ejemplo (opcional — borrar en producción)
-- =========================================================
-- insert into public.eventos (nombre, fecha, lugar) values
--   ('Disturbios en la Noche — Vol. VI', '10 y 11 de Sept', 'Groove, CABA');
