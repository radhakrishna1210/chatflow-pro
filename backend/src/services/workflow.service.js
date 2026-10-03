import { prisma } from '../lib/prisma.js';
import {
  cancelRunsForWorkflow, rankMatches, resolveReply, findStepTemplate, templateStepValues,
} from './workflowEngine.service.js';
import {
  validateGraph, parseDelayMs, BUILTIN_LEAD_STATUSES, BUILTIN_DEAL_STAGES, CRM_TRIGGER_SUBTYPES, buttonOptions,
} from './workflowGraph.js';
import { parseKeywords, matchedKeyword, keywordMatches } from './automation.service.js';
import { countVariables } from '../lib/templateParams.js';

const norm = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '_');
const warnFailed = (what) => (err) => {
  console.warn(`[Workflow] Could not check ${what} while saving:`, err.message);
  return null;
};

// ── Run statistics for the list (contract C1) ──────────────────────────────

// All-time run count, and the latest run's time and status, per workflow. The
// Workflows tab used to derive these from the latest 20 runs workspace-wide,
// so a quiet workflow next to a busy one showed "0 runs".
async function runStats(workspaceId, workflowIds) {
  const grouped = await prisma.workflowRun.groupBy({
    by: ['workflowId'],
    where: { workspaceId, workflowId: { in: workflowIds } },
    _count: { _all: true },
    _max: { startedAt: true },
  });
  const withRuns = grouped.filter((g) => g._max?.startedAt);
  // The latest run of each workflow, by its (workflowId, startedAt) index.
  const latest = withRuns.length
    ? await prisma.workflowRun.findMany({
        where: { workspaceId, OR: withRuns.map((g) => ({ workflowId: g.workflowId, startedAt: g._max.startedAt })) },
        select: { workflowId: true, status: true, startedAt: true },
      })
    : [];
  const statusOf = new Map(latest.map((r) => [r.workflowId, r.status]));
  return new Map(grouped.map((g) => [g.workflowId, {
    runCount: g._count?._all ?? 0,
    lastRunAt: g._max?.startedAt ?? null,
    lastRunStatus: statusOf.get(g.workflowId) ?? null,
  }]));
}

export async function listWorkflows(workspaceId) {
  const workflows = await prisma.workflow.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
  });
  if (workflows.length === 0) return workflows;
  const stats = await runStats(workspaceId, workflows.map((w) => w.id)).catch(warnFailed('run statistics')) ?? new Map();
  return workflows.map((w) => ({
    ...w,
    runCount: stats.get(w.id)?.runCount ?? 0,
    lastRunAt: stats.get(w.id)?.lastRunAt ?? null,
    lastRunStatus: stats.get(w.id)?.lastRunStatus ?? null,
  }));
}

// ── Save-time checks that need the workspace (contract C2, C3, C6) ─────────

const stepsOf = (nodes) => (Array.isArray(nodes) ? nodes : []).filter((n) => n?.type === 'action' || n?.type === 'condition');
const triggerOf = (nodes) => (Array.isArray(nodes) ? nodes : []).find((n) => n?.type === 'trigger');

// The lead statuses a workflow may name: the built-ins (NURTURING and
// CONVERTED included) plus the workspace's own lifecycle stages, by key or label.
async function knownLeadStatuses(workspaceId) {
  const { loadLeadIntakeRules } = await import('./leadIntake.service.js');
  const rules = await loadLeadIntakeRules(workspaceId);
  const stages = Array.isArray(rules?.lifecycle?.stages) ? rules.lifecycle.stages : [];
  return new Set([...BUILTIN_LEAD_STATUSES, ...stages.flatMap((s) => [s?.key, s?.label])].filter(Boolean).map(norm));
}

async function knownDealStages(workspaceId) {
  const stages = await prisma.pipelineStage.findMany({ where: { workspaceId }, select: { key: true, label: true } });
  return new Set([...BUILTIN_DEAL_STAGES, ...stages.flatMap((s) => [s.key, s.label])].filter(Boolean).map(norm));
}

