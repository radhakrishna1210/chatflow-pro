import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

// Which Gemini model answers a given piece of work.
//
// There are two levels. The platform default (GEMINI_MODEL, with
// GEMINI_FALLBACK_MODEL behind it) is what everything used before, and is now
// editable from Super Admin → API Management. On top of that the super admin
// can pin one workspace to a model of its own (Workspace.aiModel).
//
// The workspace's choice has to reach roughly twenty call sites — the agents,
// the onboarding assistant, single-prompt workflow and template generation,
// copilot, voice, the website widget — most of which call llmText() with no
// idea which workspace they are working for. Threading a `model` argument
// through every one of them would have meant touching every AI feature, and the
// next feature added would silently miss it.
//
// So the model rides on the async context instead. Whatever starts the work
// (an HTTP request for a workspace, an inbound WhatsApp message) declares the
// workspace's model once, and the single place that talks to Gemini reads it
// back. A feature written tomorrow that calls llmText() inherits the right
// model without knowing any of this exists.

const context = new AsyncLocalStorage();

// A model id as Google names it: "gemini-flash-latest", "gemini-2.5-pro". The
// API also accepts and returns them prefixed ("models/…"), so that is stripped.
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/i;

// Returns the cleaned id, or null when the value is empty or not a model id.
export function cleanModelId(raw) {
  const value = String(raw ?? '').trim().replace(/^models\//i, '');
  return MODEL_ID.test(value) ? value : null;
}

// Runs `fn` with `model` as the model for every LLM call made inside it,
// however deep or asynchronous. An empty or malformed model means "no
// override": the work runs on the platform default.
export function runWithAiModel(model, fn) {
  return context.run({ model: cleanModelId(model) }, fn);
}

// The workspace-level override in force right now, or null.
export function workspaceModelOverride() {
  return context.getStore()?.model || null;
}

// The model a call made right now should use first.
export function activeModel() {
  return workspaceModelOverride() || env.GEMINI_MODEL;
}

// Every model worth trying, in order: the workspace's own, then the platform
// default, then the platform fallback.
//
// The platform default stays in the chain behind a workspace override on
// purpose. A pinned model id can be retired by Google (it answers 404 from
// then on); without the default behind it, that workspace's every AI feature
// would go silent until someone noticed and re-picked a model.
export function modelChain() {
  return [...new Set([workspaceModelOverride(), env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean))];
}

// ── Looking a workspace's model up ──────────────────────────────────────────
//
// For work that starts outside a workspace-scoped HTTP request (voice calls,
// the public website widget, the onboarding assistant). Cached briefly: these
// paths can fire per message, and the setting changes a few times a year.

const CACHE_MS = 30_000;
const cache = new Map(); // workspaceId -> { model, at }

export async function workspaceAiModel(workspaceId) {
  if (!workspaceId) return null;
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.model;
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiModel: true } });
    const model = cleanModelId(ws?.aiModel);
    cache.set(workspaceId, { model, at: Date.now() });
    return model;
  } catch (err) {
    // Never fatal: not knowing the override means using the platform default,
    // which is a working configuration.
    console.error('[aiModel] Could not read the workspace model — using the platform default:', err.message);
    return null;
  }
}

// Called when the super admin changes a workspace's model, so the change is
// live on the next call rather than after the cache expires.
export function forgetWorkspaceAiModel(workspaceId) {
  if (workspaceId) cache.delete(workspaceId); else cache.clear();
}

// Runs `fn` under the model of `workspaceId`. With no workspace the function
// simply runs, keeping whatever context it was already in.
export async function runWithWorkspaceAiModel(workspaceId, fn) {
  if (!workspaceId) return fn();
  return runWithAiModel(await workspaceAiModel(workspaceId), fn);
}
