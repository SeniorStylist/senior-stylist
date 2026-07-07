import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  icon: LucideIcon
  title: string
  /** Count / one-line description shown under the title. */
  subtitle?: React.ReactNode
  /** Extra classes on the outer wrapper (e.g. spacing overrides). */
  className?: string
  /** Optional data-tour anchor forwarded to the wrapper. */
  'data-tour'?: string
}

/**
 * Canonical page header: a burgundy icon chip + DM Serif title + muted subtitle.
 * Renders only the left block — pages keep their own actions row beside it.
 * The single source of truth for "what screen am I on" across the app.
 */
export function PageHeader({ icon: Icon, title, subtitle, className, ...rest }: PageHeaderProps) {
  return (
    <div className={cn('flex items-center gap-3 min-w-0', className)} data-tour={rest['data-tour']}>
      <div className="w-11 h-11 rounded-2xl bg-[#F9EFF2] text-[#8B2E4A] flex items-center justify-center shrink-0">
        <Icon size={22} />
      </div>
      <div className="min-w-0">
        <h1
          className="text-2xl font-normal text-stone-900 leading-tight truncate"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          {title}
        </h1>
        {subtitle != null && <div className="text-sm text-stone-500 mt-0.5 truncate">{subtitle}</div>}
      </div>
    </div>
  )
}
