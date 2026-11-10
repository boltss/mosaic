import { useEffect, useRef, type ComponentProps } from 'react';
import { classNames } from './classNames.ts';

export type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** Some, but not all, of what this checkbox stands for is checked. */
  indeterminate?: boolean;
};

export function Checkbox({ indeterminate = false, className, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      data-slot="checkbox"
      type="checkbox"
      className={classNames('cursor-pointer accent-success disabled:cursor-not-allowed disabled:opacity-50', className)}
      {...props}
    />
  );
}
