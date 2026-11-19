import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { telegramConfigured } from '@/server/telegram/api';
import { handleTelegramUpdate, type Update } from '@/server/telegram/handle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// a voice message (transcription + assistant) can take a while on serverless hosting
export const maxDuration = 120;

function secretOk(req: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  const got = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (expected.length < 16 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/**
 * Telegram Bot webhook (used when the site has a stable public address). On a computer without
 * one, the site listens to Telegram by itself instead: see server/telegram/poller.ts.
 */
export async function POST(req: Request) {
  if (!telegramConfigured() || !secretOk(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const update = (await req.json().catch(() => null)) as Update | null;
  if (update) await handleTelegramUpdate(update);
  return NextResponse.json({ ok: true });
}
