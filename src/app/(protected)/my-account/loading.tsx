export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-5">
      <div className="skeleton-shimmer rounded-2xl h-9 w-44" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-24" />
        ))}
      </div>
      <div className="skeleton-shimmer rounded-2xl h-48" />
      <div className="skeleton-shimmer rounded-2xl h-48" />
      <div className="skeleton-shimmer rounded-2xl h-32" />
    </div>
  )
}
