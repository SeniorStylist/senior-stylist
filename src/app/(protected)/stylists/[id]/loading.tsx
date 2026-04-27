export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton-shimmer rounded-full h-12 w-12" />
        <div className="space-y-2">
          <div className="skeleton-shimmer rounded-xl h-6 w-56" />
          <div className="skeleton-shimmer rounded-xl h-4 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-24" />
        ))}
      </div>
      <div className="skeleton-shimmer rounded-2xl h-48" />
      <div className="skeleton-shimmer rounded-2xl h-48" />
    </div>
  )
}