async function templateWarnings(workspaceId, steps) {
  const warnings = [];
  for (const [i, node] of steps.entries()) {
    if (node.subtype !== 'template') continue;
    const label = node.value || node.templateId;
    const template = await findStepTemplate(workspaceId, node);
    if (!template) {
      warnings.push(`Step ${i + 1}: template "${label}" was not found in this workspace, so the step will fail until it exists.`);
      continue;
    }
    if (template.status !== 'APPROVED') {
      warnings.push(`Step ${i + 1}: template "${template.name}" is ${String(template.status).toLowerCase()} — the step will fail until Meta approves it.`);
    }
    const components = Array.isArray(template.components) ? template.components : [];
    const required = components.reduce((max, c) => Math.max(max, countVariables(c?.text)), 0);
    const given = Array.isArray(node.params) ? node.params.length : 0;
    if (given === 0 && required >= 2) {
      warnings.push(`Step ${i + 1}: template "${template.name}" has ${required} placeholders ({{1}}–{{${required}}}) and the step gives no values. Add one per placeholder — approval sample values are never sent, so the step will fail without them.`);
    } else if (given > 0 && given < required) {
      warnings.push(`Step ${i + 1}: template "${template.name}" has ${required} placeholders but the step gives ${given} value(s); the step will fail until each has a value.`);
    } else if (given > required) {
      warnings.push(`Step ${i + 1}: template "${template.name}" has ${required} placeholder(s); the extra ${given - required} value(s) will be ignored.`);
    }
  }
  return warnings;
}

// A "Send message" step whose text is exactly an approved template's name used
// to be sent as that template at run time. It is sent as text now; say so.
async function messageNamesTemplateWarnings(workspaceId, steps) {
  const texts = steps.map((n, i) => ({ i, text: String(n.value ?? '').trim() }))
    .filter(({ i, text }) => steps[i].subtype === 'message' && text && !text.includes('\n') && text.length <= 512);
  if (texts.length === 0) return [];
  const approved = await prisma.template.findMany({
    where: { workspaceId, status: 'APPROVED' },
    select: { name: true },
  });
  const names = new Map(approved.map((t) => [String(t.name).toLowerCase(), t.name]));
  return texts
    .filter(({ text }) => names.has(text.toLowerCase()))
    .map(({ i, text }) => `Step ${i + 1} sends the text "${text}", which is the name of the approved template "${names.get(text.toLowerCase())}". To send the template, use a "Send template" step.`);
}

async function lifecycleWarnings(workspaceId, trigger, steps) {
  const warnings = [];
  const leadKeys = steps.filter((n) => n.subtype === 'lead_status').length || (trigger?.subtype === 'lead_status' && trigger.value)
    ? await knownLeadStatuses(workspaceId)
    : null;
  if (leadKeys && trigger?.subtype === 'lead_status' && String(trigger.value ?? '').trim() && !leadKeys.has(norm(trigger.value))) {
    warnings.push(`The trigger's lead status "${trigger.value}" is not a stage in this workspace's lead lifecycle (Customize Your Business → Lead Lifecycle), so it may never fire.`);
  }
  steps.forEach((node, i) => {
    if (node.subtype !== 'lead_status' || !leadKeys) return;
    if (norm(node.value) === 'CONVERTED') {
      warnings.push(`Step ${i + 1}: a lead becomes CONVERTED only by converting it in the CRM; this step will be skipped.`);
    } else if (!leadKeys.has(norm(node.value))) {
      warnings.push(`Step ${i + 1}: "${node.value}" is not a stage in this workspace's lead lifecycle (Customize Your Business → Lead Lifecycle); the step will be skipped until it is.`);
    }
  });
  if (trigger?.subtype === 'deal_stage' && String(trigger.value ?? '').trim()) {
    const stages = await knownDealStages(workspaceId);
    if (!stages.has(norm(trigger.value))) {
      warnings.push(`The trigger's deal stage "${trigger.value}" is not one of this workspace's pipeline stages, so it may never fire.`);
    }
  }
  return warnings;
}

