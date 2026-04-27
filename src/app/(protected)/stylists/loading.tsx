export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="skeleton-shimmer rounded-2xl h-9 w-40" />
        <div className="skeleton-shimmer rounded-2xl h-9 w-32" />
      </div>
      <div className="skeleton-shimmer rounded-2xl h-10 w-full" />
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-14 border-b border-stone-100 last:border-0" />
        ))}
      </div>
    </div>
  )
}
