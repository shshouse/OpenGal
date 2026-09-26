import * as React from 'react'
import { Check } from 'geist-icons'
import { cn } from '../../lib/utils'

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, disabled, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      disabled={disabled}
      className={cn(
        'peer relative h-4 w-4 shrink-0 appearance-none rounded border border-border bg-transparent',
        'transition-colors duration-150',
        'hover:border-muted-foreground/60',
        'checked:border-primary checked:bg-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Checkbox.displayName = 'Checkbox'

export function CheckboxIndicator({ className }: { className?: string }) {
  return (
    <Check
      size={10}
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
        'text-primary-foreground opacity-0 transition-opacity duration-100',
        'peer-checked:opacity-100',
        className
      )}
    />
  )
}
