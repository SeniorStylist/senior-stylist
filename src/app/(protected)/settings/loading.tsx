export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="skeleton-shimmer rounded-2xl h-8 w-32 mb-2" />
      <div className="skeleton-shimmer rounded-md h-4 w-48 mb-6" />
      <div className="md:flex md:gap-0">
        <nav className="md:w-60 md:shrink-0 md:border-r md:border-stone-100 md:pr-4 space-y-4">
          <div className="skeleton-shimmer rounded-xl h-9" />
          {[3, 2, 1].map((count, g) => (
            <div key={g} className="space-y-1.5">
              <div className="skeleton-shimmer rounded h-3 w-20" />
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="skeleton-shimmer rounded-xl h-9" />
              ))}
            </div>
          ))}
        </nav>
        <div className="flex-1 min-w-0 md:pl-7 mt-4 md:mt-0">
          <div className="flex items-start gap-3 mb-6">
            <div className="skeleton-shimmer rounded-xl h-10 w-10 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton-shimmer rounded h-5 w-40" />
              <div className="skeleton-shimmer rounded h-3.5 w-64" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="skeleton-shimmer rounded-2xl h-40" />
            <div className="skeleton-shimmer rounded-2xl h-64" />
          </div>
        </div>
      </div>
    </div>
  )
}
