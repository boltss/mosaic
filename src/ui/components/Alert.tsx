import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

const alertVariants = cva('px-2.5 py-2 text-sm', {
  variants: { variant: { default: 'text-muted', warning: 'text-warning' } },
  defaultVariants: { variant: 'default' },
});

/** A short note that takes the place of content: why something is hidden, missing or failed. */
export function Alert({ variant, className, ...props }: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? 'default'}
      className={classNames(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