// Keyword triggers that compete with another active workflow's. Only one
// workflow answers a message, so an author should know which keyword wins.
async function overlapWarnings(workspaceId, trigger, { workflowId, active }) {
  if (!active || trigger?.subtype !== 'keyword') return [];
  const mine = parseKeywords(trigger.value);
  if (mine.length === 0) return [];
  const others = await prisma.workflow.findMany({
    where: { workspaceId, isActive: true, ...(workflowId ? { id: { not: workflowId } } : {}) },
    select: { id: true, name: true, nodes: true },
  });
  const warnings = [];
  for (const other of others) {
    if (other.id === workflowId) continue;
    const theirs = triggerOf(other.nodes);
    if (theirs?.subtype !== 'keyword') continue;
    for (const keyword of mine) {
      const clash = parseKeywords(theirs.value).find((k) => k.toLowerCase() === keyword.toLowerCase()
        || keywordMatches(k, keyword) || keywordMatches(keyword, k));
      if (!clash) continue;
      warnings.push(clash.toLowerCase() === keyword.toLowerCase()
        ? `"${keyword}" is also used by "${other.name}" — the more specific keyword wins, and on a tie the most recently updated workflow runs.`
        : `"${keyword}" overlaps "${clash}" in "${other.name}" — the more specific keyword wins.`);
      if (warnings.length >= 5) return warnings;
    }
  }
  return warnings;
}

// Everything the save response warns about beyond validateGraph's own checks.
// A lookup that fails costs its warning, never the save.
async function serviceWarnings(workspaceId, nodes, { workflowId = null, active = true } = {}) {
  const trigger = triggerOf(nodes);
  const steps = stepsOf(nodes);
  const groups = await Promise.all([
    templateWarnings(workspaceId, steps).catch(warnFailed('template steps')),
    messageNamesTemplateWarnings(workspaceId, steps).catch(warnFailed('message steps')),
    lifecycleWarnings(workspaceId, trigger, steps).catch(warnFailed('lead statuses and deal stages')),
    overlapWarnings(workspaceId, trigger, { workflowId, active }).catch(warnFailed('keyword overlaps')),
  ]);
  return groups.flatMap((g) => g ?? []);
}

// `nodes` are checked against what the engine can run here as well as in the
// route schema, because not every caller comes through the route (the
// onboarding assistant creates workflows directly). What is stored is the graph
// validateGraph normalised — including the wait for a reply it inserts after
// buttons that lead into a condition, which used to be computed and thrown
// away. `edges` is never read by the engine, which runs the ordered node list,
// so it is stored empty.
//
// The response carries `warnings`: things that save fine but will not behave
// the way they look (contract C2).
export async function createWorkflow(workspaceId, { name, isActive = true, nodes = [] }) {
  const graph = validateGraph(nodes);
  const extra = await serviceWarnings(workspaceId, graph.nodes, { active: isActive });
  const workflow = await prisma.workflow.create({
    data: {
      workspaceId,
      name,
      isActive,
      nodes: graph.nodes,
      edges: [],
    },
  });
  return { ...workflow, warnings: [...graph.warnings, ...extra] };
}

export async function updateWorkflow(workspaceId, id, updates) {
  const workflow = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!workflow) {
    const e = new Error('Workflow not found');
    e.status = 404;
    throw e;
  }

  const data = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  let graph = null;
  if (updates.nodes !== undefined) {
    graph = validateGraph(updates.nodes);
    data.nodes = graph.nodes;
  } else {
    // A rename or an on/off toggle still reports what is wrong with the saved
    // steps — switching a workflow on is exactly when an overlap starts to matter.
    try { graph = validateGraph(workflow.nodes); } catch { graph = { nodes: workflow.nodes, warnings: [] }; }
  }
  const active = updates.isActive ?? workflow.isActive;
  const extra = await serviceWarnings(workspaceId, graph.nodes, { workflowId: id, active });

  const updated = await prisma.workflow.update({
    where: { id },
    data,
  });

  // Switching a workflow off must also stop the runs it already started —
  // otherwise a run parked on a delay or a question carries on messaging the
  // customer after the workflow was deactivated.
  if (workflow.isActive && updates.isActive === false) {
    await cancelRunsForWorkflow(workspaceId, id, 'The workflow was deactivated')
      .catch((err) => console.error(`[Workflow] Could not cancel the runs of workflow ${id}:`, err.message));
  }
  return { ...updated, warnings: [...graph.warnings, ...extra] };
}

export async function deleteWorkflow(workspaceId, id) {
  const workflow = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!workflow) {
    const e = new Error('Workflow not found');
    e.status = 404;
    throw e;
  }
  await prisma.workflow.delete({ where: { id } });
}

