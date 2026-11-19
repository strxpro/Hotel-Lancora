import { clsx, type ClassValue } from 'clsx';
import { intlLocale } from './dates';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** "1 notte" · "3 notti" (the panel and the owner's messages are in Italian). */
export const notti = (n: number): string => `${n} ${n === 1 ? 'notte' : 'notti'}`;
/** "1 ospite" · "2 ospiti" */
export const ospiti = (n: number): string => `${n} ${n === 1 ? 'ospite' : 'ospiti'}`;

export function money(n: number, locale = 'it', fraction: 0 | 2 = 0): string {
  const frac = fraction === 0 && !Number.isInteger(n) ? 2 : fraction;
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'EUR', minimumFractionDigits: frac, maximumFractionDigits: frac }).format(n);
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
