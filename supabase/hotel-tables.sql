-- ═══════════════════════════════════════════════════════════════════════════
-- Hotel L'Ancora — tabele w Supabase (jeden plik, można uruchamiać wiele razy)
--
-- JAK UŻYĆ: Supabase → SQL Editor → New query → wklej CAŁY ten plik → Run.
-- Na końcu pojawi się lista 27 tabel; w kolumnie "rls_wlaczone" wszędzie ma być true.
--
-- Co tworzy:
--   · hotel_state        – dotychczasowa kopia całego dokumentu (nadal źródło prawdy)
--   · 26 tabel           – te same dane rozłożone na prawdziwe tabele (src/lib/types.ts → DB),
--                          w tym hotel_list_order: kolejność wierszy na listach dokumentu
--   · bookings_no_overlap – ograniczenie w bazie: dwa aktywne pobyty w tym samym pokoju
--                           nie mogą się nakładać (dzień wyjazdu jest wolny)
--   · hotel_sync()       – jedna transakcja na każdy zapis ze strony
--   · Row Level Security włączone na każdej tabeli, bez żadnej polityki:
--     dane czyta i zapisuje wyłącznie serwer strony (klucz SUPABASE_SECRET_KEY).
--
-- Replaces supabase/migrations/0001_init.sql and 0002_full_model.sql, which no longer match the
-- app: they use uuid keys (the app's ids are text: "room-101", "bk-6", "u-admin") and link staff
-- to Supabase Auth (the app has its own users). Column ↔ field mapping: src/server/db/tables.ts.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ── the whole document, as before (server/db/cloud.ts) ─────────────────────
create table if not exists public.hotel_state (
  id text primary key,
  version bigint not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── which version of the document the tables hold ──────────────────────────
create table if not exists public.hotel_meta (
  id int primary key default 1 check (id = 1),
  schema_version int not null,
  version bigint not null,
  seeded_at timestamptz not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now()
);

-- ── settings: one row, one jsonb column per section of Settings ────────────
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  hotel jsonb not null,
  floors jsonb not null,
  payments jsonb not null,
  pricing jsonb not null,
  stripe_connect jsonb not null,
  notifications jsonb not null,
  services jsonb not null default '[]',
  reviews jsonb not null,
  custom_amenities jsonb not null default '[]',
  faq jsonb not null default '[]',
  demo_mode boolean not null default false,
  panel jsonb,                                        -- the owner's first set-up, times of the Telegram reports
  constraint settings_payments_shape check (
    payments->>'mode' in ('full', 'deposit_percent', 'deposit_fixed')
    and jsonb_typeof(payments->'depositPercent') = 'number'
    and jsonb_typeof(payments->'holdMinutes') = 'number'
    and jsonb_typeof(payments->'cashDiscountPercent') = 'number'
    and jsonb_typeof(payments->'allowCashAtHotel') = 'boolean'
    and jsonb_typeof(payments->'allowOnline') = 'boolean'
  ),
  constraint settings_pricing_shape check (
    pricing->>'board' in ('room_only', 'breakfast')
    and jsonb_typeof(pricing->'singleUsePercent') = 'number'
    and (pricing->>'singleUsePercent')::numeric >= 0
  )
);
alter table public.settings add column if not exists panel jsonb;

-- ── staff (the app's own login, not Supabase Auth) ─────────────────────────
create table if not exists public.staff_users (
  id text primary key,
  email text not null,
  name text not null,
  role text not null check (role in ('admin', 'staff')),
  password_hash text not null,
  created_at timestamptz not null,
  two_factor jsonb                                    -- the code from the phone (see below)
);
-- the second step of the login (a code from an authenticator app): the key is sealed with the
-- site's own secret, the emergency codes are stored only as fingerprints
alter table public.staff_users add column if not exists two_factor jsonb;

-- ── rooms ──────────────────────────────────────────────────────────────────
create table if not exists public.rooms (
  id text primary key,
  number text not null,
  slug text not null,
  name text not null,
  type text not null check (type in ('singola', 'doppia', 'matrimoniale', 'tripla', 'family', 'suite')),
  max_guests int not null check (max_guests between 1 and 10),
  beds text not null default '',
  beds_count int not null default 1,
  bed_config jsonb,                                   -- [{kind:'matrimoniale', count:1}, …] or null (older rooms)
  size_m2 numeric(6,1),
  floor text not null check (floor in ('terra', 'superiore', 'inferiore')),
  base_price numeric(10,2) not null check (base_price >= 0),
  cash_price numeric(10,2) check (cash_price is null or cash_price >= 0),  -- null = global cash discount
  payment text check (payment is null or payment in ('both', 'card', 'cash')),  -- how guests pay this room; null = not set (both)
  number_auto boolean,  -- true = the hotel has no room numbers: the site gave this one (never shown to guests)
  status text not null check (status in ('available', 'unavailable', 'draft')),
  hidden boolean not null default false,
  amenities text[] not null default '{}',
  title text not null default '',                     -- Italian source text
  short_text text not null default '',
  description text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  is_demo boolean not null default false,
  constraint rooms_number_key unique (number) deferrable initially immediate,
  constraint rooms_slug_key unique (slug) deferrable initially immediate
);

-- databases created before the column existed get it here (nothing else changes)
alter table public.rooms add column if not exists payment text check (payment is null or payment in ('both', 'card', 'cash'));
alter table public.rooms add column if not exists number_auto boolean;

create table if not exists public.room_photos (
  room_id text not null references public.rooms (id) on delete cascade deferrable initially immediate,
  id text not null,
  position int not null,
  src text not null,
  alt text not null default '',
  width int not null,
  height int not null,
  is_demo boolean not null default false,
  credit text,
  primary key (room_id, id)
);

create table if not exists public.room_translations (
  room_id text not null references public.rooms (id) on delete cascade deferrable initially immediate,
  locale text not null check (locale in ('en', 'pl', 'de', 'fr', 'es')),
  title text not null default '',
  short_text text not null default '',
  description text not null default '',
  status text not null check (status in ('da_tradurre', 'da_verificare', 'tradotto')),
  manual boolean not null default false,
  updated_at timestamptz not null,
  published jsonb,                                    -- {title, short, description} shown on the site, or null
  primary key (room_id, locale)
);

-- ── prices ─────────────────────────────────────────────────────────────────
create table if not exists public.rate_periods (
  id text primary key,
  label text not null,
  date_from date not null,
  date_to date not null,                              -- exclusive
  room_ids text[],                                    -- null = all rooms
  mode text not null check (mode in ('fixed', 'percent')),
  value numeric(10,2) not null,
  created_at timestamptz not null,
  cash_price numeric(10,2),                           -- the season's own cash price (null = usual cash discount)
  check (date_from < date_to)
);
-- the hotel's price list has its own cash price for each season
alter table public.rate_periods add column if not exists cash_price numeric(10,2);

-- ── bookings ───────────────────────────────────────────────────────────────
create table if not exists public.bookings (
  id text primary key,
  code text not null unique,
  token text not null unique,
  -- no foreign key on purpose: the app lets the owner delete a room that only has past stays
  room_id text,                                       -- null = "da assegnare" (OTA)
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  country text,
  lang text check (lang is null or lang in ('it', 'en', 'pl', 'de', 'fr', 'es')),
  adults int not null check (adults >= 0),
  children int not null default 0 check (children >= 0),
  children_ages int[] not null default '{}',
  check_in date not null,                             -- first occupied night
  check_out date not null,                            -- not an occupied night
  total numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  promo_code text,
  amount_paid numeric(10,2) not null default 0,
  status text not null check (status in ('confirmed', 'pending_payment', 'cancelled')),
  -- true while the stay keeps its room busy: not cancelled and not a payment hold whose time ran out
  -- (isBookingActive in src/lib/availability.ts; written by the app together with every change)
  occupies_room boolean not null,
  hold_expires_at timestamptz,
  source text not null check (source in ('sito', 'telefono', 'email', 'walkin', 'booking', 'expedia', 'altro_ota')),
  ota_ref text,
  special_requests text not null default '',
  notes text not null default '',
  consent_privacy boolean not null,
  consent_terms boolean not null,
  consent_marketing boolean not null default false,
  payment_method text check (payment_method is null or payment_method in ('card', 'cash', 'transfer', 'ota')),
  review_requested_at timestamptz,
  simulated boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  cancelled_at timestamptz,
  card jsonb,                                         -- the guest's card kept with the booking (ids, brand, last 4 digits)
  card_request jsonb,                                 -- the hotel asked for a new card by a deadline
  no_show jsonb,                                      -- the guest did not arrive: fee charged / waived / due
  change_request jsonb,                               -- new dates or free cancellation asked, waiting for the other side
  constraint bookings_stay_order check (check_in < check_out),
  constraint bookings_cancelled_frees_room check (not occupies_room or status <> 'cancelled'),
  -- THE guarantee: two stays that keep the same room busy can never share a night.
  -- Half-open range [check_in, check_out): the next guest may arrive on the departure day.
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (occupies_room and room_id is not null) deferrable initially immediate
);
create index if not exists bookings_room_idx on public.bookings (room_id, check_in);
create index if not exists bookings_checkout_idx on public.bookings (check_out) where status = 'confirmed';
create index if not exists bookings_email_idx on public.bookings (lower(email));
-- the guest's card kept with the booking (payment service ids, brand, last 4 digits: never the number),
-- the hotel's request for a new card, the no-show and the change of dates / free cancellation asked
alter table public.bookings add column if not exists card jsonb;
alter table public.bookings add column if not exists card_request jsonb;
alter table public.bookings add column if not exists no_show jsonb;
alter table public.bookings add column if not exists change_request jsonb;

create table if not exists public.room_blocks (
  id text primary key,
  room_id text not null references public.rooms (id) on delete cascade deferrable initially immediate,
  date_from date not null,
  date_to date not null,                              -- exclusive
  reason text not null default '',
  created_by text not null default '',
  created_at timestamptz not null,
  source text check (source is null or source in ('booking', 'expedia', 'airbnb', 'altro')),  -- portal calendar the nights came from
  ext_uid text,                                       -- "<calendar id>:<event uid>" for synced nights
  check (date_from < date_to)
);
alter table public.room_blocks add column if not exists source text check (source is null or source in ('booking', 'expedia', 'airbnb', 'altro'));
alter table public.room_blocks add column if not exists ext_uid text;
create index if not exists room_blocks_room_idx on public.room_blocks (room_id, date_from);

create table if not exists public.payments (
  id text primary key,
  booking_id text not null references public.bookings (id) deferrable initially immediate,
  amount numeric(10,2) not null,                      -- negative = refund
  kind text not null check (kind in ('deposit', 'full', 'balance', 'refund')),
  provider text not null check (provider in ('stripe', 'stripe_test', 'simulazione', 'contanti', 'bonifico', 'ota', 'pos')),
  status text not null check (status in ('succeeded', 'failed', 'pending')),
  reference text,                                     -- Stripe payment intent / session
  created_at timestamptz not null
);
create index if not exists payments_booking_idx on public.payments (booking_id);
create index if not exists payments_reference_idx on public.payments (reference) where reference is not null;

-- ── emails, notifications, audit ───────────────────────────────────────────
create table if not exists public.outbox (
  id text primary key,
  to_email text not null,
  subject text not null,
  template text not null,
  html text not null,
  text_body text not null,
  booking_id text references public.bookings (id) deferrable initially immediate,
  status text not null check (status in ('demo_outbox', 'sent', 'failed')),
  error text,
  created_at timestamptz not null,
  sent_at timestamptz,
  list_unsubscribe text
);
create index if not exists outbox_created_idx on public.outbox (created_at desc);

create table if not exists public.notifications (
  id text primary key,
  type text not null,
  title text not null,
  body text not null,
  href text,
  read boolean not null default false,
  telegram text not null,
  created_at timestamptz not null
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);

create table if not exists public.audit_log (
  id text primary key,
  at timestamptz not null,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  details text not null default ''
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- ── channel manager and Telegram ───────────────────────────────────────────
create table if not exists public.channel_state (
  id int primary key default 1 check (id = 1),
  provider_name text not null,
  status text not null check (status in ('non_collegato', 'simulazione', 'collegato')),
  last_sync timestamptz,
  imported_count int not null default 0,
  log jsonb not null default '[]',
  mapping jsonb not null default '[]',
  calendars jsonb,                                    -- portal calendars (iCal) linked to rooms
  ical_key text                                       -- secret in the hotel's own calendar links
);
alter table public.channel_state add column if not exists calendars jsonb;
alter table public.channel_state add column if not exists ical_key text;

create table if not exists public.telegram_state (
  id int primary key default 1 check (id = 1),
  link_code jsonb,                                    -- {code, userId, expiresAt} while the owner is linking a chat
  last_test_at timestamptz,
  last_error text
);

create table if not exists public.telegram_links (
  chat_id text primary key,
  user_id text not null references public.staff_users (id) on delete cascade deferrable initially immediate,
  name text not null,
  linked_at timestamptz not null
);

-- ── assistant ──────────────────────────────────────────────────────────────
create table if not exists public.pending_actions (
  id text primary key,
  channel text not null check (channel in ('panel', 'telegram')),
  chat_id text,
  user_id text not null references public.staff_users (id) on delete cascade deferrable initially immediate,
  tool text not null,
  args jsonb not null default '{}',
  summary text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  lang text
);

create table if not exists public.assistant_log (
  id text primary key,
  user_id text not null references public.staff_users (id) on delete cascade deferrable initially immediate,
  channel text not null check (channel in ('panel', 'telegram')),
  role text not null check (role in ('user', 'assistant')),
  body text not null,
  pending_id text,
  resolved boolean,
  engine text,
  voice boolean,
  image text,                                         -- picture sent by the owner
  images text[],                                      -- pictures shown by the assistant
  ui jsonb,                                           -- "watch me do it" steps
  at timestamptz not null
);
create index if not exists assistant_log_user_idx on public.assistant_log (user_id, at);

-- ── marketing ──────────────────────────────────────────────────────────────
create table if not exists public.promotions (
  id text primary key,
  code text not null,
  description text not null default '',
  percent numeric(5,2) not null check (percent > 0 and percent <= 100),
  valid_from date,
  valid_to date,
  active boolean not null default true,
  min_nights int not null default 1
);
create index if not exists promotions_code_idx on public.promotions (upper(code));

create table if not exists public.feedback (
  id text primary key,
  booking_id text references public.bookings (id) deferrable initially immediate,
  room_id text,                                       -- null = the hotel in general (no foreign key: see bookings.room_id)
  email text,                                         -- written on the website: the guest's e-mail (private, never on the site)
  name text not null,
  rating int not null check (rating between 1 and 5),
  comment text not null,
  lang text not null,
  photos text[],
  translations jsonb,                                 -- {"en": "…", "pl": "…"}
  verified boolean,                                   -- came from the post-stay email link
  pending boolean,                                    -- written without a stay: waits for approval
  edited_at timestamptz,
  publish_consent boolean not null,
  show_on_site boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null
);
alter table public.feedback add column if not exists email text;
create index if not exists feedback_room_idx on public.feedback (room_id) where show_on_site;
create index if not exists feedback_booking_idx on public.feedback (booking_id) where booking_id is not null;

create table if not exists public.review_replies (
  review_id text not null references public.feedback (id) on delete cascade deferrable initially immediate,
  id text not null,
  position int not null,
  author text not null check (author in ('hotel', 'guest')),
  name text not null,
  email text,                                         -- guests leave it with a reply; never shown on the site
  body text not null,
  lang text not null,
  translations jsonb,
  created_at timestamptz not null,
  primary key (review_id, id)
);

create table if not exists public.guest_messages (
  id text primary key,
  booking_id text references public.bookings (id) deferrable initially immediate,
  name text not null,
  email text not null,
  subject text not null,
  body text not null,
  source text not null check (source in ('contatti', 'area_ospite')),
  read boolean not null default false,
  created_at timestamptz not null,
  sender text check (sender is null or sender in ('guest', 'hotel'))   -- the conversation of a booking
);
alter table public.guest_messages add column if not exists sender text check (sender is null or sender in ('guest', 'hotel'));

create table if not exists public.tasks (
  id text primary key,
  label text not null,
  done boolean not null default false,
  created_at timestamptz not null
);

create table if not exists public.campaigns (
  id text primary key,
  name text not null,
  subject text not null,
  headline text not null default '',
  body text not null default '',
  cta_label text not null default '',
  cta_url text not null default '',
  image text not null default '',
  audience text not null check (audience in ('consent_all', 'past_guests', 'future_guests')),
  selected text[],                                    -- exact people (emails); null/empty = whole audience
  langs text[],                                       -- only these guest languages; null/empty = all
  translate boolean,
  personal boolean,                                   -- service message to chosen people, not promotional
  theme jsonb,
  status text not null check (status in ('draft', 'sent')),
  sent_at timestamptz,
  recipients int not null default 0,
  created_at timestamptz not null
);

create table if not exists public.unsubscribed (
  email text primary key,
  added_at timestamptz not null default now()
);

-- ── the order of the rows in the document's lists ──────────────────────────
-- The site keeps bookings, payments, reviews… in lists whose order is part of the data (it appends
-- to some and prepends to others). A row is written here only for a list whose order cannot be told
-- from its creation times (demo rows with invented dates, rows created in the same instant).
create table if not exists public.hotel_list_order (
  list text primary key,                              -- 'bookings', 'payments', 'feedback', …
  ids text[] not null                                 -- the ids in the order the document keeps them
);

-- ── the list of tables, parents before children ────────────────────────────
create or replace function public.hotel_tables() returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'hotel_meta', 'settings', 'staff_users',
    'rooms', 'room_photos', 'room_translations', 'rate_periods',
    'bookings', 'room_blocks', 'payments',
    'outbox', 'notifications', 'audit_log',
    'channel_state', 'telegram_state', 'telegram_links',
    'pending_actions', 'assistant_log',
    'promotions', 'feedback', 'review_replies', 'guest_messages', 'tasks', 'campaigns', 'unsubscribed',
    'hotel_list_order'
  ]::text[];
$$;

-- ── one saved change of the site = one transaction here ────────────────────
-- p = { "delete": {table: [keys]},      rows to remove (key = the primary key columns)
--       "keep":   {table: [keys]},      full copy: every row of that table NOT listed is removed
--       "upsert": {table: [rows]} }     rows to insert or update (all rows of a table carry the same keys)
-- Unique, foreign key and no-overlap checks are verified once, at the end, so the order of the
-- rows inside one change never matters; if any check fails nothing at all is saved.
create or replace function public.hotel_sync(p jsonb) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $fn$
declare
  tabs constant text[] := public.hotel_tables();
  t text;
  i int;
  rel regclass;
  pk text[];
  cols text[];
  chunk jsonb;
  n bigint;
  cond text;
  col_list text;
  set_list text;
  upserted jsonb := '{}'::jsonb;
  deleted jsonb := '{}'::jsonb;
begin
  set constraints all deferred;

  -- 1) removals, children before parents
  for i in reverse array_length(tabs, 1)..1 loop
    t := tabs[i];
    rel := format('public.%I', t)::regclass;
    select array_agg(a.attname::text order by k.ord) into pk
      from pg_index ix
      cross join lateral unnest(ix.indkey::int2[]) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum
      where ix.indrelid = rel and ix.indisprimary;
    select string_agg(format('d.%1$I = k.%1$I', c), ' and ') into cond from unnest(pk) as c;

    chunk := p->'delete'->t;
    if jsonb_typeof(chunk) = 'array' and jsonb_array_length(chunk) > 0 then
      execute format('delete from public.%1$I d using jsonb_populate_recordset(null::public.%1$I, $1) k where %2$s', t, cond) using chunk;
      get diagnostics n = row_count;
      deleted := deleted || jsonb_build_object(t, n);
    end if;

    chunk := p->'keep'->t;
    if jsonb_typeof(chunk) = 'array' then
      execute format('delete from public.%1$I d where not exists (select 1 from jsonb_populate_recordset(null::public.%1$I, $1) k where %2$s)', t, cond) using chunk;
      get diagnostics n = row_count;
      if n > 0 then
        deleted := deleted || jsonb_build_object(t, coalesce((deleted->>t)::bigint, 0) + n);
      end if;
    end if;
  end loop;

  -- 2) inserts and updates, parents before children
  foreach t in array tabs loop
    chunk := p->'upsert'->t;
    if jsonb_typeof(chunk) is distinct from 'array' or jsonb_array_length(chunk) = 0 then
      continue;
    end if;
    rel := format('public.%I', t)::regclass;
    select array_agg(a.attname::text order by k.ord) into pk
      from pg_index ix
      cross join lateral unnest(ix.indkey::int2[]) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum
      where ix.indrelid = rel and ix.indisprimary;
    -- only the columns the site sends: the others keep their default / current value
    select array_agg(a.attname::text order by a.attnum) into cols
      from pg_attribute a
      where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
        and (chunk->0) ? a.attname::text;
    if cols is null or not (pk <@ cols) then
      raise exception 'hotel_sync: the rows for "%" do not carry the key columns %', t, pk;
    end if;
    select string_agg(format('%I', c), ', ') into col_list from unnest(cols) as c;
    select string_agg(format('%1$I = excluded.%1$I', c), ', ') into set_list from unnest(cols) as c where c <> all (pk);
    execute format(
      'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%3$s) do %4$s',
      t, col_list, (select string_agg(format('%I', c), ', ') from unnest(pk) as c),
      case when set_list is null then 'nothing' else 'update set ' || set_list end
    ) using chunk;
    get diagnostics n = row_count;
    upserted := upserted || jsonb_build_object(t, n);
  end loop;

  -- 3) verify everything now, so a refused change is reported by this call
  set constraints all immediate;

  return jsonb_build_object(
    'ok', true,
    'version', (select m.version from public.hotel_meta m where m.id = 1),
    'upserted', upserted,
    'deleted', deleted
  );
