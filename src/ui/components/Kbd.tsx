import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

/** A key the reader can press. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={classNames(
        'rounded-sm border border-b-2 border-border bg-background px-1 font-mono text-[10.5px] leading-[normal]',
        className,
      )}
      {...props}
    />
  );
}
