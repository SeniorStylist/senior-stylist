import { SkeletonResidentRow } from '@/components/ui/skeleton'

export default function ResidentsLoading() {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-36 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-32 bg-stone-100 rounded-xl animate-pulse" />
      </div>

      {/* Search bar */}
      <div className="h-10 w-full bg-stone-100 rounded-xl animate-pulse mb-4" />

      {/* Resident rows */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <SkeletonResidentRow key={i} />
        ))}
      </div>
    </div>
  )
}
