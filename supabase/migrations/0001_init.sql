-- ⚠ NIEAKTUALNE / SUPERSEDED — do not run. Use supabase/hotel-tables.sql instead.
-- This file uses uuid keys and Supabase Auth profiles; the app has text ids ("room-101", "bk-6")
-- and its own users, so these tables could not hold the hotel's data. Kept only for reference.

-- Hotel L'Ancora — production schema for PostgreSQL / Supabase.
-- The demo runs on a local JSON store with the same shapes (src/lib/types.ts).
-- Key guarantee: the EXCLUDE constraint makes double bookings impossible at database level.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ── staff profiles (linked to Supabase Auth) ───────────────────────────────
create type staff_role as enum ('admin', 'staff');
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role staff_role not null default 'staff',
  created_at timestamptz not null default now()
);

create or replace function is_staff() returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;
create or replace function is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ── rooms ──────────────────────────────────────────────────────────────────
create type floor_key as enum ('terra', 'superiore', 'inferiore');
create type room_status as enum ('available', 'unavailable', 'draft');
create type room_type as enum ('singola', 'doppia', 'matrimoniale', 'tripla', 'family', 'suite');

create table rooms (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  slug text not null unique,
  name text not null,
  type room_type not null,
  max_guests int not null check (max_guests between 1 and 10),
  beds text not null default '',
  beds_count int not null default 1,
  size_m2 numeric(6,1),
  floor floor_key not null default 'terra',
  base_price numeric(10,2) not null check (base_price > 0),
  status room_status not null default 'draft',
  hidden boolean not null default false,
  amenities text[] not null default '{}',
  title text not null default '',
  short_text text not null default '',
  description text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table room_photos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  storage_path text not null,          -- Supabase Storage bucket "room-photos"
  alt text not null default '',
  width int not null,
  height int not null,
  position int not null default 0,
  is_demo boolean not null default false
);

create type translation_status as enum ('da_tradurre', 'da_verificare', 'tradotto');
create table room_translations (
  room_id uuid not null references rooms (id) on delete cascade,
  locale text not null check (locale in ('en', 'pl', 'de', 'fr', 'es')),
  title text not null default '',
  short_text text not null default '',
  description text not null default '',
  status translation_status not null default 'da_tradurre',
  manual boolean not null default false,
  published_title text,
  published_short text,
  published_description text,
  updated_at timestamptz not null default now(),
  primary key (room_id, locale)
);

-- ── pricing ────────────────────────────────────────────────────────────────
create table rate_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  stay daterange not null,               -- [from, to)
  room_ids uuid[],                       -- null = all rooms
  mode text not null check (mode in ('fixed', 'percent')),
  value numeric(10,2) not null,
  created_at timestamptz not null default now()
);

-- ── bookings & blocks ──────────────────────────────────────────────────────
create type booking_status as enum ('confirmed', 'pending_payment', 'cancelled');
create type booking_source as enum ('sito', 'telefono', 'email', 'walkin', 'booking', 'expedia', 'altro_ota');

create table bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  token text not null unique default encode(gen_random_bytes(24), 'base64'),
  room_id uuid references rooms (id),     -- null = "da assegnare" (OTA)
  stay daterange not null check (lower(stay) < upper(stay)),  -- check-in night included, check-out excluded
  first_name text not null, last_name text not null, email text not null, phone text not null default '',
  adults int not null check (adults >= 1), children int not null default 0, children_ages int[] not null default '{}',
  total numeric(10,2) not null, discount numeric(10,2) not null default 0, promo_code text,
  amount_paid numeric(10,2) not null default 0,
  status booking_status not null,
  hold_expires_at timestamptz,
  source booking_source not null,
  ota_ref text,
  special_requests text not null default '', notes text not null default '',
  consent_privacy boolean not null, consent_terms boolean not null, consent_marketing boolean not null default false,
  simulated boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), cancelled_at timestamptz,
  -- no two active stays of the same room may overlap (half-open ranges: departure day stays free)
  constraint no_double_booking exclude using gist (room_id with =, stay with &&) where (status <> 'cancelled' and room_id is not null)
);
create index bookings_stay_idx on bookings using gist (stay);
-- Expired payment holds are released by a scheduled job: update bookings set status='cancelled' where status='pending_payment' and hold_expires_at < now();

create table room_blocks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  period daterange not null,
  reason text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint no_overlapping_blocks exclude using gist (room_id with =, period with &&)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id),
  amount numeric(10,2) not null,
  kind text not null check (kind in ('deposit', 'full', 'balance', 'refund')),
  provider text not null,
  status text not null,
  reference text unique,                  -- Stripe payment_intent: idempotent webhooks
  created_at timestamptz not null default now()
);

