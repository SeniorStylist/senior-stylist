export default function Loading() {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="skeleton-shimmer rounded-2xl h-14 w-64 mb-6" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-shimmer rounded-2xl h-28" />
        ))}
      </div>
    </div>
  )
}
