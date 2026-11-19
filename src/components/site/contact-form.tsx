'use client';
import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { useI18n } from './providers';
import { sendContact } from '@/app/[locale]/contatti/actions';

export function ContactForm() {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (state === 'sent')
    return (
      <div className="flex items-start gap-4 border border-line bg-white p-8" role="status">
        <Check className="mt-1 h-5 w-5 text-sage" />
        <p className="serif text-[1.7rem] leading-snug text-navy">{t.contact.sent}</p>
      </div>
    );

  return (
    <form
      className="grid gap-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await sendContact(Object.fromEntries(f));
          if (r.ok) setState('sent');
          else setError(r.error ?? t.common.error);
        });
      }}
    >
      <label className="block">
        <span className="label">{t.contact.name}</span>
        <input name="name" required minLength={2} maxLength={80} autoComplete="name" className="field" />
      </label>
      <label className="block">
        <span className="label">{t.contact.email}</span>
        <input name="email" type="email" required maxLength={120} autoComplete="email" className="field" />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">{t.contact.subject}</span>
        <input name="subject" maxLength={120} className="field" />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">{t.contact.message}</span>
        <textarea name="message" required minLength={5} maxLength={2000} rows={6} className="field resize-y" />
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {error && <p className="text-sm text-terracotta sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="btn btn-navy">
          {pending ? t.common.loading : t.contact.send}
        </button>
      </div>
    </form>
  );
}
