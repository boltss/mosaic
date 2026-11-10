import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

export const buttonVariants = cva('cursor-pointer whitespace-nowrap disabled:cursor-not-allowed', {
  variants: {
    variant: {
      /** Bare text that brightens on hover: close buttons, quiet links. */
      ghost: 'text-muted hover:text-foreground',
      /** Bare text in the accent colour: inline actions. */
      link: 'px-1.5 py-px text-primary',
      /** Bordered button that takes the colour of the text around it. */
      outline: 'border border-border',
      /** The one primary action on a surface. */
      approve: 'rounded-lg border border-approve-border bg-approve px-3 py-[3px] font-semibold text-white',
      /** Rounded status chip that opens something. */
      pill: 'flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-sm text-muted hover:border-success',
      /** A warning the reader can act on. */
      warning:
        'my-[3px] inline-block rounded-lg border border-warning/45 bg-warning/8 px-2 py-px text-left text-xs whitespace-normal text-warning',
    },
    size: {
      inherit: '',
      small: 'text-sm',
      large: 'px-1 text-xl',
    },
  },
  compoundVariants: [
    { variant: 'outline', size: 'inherit', className: 'rounded-md bg-surface px-1.5 text-xs' },
    { variant: 'outline', size: 'small', className: 'rounded-lg bg-background px-[9px] py-0.5 text-foreground' },
  ],
  defaultVariants: { variant: 'outline', size: 'inherit' },
});

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      type={type}
      className={classNames(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
