export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="skeleton-shimmer rounded-2xl h-8 w-32 mb-6" />
      <div className="md:flex md:gap-0">
        <nav className="md:w-56 md:shrink-0 md:border-r md:border-stone-100 md:pr-4 space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer rounded-xl h-9" />
          ))}
        </nav>
        <div className="flex-1 min-w-0 md:pl-6 mt-4 md:mt-0 space-y-4">
          <div className="skeleton-shimmer rounded-2xl h-40" />
          <div className="skeleton-shimmer rounded-2xl h-64" />
        </div>
      </div>
    </div>
  )
}
