import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getCurrentUser, can } from '@/server/auth/guard';
import { DATA_DIR } from '@/server/db/store';
import { rateLimit, sameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 12 * 1024 * 1024;

/**
 * Admin photo upload. The browser already resizes/compresses to WebP; the server re-encodes with
 * sharp anyway (validates it is a real image, strips EXIF/GPS, caps the size).
 * Production: swap this handler for Supabase Storage (see README).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Origine non valida' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'rooms.edit')) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
  if (!rateLimit(`upload:${user.id}`, 60, 10 * 60_000)) return NextResponse.json({ error: 'Troppi caricamenti, attendi un momento.' }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Nessun file ricevuto' }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: 'File troppo grande (max 12 MB)' }, { status: 413 });
  if (!/^image\/(webp|jpeg|png|avif)$/.test(file.type)) return NextResponse.json({ error: 'Formato non supportato: usa JPG, PNG o WebP' }, { status: 415 });
  try {
    const sharp = (await import('sharp')).default;
    const input = Buffer.from(await file.arrayBuffer());
    const img = sharp(input, { failOn: 'error' }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error('Immagine non valida');
    const out = await img.resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const name = `${crypto.randomUUID()}.webp`;
    const dir = path.join(DATA_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), out.data);
    return NextResponse.json({ src: `/api/media/${name}`, width: out.info.width, height: out.info.height, size: out.info.size });
  } catch {
    return NextResponse.json({ error: 'Il file non sembra un’immagine valida' }, { status: 422 });
  }
}
