import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

/** Placeholder for content that is still loading. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={classNames(
        'm-2 h-[46px] animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--border-subtle),var(--surface),var(--border-subtle))] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
