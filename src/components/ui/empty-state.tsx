'use client'

import { cn } from '@/lib/utils'
import { Button } from './button'

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description?: string
  cta?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({ icon, title, description, cta, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-10 px-6 text-center',
        className
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-stone-50 flex items-center justify-center text-stone-400 mb-1">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-stone-700">{title}</p>
        {description && <p className="text-xs text-stone-400">{description}</p>}
      </div>
      {cta && (
        <Button variant="primary" size="md" onClick={cta.onClick} className="mt-1">
          {cta.label}
        </Button>
      )}
    </div>
  )
}
