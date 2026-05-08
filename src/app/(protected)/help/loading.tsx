export default function HelpLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="skeleton-shimmer h-9 w-48 rounded-xl mb-3" />
      <div className="skeleton-shimmer h-4 w-72 rounded-md mb-6" />
      <div className="skeleton-shimmer h-3 w-24 rounded mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-stone-100 bg-white p-5 h-44 skeleton-shimmer"
          />
        ))}
      </div>
    </div>
  )
}
