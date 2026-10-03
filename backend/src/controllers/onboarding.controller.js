import { prisma } from '../lib/prisma.js';
import { llmText, llmJson } from '../lib/llm.js';
import { generateTemplateDraft } from '../services/templateAi.service.js';
import { createWorkflow } from '../services/workflow.service.js';
import { generateWorkflowPreview } from '../services/automation.service.js';
import { hasFeature } from '../services/subscription.service.js';
import { createTemplate, deleteTemplate } from '../services/templates.service.js';
import { createCampaign } from '../services/campaigns.service.js';
import { templateSchemas } from '../validators/index.js';

// ─── Intent detection ─────────────────────────────────────────────────────────
async function detectIntent(message) {
  const msg = message.toLowerCase().trim();

  if (msg.includes('delete') || msg.includes('remove') || msg.includes('clear')) {
    if (msg.includes('campaign')) return 'DELETE_CAMPAIGN';
    if (msg.includes('template')) return 'DELETE_TEMPLATE';
    return 'GENERAL';
  }
  // "workflow"/"automation"/"flow" → build an automation workflow
  if (/\b(workflow|automation|auto[- ]?reply|flow|when someone|if a customer|drip)\b/.test(msg)) {
    return 'CREATE_WORKFLOW';
  }
  if (msg.includes('create') || msg.includes('make') || msg.includes('build') || msg.includes('new') || msg.includes('generate') || msg.includes('set up') || msg.includes('setup')) {
    if (msg.includes('template') || msg.includes('message')) return 'CREATE_TEMPLATE';
    if (msg.includes('campaign') || msg.includes('broadcast')) return 'CREATE_CAMPAIGN';
    if (msg.includes('workflow') || msg.includes('automation')) return 'CREATE_WORKFLOW';
  }

  const system = `You are an intent classifier for a WhatsApp automation tool. Classify the message into EXACTLY ONE of:
CREATE_TEMPLATE, CREATE_CAMPAIGN, CREATE_WORKFLOW, GENERAL. Respond with only the intent string.`;
  const raw = await llmText(`Classify: "${message}"`, system);
  if (raw) {
    const u = raw.toUpperCase();
    if (u.includes('CREATE_TEMPLATE')) return 'CREATE_TEMPLATE';
    if (u.includes('CREATE_CAMPAIGN')) return 'CREATE_CAMPAIGN';
    if (u.includes('CREATE_WORKFLOW')) return 'CREATE_WORKFLOW';
  }
  return 'GENERAL';
}

// Full template draft — name, category, header, body, footer and variable
// samples — using the same service the Templates tab's "Create with AI" uses,
// so the agent and the builder cannot drift apart on category rules or copy
// style. Returns the shape templateAi.service.js defines.
async function draftTemplate(prompt) {
  return generateTemplateDraft(prompt);
}

// Turns a draft into the Meta component array, header included. A media header
// is deliberately NOT set here: Meta needs a real sample file uploaded before
// it will approve one, and the chat agent has no file to upload — the draft
// only records that an image would help, and the user adds it in the builder.
function draftToComponents(draft) {
  const components = [];
  if (draft.headerText) components.push({ type: 'HEADER', format: 'TEXT', text: draft.headerText });
  const body = { type: 'BODY', text: draft.body };
  if (draft.variables?.length) {
    body.example = { body_text: [draft.variables.map((v) => v.example)] };
  }
  components.push(body);
  if (draft.footer) components.push({ type: 'FOOTER', text: draft.footer });
  return components;
}

// ─── Campaign planning ────────────────────────────────────────────────────────

const bodyOf = (components) =>
  (Array.isArray(components) ? components : []).find((c) => String(c?.type).toUpperCase() === 'BODY')?.text || '';

