/**
 * Shown at once while the next panel page is on its way (the side menu stays): a gold bar running
 * along the top and the outline of the page, so a click never looks like nothing happened.
 */
export default function PanelLoading() {
  return (
    <div aria-busy="true" aria-label="Caricamento" className="relative">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-[3px] overflow-hidden">
        <span className="panel-progress block h-full w-1/3 bg-gradient-to-r from-transparent via-gold to-gold" />
      </div>
      <div className="mb-7 space-y-3">
        <span className="block h-3 w-24 animate-pulse rounded-full bg-sand-2" />
        <span className="block h-9 w-64 animate-pulse rounded-full bg-sand-2" />
        <span className="block h-3 w-96 max-w-full animate-pulse rounded-full bg-sand-2" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-40 animate-pulse rounded-3xl bg-white ring-1 ring-line" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <span className="mt-4 block h-72 animate-pulse rounded-3xl bg-white ring-1 ring-line" />
    </div>
  );
}
