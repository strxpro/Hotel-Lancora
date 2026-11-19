import { addDays, diffDays, isValidISODate } from '@/lib/dates';

export interface StayQuery {
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  childrenAges: number[];
}

export const EMPTY_QUERY: StayQuery = { checkIn: null, checkOut: null, adults: 2, children: 0, childrenAges: [] };

export function queryFromParams(sp: URLSearchParams | Record<string, string | string[] | undefined>, today: string): StayQuery {
  const get = (k: string) => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const ci = get('checkIn');
  const co = get('checkOut');
  const valid = isValidISODate(ci) && isValidISODate(co) && ci >= today && co > ci && diffDays(ci, co) <= 30;
  const adults = Math.min(8, Math.max(1, Number(get('adults')) || 2));
  const children = Math.min(6, Math.max(0, Number(get('children')) || 0));
  const ages = (get('ages') ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= 0 && x <= 17)
    .slice(0, children);
  return { checkIn: valid ? ci : null, checkOut: valid ? co! : null, adults, children, childrenAges: ages };
}

export function queryToParams(q: StayQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.checkIn && q.checkOut) {
    p.set('checkIn', q.checkIn);
    p.set('checkOut', q.checkOut);
  }
  p.set('adults', String(q.adults));
  if (q.children) {
    p.set('children', String(q.children));
    if (q.childrenAges.length) p.set('ages', q.childrenAges.join(','));
  }
  return p;
}

export function hasDates(q: StayQuery): q is StayQuery & { checkIn: string; checkOut: string } {
  return Boolean(q.checkIn && q.checkOut);
}

export function defaultStay(today: string): { checkIn: string; checkOut: string } {
  return { checkIn: addDays(today, 7), checkOut: addDays(today, 10) };
}
