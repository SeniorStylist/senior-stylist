export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton-shimmer rounded-2xl h-9 w-9" />
        <div className="skeleton-shimmer rounded-2xl h-9 w-64" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-20" />
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-16 border-b border-stone-100 last:border-0" />
        ))}
      </div>
    </div>
  )
}
