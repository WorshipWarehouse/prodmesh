// ─────────────────────────────────────────────────────────────────────────────
//  STARTUP CHECKLIST TEMPLATES  —  per event type (PC service type).
//
//  Keyed by Planning Center service type id, with '*' as the default for any
//  event type without its own template. One template per event type covers it
//  in every room it runs in — the room only supplies execution context (an
//  automated `action: { type: 'mode', mode }` presses THAT room's Companion
//  button when checked, lockouts still enforced).
//
//  Persisted to server/data/checklists.json (git-ignored) via the same
//  atomic-write pattern as settings.js; editable in Admin → Checklists.
//  Checklist RUN state stays per-event in SQLite (checklistStore.js).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from './atomicFile.js';
import { validateTemplateItems } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PRODMESH_DATA_DIR ?? join(__dirname, 'data');
const FILE = join(DATA_DIR, 'checklists.json');

// First-run seed — the templates that were hardcoded before the editor existed.
const DEFAULTS = {
  version: 1,
  templates: {
    // Sunday
    '500001': [
      { id: 'mode-sunday', label: 'Set room to Sunday mode', action: { type: 'mode', mode: 'sunday' } },
      { id: 'cameras', label: 'Install batteries in mobile cameras' },
      { id: 'ros-sheets', label: 'Place run of show sheets at all tech positions' },
      { id: 'sermon-notes', label: 'Place sermon notes in the PCR' },
      { id: 'packs', label: 'Ensure all mic and IEM packs are charged' },
      { id: 'protools', label: 'Start ProTools session for live stream broadcast audio' },
    ],
    // Any event type without its own template
    '*': [
      { id: 'packs', label: 'Ensure mic and IEM packs are charged' },
      { id: 'ros-sheets', label: 'Place run of show sheets at tech positions' },
    ],
  },
};

let data = null;

function load() {
  if (data) return data;
  if (existsSync(FILE)) {
    try {
      data = { ...structuredClone(DEFAULTS), ...JSON.parse(readFileSync(FILE, 'utf8')) };
    } catch {
      data = structuredClone(DEFAULTS);
    }
  } else {
    data = structuredClone(DEFAULTS);
    persist();
  }
  return data;
}

function persist() {
  writeJsonAtomic(FILE, data);
}

/** The template for an event type ('*' fallback), or []. */
export function templateFor(serviceTypeId) {
  const t = load().templates;
  return t[serviceTypeId] ?? t['*'] ?? [];
}

export function getTemplates() {
  return structuredClone(load().templates);
}

/** Replace one event type's template. Items without an id get a stable slug
 *  derived from the label (existing ids are preserved so run state survives
 *  edits). Throws on invalid input — callers map that to HTTP 400. */
export function setTemplate(serviceTypeId, items) {
  validateTemplateItems(items);
  const used = new Set();
  const cleaned = items.map((it) => {
    let id = it.id?.trim() || slug(it.label);
    while (used.has(id)) id = `${id}-2`;
    used.add(id);
    return { id, label: it.label.trim(), ...(it.action ? { action: { type: 'mode', mode: it.action.mode } } : {}) };
  });
  load().templates[serviceTypeId] = cleaned;
  persist();
}

/** Remove an event type's own template so it falls back to '*' (removing '*'
 *  itself leaves event types without a template checklist-less). */
export function removeTemplate(serviceTypeId) {
  delete load().templates[serviceTypeId];
  persist();
}

function slug(label) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}
