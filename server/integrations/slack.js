// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRATION: Slack  (assistance notifications for the tech team)
//
//  Server-side only — browsers never talk to Slack. Uses a bot token via the
//  Web API (chat.postMessage / reactions.add): unlike an incoming webhook,
//  posting returns the message ts, so dismissing a request can ✅ the original
//  message and the channel stays readable as a live status board.
//
//  Credentials live in secrets.json under slack.<env>.*; `slack.use` (or the
//  PRODMESH_SLACK_ENV env var) picks the test or prod app so development can
//  never ping the real team channel by accident.
// ─────────────────────────────────────────────────────────────────────────────

import { getSecret } from '../secrets.js';
import { report } from '../health.js';

const BASE = process.env.PRODMESH_SLACK_API ?? 'https://slack.com/api'; // test override
const TIMEOUT_MS = 6000;

const env = () => process.env.PRODMESH_SLACK_ENV ?? getSecret('slack.use') ?? 'prod';
const cfg = (key) => getSecret(`slack.${env()}.${key}`);

export function isConfigured() {
  return Boolean(cfg('botOauthToken') && cfg('channel'));
}

/** Which app is live ('test' | 'prod') — surfaced in logs, never secrets. */
export function activeEnv() {
  return env();
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
