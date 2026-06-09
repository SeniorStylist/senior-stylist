export default function Loading() {
  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="skeleton-shimmer rounded-2xl h-6 w-40 mb-6" />
        <div className="skeleton-shimmer rounded-2xl h-72 w-full" />
      </div>
    </div>
  )
}
