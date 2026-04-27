export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="skeleton-shimmer rounded-2xl h-9 w-36" />
        <div className="skeleton-shimmer rounded-2xl h-9 w-28" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-20" />
        ))}
      </div>
    </div>
  )
}
