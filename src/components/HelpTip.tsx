import { HelpCircle } from 'lucide-react';

// The circular "?" for supplementary info (see docs/UI_TEXT.md). Content must
// be optional reading — never the only place must-know information lives.
// Shows on hover and on keyboard focus.
export function HelpTip({ text }: { text: string }) {
  return (
    <span className="helptip">
      <button type="button" className="helptip__btn" aria-label={text}>
        <HelpCircle size={14} aria-hidden />
      </button>
      <span role="tooltip" className="helptip__bubble">{text}</span>
    </span>
  );
}
