export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="skeleton rounded-2xl h-10 w-56 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton rounded-2xl h-20" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton rounded-2xl h-40" />)}
      </div>
    </div>
  )
}
