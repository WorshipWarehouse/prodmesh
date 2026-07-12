import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement>;

// A consistent themed trigger while retaining the native select's keyboard,
// screen-reader, and platform input behavior.
export function SelectField({ className = '', children, ...props }: SelectFieldProps) {
  return (
    <span className={`selectfield${className ? ` ${className}` : ''}`}>
      <select className="selectfield__control" {...props}>
        {children}
      </select>
      <ChevronDown className="selectfield__icon" size={14} aria-hidden />
    </span>
  );
}
