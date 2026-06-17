export default function SignupSheetLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="skeleton w-11 h-11 rounded-2xl" />
        <div className="space-y-2">
          <div className="skeleton h-7 w-44 rounded-full" />
          <div className="skeleton h-3.5 w-56 rounded-full" />
        </div>
      </div>

      {/* Pending list card */}
      <div className="rounded-2xl border border-stone-100 bg-white shadow-[var(--shadow-sm)]">
        <div className="px-5 pt-5 pb-4 border-b border-stone-100">
          <div className="skeleton h-3 w-32 rounded-full mb-1.5" />
          <div className="skeleton h-3 w-24 rounded-full" />
        </div>
        <div className="divide-y divide-stone-50">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="px-5 py-4 flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-4 w-40 rounded-full" />
                <div className="skeleton h-3 w-28 rounded-full" />
                <div className="skeleton h-3 w-20 rounded-full" />
              </div>
              <div className="skeleton h-7 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      {/* Add form card */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton h-10 w-full rounded-xl" />
        <div className="skeleton h-10 w-full rounded-xl" />
        <div className="skeleton h-10 w-full rounded-xl" />
        <div className="skeleton h-16 w-full rounded-xl" />
        <div className="skeleton h-10 w-32 rounded-xl" />
      </div>
    </div>
  )
}
