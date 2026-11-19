import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db/store';
import { CLOUD } from './db/cloud-row';

/**
 * Where the photos uploaded from the panel, the guests' review photos and the assistant's images
 * live. On the computer: data/uploads. On hosting without a disk (STORE_MODE=cloud): Supabase
 * Storage, bucket `MEDIA_BUCKET` (default "uploads", private: only the server key reads it, the
 * site serves the files itself through /api/media/<name>).
 */
const BUCKET = () => (process.env.MEDIA_BUCKET || 'uploads').trim();
const base = () => `${(process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '')}/storage/v1`;
function auth(): Record<string, string> {
  const k = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  return { apikey: k, authorization: `Bearer ${k}` };
}
export const MEDIA_NAME = /^[a-z0-9-]{8,64}\.(webp|jpg|jpeg|png)$/;
export const mediaType = (name: string) => (name.endsWith('.webp') ? 'image/webp' : name.endsWith('.png') ? 'image/png' : 'image/jpeg');

export async function putMedia(name: string, data: Buffer): Promise<string> {
  if (!MEDIA_NAME.test(name)) throw new Error('Nome file non valido');
  if (CLOUD) {
    const r = await fetch(`${base()}/object/${BUCKET()}/${name}`, { method: 'POST', headers: { ...auth(), 'content-type': mediaType(name), 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }, body: new Uint8Array(data), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Foto non salvata (Storage ${r.status}: ${(await r.text()).slice(0, 120)})`);
  } else {
    const dir = path.join(DATA_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  return `/api/media/${name}`;
}

export async function getMedia(name: string): Promise<Buffer | null> {
  if (!MEDIA_NAME.test(name)) return null;
  if (CLOUD) {
    const r = await fetch(`${base()}/object/${BUCKET()}/${name}`, { headers: auth(), signal: AbortSignal.timeout(20000) }).catch(() => null);
    return r && r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  }
  try {
    return fs.readFileSync(path.join(DATA_DIR, 'uploads', name));
  } catch {
    return null;
  }
}
