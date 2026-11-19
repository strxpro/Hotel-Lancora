'use client';
import { Printer } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Prints the page as it is (the panel's menus disappear on paper, see globals.css). */
export function PrintButton({ label = 'Stampa', className }: { label?: string; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={cn('inline-flex h-10 items-center gap-2 rounded-full border border-navy px-4 text-xs font-semibold text-navy transition hover:bg-navy hover:text-ivory print:hidden', className)}>
      <Printer className="h-4 w-4" /> {label}
    </button>
  );
}

/** The top of the printed sheet (invisible on screen): hotel, title, period, when it was printed. */
export function PrintHeader({ hotel, title, period }: { hotel: string; title: string; period: string }) {
  return (
    <div className="mb-6 hidden border-b border-navy/30 pb-4 print:block">
      <p className="text-[9pt] uppercase tracking-[0.3em] text-gold-2">{hotel}</p>
      <p className="serif mt-1 text-[22pt] leading-tight text-navy">{title}</p>
      <p className="mt-1 text-[9pt] text-mist">
        {period} · stampato il {new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date())}
      </p>
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * A clean sheet in a window of its own (table, totals per method, signature line) and the print
 * dialog straight away. Used by Pagamenti → Movimenti for a period or the ticked rows.
 */
export function printSheet(p: { hotel: string; title: string; period: string; columns: string[]; rows: string[][]; alignRight?: number[]; totals: [string, string][] }) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) return false;
  const right = new Set(p.alignRight ?? []);
  const when = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date());
  w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(p.title)} · ${esc(p.hotel)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #10283D; margin: 0; padding: 28px; }
  .eyebrow { font: 600 9pt Arial, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #9a7b4c; }
  h1 { font-weight: normal; font-size: 24pt; margin: 6px 0 2px; }
  .meta { font: 9pt Arial, sans-serif; color: #6b7376; margin-bottom: 22px; }
  table { width: 100%; border-collapse: collapse; font: 9.5pt Arial, sans-serif; }
  th { text-align: left; font-size: 7.5pt; letter-spacing: .14em; text-transform: uppercase; color: #6b7376; border-bottom: 1.5px solid #10283D; padding: 7px 6px; }
  td { padding: 7px 6px; border-bottom: 1px solid #e7d9c1; vertical-align: top; }
  tr:nth-child(even) td { background: #faf7f1; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .neg { color: #b4573c; }
  .totals { margin-top: 18px; margin-left: auto; width: 320px; font: 10pt Arial, sans-serif; }
  .totals div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #e7d9c1; }
  .totals div:last-child { border-bottom: 2px solid #10283D; font-weight: bold; font-size: 11.5pt; }
  .sign { margin-top: 60px; display: flex; justify-content: space-between; font: 9pt Arial, sans-serif; color: #6b7376; }
  .sign span { border-top: 1px solid #10283D; padding-top: 6px; width: 220px; text-align: center; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="eyebrow">${esc(p.hotel)}</div>
<h1>${esc(p.title)}</h1>
<div class="meta">${esc(p.period)} · stampato il ${esc(when)}</div>
<table><thead><tr>${p.columns.map((c, i) => `<th${right.has(i) ? ' class="r"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${p.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${right.has(i) ? 'r' : ''}${right.has(i) && c.trim().startsWith('-') ? ' neg' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<div class="totals">${p.totals.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
<div class="sign"><span>Data</span><span>Firma</span></div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };</script>
</body></html>`);
  w.document.close();
  return true;
}
