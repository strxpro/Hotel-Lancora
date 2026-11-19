-- ⚠ NIEAKTUALNE / SUPERSEDED — do not run. Use supabase/hotel-tables.sql instead.
-- This file uses uuid keys and Supabase Auth profiles; the app has text ids ("room-101", "bk-6")
-- and its own users, so these tables could not hold the hotel's data. Kept only for reference.

-- Hotel L'Ancora — brings the schema of 0001 up to the complete model of src/lib/types.ts:
-- room beds + cash price, guest language, room reviews (photos, replies, translations),
-- email campaigns, the shared assistant chat (panel + Telegram), tasks, unsubscribes,
-- server-only secrets, storage buckets and the scheduled jobs.
-- Safe to run once after 0001 (all statements are additive).

-- ── rooms ──────────────────────────────────────────────────────────────────
alter table rooms
  add column if not exists bed_config jsonb not null default '[]',      -- [{kind:'matrimoniale', count:1}, …]
  add column if not exists cash_price numeric(10,2) check (cash_price is null or cash_price > 0),  -- price when paying cash (a discount: Italy forbids card surcharges)
  add column if not exists is_demo boolean not null default false;
alter table rooms add constraint cash_not_above_card check (cash_price is null or cash_price <= base_price);
alter table room_photos add column if not exists credit text;

-- ── bookings ───────────────────────────────────────────────────────────────
alter table bookings
  add column if not exists country text,                                  -- ISO2, for statistics and email language
  add column if not exists lang text check (lang is null or lang in ('it', 'en', 'pl', 'de', 'fr', 'es')),
  add column if not exists payment_method text check (payment_method is null or payment_method in ('card', 'cash', 'transfer', 'ota')),
  add column if not exists review_requested_at timestamptz,               -- "rate your room" email sent
  add column if not exists is_demo boolean not null default false;
create index if not exists bookings_checkout_idx on bookings (upper(stay)) where status = 'confirmed';
create index if not exists bookings_email_idx on bookings (lower(email));

-- payments: every way the hotel gets paid
alter table payments add constraint payments_provider_check check (provider in ('stripe', 'stripe_test', 'simulazione', 'contanti', 'bonifico', 'ota', 'pos'));
alter table payments add constraint payments_status_check check (status in ('succeeded', 'failed', 'pending'));

-- outbox: one-click unsubscribe header for marketing emails
alter table outbox add column if not exists list_unsubscribe text;

-- pending assistant actions remember the language the owner wrote in
alter table pending_actions add column if not exists lang text not null default 'it';

-- ── room reviews ───────────────────────────────────────────────────────────
alter table feedback
  add column if not exists room_id uuid references rooms (id) on delete set null,   -- null = the hotel in general
  add column if not exists photos text[] not null default '{}' check (cardinality(photos) <= 3),
  add column if not exists translations jsonb not null default '{}',                -- {"en": "…", "pl": "…"}
  add column if not exists verified boolean not null default false,                -- came from the post-stay email link
  add column if not exists pending boolean not null default false,                 -- written without a stay: waits for approval
  add column if not exists edited_at timestamptz,
  add column if not exists is_demo boolean not null default false;
create unique index if not exists feedback_one_per_booking on feedback (booking_id) where booking_id is not null;
create index if not exists feedback_room_idx on feedback (room_id) where show_on_site;

create table if not exists review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references feedback (id) on delete cascade,
  author text not null check (author in ('hotel', 'guest')),
  name text not null,
  body text not null check (char_length(body) between 1 and 1200),
  lang text not null default 'it',
  translations jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists review_replies_review_idx on review_replies (review_id, created_at);

-- average stars per room, for the room cards and the "4★ and up" filter
create or replace view room_ratings as
  select room_id, round(avg(rating)::numeric, 2) as avg, count(*) as count
  from feedback
  where room_id is not null and show_on_site and not pending
  group by room_id;

-- ── email campaigns ────────────────────────────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  headline text not null default '',
  body text not null default '',
  cta_label text not null default '',
  cta_url text not null default '',
  image text not null default '',
  audience text not null check (audience in ('consent_all', 'past_guests', 'future_guests')),
  selected text[] not null default '{}',        -- exact people (emails); empty = whole audience
  langs text[] not null default '{}',           -- only these guest languages; empty = all
  translate boolean not null default true,
  personal boolean not null default false,      -- service message to chosen people, not promotional
  theme jsonb,
  status text not null default 'draft' check (status in ('draft', 'sent')),
  sent_at timestamptz,
  recipients int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists unsubscribed (
  email text primary key check (email = lower(email)),
  at timestamptz not null default now()
);

