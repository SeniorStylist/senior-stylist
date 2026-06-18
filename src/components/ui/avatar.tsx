import { cn } from '@/lib/utils'
import { getAvatarColor } from '@/lib/avatar-colors'
import { getInitials } from '@/lib/get-initials'

interface AvatarProps {
  name: string
  color?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  photoUrl?: string | null
}

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-[12px]',
  lg: 'w-11 h-11 text-sm',
}

export function Avatar({ name, color, size = 'md', className, photoUrl }: AvatarProps) {
  const initials = getInitials(name)

  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        className={cn(
          'rounded-full object-cover shrink-0',
          sizes[size],
          className
        )}
      />
    )
  }

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

  const palette = getAvatarColor(name)

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold shrink-0',
        sizes[size],
        className
      )}
      style={{ backgroundColor: palette.bg, color: palette.text }}
    >
      {initials}
    </div>
  )
}
