'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, MessageCircle, Phone, Send } from 'lucide-react';
import type { Locale } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n } from './providers';

const T: Record<Locale, { hint: string; msg: string; label: string; send: string; call: string; note: string }> = {
  it: { hint: 'Scrivici o chiamaci', msg: 'Buongiorno, vorrei informazioni per un soggiorno all’{hotel}.', label: 'Il tuo messaggio', send: 'Invia su WhatsApp', call: 'Chiama', note: 'Si apre WhatsApp con il tuo messaggio già scritto: basta premere invio.' },
  en: { hint: 'Message or call us', msg: 'Hello, I would like some information about a stay at {hotel}.', label: 'Your message', send: 'Send on WhatsApp', call: 'Call', note: 'WhatsApp opens with your message already written: just press send.' },
  pl: { hint: 'Napisz lub zadzwoń', msg: 'Dzień dobry, chciałbym zapytać o pobyt w Waszym hotelu.', label: 'Twoja wiadomość', send: 'Wyślij przez WhatsApp', call: 'Zadzwoń', note: 'Otworzy się WhatsApp z gotową wiadomością: wystarczy nacisnąć wyślij.' },
  de: { hint: 'Schreiben oder anrufen', msg: 'Guten Tag, ich hätte gerne Informationen zu einem Aufenthalt im {hotel}.', label: 'Ihre Nachricht', send: 'Über WhatsApp senden', call: 'Anrufen', note: 'WhatsApp öffnet sich mit Ihrer Nachricht: einfach auf Senden tippen.' },
  fr: { hint: 'Écrivez-nous ou appelez-nous', msg: 'Bonjour, je souhaiterais des informations pour un séjour à l’{hotel}.', label: 'Votre message', send: 'Envoyer sur WhatsApp', call: 'Appeler', note: 'WhatsApp s’ouvre avec votre message déjà écrit : il suffit d’appuyer sur envoyer.' },
  es: { hint: 'Escríbenos o llámanos', msg: 'Hola, quisiera información sobre una estancia en el {hotel}.', label: 'Tu mensaje', send: 'Enviar por WhatsApp', call: 'Llamar', note: 'Se abre WhatsApp con tu mensaje ya escrito: solo tienes que pulsar enviar.' },
};

/**
 * WhatsApp on the Contatti page: a tap opens a small box with a message already written in the
 * visitor's language (they can change it) and two choices: send it on WhatsApp (the app opens with
 * that text, ready to send) or call the same number.
 */
export function WhatsAppContact({ number, hotel }: { number: string; hotel: string }) {
  const { locale } = useI18n();
  const x = T[locale] ?? T.it;
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(() => x.msg.replace('{hotel}', hotel));
  const digits = number.replace(/\D/g, '');
  const tel = `+${digits}`;
  return (
    <li className="flex gap-4" data-testid="whatsapp-contact">
      <MessageCircle className="mt-1 h-4 w-4 shrink-0 text-[#128c4a]" />
      <span className="min-w-0 flex-1">
        <span className="label mb-1">WhatsApp</span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group inline-flex items-center gap-2 text-left text-navy">
          <span className="link-u">{number}</span>
          <span className="rounded-full bg-[#25d366]/12 px-2.5 py-0.5 text-[0.7rem] font-semibold text-[#128c4a]">{x.hint}</span>
          <ChevronDown className={cn('h-4 w-4 text-mist transition-transform duration-300', open && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div key="wa" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
              <div className="mt-3 max-w-md rounded-2xl border border-[#25d366]/30 bg-white p-4 shadow-[0_24px_50px_-34px_rgba(18,140,74,0.6)]">
                <label htmlFor="wa-msg" className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-mist">
                  {x.label}
                </label>
                <textarea id="wa-msg" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} className="field mt-1.5 w-full resize-none text-[0.92rem]" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <motion.a
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    href={`https://wa.me/${digits}${msg.trim() ? `?text=${encodeURIComponent(msg.trim())}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="whatsapp-send"
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-[#25d366] px-5 text-[0.78rem] font-semibold text-white shadow-[0_14px_28px_-16px_rgba(18,140,74,0.9)] transition-colors hover:bg-[#1fbe5b]"
                  >
                    <Send className="h-4 w-4" /> {x.send}
                  </motion.a>
                  <motion.a whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }} href={`tel:${tel}`} data-testid="whatsapp-call" className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[0.78rem] font-semibold text-navy transition-colors hover:border-navy">
                    <Phone className="h-4 w-4" /> {x.call}
                  </motion.a>
                </div>
                <p className="mt-2.5 text-[0.75rem] text-mist">{x.note}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    </li>
  );
}
