import { CalendarDays, Clock3, UsersRound } from 'lucide-react';
import { type PlanItem, type PlanTeamMember, type ShowState } from '../api';
import { useNow } from '../lib/useNow';
import { roomTopic, useTopic } from '../lib/stream';
import { usePlan } from './usePlan';
import type { WidgetProps } from './types';

const time = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const minutes = (seconds: number) => `${Math.floor(Math.abs(seconds) / 60)}:${String(Math.floor(Math.abs(seconds) % 60)).padStart(2, '0')}`;
const runItems = (items: PlanItem[]) => items.filter((item) => item.type !== 'header');

export function PlanningCenterService({ roomId, config }: WidgetProps) {
  const { plan, time: serviceTime } = usePlan(roomId, config);
  if (!plan) return <p className="wgt__empty">No Planning Center service selected</p>;
  return <section className="wgt pcw"><div className="wgt__head"><CalendarDays size={16} /><span className="wgt__title">Planning Center service</span></div><strong className="pcw__title">{plan.title}</strong><p className="wgt__detail">{plan.dates ?? 'Date unavailable'}{serviceTime?.startsAt ? ` · ${time(new Date(serviceTime.startsAt))}` : ''}</p></section>;
}

export function PlanningCenterTimers({ roomId, config }: WidgetProps) {
  const { plan, planId, timeId } = usePlan(roomId, config);
  const show = useTopic<ShowState>(roomTopic.show(roomId));
  const now = useNow(1000);
  if (!plan) return <p className="wgt__empty">No Planning Center timers available</p>;
  const current = show?.active && show.planId === planId && show.timeId === timeId ? show.current : null;
  const item = current?.itemId ? plan.items.find((row) => row.id === current.itemId) ?? null : null;
  const remaining = item?.length != null && current?.startedAt != null ? Math.max(0, item.length - Math.floor((now - current.startedAt) / 1000)) : null;
  return <section className="wgt pcw pcw--timer"><div className="wgt__head"><Clock3 size={16} /><span className="wgt__title">{item?.title ?? 'Waiting for service item'}</span></div><strong className="pcw__delta">{remaining == null ? '—' : minutes(remaining)}</strong><p className="wgt__detail">{item?.length != null ? `${minutes(item.length)} planned` : 'No Planning Center duration'}</p></section>;
}

export function PlanningCenterSchedule({ roomId, config }: WidgetProps) {
  const { plan, planId, time: serviceTime, timeId } = usePlan(roomId, config);
  const show = useTopic<ShowState>(roomTopic.show(roomId));
  const now = useNow(1000);
  const items = runItems(plan?.items ?? []);
  const current = show?.active && show.planId === planId && show.timeId === timeId ? show.current?.itemIndex : null;
  const before = current != null && current >= 0 ? items.slice(0, current).reduce((sum, item) => sum + (item.length ?? 0), 0) : null;
  const expected = serviceTime?.startsAt != null && before != null ? new Date(serviceTime.startsAt).getTime() + before * 1000 : null;
  const delta = expected == null ? null : Math.round((now - expected) / 1000);
  const label = delta == null ? 'Waiting for current item' : delta > 0 ? 'Behind schedule' : delta < 0 ? 'Ahead of schedule' : 'On schedule';
  return <section className={`wgt pcw pcw--schedule ${delta != null && delta > 0 ? 'pcw--behind' : ''}`}><div className="wgt__head"><Clock3 size={16} /><span className="wgt__title">Overall</span></div><strong className="pcw__delta">{delta == null ? '—' : `${delta < 0 ? '−' : '+'}${minutes(delta)}`}</strong><p className="wgt__detail">{label}{current != null && items[current] ? ` · ${items[current].title}` : ''}</p></section>;
}

export function PlanningCenterTeams({ roomId, config }: WidgetProps) {
  const { plan } = usePlan(roomId, config);
  const groups = new Map<string, PlanTeamMember[]>();
  for (const member of plan?.teamMembers ?? []) groups.set(member.teamName, [...(groups.get(member.teamName) ?? []), member]);
  if (!plan) return <p className="wgt__empty">No Planning Center team selected</p>;
  return <section className="wgt pcw pcw--teams"><div className="wgt__head"><UsersRound size={16} /><span className="wgt__title">Planning Center teams</span></div>{[...groups].map(([team, members]) => <div key={team}><small className="pcw__team">{team}</small>{members?.map((member) => <p className="pcw__row" key={member.id}><span>{member.name}</span><small>{member.position}</small></p>)}</div>)}</section>;
}
