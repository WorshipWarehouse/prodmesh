import { HelpCircle } from 'lucide-react';

// The circular "?" for supplementary info (see docs/UI_TEXT.md). Content must
// be optional reading — never the only place must-know information lives.
// Shows on hover and on keyboard focus.
//
// `place` is for triggers near the top of the window, where a bubble above
// would be cut off by the viewport (the setup wizard's step titles).
export function HelpTip({ text, place = 'above' }: { text: string; place?: 'above' | 'below' }) {
  return (
    <span className="helptip">
      <button type="button" className="helptip__btn" aria-label={text}>
        <HelpCircle size={14} aria-hidden />
      </button>
      <span role="tooltip" className={`helptip__bubble helptip__bubble--${place}`}>{text}</span>
    </span>
  );
}
