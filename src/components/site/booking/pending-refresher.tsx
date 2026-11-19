'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** While a Stripe payment awaits its webhook, refresh the page every 2.5 s (max ~2 min). */
export function PendingRefresher() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      if (++n > 48) return window.clearInterval(id);
      router.refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [router]);
  return null;
}
