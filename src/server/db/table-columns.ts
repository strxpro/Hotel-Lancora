import type { TableName } from './tables';

/**
 * The columns the site writes in every table (supabase/hotel-tables.sql, without the ones the
 * database fills by itself). Used to notice a database created from an older SQL file even when a
 * table is still empty: hotel_sync() quietly skips a column the table does not have.
 * tests/tables.test.ts checks this list against the SQL file and against the mapper in tables.ts —
 * when a field is added there, add its column here too.
 */
export const TABLE_COLUMNS: Record<TableName, readonly string[]> = {
  hotel_meta: ['id', 'schema_version', 'version', 'seeded_at', 'updated_at', 'synced_at'],
  settings: ['id', 'hotel', 'floors', 'payments', 'pricing', 'stripe_connect', 'notifications', 'services',
    'reviews', 'custom_amenities', 'faq', 'demo_mode', 'panel', 'places'],
  staff_users: ['id', 'email', 'name', 'role', 'password_hash', 'created_at', 'two_factor'],
  rooms: ['id', 'number', 'slug', 'name', 'type', 'max_guests', 'beds', 'beds_count', 'bed_config', 'size_m2',
    'floor', 'base_price', 'cash_price', 'payment', 'number_auto', 'status', 'hidden', 'amenities', 'title', 'short_text',
    'description', 'sort_order', 'created_at', 'updated_at', 'is_demo'],
  room_photos: ['room_id', 'id', 'position', 'src', 'alt', 'width', 'height', 'is_demo', 'credit'],
  room_translations: ['room_id', 'locale', 'title', 'short_text', 'description', 'status', 'manual',
    'updated_at', 'published'],
  rate_periods: ['id', 'label', 'date_from', 'date_to', 'room_ids', 'mode', 'value', 'created_at', 'cash_price'],
  bookings: ['id', 'code', 'token', 'room_id', 'first_name', 'last_name', 'email', 'phone', 'country', 'lang',
    'adults', 'children', 'children_ages', 'check_in', 'check_out', 'total', 'discount', 'promo_code',
    'amount_paid', 'status', 'occupies_room', 'hold_expires_at', 'source', 'ota_ref', 'special_requests',
    'notes', 'consent_privacy', 'consent_terms', 'consent_marketing', 'payment_method', 'review_requested_at',
    'simulated', 'is_demo', 'created_at', 'updated_at', 'cancelled_at', 'card', 'card_request', 'no_show',
    'change_request'],
  room_blocks: ['id', 'room_id', 'date_from', 'date_to', 'reason', 'created_by', 'created_at', 'source',
    'ext_uid'],
  payments: ['id', 'booking_id', 'amount', 'kind', 'provider', 'status', 'reference', 'created_at'],
  outbox: ['id', 'to_email', 'subject', 'template', 'html', 'text_body', 'booking_id', 'status', 'error',
    'created_at', 'sent_at', 'list_unsubscribe'],
  notifications: ['id', 'type', 'title', 'body', 'href', 'read', 'telegram', 'created_at'],
  audit_log: ['id', 'at', 'actor', 'action', 'entity', 'entity_id', 'details'],
  channel_state: ['id', 'provider_name', 'status', 'last_sync', 'imported_count', 'log', 'mapping',
    'calendars', 'ical_key'],
  telegram_state: ['id', 'link_code', 'last_test_at', 'last_error'],
  telegram_links: ['chat_id', 'user_id', 'name', 'linked_at'],
  pending_actions: ['id', 'channel', 'chat_id', 'user_id', 'tool', 'args', 'summary', 'created_at',
    'expires_at', 'lang'],
  assistant_log: ['id', 'user_id', 'channel', 'role', 'body', 'pending_id', 'resolved', 'engine', 'voice',
    'image', 'images', 'ui', 'at'],
  promotions: ['id', 'code', 'description', 'percent', 'valid_from', 'valid_to', 'active', 'min_nights'],
  feedback: ['id', 'booking_id', 'room_id', 'email', 'name', 'rating', 'comment', 'lang', 'photos',
    'translations', 'verified', 'pending', 'edited_at', 'publish_consent', 'show_on_site', 'is_demo',
    'created_at'],
  review_replies: ['review_id', 'id', 'position', 'author', 'name', 'email', 'body', 'lang', 'translations',
    'created_at'],
  guest_messages: ['id', 'booking_id', 'name', 'email', 'subject', 'body', 'source', 'read', 'created_at',
    'sender'],
  tasks: ['id', 'label', 'done', 'created_at'],
  campaigns: ['id', 'name', 'subject', 'headline', 'body', 'cta_label', 'cta_url', 'image', 'audience',
    'selected', 'langs', 'translate', 'personal', 'theme', 'status', 'sent_at', 'recipients', 'created_at'],
  unsubscribed: ['email'],
  hotel_list_order: ['list', 'ids'],
};
