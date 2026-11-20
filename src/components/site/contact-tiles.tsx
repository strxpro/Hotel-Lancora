'use client';
import { CalendarRange, Mail, MapPin, MessageCircle, Phone, Send } from 'lucide-react';
import { STAY_T } from '@/lib/i18n/stay-dict';
import { cn } from '@/lib/utils';
import { useI18n } from './providers';

export type HotelContact = { phone: string; whatsapp?: string; email: string; lat: number; lng: number };

/**
 * One-tap actions for a guest: change dates, write to the reception (the owner gets it on
 * Telegram), call, WhatsApp, e-mail, directions. `dates` / `write` add the two that scroll to
 * the booking page's own sections.
 */
export function ContactTiles({ contact, dates = false, write = false, className }: { contact: HotelContact; dates?: boolean; write?: boolean; className?: string }) {
  const { locale } = useI18n();
  const x = STAY_T[locale];
  const wa = contact.whatsapp?.replace(/\D/g, '');
  const go = (id: string) => (e: React.MouseEvent) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const tiles = [
    ...(dates ? [{ key: 'dates', href: '#modifica', icon: CalendarRange, label: x.dates, onClick: go('modifica'), strong: true }] : []),
    ...(write ? [{ key: 'write', href: '#messaggi', icon: Send, label: x.write, onClick: go('messaggi'), strong: true }] : []),
    ...(contact.phone ? [{ key: 'call', href: `tel:${contact.phone.replace(/\s/g, '')}`, icon: Phone, label: x.call }] : []),
    ...(wa ? [{ key: 'wa', href: `https://wa.me/${wa}`, icon: MessageCircle, label: x.whatsapp, external: true }] : []),
    ...(contact.email ? [{ key: 'mail', href: `mailto:${contact.email}`, icon: Mail, label: x.email }] : []),
    { key: 'map', href: `https://www.google.com/maps/dir/?api=1&destination=${contact.lat},${contact.lng}`, icon: MapPin, label: x.directions, external: true },
  ] as { key: string; href: string; icon: React.ComponentType<{ className?: string }>; label: string; onClick?: (e: React.MouseEvent) => void; strong?: boolean; external?: boolean }[];
  return (
    <ul className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}>
      {tiles.map((t) => (
        <li key={t.key}>
          <a
            href={t.href}
            onClick={t.onClick}
            target={t.external ? '_blank' : undefined}
            rel={t.external ? 'noopener noreferrer' : undefined}
            className={cn('group flex h-full min-h-[3.25rem] items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-[0.85rem] font-semibold transition-[background-color,border-color,transform] duration-300 hover:-translate-y-0.5', t.strong ? 'border-navy bg-navy text-ivory hover:bg-navy-3' : 'border-line bg-white text-navy hover:border-navy')}
          >
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', t.strong ? 'bg-white/10 text-gold' : 'bg-sand-2 text-gold-2')}>
              <t.icon className="h-4 w-4" />
            </span>
            <span className="leading-tight">{t.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
