export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="skeleton-shimmer rounded-2xl h-10 w-48" />
      <div className="skeleton-shimmer rounded-2xl h-64" />
      <div className="grid md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-24" />
        ))}
      </div>
    </div>
  )
}
