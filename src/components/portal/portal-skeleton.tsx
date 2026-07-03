// Family-portal loading skeleton (13C). Rendered by each portal route's
// loading.tsx while the server component fetches — the burgundy masthead + nav
// come from layout.tsx and stay visible, so this only paints the content area.
// Matches the portal card language (white rounded-2xl cards on #FDF8F8), using
// the global `.skeleton` shimmer for the bars.

export function PortalPageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="py-2 space-y-4" aria-busy="true" aria-label="Loading">
      {/* page title */}
      <div className="skeleton h-7 w-44 rounded-xl" />
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5 space-y-3">
          <div className="skeleton h-4 w-1/3 rounded-lg" />
          <div className="skeleton h-3.5 w-2/3 rounded-lg" />
          <div className="skeleton h-3.5 w-1/2 rounded-lg" />
        </div>
      ))}
    </div>
  )
}
