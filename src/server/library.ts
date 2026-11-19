import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, readDb } from './db/store';

/**
 * The hotel's photo library: every picture uploaded once (by the owner or by whoever builds the site)
 * that can be put into any room with a click. The files are the usual uploads (/api/media/…); this is
 * only the list, kept next to them. The photos already used in the rooms are part of it too.
 */
export type LibraryPhoto = { src: string; width: number; height: number; addedAt: string; rooms: string[] };

const FILE = () => path.join(DATA_DIR, 'libreria.json');

function readList(): Omit<LibraryPhoto, 'rooms'>[] {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Omit<LibraryPhoto, 'rooms'>[];
  } catch {
    return [];
  }
}
function writeList(list: Omit<LibraryPhoto, 'rooms'>[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${FILE()}.tmp`, JSON.stringify(list, null, 1));
  fs.renameSync(`${FILE()}.tmp`, FILE());
}

/** Library + the real photos of every room (no stock photos), newest first; which rooms use each one. */
export function libraryPhotos(): LibraryPhoto[] {
  const db = readDb();
  const used = new Map<string, string[]>();
  const extra: Omit<LibraryPhoto, 'rooms'>[] = [];
  for (const r of db.rooms) {
    for (const p of r.photos) {
      used.set(p.src, [...(used.get(p.src) ?? []), r.number]);
      if (!p.demo && p.src.startsWith('/api/media/')) extra.push({ src: p.src, width: p.width, height: p.height, addedAt: r.updatedAt });
    }
  }
  const seen = new Set<string>();
  return [...readList(), ...extra]
    .filter((p) => (seen.has(p.src) ? false : (seen.add(p.src), true)))
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    .map((p) => ({ ...p, rooms: used.get(p.src) ?? [] }));
}

export function addLibraryPhotos(items: { src: string; width: number; height: number }[]): number {
  const list = readList();
  const have = new Set(list.map((p) => p.src));
  const now = new Date().toISOString();
  let n = 0;
  for (const it of items) {
    if (!/^\/api\/media\/[\w.-]+$/.test(it.src) || have.has(it.src)) continue;
    list.unshift({ src: it.src, width: Math.round(it.width), height: Math.round(it.height), addedAt: now });
    have.add(it.src);
    n++;
  }
  writeList(list);
  return n;
}

export function removeLibraryPhoto(src: string): void {
  writeList(readList().filter((p) => p.src !== src));
}
