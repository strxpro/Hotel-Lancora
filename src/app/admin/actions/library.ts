'use server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { act } from '@/server/action';
import { addLibraryPhotos, libraryPhotos, removeLibraryPhoto, type LibraryPhoto } from '@/server/library';

/** Reading only: no refresh of the pages. */
export async function libraryAction(): Promise<LibraryPhoto[]> {
  await requireUser('rooms.edit');
  return libraryPhotos();
}

const Item = z.object({ src: z.string().regex(/^\/api\/media\/[\w.-]+$/), width: z.number().positive(), height: z.number().positive() });

export async function addToLibraryAction(raw: unknown) {
  return act('rooms.edit', () => ({ added: addLibraryPhotos(z.array(Item).max(200).parse(raw)) }));
}

export async function removeFromLibraryAction(src: string) {
  return act('rooms.edit', () => removeLibraryPhoto(z.string().max(200).parse(src)), 'Foto tolta dalla libreria (resta nelle camere dove l’hai già messa).');
}
