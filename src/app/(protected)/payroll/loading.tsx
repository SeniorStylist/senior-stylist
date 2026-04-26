export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="skeleton-shimmer rounded-2xl h-10 w-48" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-14" />
        ))}
      </div>
    </div>
  )
}
