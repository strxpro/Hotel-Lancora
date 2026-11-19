import Link from 'next/link';
import { AnchorMark } from '@/components/site/brand';

export default function NotFound() {
  return (
    <div className="flex min-h-[80svh] items-center bg-ivory pt-24">
      <div className="container-x text-center">
        <AnchorMark className="mx-auto h-16 w-14 text-gold" strokeWidth={1} />
        <p className="eyebrow mt-8 text-mist">404</p>
        <h1 className="display mt-4 text-title text-navy">Pagina non trovata</h1>
        <p className="mx-auto mt-5 max-w-md text-charcoal/75">Il sentiero che cercavi non esiste più. Torna al porto.</p>
        <Link href="/" className="btn btn-navy mt-10">
          Home
        </Link>
      </div>
    </div>
  );
}