// Picks which approved template a campaign should send and names the campaign
// after the user's own words. This used to grab whichever template happened to
// be created first and call the campaign `campaign_<timestamp>` — with several
// templates in a workspace that is a coin flip, and the wrong template goes to
// every recipient. Falls back to a word-overlap match so the flow still works
// without a key.
async function planCampaign(prompt, templates) {
  const list = templates
    .map((t, i) => `${i + 1}. ${t.name} [${t.category}] — ${bodyOf(t.components).slice(0, 140)}`)
    .join('\n');

  const system = `You plan a WhatsApp broadcast campaign. Given the user's request and the templates they already have approved, choose the single best template and name the campaign.
Reply with ONLY JSON: {"choice": number, "name": string, "why": string}
- "choice" is the number of the best template from the list, or 0 if none fit.
- "name" is a short human campaign name in the user's own words, max 60 chars, e.g. "Diwali sale blast".
- "why" is one short sentence on why that template fits.`;
  const plan = await llmJson(`Request: "${prompt}"\n\nTemplates:\n${list}`, system);

  const n = Number(plan?.choice);
  if (Number.isInteger(n) && n >= 1 && n <= templates.length) {
    return {
      template: templates[n - 1],
      name: String(plan.name || '').trim().slice(0, 60) || `${templates[n - 1].name} campaign`,
      why: String(plan?.why || '').trim().slice(0, 160),
      picked: 'ai',
    };
  }

  // Deterministic fallback: score each template's name and body against the
  // request, and derive the campaign name from the request itself.
  const words = new Set(String(prompt).toLowerCase().match(/[a-z]{3,}/g) || []);
  let best = templates[0];
  let bestScore = -1;
  for (const t of templates) {
    const hay = `${t.name} ${bodyOf(t.components)}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  const derived = String(prompt).trim().replace(/\s+/g, ' ').slice(0, 60);
  return { template: best, name: derived || `${best.name} campaign`, why: '', picked: 'fallback' };
}

// ─── Permissions and writes ───────────────────────────────────────────────────

// This route lives outside /workspaces/:workspaceId, so neither workspaceContext
// nor authorize() runs. The same rules are applied here instead: creating is
// member-level work (CLIENT and up, as on the REST routes), and deleting from a
// free-text chat is restricted to ADMIN.
const ROLE_LEVEL = { VIEWER: 0, AGENT: 1, CLIENT: 2, ADMIN: 3 };
export const canCreateFromChat = (role) => (ROLE_LEVEL[role] ?? -1) >= ROLE_LEVEL.CLIENT;
export const canDeleteFromChat = (role) => role === 'ADMIN';

const CREATE_DENIED = 'Your role in this workspace can\'t create templates, campaigns or automations. Ask a workspace admin if you need this.';
const DELETE_DENIED = 'Only workspace admins can delete templates or campaigns from the assistant. You can manage them from the Templates and Campaigns pages instead.';

// Mirrors workspaceContext: a suspended workspace or an inactive subscription
// blocks the workspace for everyone but platform super admins.
export function workspaceBlockReason(workspace, user) {
  if (user?.superAdmin === true) return null;
  if (workspace?.suspended) return 'This workspace has been suspended. Please contact support.';
  const subStatus = workspace?.subscription?.status;
  if (subStatus && ['CANCELLED', 'EXPIRED'].includes(subStatus)) {
    return 'This workspace\'s subscription is inactive. Renew your plan or recharge your wallet to continue.';
  }
  return null;
}

const firstNumberId = async (workspaceId) =>
  (await prisma.waNumber.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;

// Saves through the same validation and service the Templates page uses, so a
// chat-made template is checked, bound to a number and actually submitted to
// Meta — PENDING then really does mean "in review". Errors a user can act on
// (validation, Meta rejection) come back as text instead of a 500.
async function saveTemplate(workspaceId, { name, category, language, components }) {
  const parsed = templateSchemas.create.safeParse({ name, category, language, components });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || 'The template is not valid.' };
  }
  try {
    const tpl = await createTemplate(workspaceId, { ...parsed.data, waNumberId: await firstNumberId(workspaceId) });
    await prisma.template.update({ where: { id: tpl.id }, data: { aiGenerated: true } }).catch((err) => console.warn(`[Onboarding] Could not flag template ${tpl.id} as AI-generated:`, err.message));
    return { tpl };
  } catch (err) {
    if (err.status && err.status < 500) return { error: err.message };
    throw err;
  }
}

// Same path as POST /campaigns: plan campaign cap, template/number checks.
async function saveCampaign(workspaceId, user, { name, template }) {
  try {
    const numberId = template.waNumberId || await firstNumberId(workspaceId);
    const campaign = await createCampaign(workspaceId, { name, templateId: template.id, numberId }, user);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { aiGenerated: true } }).catch((err) => console.warn(`[Onboarding] Could not flag campaign ${campaign.id} as AI-generated:`, err.message));
    return { campaign };
  } catch (err) {
    if (err.status && err.status < 500) return { error: err.message };
    throw err;
  }
}

const exactName = (text) => ({ equals: text.trim(), mode: 'insensitive' });

// ─── Main chat handler ────────────────────────────────────────────────────────
export const chatWithAi = async (req, res) => {
  try {
    const { message, guided = true } = req.body;
    const userId = req.user.id;
    const workspaceId = req.body.workspaceId || req.user.workspaceId;
    if (!workspaceId) return res.status(400).json({ content: 'No workspace selected.' });

    // This handler runs on every turn of the guided template/campaign/workflow
    // flow, and these four reads don't depend on each other — batching them
    // avoids four sequential round trips per message (membership, plan
    // feature flag, session lookup, and number count were previously each
    // awaited one at a time). Results are only used after the membership
    // check below, so a non-member never sees any of this data.
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      include: { workspace: { select: { suspended: true, subscription: { select: { status: true } } } } },
    });
    if (!member) return res.status(403).json({ content: 'You are not a member of that workspace.' });
    const blocked = workspaceBlockReason(member.workspace, req.user);
    if (blocked) return res.status(403).json({ content: blocked, error: blocked });
    const mayCreate = canCreateFromChat(member.role);
    const mayDelete = canDeleteFromChat(member.role);

    const [aiOnboardingAllowed, existingSession, numberCount] = await Promise.all([
      hasFeature(workspaceId, 'aiOnboarding'),
      prisma.aiSession.findFirst({ where: { userId, workspaceId }, orderBy: { updatedAt: 'desc' } }),
      prisma.waNumber.count({ where: { workspaceId } }),
    ]);

    if (!aiOnboardingAllowed) {
      return res.status(403).json({
        content: 'AI onboarding isn\'t included in your current plan. Upgrade to unlock it.',
        error: 'AI onboarding isn\'t included in your current plan. Upgrade to unlock it.',
        code: 'PLAN_FEATURE_LOCKED',
        feature: 'aiOnboarding',
      });
    }

    let session = existingSession;
    if (!session) session = await prisma.aiSession.create({ data: { userId, workspaceId, state: { step: 'IDLE' } } });

    let state = session.state || { step: 'IDLE' };
    const text = (message || '').trim();
    const low = text.toLowerCase();
    let responseText = '';
    let card = null;

    const save = async () => prisma.aiSession.update({ where: { id: session.id }, data: { state } });

    if (guided === false || ['cancel', 'reset', 'abort'].includes(low)) {
      state = { step: 'IDLE' };
    }

    // Role is read live on every turn, so a flow started before a demotion
    // cannot be finished after it.
    if (state.step && state.step !== 'IDLE') {
      const deleting = String(state.step).startsWith('DELETE_');
      if (!(deleting ? mayDelete : mayCreate)) {
        state = { step: 'IDLE' };
        await save();
        return res.json({ content: deleting ? DELETE_DENIED : CREATE_DENIED });
      }
    }

    if (state.step === 'IDLE') {
      const intent = await detectIntent(text);

      const isDelete = intent === 'DELETE_TEMPLATE' || intent === 'DELETE_CAMPAIGN';
      const isCreate = intent === 'CREATE_TEMPLATE' || intent === 'CREATE_CAMPAIGN' || intent === 'CREATE_WORKFLOW';
      if ((isDelete && !mayDelete) || (isCreate && !mayCreate)) {
        state = { step: 'IDLE' };
        await save();
        return res.json({ content: isDelete ? DELETE_DENIED : CREATE_DENIED });
      }

      if (intent === 'CREATE_WORKFLOW') {
        // Built by the same generator as Automation → Workflows → Create with
        // AI, and saved inactive: a workflow messages customers, so it starts
        // only once someone has read its steps and switched it on.
        const spec = await generateWorkflowPreview(workspaceId, text);
        if (!Array.isArray(spec?.nodes)) {
          responseText = 'To build automations from a website, open Automation → Workflows → Create with AI and paste the URL there.';
          state = { step: 'IDLE' };
          await save();
          return res.json({ content: responseText, card });
        }
        let wf;
        try {
          wf = await createWorkflow(workspaceId, { name: spec.name || 'AI workflow', nodes: spec.nodes, isActive: false });
        } catch (err) {
          if (err.status !== 400) throw err;
          responseText = `I could not build that automation: ${err.message} Try describing it differently, or build it in Automation → Workflows.`;
          state = { step: 'IDLE' };
          await save();
          return res.json({ content: responseText, card });
        }
        const triggerStep = spec.nodes.find((n) => n.type === 'trigger');
        // This used to also register a shadow AutomationTrigger, because the
        // Workflows tab was inert and a workflow alone would never have fired.
        // The inbound handler runs workflows directly now, so the duplicate is
        // gone — it would only have made the workflow harder to edit later.
        responseText = `Done — I built the "${wf.name}" automation as a draft. Review it under Automation → Workflows and switch it on when it looks right${triggerStep?.subtype === 'keyword' ? ` — it will then reply when someone messages "${triggerStep.value}"` : ''}.`;
        card = { title: 'Workflow Drafted', icon: '⚙️', details: { name: wf.name, steps: spec.nodes.length, status: 'INACTIVE' } };
        state = { step: 'IDLE' };
        await save();
        return res.json({ content: responseText, card });
      }

      if (intent === 'CREATE_TEMPLATE') {
        if (guided === false) {
          const draft = await draftTemplate(text);
          const imageHint = draft.suggestImage
            ? ` It would work better with an image header — ${draft.imageIdea || 'add a relevant photo'}. Open it in Templates to upload one.`
            : '';
          if (numberCount === 0) {
            responseText = "I've drafted your template copy below, but you need to connect a WhatsApp number before it can be saved and submitted to Meta.";
            card = { title: 'Template Draft (not saved)', icon: '📝', details: { name: draft.name, category: draft.category, preview: draft.body } };
          } else {
            // Category comes from the draft: saving a UTILITY message as
            // MARKETING is a common Meta rejection reason.
            const saved = await saveTemplate(workspaceId, {
              name: draft.name, category: draft.category, language: draft.language, components: draftToComponents(draft),
            });
            if (saved.error) {
              responseText = `I drafted the copy below but couldn't save it: ${saved.error}`;
              card = { title: 'Template Draft (not saved)', icon: '📝', details: { name: draft.name, category: draft.category, preview: draft.body } };
            } else {
              responseText = `I've created your template and submitted it to Meta for review (category ${draft.category}). It can be used once it's approved.${imageHint}`;
              card = { title: 'Template Submitted', icon: '📝', details: { name: saved.tpl.name, category: draft.category, status: 'PENDING', preview: draft.body, ...(draft.suggestImage ? { suggestedHeader: 'Image' } : {}) } };
            }
          }
          state = { step: 'IDLE' };
          await save();
          return res.json({ content: responseText, card });
        }
        state = { step: 'TEMPLATE_GATHER_NAME', seed: text };
        responseText = "Great — let's create a WhatsApp template. What should we name it? (e.g. appointment_reminder)";
      } else if (intent === 'CREATE_CAMPAIGN') {
        if (guided === false) {
          const templates = await prisma.template.findMany({
            where: { workspaceId, status: { not: 'DELETED' } },
            select: { id: true, name: true, category: true, components: true, waNumberId: true },
            orderBy: { createdAt: 'desc' },
            take: 40,
          });
          if (templates.length === 0) {
            responseText = "You don't have any templates yet. Say 'create a template' first, then I can build a campaign around it.";
          } else {
            const plan = await planCampaign(text, templates);
            const saved = await saveCampaign(workspaceId, req.user, { name: plan.name, template: plan.template });
            if (saved.error) {
              responseText = `I couldn't create that campaign: ${saved.error}`;
            } else {
              responseText = `I've drafted the "${saved.campaign.name}" campaign using your "${plan.template.name}" template${plan.why ? ` — ${plan.why}` : ''}. Open it from the Campaigns page to pick recipients and launch it.`;
              card = { title: 'Campaign Drafted', icon: '🚀', details: { name: saved.campaign.name, template: plan.template.name, status: 'DRAFT' } };
            }
          }
          state = { step: 'IDLE' };
          await save();
          return res.json({ content: responseText, card });
        }
        state = { step: 'CAMPAIGN_GATHER_NAME' };
        responseText = "Let's set up a campaign. What should we call it?";
      } else if (intent === 'DELETE_TEMPLATE') {
        state = { step: 'DELETE_GATHER_TEMPLATE_NAME' };
        responseText = "Sure — what's the exact name of the template to delete?";
      } else if (intent === 'DELETE_CAMPAIGN') {
        state = { step: 'DELETE_GATHER_CAMPAIGN_NAME' };
        responseText = "Okay — what's the exact name of the draft campaign to delete?";
      } else {
        const aiGeneral = await llmText(
          `You are Spandan's assistant. The user said: "${text}". Reply helpfully in 1-2 sentences, guiding them to create a template, campaign, or automation workflow.`,
          'You are a concise, friendly WhatsApp marketing assistant.'
        );
        responseText = aiGeneral || "I can build templates, campaigns and automation workflows for you. Try: \"create a template for an abandoned cart\" or \"build a workflow that replies when someone says HELP\".";
      }
    }
    else if (state.step === 'TEMPLATE_GATHER_NAME') {
      state.templateName = text.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 60) || `template_${Date.now()}`;
      state.step = 'TEMPLATE_GATHER_BODY';
      responseText = `Got it — "${state.templateName}". What should the message say? (I can also draft it — just describe the goal, e.g. "abandoned cart reminder".) Use {{1}} for the name.`;
    }
    else if (state.step === 'TEMPLATE_GATHER_BODY') {
      // Pasted copy is used verbatim; a described goal gets a full draft.
      const pasted = text.includes('{{') || text.length > 120;
      const draft = pasted ? null : await draftTemplate(text);
      const body = pasted ? text : draft.body;
      // The name they already chose wins over the drafted one.
      const components = pasted ? [{ type: 'BODY', text: body }] : draftToComponents(draft);
      const category = pasted ? 'MARKETING' : draft.category;
      const language = pasted ? 'en_US' : draft.language;
      const imageHint = draft?.suggestImage
        ? ` An image header would suit this one — ${draft.imageIdea || 'add a relevant photo'}. You can upload it from the Templates page.`
        : '';

      if (numberCount === 0) {
        responseText = "I've drafted the copy, but connect a WhatsApp number first to save and submit it to Meta.";
        card = { title: 'Template Draft (not saved)', icon: '📝', details: { name: state.templateName, category, preview: body } };
      } else {
        const saved = await saveTemplate(workspaceId, { name: state.templateName, category, language, components });
        if (saved.error) {
          responseText = `I couldn't save that template: ${saved.error}`;
          card = { title: 'Template Draft (not saved)', icon: '📝', details: { name: state.templateName, category, preview: body } };
        } else {
          responseText = `Created and submitted to Meta for review (category ${category}). It can be used once it's approved.${imageHint}`;
          card = { title: 'Template Submitted', icon: '📝', details: { name: saved.tpl.name, category, status: 'PENDING', preview: body, ...(draft?.suggestImage ? { suggestedHeader: 'Image' } : {}) } };
        }
      }
      state = { step: 'IDLE' };
    }
    else if (state.step === 'CAMPAIGN_GATHER_NAME') {
      state.campaignName = text;
      const templates = await prisma.template.findMany({ where: { workspaceId, status: { not: 'DELETED' } }, select: { name: true } });
      if (templates.length === 0) {
        responseText = "You don't have any templates yet. Say 'create a template' to make one first.";
        state = { step: 'IDLE' };
      } else {
        state.step = 'CAMPAIGN_GATHER_TEMPLATE';
        responseText = `Which template should it use? Available: ${templates.map((t) => t.name).join(', ')}`;
      }
    }
    else if (state.step === 'CAMPAIGN_GATHER_TEMPLATE') {
      // Exact-ish name match first — when the user typed a real template name
      // there is nothing to interpret. Only a miss goes to the model, so a
      // description ("the one about the sale") still lands on a template
      // instead of dead-ending on "I couldn't find a template matching…".
      let template = await prisma.template.findFirst({ where: { workspaceId, status: { not: 'DELETED' }, name: { contains: text, mode: 'insensitive' } } });
      let why = '';
      if (!template) {
        const templates = await prisma.template.findMany({
          where: { workspaceId, status: { not: 'DELETED' } },
          select: { id: true, name: true, category: true, components: true, waNumberId: true },
          orderBy: { createdAt: 'desc' },
          take: 40,
        });
        if (templates.length) {
          const plan = await planCampaign(`${state.campaignName || ''} ${text}`.trim(), templates);
          if (plan.picked === 'ai') { template = plan.template; why = plan.why; }
        }
      }
      if (template) {
        const saved = await saveCampaign(workspaceId, req.user, { name: state.campaignName, template });
        if (saved.error) {
          responseText = `I couldn't create that campaign: ${saved.error}`;
        } else {
          responseText = `Your campaign is saved as a draft using the "${template.name}" template${why ? ` — ${why}` : ''}. Add recipients and launch it from the Campaigns page.`;
          card = { title: 'Campaign Drafted', icon: '🚀', details: { name: saved.campaign.name, template: template.name, status: 'DRAFT' } };
        }
      } else {
        responseText = `I couldn't find a template matching "${text}". Please try again.`;
      }
      state = { step: 'IDLE' };
    }
    // Deletes need an exact name and an explicit confirmation turn: a substring
    // match used to hard-delete whichever record happened to come first.
    else if (state.step === 'DELETE_GATHER_TEMPLATE_NAME') {
      const matches = await prisma.template.findMany({
        where: { workspaceId, status: { not: 'DELETED' }, name: exactName(text) },
        select: { id: true, name: true },
        take: 2,
      });
      if (matches.length === 1) {
        state = { step: 'DELETE_CONFIRM_TEMPLATE', templateId: matches[0].id, name: matches[0].name };
        responseText = `Delete template "${matches[0].name}"? This also removes it from Meta. Type DELETE to confirm, or anything else to cancel.`;
      } else {
        responseText = matches.length
          ? `More than one template is named "${text}". Delete the right one from the Templates page.`
          : `No template named exactly "${text}" found.`;
        state = { step: 'IDLE' };
      }
    }
    else if (state.step === 'DELETE_CONFIRM_TEMPLATE') {
      if (low === 'delete') {
        await deleteTemplate(workspaceId, state.templateId);
        responseText = `Deleted template "${state.name}". You can restore it from the Templates page's deleted list.`;
      } else {
        responseText = 'Okay, nothing was deleted.';
      }
      state = { step: 'IDLE' };
    }
    else if (state.step === 'DELETE_GATHER_CAMPAIGN_NAME') {
      const matches = await prisma.campaign.findMany({
        where: { workspaceId, name: exactName(text) },
        select: { id: true, name: true, status: true },
        take: 2,
      });
      if (matches.length !== 1) {
        responseText = matches.length
          ? `More than one campaign is named "${text}". Manage it from the Campaigns page.`
          : `No campaign named exactly "${text}" found.`;
        state = { step: 'IDLE' };
      } else if (matches[0].status !== 'DRAFT') {
        // A scheduled or running campaign has a queued job and sent messages
        // behind it; it is cancelled from the Campaigns page, never deleted here.
        responseText = `"${matches[0].name}" is ${matches[0].status.toLowerCase()}, so it can't be deleted here. Only draft campaigns can be deleted from the assistant — cancel it from the Campaigns page instead.`;
        state = { step: 'IDLE' };
      } else {
        state = { step: 'DELETE_CONFIRM_CAMPAIGN', campaignId: matches[0].id, name: matches[0].name };
        responseText = `Delete the draft campaign "${matches[0].name}"? Type DELETE to confirm, or anything else to cancel.`;
      }
    }
    else if (state.step === 'DELETE_CONFIRM_CAMPAIGN') {
      if (low === 'delete') {
        // Status re-checked in the delete itself, in case it was scheduled
        // between the two turns.
        const { count } = await prisma.campaign.deleteMany({ where: { id: state.campaignId, workspaceId, status: 'DRAFT' } });
        responseText = count
          ? `Deleted campaign "${state.name}".`
          : `"${state.name}" is no longer a draft, so it was not deleted.`;
      } else {
        responseText = 'Okay, nothing was deleted.';
      }
      state = { step: 'IDLE' };
    }
    else {
      state = { step: 'IDLE' };
      responseText = "Let's start over — what would you like to build?";
    }

    await save();
    return res.json({ content: responseText, card });
  } catch (err) {
    console.error('[onboarding] chatWithAi error:', err);
    return res.status(500).json({ content: 'Something went wrong while processing that. Please try again.' });
  }
};
