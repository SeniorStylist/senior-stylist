import { SkeletonBookingCard } from '@/components/ui/skeleton'

export default function LogLoading() {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-32 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-28 bg-stone-100 rounded-xl animate-pulse" />
      </div>

      {/* Date nav */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-8 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-5 w-40 bg-stone-100 rounded animate-pulse" />
        <div className="h-8 w-8 bg-stone-100 rounded-xl animate-pulse" />
      </div>

      {/* Booking cards */}
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <SkeletonBookingCard key={i} />
        ))}
      </div>
    </div>
  )
}
