import type { ComponentProps } from 'react';
import { Button } from './Button.tsx';
import { classNames } from './classNames.ts';

/** A card over a dimmed backdrop; clicking the backdrop closes it. */
export function Dialog({ onClose, className, children, ...props }: ComponentProps<'div'> & { onClose: () => void }) {
  return (
    <div
      data-slot="dialog-overlay"
      className="absolute inset-0 z-20 grid place-items-center bg-backdrop/60"
      onClick={onClose}
    >
      <div
        data-slot="dialog"
        role="dialog"
        aria-modal="true"
        className={classNames(
          'max-h-[90%] w-[min(560px,92%)] overflow-auto rounded-2xl border border-border bg-surface px-5 py-[18px] shadow-[0_20px_50px_var(--shadow)]',
          className,
        )}
        onClick={event => event.stopPropagation()}
        {...props}
      >
        <Button variant="ghost" className="float-right px-1.5 py-px text-[14px] hover:text-muted" onClick={onClose}>
          ✕
        </Button>
        {children}
      </div>
    </div>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="dialog-title" className={classNames('mb-0.5 text-lg font-bold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-description" className={classNames('mb-3.5 text-sm text-muted', className)} {...props} />
  );
}
