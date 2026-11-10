import { cva, type VariantProps } from 'class-variance-authority';
import { classNames } from './classNames.ts';

const trackVariants = cva('overflow-hidden bg-subtle', {
  variants: {
    size: {
      default: 'h-2 min-w-[60px] flex-1 rounded-full',
      small: 'h-1 w-[34px] flex-none rounded-[9px]',
    },
  },
  defaultVariants: { size: 'default' },
});
const fillVariants = cva('block h-full', {
  variants: {
    size: {
      default: 'bg-[linear-gradient(90deg,#238636,var(--success))] transition-[width] duration-250',
      small: 'bg-success',
    },
  },
  defaultVariants: { size: 'default' },
});

/** A bar filled to `value` percent. */
export function Progress({
  value,
  size,
  className,
}: { value: number; className?: string } & VariantProps<typeof trackVariants>) {
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={classNames(trackVariants({ size }), className)}
    >
      <span className={fillVariants({ size })} style={{ width: `${value}%` }} />
    </div>
  );
}
