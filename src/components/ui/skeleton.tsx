'use client'

import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('skeleton', className)} />
  )
}

export function SkeletonBookingCard() {
  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
      <div className="flex items-center gap-3 mb-3">
        <Skeleton className="w-8 h-8 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-36 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-full rounded mb-2" />
      <Skeleton className="h-3 w-3/4 rounded" />
    </div>
  )
}

export function SkeletonResidentRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-stone-50">
      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-32 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
      <Skeleton className="h-3.5 w-14 rounded" />
      <Skeleton className="h-3.5 w-14 rounded" />
    </div>
  )
}

export function SkeletonStatCard() {
  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-3">
      <Skeleton className="h-3 w-20 rounded" />
      <Skeleton className="h-8 w-28 rounded" />
    </div>
  )
}
