import { SelectField } from '../components/SelectField';
import type { ServicePlan } from '../api';
import type { WidgetConfig } from '../widgets/types';

// The dashboard's context bar: which event, and which of its service times.
//
// It sets the config EVERY widget on the canvas inherits, rather than each
// widget carrying its own — so re-scoping a dashboard to the 9:30 service is
// one dropdown, not twelve.
//
// "Follow the room" is the default and is not a placeholder: it means an empty
// config, which each widget resolves to the room's own next service. That is
// what lets a screen sit in a lobby for a year without being reconfigured.

const FOLLOW = '';

const timeLabel = (time: { name: string | null; startsAt: string | null }) => {
  const clock = time.startsAt
    ? new Date(time.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  return [time.name, clock].filter(Boolean).join(' · ') || 'Service';
};

export function ViewMenubar({
  plans,
  config,
  onChange,
  right,
}: {
  plans: ServicePlan[];
  config: WidgetConfig;
  onChange: (next: WidgetConfig) => void;
  /** Actions for the far end — Edit, mostly. */
  right?: React.ReactNode;
}) {
  const plan = plans.find((p) => p.id === config.planId) ?? null;

  return (
    <div className="viewbar">
      <label className="viewbar__field">
        <span>Event</span>
        <SelectField
          value={config.planId ?? FOLLOW}
          onChange={(e) =>
            onChange(e.target.value === FOLLOW ? {} : { planId: e.target.value })
          }
        >
          <option value={FOLLOW}>Follow the room</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {[p.title, p.dates].filter(Boolean).join(' · ')}
            </option>
          ))}
        </SelectField>
      </label>

      <label className="viewbar__field">
        <span>Service time</span>
        <SelectField
          value={config.timeId ?? FOLLOW}
          disabled={!plan}
          onChange={(e) =>
            onChange({
              ...config,
              ...(e.target.value === FOLLOW ? { timeId: undefined } : { timeId: e.target.value }),
            })
          }
        >
          <option value={FOLLOW}>{plan ? 'First service' : '—'}</option>
          {plan?.times.map((t) => (
            <option key={t.id} value={t.id}>
              {timeLabel(t)}
            </option>
          ))}
        </SelectField>
      </label>

      {right && <div className="viewbar__right">{right}</div>}
    </div>
  );
}