end;
$fn$;

-- rows per table: used to compare the tables with the document
create or replace function public.hotel_table_counts() returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  t text;
  n bigint;
  result jsonb := '{}'::jsonb;
begin
  foreach t in array public.hotel_tables() loop
    execute format('select count(*) from public.%I', t) into n;
    result := result || jsonb_build_object(t, n);
  end loop;
  return result;
end;
$fn$;

-- website holds whose payment time ran out stop keeping the room busy
-- (the site does this itself with every change; this is for a scheduled job once reads move here)
create or replace function public.hotel_release_expired_holds() returns int
language sql
security invoker
set search_path = public, pg_temp
as $fn$
  with x as (
    update public.bookings set occupies_room = false
    where occupies_room and status = 'pending_payment' and hold_expires_at is not null and hold_expires_at <= now()
    returning 1
  ) select count(*)::int from x;
$fn$;

-- ── security: Row Level Security on every table, no policy, server key only ─
do $do$
declare
  t text;
begin
  foreach t in array public.hotel_tables() || array['hotel_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$do$;

revoke all on function public.hotel_tables() from public, anon, authenticated;
revoke all on function public.hotel_sync(jsonb) from public, anon, authenticated;
revoke all on function public.hotel_table_counts() from public, anon, authenticated;
revoke all on function public.hotel_release_expired_holds() from public, anon, authenticated;
grant execute on function public.hotel_tables() to service_role;
grant execute on function public.hotel_sync(jsonb) to service_role;
grant execute on function public.hotel_table_counts() to service_role;
grant execute on function public.hotel_release_expired_holds() to service_role;

-- let the API see the new tables and functions at once
notify pgrst, 'reload schema';

-- ── wynik: 27 tabel, wszędzie rls_wlaczone = true, polityki = 0 ─────────────
select c.relname as tabela,
       c.relrowsecurity as rls_wlaczone,
       (select count(*) from pg_policies pol where pol.schemaname = 'public' and pol.tablename = c.relname) as polityki
from pg_class c
join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'r'
  and c.relname = any (public.hotel_tables() || array['hotel_state'])
order by c.relname;