-- ── assistant: one conversation per staff member, shared by panel and Telegram ──
create table if not exists assistant_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  channel text not null check (channel in ('panel', 'telegram')),
  role text not null check (role in ('user', 'assistant')),
  body text not null,
  pending_id uuid,
  resolved boolean not null default false,
  engine text,
  voice boolean not null default false,
  image text,                    -- picture sent by the owner
  images text[],                 -- pictures shown by the assistant
  ui jsonb,                      -- "watch me do it" steps
  at timestamptz not null default now()
);
create index if not exists assistant_log_user_idx on assistant_log (user_id, at);

create table if not exists telegram_link_codes (
  code text primary key check (code ~ '^\d{6}$'),
  user_id uuid not null references profiles (id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── secrets connected from the panel (Groq, SMTP, Stripe…) ─────────────────
-- Only the server (service role) can read them: RLS on, no policy at all.
-- In production you can keep them in environment variables or Supabase Vault instead.
create table if not exists app_secrets (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- road routes from the hotel to the places (OpenStreetMap routing), cached
create table if not exists route_cache (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── Row Level Security for the new tables ──────────────────────────────────
alter table review_replies enable row level security;
alter table campaigns enable row level security;
alter table unsubscribed enable row level security;
alter table assistant_log enable row level security;
alter table telegram_link_codes enable row level security;
alter table tasks enable row level security;
alter table app_secrets enable row level security;
alter table route_cache enable row level security;

-- public website: published reviews (approved, with consent) and their replies
drop policy if exists "public reviews" on feedback;
create policy "public reviews" on feedback for select using (show_on_site and publish_consent and not pending);
create policy "public replies" on review_replies for select using (exists (select 1 from feedback f where f.id = review_id and f.show_on_site and f.publish_consent and not f.pending));
create policy "public routes" on route_cache for select using (true);

create policy "staff replies" on review_replies for all using (is_staff()) with check (is_staff());
create policy "admin campaigns" on campaigns for all using (is_admin()) with check (is_admin());
create policy "admin unsubscribed" on unsubscribed for select using (is_admin());
create policy "own assistant log" on assistant_log for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admin link codes" on telegram_link_codes for all using (is_admin()) with check (is_admin());
create policy "staff tasks" on tasks for all using (is_staff()) with check (is_staff());
-- app_secrets: intentionally no policy (service role only)
-- Guest writes (review form, replies, unsubscribe) go through server routes with the service
-- role after validation, rate limiting and link checks — never directly from the browser.

-- ── Storage: photos ────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values
  ('room-photos', 'room-photos', true),     -- room galleries
  ('review-photos', 'review-photos', true), -- up to 3 photos per guest review
  ('media', 'media', true)                  -- email images, generated pictures, assistant uploads
on conflict (id) do nothing;

create policy "public read photos" on storage.objects for select using (bucket_id in ('room-photos', 'review-photos', 'media'));
create policy "staff write photos" on storage.objects for insert with check (bucket_id in ('room-photos', 'media') and is_staff());
create policy "staff update photos" on storage.objects for update using (bucket_id in ('room-photos', 'media') and is_staff());
create policy "staff delete photos" on storage.objects for delete using (bucket_id in ('room-photos', 'review-photos', 'media') and is_staff());

-- ── scheduled jobs ─────────────────────────────────────────────────────────
-- unpaid website bookings release their room after the hold time
create or replace function release_expired_holds() returns int language sql security definer as $$
  with x as (
    update bookings set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where status = 'pending_payment' and hold_expires_at < now()
    returning 1
  ) select count(*)::int from x;
$$;

-- bookings that should receive the "rate your room" email today (the server sends it)
create or replace function due_review_requests(delay_days int default 1) returns setof bookings language sql stable security definer as $$
  select * from bookings
  where status = 'confirmed' and source = 'sito' and review_requested_at is null
    and upper(stay) + delay_days <= current_date and upper(stay) > current_date - 7;
$$;

-- With the pg_cron extension (Database → Extensions → pg_cron) uncomment:
-- select cron.schedule('release-holds', '*/5 * * * *', $$select release_expired_holds()$$);

-- ── Realtime for the panel ─────────────────────────────────────────────────
alter publication supabase_realtime add table feedback, review_replies, campaigns, assistant_log, payments;
