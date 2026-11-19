import { NextResponse } from 'next/server';
import { putMedia } from '@/server/media-store';
import { ipOf, rateLimit, sameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 10 * 1024 * 1024;

/**
 * Photos attached to a guest review (max 3 per review, enforced by the form and the action).
 * Re-encoded with sharp: only real images, EXIF/GPS removed, max 1600 px.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Origine non valida' }, { status: 403 });
  const ip = ipOf(req.headers);
  if (!rateLimit(`review-photo:${ip}`, 12, 15 * 60_000)) return NextResponse.json({ error: 'Too many uploads' }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: 'Max 10 MB' }, { status: 413 });
  if (!/^image\/(webp|jpeg|png|avif|heic|heif)$/.test(file.type)) return NextResponse.json({ error: 'JPG, PNG, WebP' }, { status: 415 });
  try {
    const sharp = (await import('sharp')).default;
    const img = sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'error' }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error('bad');
    const out = await img.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    return NextResponse.json({ src: await putMedia(`${crypto.randomUUID()}.webp`, out.data) });
  } catch {
    return NextResponse.json({ error: 'Invalid image' }, { status: 422 });
  }
}
