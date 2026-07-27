// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: Slack  (assistance notifications for the tech team)
//
//  Server-side only — browsers never talk to Slack. Uses a bot token via the
//  Web API (chat.postMessage / reactions.add): unlike an incoming webhook,
//  posting returns the message ts, so dismissing a request can ✅ the original
//  message and the channel stays readable as a live status board.
//
//  Credentials live in secrets.json under `slack.botOauthToken` / `slack.channel`.
//
//  They used to be split into slack.test.* and slack.prod.* with `slack.use`
//  choosing between them. That was a development convenience that every
//  installing church had to understand, so it collapsed to one set. Existing
//  installs are read through the legacy shape below and keep working
//  untouched; PRODMESH_SLACK_ENV still forces a legacy branch for anyone who
//  genuinely runs two apps.
// ─────────────────────────────────────────────────────────────────────────────

import { getSecret } from '../secrets.js';
import { report } from '../health.js';

const BASE = process.env.PRODMESH_SLACK_API ?? 'https://slack.com/api'; // test override
const TIMEOUT_MS = 6000;

const legacyEnv = () => process.env.PRODMESH_SLACK_ENV ?? getSecret('slack.use') ?? 'prod';

/**
 * Flat key first; fall back to the old nested one. An install configured
 * before the simplification keeps working with no migration step and no
 * silent loss of its Slack setup.
 */
const cfg = (key) => getSecret(`slack.${key}`) ?? getSecret(`slack.${legacyEnv()}.${key}`);

export function isConfigured() {
  return Boolean(cfg('botOauthToken') && cfg('channel'));
}

/** Which credentials are live — 'default', or the legacy branch in use. */
export function activeEnv() {
  return getSecret('slack.botOauthToken') ? 'default' : legacyEnv();
}

async function slackApi(method, payload) {
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${cfg('botOauthToken')}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json();
    // Slack answers HTTP 200 with ok:false for app-level errors.
    if (!body.ok) throw new Error(`Slack ${method}: ${body.error}`);
    report('slack', true);
    return body;
  } catch (err) {
    report('slack', false, String(err.message ?? err));
    throw err;
  }
}

/** Post to the configured channel. Returns { channel, ts } for later updates. */
export async function postMessage(text) {
  const body = await slackApi('chat.postMessage', { channel: cfg('channel'), text });
  return { channel: body.channel, ts: body.ts };
}

/** React to a previously posted message (default ✅). */
export function addReaction(channel, ts, name = 'white_check_mark') {
  return slackApi('reactions.add', { channel, timestamp: ts, name });
}

// Read methods use GET + query params (Slack rejects JSON bodies on these).
async function slackGetApi(method, params) {
  try {
    const res = await fetch(`${BASE}/${method}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${cfg('botOauthToken')}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`Slack ${method}: ${body.error}`);
    report('slack', true);
    return body;
  } catch (err) {
    report('slack', false, String(err.message ?? err));
    throw err;
  }
}

/** Reactions currently on a message: [{ name, users: [], count }]. */
export async function getMessageReactions(channel, ts) {
  const body = await slackGetApi('reactions.get', { channel, timestamp: ts, full: 'true' });
  return body.message?.reactions ?? [];
}

// Slack user id → display name, cached per boot. Needs users:read; without
// it (or on error) resolves null and callers fall back to a generic label.
const userNames = new Map();
export async function userName(userId) {
  if (userNames.has(userId)) return userNames.get(userId);
  let name = null;
  try {
    const body = await slackGetApi('users.info', { user: userId });
    name = body.user?.profile?.display_name || body.user?.real_name || null;
  } catch {
    /* missing users:read scope or transient — generic label is fine */
  }
  userNames.set(userId, name);
  return name;
}
