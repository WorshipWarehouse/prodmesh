import { cloneElement, useId, type ReactElement } from 'react';
import { HelpTip } from '../HelpTip';

// Label-above-control field (the .lfield visual language). The label is
// associated via htmlFor/id so the optional HelpTip sits beside the label
// text without leaking into the control's accessible name.
export function Field({ label, help, width, children }: {
  label: string;
  help?: string;
  width?: 'grow' | 'md' | 'sm' | 'xs';
  children: ReactElement<{ id?: string }>;
}) {
  const autoId = useId();
  const id = children.props.id ?? autoId;
  return (
    <div className={`ffield${width ? ` ffield--${width}` : ''}`}>
      <span className="ffield__label">
        <label htmlFor={id}>{label}</label>
        {help && <HelpTip text={help} />}
      </span>
      {cloneElement(children, { id })}
    </div>
  );
}
