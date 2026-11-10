import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={classNames(
        'rounded-lg border border-border bg-background px-2 py-[3px] placeholder:text-[#757575]',
        className,
      )}
      {...props}
    />
  );
}
