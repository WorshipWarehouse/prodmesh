import type { InputHTMLAttributes, ReactNode } from 'react';
import { Check } from 'lucide-react';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
};

export function Checkbox({ label, className = '', ...props }: CheckboxProps) {
  return (
    <label className={`checkbox${className ? ` ${className}` : ''}`}>
      <span className="checkbox__box">
        <input className="checkbox__input" type="checkbox" {...props} />
        <Check className="checkbox__check" size={12} strokeWidth={3} aria-hidden />
      </span>
      <span className="checkbox__label">{label}</span>
    </label>
  );
}
