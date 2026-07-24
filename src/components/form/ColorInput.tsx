import type { InputHTMLAttributes } from 'react';

// A themed native color input — the swatch fills the standard 40px control.
export function ColorInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input {...props} type="color" className={`field colorinput${className ? ` ${className}` : ''}`} />;
}
