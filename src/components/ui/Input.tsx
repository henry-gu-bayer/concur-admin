import { InputHTMLAttributes, SelectHTMLAttributes, forwardRef } from 'react';

const baseField =
  'flex w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm transition-colors ' +
  'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...rest },
  ref
) {
  return <input ref={ref} className={`${baseField} h-10 ${className}`} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = '', children, ...rest },
  ref
) {
  return (
    <select ref={ref} className={`${baseField} h-10 ${className}`} {...rest}>
      {children}
    </select>
  );
});