-- ── communication, automation, audit ───────────────────────────────────────
create table outbox (id uuid primary key default gen_random_uuid(), to_email text not null, subject text not null, template text not null, html text not null, text_body text not null, booking_id uuid references bookings (id), status text not null, error text, created_at timestamptz not null default now(), sent_at timestamptz);
create table notifications (id uuid primary key default gen_random_uuid(), type text not null, title text not null, body text not null, href text, read boolean not null default false, telegram text not null, created_at timestamptz not null default now());
create table audit_log (id bigserial primary key, at timestamptz not null default now(), actor text not null, action text not null, entity text not null, entity_id text, details text not null);
create table telegram_links (chat_id text primary key, user_id uuid not null references profiles (id) on delete cascade, name text not null, linked_at timestamptz not null default now());
create table pending_actions (id uuid primary key default gen_random_uuid(), channel text not null, chat_id text, user_id uuid not null references profiles (id), tool text not null, args jsonb not null, summary text not null, created_at timestamptz not null default now(), expires_at timestamptz not null);
create table promotions (id uuid primary key default gen_random_uuid(), code text not null unique, description text not null, percent numeric(5,2) not null check (percent between 1 and 60), valid daterange not null, min_nights int not null default 1, active boolean not null default true);
create table feedback (id uuid primary key default gen_random_uuid(), booking_id uuid references bookings (id), name text not null, rating int not null check (rating between 1 and 5), comment text not null, lang text not null, publish_consent boolean not null, show_on_site boolean not null default false, created_at timestamptz not null default now(), check (not show_on_site or publish_consent));
create table guest_messages (id uuid primary key default gen_random_uuid(), booking_id uuid references bookings (id), name text not null, email text not null, subject text not null, body text not null, source text not null, read boolean not null default false, created_at timestamptz not null default now());
create table settings (id int primary key default 1 check (id = 1), data jsonb not null);
create table channel_state (id int primary key default 1 check (id = 1), data jsonb not null);

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table rooms enable row level security;
alter table room_photos enable row level security;
alter table room_translations enable row level security;
alter table rate_periods enable row level security;
alter table bookings enable row level security;
alter table room_blocks enable row level security;
alter table payments enable row level security;
alter table outbox enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
alter table telegram_links enable row level security;
alter table pending_actions enable row level security;
alter table promotions enable row level security;
alter table feedback enable row level security;
alter table guest_messages enable row level security;
alter table settings enable row level security;
alter table channel_state enable row level security;

-- public website: only published rooms and their published content
create policy "public rooms" on rooms for select using (status <> 'draft' and not hidden);
create policy "public photos" on room_photos for select using (exists (select 1 from rooms r where r.id = room_id and r.status <> 'draft' and not r.hidden));
create policy "public translations" on room_translations for select using (published_title is not null);
create policy "public prices" on rate_periods for select using (true);
create policy "public reviews" on feedback for select using (show_on_site);

-- staff: everything operational; admin-only for money, settings and audit
create policy "staff rooms" on rooms for all using (is_staff()) with check (is_staff());
create policy "staff photos" on room_photos for all using (is_staff()) with check (is_staff());
create policy "staff translations" on room_translations for all using (is_staff()) with check (is_staff());
create policy "admin prices" on rate_periods for all using (is_admin()) with check (is_admin());
create policy "staff bookings" on bookings for all using (is_staff()) with check (is_staff());
create policy "staff blocks" on room_blocks for all using (is_staff()) with check (is_staff());
create policy "admin payments" on payments for all using (is_admin()) with check (is_admin());
create policy "staff outbox" on outbox for select using (is_staff());
create policy "staff notifications" on notifications for all using (is_staff());
create policy "admin audit" on audit_log for select using (is_admin());
create policy "admin telegram" on telegram_links for all using (is_admin());
create policy "own pending" on pending_actions for all using (user_id = auth.uid());
create policy "admin promotions" on promotions for all using (is_admin());
create policy "staff feedback" on feedback for all using (is_staff());
create policy "staff messages" on guest_messages for all using (is_staff());
create policy "admin settings" on settings for all using (is_admin());
create policy "admin channel" on channel_state for all using (is_admin());
-- Guest-facing writes (website bookings, contact form, guest area) go through server routes with
-- the service role key after validation + rate limiting; anonymous clients never write directly.

-- Realtime: publish tables the panel listens to (replaces the demo's version polling)
alter publication supabase_realtime add table bookings, room_blocks, rooms, notifications;