// ── "Test this workflow" ───────────────────────────────────────────────────

const WINDOW_MS = 24 * 3_600_000;
const WINDOW_WARN_MS = 23 * 3_600_000;

// Whether a contact wrote on WhatsApp within the last 24 hours, so a free-form
// step started by a CRM change would actually be delivered.
async function windowOpenFor(workspaceId, contactId) {
  if (!contactId) return null;
  const conversation = await prisma.conversation.findFirst({
    where: { workspaceId, contactId, channel: 'WHATSAPP' },
    orderBy: { lastInboundAt: 'desc' },
    select: { lastInboundAt: true },
  }).catch(() => null);
  const at = conversation?.lastInboundAt ? new Date(conversation.lastInboundAt).getTime() : null;
  return at != null && Date.now() - at < WINDOW_MS;
}

// Real workflow simulation: interpret the trigger/action nodes and produce an
// honest step-by-step execution trace, with the production matcher and rules:
//
//  - `options.nodes` tests the draft on screen (normalised and validated as a
//    save would); otherwise the saved steps are tested;
//  - `active`/`inactive` say whether the workflow is switched on — a paused
//    workflow does not run in production, however well its trigger matches;
//  - `winner` names the workflow production would actually run for the sample
//    message (only one answers), and `wouldRun` combines all of it;
//  - `options.contactId` evaluates conditions and fills {{name}} against a
//    real contact instead of nobody;
//  - steps production would skip or fail are flagged with result
//    'would fail' / 'warning' instead of 'ok'.
//
// `options.replies` are the customer's answers, in order, to each "wait for
// reply" step.
export async function simulateWorkflow(workspaceId, workflowId, sampleMessage = 'Hi', options = {}) {
  const note = 'Simulation only — no real messages were sent.';
  let workflow = null;
  if (workflowId) {
    workflow = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId } });
    if (!workflow) { const e = new Error('Workflow not found'); e.status = 404; throw e; }
  }
  const draftNodes = Array.isArray(options.nodes) && options.nodes.length ? options.nodes : null;
  if (!workflow && !draftNodes) {
    const e = new Error('Say which workflow to test, or send the steps to test'); e.status = 400; throw e;
  }
  const name = workflow?.name ?? (String(options.name ?? '').trim() || 'Draft workflow');
  const active = workflow ? workflow.isActive !== false : false;
  const base = { workflowId: workflow?.id ?? null, name, active, inactive: !active, ...(draftNodes ? { draft: true } : {}) };

  let nodes = draftNodes ?? (Array.isArray(workflow.nodes) ? workflow.nodes : []);
  const warnings = [];
  if (nodes.length === 0) {
    return { ...base, ran: false, wouldRun: false, reason: 'This workflow has no steps to run.', trace: [], note };
  }
  if (draftNodes) {
    try {
      const graph = validateGraph(draftNodes);
      nodes = graph.nodes;
      warnings.push(...graph.warnings);
    } catch (err) {
      return { ...base, ran: false, wouldRun: false, reason: err.message, trace: [], note };
    }
  }

  const msgText = typeof sampleMessage === 'string'
    ? sampleMessage
    : String(sampleMessage?.message || sampleMessage?.text || sampleMessage || '');

  let contact = null;
  if (options.contactId) {
    contact = await prisma.contact.findFirst({ where: { id: String(options.contactId), workspaceId } });
    if (!contact) { const e = new Error('Contact not found'); e.status = 404; throw e; }
  }
  const isNewContact = options.isNewContact === true;

  const trigger = nodes.find((n) => n.type === 'trigger');
  const crm = CRM_TRIGGER_SUBTYPES.has(trigger?.subtype);
  const trace = [];
  let triggered = true;
  let reason = null;

  if (trigger) {
    if (trigger.subtype === 'keyword') {
      const kw = String(trigger.value || '').trim();
      const matched = kw ? matchedKeyword(kw, msgText) : null;
      triggered = Boolean(matched);
      trace.push({
        step: 'trigger', subtype: 'keyword',
        detail: kw ? `Match "${trigger.value}" against "${msgText}"${matched ? ` — matched "${matched}"` : ''}` : 'No keyword configured',
        result: triggered ? 'matched' : 'no match',
      });
      if (!triggered) reason = `Sample message does not contain the keyword "${trigger.value}".`;
    } else {
      trace.push({ step: 'trigger', subtype: trigger.subtype, detail: `Trigger type "${trigger.subtype}"`, result: 'assumed fired (simulation)' });
    }
  } else {
    triggered = false;
    reason = 'Workflow has no trigger step, so nothing would start it.';
    trace.push({ step: 'trigger', detail: 'missing', result: 'no trigger' });
  }

  // Which workflow production would run for this message: the same matcher,
  // over the active workflows plus this one (as tested, as if switched on).
  let winner = null;
  if (triggered && trigger?.subtype === 'keyword') {
    const others = await prisma.workflow.findMany({ where: { workspaceId, isActive: true } }).catch(() => null);
    if (Array.isArray(others)) {
      const self = { ...(workflow ?? {}), id: workflow?.id ?? '__draft__', name, nodes, updatedAt: draftNodes ? new Date() : workflow?.updatedAt };
      const ranked = rankMatches([...others.filter((w) => w.id !== self.id), self], { messageBody: msgText, event: 'message', isNewContact });
      if (ranked[0]) winner = { id: ranked[0].id === '__draft__' ? null : ranked[0].id, name: ranked[0].name, isThisWorkflow: ranked[0] === self };
    }
  }

  if (!active && triggered) {
    reason = workflow ? 'This workflow is switched off, so it would not run. Switch it on to use it.' : 'This draft is not saved yet, so it would not run.';
  } else if (winner && !winner.isThisWorkflow) {
    reason = `This message would be answered by "${winner.name}" instead — only one workflow answers a message, and its trigger is more specific (or it was updated more recently).`;
  }

  // Walks the steps the way the engine does — conditions skip, a wait for the
  // customer's reply consumes the next sample reply — so a branching chat can
  // be tried end to end. Without replies the walk stops at the first wait and
  // says what is still to come, rather than guessing an answer.
  let pendingReplies = 0;
  if (triggered) {
    const { evaluateCondition, skipCount, renderTemplate, tidy } = await import('./workflowConditions.js');
    const replies = (Array.isArray(options.replies) ? options.replies : [])
      .map((r) => String(r ?? '').trim()).filter(Boolean);
    const steps = stepsOf(nodes);
    const variables = {};
    let current = msgText;
    let lastOptions = [];
    // Mirrors the engine: once a step hands the chat to a person, the bot
    // sends nothing more on that run.
    let handedOff = false;
    // Free-form delivery: a CRM-started run has no customer message unless the
    // contact wrote recently; every answered wait reopens the window.
    let sinceCustomer = 0;
    let customerSpoke = !crm || (await windowOpenFor(workspaceId, contact?.id)) === true;
    const render = (text) => tidy(renderTemplate(text, { contact, variables, messageBody: current }));
    const deliverable = () => {
      if (!customerSpoke) return 'only delivered if the contact messaged you in the last 24h — this workflow starts from a CRM change, so use a template step';
      if (sinceCustomer >= WINDOW_WARN_MS) return 'WhatsApp\'s 24-hour window will have closed by then, so this would fail — use a template step';
      return null;
    };

    for (let i = 0; i < steps.length; i += 1) {
      const node = steps[i];
      if (handedOff && ['message', 'buttons', 'template', 'wait_reply'].includes(node.subtype)) {
        trace.push({ step: 'action', subtype: node.subtype, detail: 'Skipped — the chat was handed to a person', result: 'skipped' });
        continue;
      }
      if (node.type === 'condition') {
        const held = evaluateCondition(node, { messageBody: current, isNewContact, contact });
        const skip = skipCount(node);
        trace.push({
          step: 'condition', subtype: node.subtype,
          detail: `If message ${node.subtype === 'equals' ? 'is' : node.subtype.replace(/_/g, ' ')} "${node.value ?? ''}" (testing "${current}"${contact ? ` for ${contact.name || 'the contact'}` : ''})`,
          result: held ? 'yes' : `no — skip ${skip} step(s)`,
        });
        if (!held) i += skip;
        continue;
      }

      if (node.subtype === 'wait_reply') {
        if (crm && !contact) {
          trace.push({ step: 'action', subtype: 'wait_reply', detail: 'Would wait for the customer to reply — only possible once a message has reached them', result: 'warning' });
        }
        if (replies.length === 0) {
          pendingReplies = steps.slice(i + 1).length;
          trace.push({
            step: 'action', subtype: 'wait_reply',
            detail: 'Would wait for the customer to reply'
              + (node.reminder && node.remindAfter ? ` (reminding them after ${node.remindAfter}: "${node.reminder}")` : '')
              + (pendingReplies ? ` — the remaining ${pendingReplies} step(s) run on their answer` : ''),
            result: 'waiting',
          });
          break;
        }
        current = resolveReply(replies.shift(), lastOptions);
        lastOptions = [];
        sinceCustomer = 0;
        customerSpoke = true;
        const saveAs = String(node.value ?? '').trim();
        if (saveAs) variables[saveAs.toLowerCase().replace(/[^a-z0-9_.]+/g, '_')] = current;
        trace.push({
          step: 'action', subtype: 'wait_reply',
          detail: `Customer replies "${current}"${saveAs ? ` (saved as {{${saveAs}}})` : ''}`,
          result: 'ok',
        });
        continue;
      }

      let detail = node.value;
      let result = 'ok';
      const entry = {};
      if (node.subtype === 'message' || node.subtype === 'template') lastOptions = [];
      if (node.subtype === 'message') {
        detail = `Would send: "${render(node.value)}"`;
        const problem = deliverable();
        if (problem) { detail += ` — ${problem}`; result = 'warning'; }
      } else if (node.subtype === 'template') {
        detail = `Would send template: "${node.value}"`;
        const template = await findStepTemplate(workspaceId, node).catch(() => undefined);
        if (template === null) {
          detail = `Would fail: template "${node.value || node.templateId}" was not found in this workspace`;
          result = 'would fail';
        } else if (template && template.status !== 'APPROVED') {
          detail = `Would fail: template "${template.name}" is ${String(template.status).toLowerCase()}, not approved`;
          result = 'would fail';
        } else if (template) {
          const { values, error } = templateStepValues(template, node, { contact, variables, messageBody: current });
          if (error) { detail = `Would fail: ${error}`; result = 'would fail'; }
          else if (values.length) entry.values = values;
        }
      } else if (node.subtype === 'buttons') {
        const parts = String(node.value ?? '').split('|').map((p) => p.trim()).filter(Boolean);
        lastOptions = buttonOptions(node);
        detail = `Would ask "${render(parts[0] ?? '')}" with options: ${lastOptions.join(', ') || '(none)'}`;
        if (lastOptions.length === 0) result = 'would fail';
        const problem = deliverable();
        if (problem && result === 'ok') { detail += ` — ${problem}`; result = 'warning'; }
      } else if (node.subtype === 'delay') {
        detail = `Would wait ${node.value || '0'}`;
        sinceCustomer += parseDelayMs(node.value);
      } else if (node.subtype === 'tag') detail = `Would tag contact "${node.value}"`;
      else if (node.subtype === 'agent') {
        detail = 'Would hand off to a human agent — automation then stays off this chat until an agent resolves it';
        handedOff = true;
        if (crm && !contact) result = 'warning';
      } else if (node.subtype === 'task') detail = `Would create task "${node.value}"`;
      else if (node.subtype === 'lead_status') detail = `Would set lead status to ${node.value}`;
      else if (node.subtype === 'owner') detail = `Would assign owner "${node.value}"`;
      else if (node.subtype === 'sequence') detail = `Would enrol in sequence "${node.value}"`;
      else { detail = `Unknown action "${node.subtype}"`; result = 'would fail'; }
      trace.push({ step: 'action', subtype: node.subtype, detail, result, ...entry });
    }
  }

  return {
    ...base,
    ran: triggered,
    wouldRun: Boolean(active && triggered && (!winner || winner.isThisWorkflow)),
    winner,
    contact: contact ? { id: contact.id, name: contact.name ?? null } : null,
    reason,
    trace,
    ...(warnings.length ? { warnings } : {}),
    ...(pendingReplies ? { awaitingReply: true } : {}),
    note,
  };
}
