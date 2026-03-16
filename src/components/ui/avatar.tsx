import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  color?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-xs',
  lg: 'w-11 h-11 text-sm',
}

export function Avatar({ name, color, size = 'md', className }: AvatarProps) {
  const initials = getInitials(name)

  if (color) {
    return (
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-semibold shrink-0',
          sizes[size],
          className
        )}
        style={{ backgroundColor: color + '20', color }}
      >
        {initials}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold shrink-0 bg-teal-50 text-teal-700',
        sizes[size],
        className
      )}
    >
      {initials}
    </div>
  )
}
