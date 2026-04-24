'use client'

import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 ease-out active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B2E4A]/30 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none disabled:translate-y-0'

    const variants = {
      primary:
        'bg-[#8B2E4A] text-white hover:bg-[#72253C] shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:shadow-[0_6px_16px_rgba(139,46,74,0.32)] hover:-translate-y-[1.5px] active:shadow-none',
      secondary:
        'bg-stone-100 text-stone-800 border border-transparent hover:bg-[#F9EFF2]/60 hover:border-[#C4687A] hover:text-[#8B2E4A] active:bg-[#F9EFF2]',
      ghost: 'bg-transparent text-stone-700 hover:bg-stone-100 active:bg-stone-200 active:scale-[0.95]',
      danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100',
    }

    const sizes = {
      sm: 'text-xs px-3 py-1.5',
      md: 'text-sm px-4 py-2.5',
      lg: 'text-sm px-5 py-3',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
