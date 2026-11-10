import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

/** A small outlined label in one colour: the text and a softer border of the same hue. */
export function Badge({ color, className, style, ...props }: ComponentProps<'span'> & { color: string }) {
  return (
    <span
      data-slot="badge"
      className={classNames('flex-none rounded-[9px] border px-1.5 text-2xs whitespace-nowrap', className)}
      style={{ color, borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, ...style }}
      {...props}
    />
  );
}
