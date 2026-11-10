import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

const groupVariants = cva('flex overflow-hidden border border-border', {
  variants: { size: { default: 'rounded-lg', small: 'flex-none rounded-md' } },
  defaultVariants: { size: 'default' },
});
const itemVariants = cva('cursor-pointer text-muted data-[state=on]:bg-border data-[state=on]:text-foreground', {
  variants: { size: { default: 'px-[9px] py-0.5', small: 'px-1.5 text-[10.5px]' } },
  defaultVariants: { size: 'default' },
});

export interface ToggleOption<Value extends string> {
  value: Value;
  label: string;
}

/** A row of mutually exclusive choices, one of which is always on. */
export function ToggleGroup<Value extends string>({
  options,
  value,
  onValueChange,
  size,
  className,
  ...props
}: {
  options: ToggleOption<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
} & VariantProps<typeof groupVariants> &
  Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div data-slot="toggle-group" role="group" className={classNames(groupVariants({ size }), className)} {...props}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          data-slot="toggle-group-item"
          data-state={option.value === value ? 'on' : 'off'}
          aria-pressed={option.value === value}
          className={itemVariants({ size })}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
