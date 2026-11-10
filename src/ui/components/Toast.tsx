import type { ComponentProps } from 'react';
import { Button } from './Button.tsx';
import { classNames } from './classNames.ts';

/** Where toasts stack: bottom centre of the surface. */
export function Toaster({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="toaster"
      className={classNames('absolute bottom-11 left-1/2 z-30 grid -translate-x-1/2 gap-1.5', className)}
      {...props}
    />
  );
}

export function Toast({
  variant = 'default',
  action,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  variant?: 'default' | 'error';
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      data-slot="toast"
      data-variant={variant}
      className={classNames(
        'flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-1.5 text-[12.5px] shadow-[0_8px_24px_var(--shadow)]',
        variant === 'error' && 'border-danger',
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {action && (
        <Button variant="link" className="font-semibold" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
