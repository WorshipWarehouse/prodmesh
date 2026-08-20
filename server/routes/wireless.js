import express from 'express';
import { rooms } from '../roomsStore.js';
import * as pco from '../integrations/planningCenter.js';
import * as wireless from '../wirelessStore.js';
import { wirelessTelemetry } from '../wirelessTelemetry.js';
import { requirePermission, auditSuccess } from '../httpAuth.js';

const router = express.Router();
const stOf = (plan) => ({ id: plan.serviceTypeId, name: plan.serviceTypeName });
const assignmentId = (member) => String(member.personId ?? member.id);

// Planning Center returns one row per position, not one row per person. The
// wireless board is assigning physical gear, so collapse those role rows by
// person while retaining every role as useful context for the operator.
function peopleForWireless(members, allowedTeams) {
  const visible = allowedTeams.size
    ? members.filter((member) => allowedTeams.has(String(member.teamId)))
    : members;
  const people = new Map();
  for (const member of visible) {
    const id = assignmentId(member);
    const current = people.get(id);
    if (!current) {
      people.set(id, { ...member, id, sourceIds: [String(member.id)], positions: [member.position], teamNames: [member.teamName] });
      continue;
    }
    current.sourceIds.push(String(member.id));
    if (!current.positions.includes(member.position)) current.positions.push(member.position);
    if (!current.teamNames.includes(member.teamName)) current.teamNames.push(member.teamName);
  }
  return [...people.values()].map(({ sourceIds, positions, teamNames, ...person }) => ({
    ...person,
    position: positions.filter(Boolean).join(' · '),
    teamName: teamNames.filter(Boolean).join(' · '),
    sourceIds,
  }));
}

async function planForRoom(room, planId) {
  const lists = await Promise.all((room.planningCenter?.serviceTypes ?? []).map((st) => pco.getUpcomingPlans(st, 10).catch(() => [])));
  return lists.flat().find((plan) => String(plan.id) === String(planId)) ?? null;
}

async function board(req, res) {
  const room = rooms[req.params.id];
  if (!room?.planningCenter?.serviceTypes?.length) return res.status(404).json({ error: 'No Planning Center service for this room' });
  try {
    const plan = await planForRoom(room, req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const [members, gear, assignments] = await Promise.all([
      pco.getPlanTeamMembers(stOf(plan), plan.id).catch(() => []),
      Promise.resolve(wireless.listGear(room.id)),
      Promise.resolve(wireless.assignmentsForPlan(room.id, plan.id)),
    ]);
    const allowedTeams = new Set(room.wirelessTeamIds ?? []);
    const visibleMembers = peopleForWireless(members, allowedTeams);
    const telemetry = await wirelessTelemetry(gear);
    res.json({
      live: pco.isConfigured(), plan: { id: plan.id, title: plan.title, dates: plan.dates, serviceTypeName: plan.serviceTypeName },
      gear,
      telemetry,
      members: visibleMembers.map((member) => ({
        ...member,
        // New assignments use the person id. Check each source role too so a
        // board created before this consolidation retains its assignments.
        microphone: assignments.find((entry) => entry.slot === 'microphone' && [member.id, ...member.sourceIds].includes(String(entry.teamMemberId)))?.gear ?? null,
        pack: assignments.find((entry) => entry.slot === 'pack' && [member.id, ...member.sourceIds].includes(String(entry.teamMemberId)))?.gear ?? null,
      })),
    });
  } catch (error) { res.status(502).json({ error: String(error.message ?? error) }); }
}

router.get('/api/rooms/:id/wireless/plans/:planId', board);
router.get('/api/rooms/:id/wireless/teams', requirePermission('config.manage'), async (req, res) => {
  const room = rooms[req.params.id];
  if (!room?.planningCenter?.serviceTypes?.length) return res.json({ teams: [] });
  try {
    const plans = await Promise.all((room.planningCenter.serviceTypes ?? []).map((st) => pco.getUpcomingPlans(st, 1).catch(() => [])));
    const plan = plans.flat().sort((a, b) => String(a.sortDate ?? '').localeCompare(String(b.sortDate ?? '')))[0];
    if (!plan) return res.json({ teams: [] });
    const members = await pco.getPlanTeamMembers(stOf(plan), plan.id);
    const teams = [...new Map(members.filter((member) => member.teamId).map((member) => [String(member.teamId), { id: String(member.teamId), name: member.teamName ?? 'Team' }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ teams, selectedTeamIds: room.wirelessTeamIds ?? [] });
  } catch (error) { res.status(502).json({ error: String(error.message ?? error) }); }
});
// Inventory belongs with Campus Connectivity. Assigning that inventory during
// a service remains a separate wireless.manage operation below.
router.get('/api/rooms/:id/wireless/gear', requirePermission('config.manage'), (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  res.json({ gear: wireless.listGear(req.params.id) });
});
router.post('/api/rooms/:id/wireless/gear', requirePermission('config.manage'), (req, res) => {
  if (!rooms[req.params.id]) return res.status(404).json({ error: 'Unknown room' });
  try {
    const gear = wireless.createGear(req.params.id, req.body ?? {});
    auditSuccess(req, 'config.manage', { resourceType: 'wireless-gear', resourceId: gear.id });
    res.status(201).json({ gear });
  } catch (error) { res.status(400).json({ error: String(error.message ?? error) }); }
});
router.put('/api/rooms/:id/wireless/gear/:gearId', requirePermission('config.manage'), (req, res) => {
  try {
    const gear = wireless.updateGear(req.params.id, req.params.gearId, req.body ?? {});
    auditSuccess(req, 'config.manage', { resourceType: 'wireless-gear', resourceId: gear.id });
    res.json({ gear });
  } catch (error) { res.status(400).json({ error: String(error.message ?? error) }); }
});
router.delete('/api/rooms/:id/wireless/gear/:gearId', requirePermission('config.manage'), (req, res) => {
  try {
    wireless.removeGear(req.params.id, req.params.gearId);
    auditSuccess(req, 'config.manage', { resourceType: 'wireless-gear', resourceId: req.params.gearId });
    res.status(204).end();
  } catch (error) { res.status(400).json({ error: String(error.message ?? error) }); }
});
router.put('/api/rooms/:id/wireless/plans/:planId/assignments/:memberId', requirePermission('wireless.manage'), async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ error: 'Unknown room' });
  try {
    const plan = await planForRoom(room, req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const members = await pco.getPlanTeamMembers(stOf(plan), plan.id);
    if (!members.some((member) => assignmentId(member) === String(req.params.memberId))) return res.status(404).json({ error: 'Scheduled person not found' });
    const gear = wireless.setAssignment(room.id, plan.id, req.params.memberId, req.body?.slot, req.body?.gearId ?? null, req.auth?.user?.id ?? null);
    auditSuccess(req, 'wireless.manage', { resourceType: 'wireless-assignment', resourceId: `${plan.id}:${req.params.memberId}:${req.body?.slot}` });
    res.json({ gear });
  } catch (error) { res.status(400).json({ error: String(error.message ?? error) }); }
});

export default router;
