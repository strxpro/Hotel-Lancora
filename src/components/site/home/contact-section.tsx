'use client';
import { motion } from 'motion/react';
import { ArrowUpRight, Mail, MessageCircle, Phone } from 'lucide-react';
import { CONTACT_T, INTRO_T } from '@/lib/i18n/reviews-dict';
import { useI18n } from '../providers';
import { SplitHeading } from '../motion-kit';
import { ContactForm } from '../contact-form';

const EASE = [0.22, 0.61, 0.12, 1] as const;
const RISE = { h: { opacity: 0, y: 24 }, v: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } } };

/** "Scrivici": the direct line to the reception, on the home page and on the contact page. */
export function ContactSection({ hotel, compact = false }: { hotel: { phone: string; whatsapp?: string; email: string }; compact?: boolean }) {
  const { locale } = useI18n();
  const c = CONTACT_T[locale];
  const x = INTRO_T[locale];
  const wa = hotel.whatsapp?.replace(/\D/g, '');
  const channels = [
    ...(wa ? [{ icon: MessageCircle, label: x.whatsapp, value: hotel.whatsapp!, href: `https://wa.me/${wa}`, tone: 'bg-[#25d366]/12 text-[#128c4a]' }] : []),
    { icon: Phone, label: x.call, value: hotel.phone, href: `tel:${hotel.phone.replace(/\s/g, '')}`, tone: 'bg-gold/15 text-gold-2' },
    { icon: Mail, label: x.email, value: hotel.email, href: `mailto:${hotel.email}`, tone: 'bg-navy/[0.07] text-navy' },
  ];

  return (
    <section id="scrivici" aria-labelledby="scrivici-title" className={compact ? 'scroll-mt-28' : 'relative scroll-mt-24 bg-ivory py-20 md:py-28'}>
      <div className={compact ? '' : 'container-x'}>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <motion.div initial="h" whileInView="v" viewport={{ once: true, margin: '-12% 0px' }} transition={{ staggerChildren: 0.08 }} className="lg:col-span-5">
            <motion.p variants={RISE} className="eyebrow text-gold-2">
              {c.eyebrow}
            </motion.p>
            <SplitHeading as="h2" className="display mt-5 text-headline text-navy">
              <span id="scrivici-title">{c.title}</span>
            </SplitHeading>
            <motion.p variants={RISE} className="mt-6 max-w-md text-[1.05rem] leading-relaxed text-charcoal/80">
              {c.text}
            </motion.p>
            <ul className="mt-9 space-y-2.5">
              {channels.map((ch) => (
                <motion.li key={ch.href} variants={RISE}>
                  <a
                    href={ch.href}
                    target={ch.href.startsWith('http') ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className="group flex items-center gap-4 rounded-2xl border border-line bg-white px-4 py-3.5 transition-[border-color,box-shadow,transform] duration-500 ease-[var(--ease-lux)] hover:-translate-y-0.5 hover:border-navy/30 hover:shadow-[0_18px_40px_-24px_rgba(16,40,61,0.45)]"
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${ch.tone}`}>
                      <ch.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">{ch.label}</span>
                      <span className="block truncate text-[0.98rem] text-navy">{ch.value}</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-navy/30 transition-transform duration-500 ease-[var(--ease-lux)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-navy" />
                  </a>
                </motion.li>
              ))}
            </ul>
            <motion.p variants={RISE} className="mt-6 flex items-center gap-2 text-[0.8rem] text-mist">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-[#4f9a5c]/50" />
                <span className="relative h-2 w-2 rounded-full bg-[#4f9a5c]" />
              </span>
              {c.open} · {c.reply}
            </motion.p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40, clipPath: 'inset(8% 4% 0% 4% round 1.75rem)' }}
            whileInView={{ opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0% round 1.75rem)' }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 1, ease: EASE }}
            className="rounded-[1.75rem] border border-line bg-white p-6 shadow-[0_40px_90px_-50px_rgba(16,40,61,0.45)] sm:p-9 lg:col-span-7"
          >
            <ContactForm />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
