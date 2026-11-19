import { getMedia, MEDIA_NAME, mediaType } from '@/server/media-store';

export const dynamic = 'force-dynamic';

/** Serves photos uploaded from the admin (data/uploads on the computer, Supabase Storage on Vercel). */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!MEDIA_NAME.test(name)) return new Response('Not found', { status: 404 });
  const buf = await getMedia(name);
  if (!buf) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { 'content-type': mediaType(name), 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}
