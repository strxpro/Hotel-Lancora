import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/guard';
import { MEDIA } from '@/content/media';
import { AnchorMark } from '@/components/site/brand';
import { LoginForm } from '@/components/admin/login-form';
import { demoLogin } from '../auth-actions';

export const metadata: Metadata = { title: 'Accesso pannello', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect('/admin');
  const { next } = await searchParams;
  const demo = process.env.DEMO_MODE === 'true' && process.env.PUBLIC_DEMO !== 'true';
  return (
    <div className="grid min-h-dvh bg-ivory lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-navy lg:block">
        <Image src={MEDIA.torreTramonto.src} alt="" fill preload sizes="50vw" className="object-cover opacity-70" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,28,43,0.2),rgba(10,28,43,0.75))]" />
        <div className="absolute bottom-12 left-12 right-12 text-ivory">
          <AnchorMark className="h-12 w-10 text-gold" />
          <p className="display mt-6 text-[3.6rem]">Il tuo hotel, sotto controllo.</p>
          <p className="mt-4 max-w-md text-ivory/75">Prenotazioni, planning camere, prezzi e assistente in un unico pannello semplice.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 text-navy">
            <AnchorMark className="h-9 w-8" />
            <div>
              <p className="text-[0.55rem] font-semibold tracking-[0.42em]">HOTEL</p>
              <p className="serif text-2xl leading-none">L’Ancora · Pannello</p>
            </div>
          </div>
          <h1 className="serif mt-12 text-[2.6rem] leading-none text-navy">Bentornato</h1>
          <p className="mt-3 text-sm text-mist">Accedi per gestire camere, prenotazioni e disponibilità.</p>
          <LoginForm next={next ?? ''} />
          {demo && (
            <div className="mt-10 border-t border-line pt-8">
              <p className="label">Modalità demo</p>
              <p className="mb-4 text-xs text-mist">Accesso rapido per la presentazione (disattivato con DEMO_MODE=false). Le credenziali demo sono nel file README.</p>
              <div className="grid grid-cols-2 gap-3">
                <form action={demoLogin.bind(null, 'admin')}>
                  <button className="btn btn-gold h-11 min-h-0 w-full">Proprietario</button>
                </form>
                <form action={demoLogin.bind(null, 'staff')}>
                  <button className="btn btn-line h-11 min-h-0 w-full text-navy">Reception</button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
