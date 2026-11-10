import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names, letting a later Tailwind class override an earlier conflicting one. */
export function classNames(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
