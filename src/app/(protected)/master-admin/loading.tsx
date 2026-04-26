export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="skeleton-shimmer rounded-2xl h-10 w-48" />
      <div className="skeleton-shimmer rounded-2xl h-12" />
      <div className="grid md:grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-32" />
        ))}
      </div>
    </div>
  )
}
