import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-stone-100 shadow-sm',
        onClick && 'cursor-pointer hover:border-stone-200 hover:shadow-md transition-all duration-150',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
