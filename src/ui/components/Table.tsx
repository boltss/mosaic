import type { ComponentProps } from 'react';
import { classNames } from './classNames.ts';

export function Table({ className, children, ...props }: ComponentProps<'table'>) {
  return (
    <table data-slot="table" className={classNames('mt-2 w-full border-collapse text-sm', className)} {...props}>
      <tbody>{children}</tbody>
    </table>
  );
}

export function TableRow(props: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" {...props} />;
}

type Alignment = { align?: 'left' | 'right' };
const alignment = (align: Alignment['align']) => (align === 'right' ? 'text-right' : 'text-left');

export function TableHead({ align, className, ...props }: Omit<ComponentProps<'th'>, 'align'> & Alignment) {
  return (
    <th
      data-slot="table-head"
      className={classNames('border-b border-subtle py-1 font-normal text-muted', alignment(align), className)}
      {...props}
    />
  );
}

export function TableCell({ align, className, ...props }: Omit<ComponentProps<'td'>, 'align'> & Alignment) {
  return (
    <td
      data-slot="table-cell"
      className={classNames('border-b border-subtle py-1 tabular-nums', alignment(align), className)}
      {...props}
    />
  );
}
