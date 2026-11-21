import type { Role } from '@/lib/types';

/** Who may do what in the panel (no Next.js here: the assistant and its tests load it too). */
export type Permission =
  | 'rooms.edit'
  | 'rooms.delete'
  | 'prices.edit'
  | 'bookings.manage'
  | 'bookings.delete'
  | 'payments.manage'
  | 'settings.edit'
  | 'users.manage'
  | 'automations.manage'
  | 'stats.view'
  | 'assistant.use'
  | 'marketing.manage'
  | 'guests.gdpr';

const PERMS: Record<Permission, Role[]> = {
  'rooms.edit': ['admin', 'staff'],
  'rooms.delete': ['admin'],
  'prices.edit': ['admin'],
  'bookings.manage': ['admin', 'staff'],
  'bookings.delete': ['admin'],
  'payments.manage': ['admin'],
  'settings.edit': ['admin'],
  'users.manage': ['admin'],
  'automations.manage': ['admin'],
  'stats.view': ['admin', 'staff'],
  'assistant.use': ['admin', 'staff'],
  'marketing.manage': ['admin'],
  'guests.gdpr': ['admin'],
};

export function can(role: Role, perm: Permission): boolean {
  return PERMS[perm].includes(role);
}

/** What the pages and actions get: never the password fingerprint nor the phone-code key. */
