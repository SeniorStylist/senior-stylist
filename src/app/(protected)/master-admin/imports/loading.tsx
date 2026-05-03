export default function ImportsLoading() {
  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="h-4 w-32 skeleton rounded mb-6" />
        <div className="h-8 w-40 skeleton rounded mb-2" />
        <div className="h-4 w-72 skeleton rounded mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 skeleton rounded" />
                  <div className="h-3 w-full skeleton rounded" />
                  <div className="h-3 w-2/3 skeleton rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
