'use client';

/**
 * Resize + compress a photo in the browser before it is sent (WebP, longest side `max` px).
 * Keeps uploads fast on hotel Wi-Fi / 4G and under the hosting's request limit (4.5 MB on Vercel).
 * A format the browser cannot open (e.g. HEIC outside Safari) is sent as it is: the server decides.
 */
export async function shrinkPhoto(file: File, max = 2200, quality = 0.84): Promise<File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
  if (!blob) return file;
  return new File([blob], 'foto.webp', { type: 'image/webp' });
}
