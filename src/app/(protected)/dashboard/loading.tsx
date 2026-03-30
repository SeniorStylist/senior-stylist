import { SkeletonBookingCard, SkeletonStatCard } from '@/components/ui/skeleton'

export default function DashboardLoading() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="h-8 w-40 bg-stone-100 rounded-xl animate-pulse mb-6" />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>

      {/* Booking cards */}
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <SkeletonBookingCard key={i} />
        ))}
      </div>
    </div>
  )
}
