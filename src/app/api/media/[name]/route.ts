import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/server/db/store';

export const dynamic = 'force-dynamic';

/** Serves photos uploaded from the admin (stored outside /public so they work after `next build`). */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-z0-9-]{8,64}\.(webp|jpg|jpeg|png)$/.test(name)) return new Response('Not found', { status: 404 });
  const file = path.join(DATA_DIR, 'uploads', name);
  if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
  const ext = name.split('.').pop();
  const type = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}
