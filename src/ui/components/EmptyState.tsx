import type { ComponentProps, ReactNode } from 'react';
import { classNames } from './classNames.ts';

/** A centred message that fills the space where content would be. */
export function EmptyState({
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & { title: ReactNode }) {
  return (
    <div
      data-slot="empty-state"
      className={classNames('grid h-full place-items-center p-[30px] text-center text-muted', className)}
      {...props}
    >
      <div>
        <h2 className="my-[0.83em] text-xl font-bold text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function EmptyStateText({ className, ...props }: ComponentProps<'p'>) {
  return <p className={classNames('my-[1em]', className)} {...props} />;
}
