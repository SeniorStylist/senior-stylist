export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="skeleton-shimmer rounded-full h-12 w-12" />
        <div className="space-y-2">
          <div className="skeleton-shimmer rounded-xl h-6 w-48" />
          <div className="skeleton-shimmer rounded-xl h-4 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="skeleton-shimmer rounded-2xl h-40" />
        <div className="skeleton-shimmer rounded-2xl h-40" />
      </div>
      <div className="skeleton-shimmer rounded-2xl h-64" />
    </div>
  )
}
