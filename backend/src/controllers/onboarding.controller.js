import { prisma } from '../lib/prisma.js';
import { llmText, llmJson } from '../lib/llm.js';
import { generateTemplateDraft } from '../services/templateAi.service.js';
import { createWorkflow } from '../services/workflow.service.js';
import { hasFeature } from '../services/subscription.service.js';

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

// Generate a WhatsApp template body from the user's real prompt. Falls back to a
// context-aware (not generic) draft when no LLM is configured.
async function generateTemplateBody(prompt) {
  const system = `You are an expert WhatsApp copywriter. Write ONE concise, friendly, high-converting WhatsApp template body for the user's use case. Use {{1}} for the recipient's name and {{2}}, {{3}} for other dynamic values where natural. Reply with ONLY the message text — no quotes, no explanations.`;
  const body = await llmText(`Write a WhatsApp template for: ${prompt}`, system);
  if (body) return body.replace(/^["']|["']$/g, '').trim();

  // Deterministic, prompt-aware fallback (no LLM available).
  const p = prompt.toLowerCase();
  if (p.includes('cart') || p.includes('abandon'))
    return 'Hi {{1}}, you left items in your cart! Complete your order now and use code {{2}} for a special discount. Reply STOP to opt out.';
  if (p.includes('diwali') || p.includes('sale') || p.includes('offer') || p.includes('discount'))
    return 'Hi {{1}}! 🎉 Our special sale is live — get {{2}} off your favourites. Shop now: {{3}}. Reply STOP to opt out.';
  if (p.includes('appointment') || p.includes('reminder') || p.includes('booking'))
    return 'Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Reply CONFIRM to confirm or CANCEL to reschedule.';
  if (p.includes('welcome') || p.includes('onboard'))
    return 'Welcome, {{1}}! 👋 Thanks for joining us. We\'re here to help — reply to this message any time with questions.';
  if (p.includes('order') || p.includes('shipping') || p.includes('delivery'))
    return 'Hi {{1}}, your order {{2}} has been {{3}}! Track it here: {{4}}. Thank you for shopping with us.';
  return `Hi {{1}}, ${prompt.trim()}. Reply STOP to opt out.`;
}

// The only subtypes workflowEngine understands. Anything else is saved as an
// ACTIVE workflow that can never fire — triggerFires() returns false for an
// unknown trigger subtype, and an unknown action is skipped at run time — so
// the model's output is clamped to these rather than trusted.
const ALLOWED_TRIGGER_SUBTYPES = new Set(['keyword', 'welcome', 'missed']);
const ALLOWED_ACTION_SUBTYPES = new Set(['message', 'delay', 'tag', 'agent']);

// Build a workflow (trigger + action steps) from the user's description.
async function generateWorkflowSpec(prompt) {
  const system = `Design a simple WhatsApp automation as JSON: {"name": string, "nodes": [{"type":"trigger"|"action","subtype":string,"value":string}]}.
trigger subtypes: keyword, welcome, missed. action subtypes: message, delay, tag, agent.
Use those subtype words exactly — no other values are accepted.
A "keyword" trigger's value is ONE uppercase word a customer would actually send (HELP, BOOK, PRICE); "welcome" and "missed" take an empty value.
Start with exactly one trigger, then 1-3 actions. Reply with ONLY the JSON.`;
  const spec = await llmJson(`Automation for: ${prompt}`, system);
  const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];

  // A trigger with no action after it isn't a workflow, so fall through to the
  // deterministic build rather than saving a stub.
  const triggerRaw = nodes.find((n) => n?.type === 'trigger');
  const actionsRaw = nodes.filter((n) => n?.type !== 'trigger');
  if (triggerRaw && actionsRaw.length) {
    let triggerSubtype = String(triggerRaw.subtype || 'keyword').toLowerCase();
    if (!ALLOWED_TRIGGER_SUBTYPES.has(triggerSubtype)) triggerSubtype = 'keyword';

    const built = [{
      id: 'step_1',
      type: 'trigger',
      subtype: triggerSubtype,
      value: triggerSubtype === 'keyword'
        ? (String(triggerRaw.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
           || prompt.match(/\b([a-z]{3,})\b/i)?.[1]?.toUpperCase() || 'HELP')
        : '',
    }];

    for (const n of actionsRaw) {
      if (built.length >= 5) break;
      let subtype = String(n?.subtype || 'message').toLowerCase();
      if (!ALLOWED_ACTION_SUBTYPES.has(subtype)) subtype = 'message';
      const value = String(n?.value || '').trim().slice(0, 900);
      if (!value) continue;
      built.push({ id: `step_${built.length + 1}`, type: 'action', subtype, value });
    }

    if (built.length >= 2) return { name: String(spec.name || 'AI Workflow').slice(0, 80), nodes: built };
  }

  // Deterministic fallback: keyword trigger → auto reply.
  const kw = (prompt.match(/\b([a-z]{3,})\b/i)?.[1] || 'hello').toUpperCase();
  const body = await generateTemplateBody(prompt);
  return {
    name: `${kw} auto-reply`.slice(0, 80),
    nodes: [
      { id: 'step_1', type: 'trigger', subtype: 'keyword', value: kw },
      { id: 'step_2', type: 'action', subtype: 'message', value: body },
    ],
  };
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
    });
    if (!member) return res.status(403).json({ content: 'You are not a member of that workspace.' });

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

    if (state.step === 'IDLE') {
      const intent = await detectIntent(text);

      if (intent === 'CREATE_WORKFLOW') {
        // Build a REAL workflow via the workflow service — no fake success.
        const spec = await generateWorkflowSpec(text);
        const wf = await createWorkflow(workspaceId, { name: spec.name, nodes: spec.nodes, edges: [], isActive: true });
        const triggerStep = spec.nodes.find((n) => n.type === 'trigger');
        // This used to also register a shadow AutomationTrigger, because the
        // Workflows tab was inert and a workflow alone would never have fired.
        // The inbound handler runs workflows directly now, so the duplicate is
        // gone — it would only have made the workflow harder to edit later.
        responseText = `Done — I built the "${wf.name}" automation and activated it. ${triggerStep?.subtype === 'keyword' ? `When someone messages "${triggerStep.value}", it will reply automatically.` : 'You can review and edit it under Automation → Workflows.'}`;
        card = { title: 'Workflow Created', icon: '⚙️', details: { name: wf.name, steps: spec.nodes.length, status: 'ACTIVE' } };
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
            const tpl = await prisma.template.create({
              data: {
                workspaceId,
                waNumberId: (await prisma.waNumber.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }))?.id,
                // Category comes from the draft now: saving a UTILITY message
                // as MARKETING is a common Meta rejection reason.
                name: draft.name, category: draft.category, language: draft.language,
                status: 'PENDING', aiGenerated: true, components: draftToComponents(draft),
              },
            });
            responseText = `I've drafted your template and saved it as PENDING (category ${draft.category}). Submit it to Meta from the Templates page to get it approved before use.${imageHint}`;
            card = { title: 'Template Drafted', icon: '📝', details: { name: tpl.name, category: draft.category, status: 'PENDING', preview: draft.body, ...(draft.suggestImage ? { suggestedHeader: 'Image' } : {}) } };
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
            where: { workspaceId },
            select: { id: true, name: true, category: true, components: true, waNumberId: true },
            orderBy: { createdAt: 'desc' },
            take: 40,
          });
          if (templates.length === 0) {
            responseText = "You don't have any templates yet. Say 'create a template' first, then I can build a campaign around it.";
          } else {
            const plan = await planCampaign(text, templates);
            const campaign = await prisma.campaign.create({
              data: { workspaceId, name: plan.name, templateId: plan.template.id, waNumberId: plan.template.waNumberId, status: 'DRAFT', aiGenerated: true },
            });
            responseText = `I've drafted the "${campaign.name}" campaign using your "${plan.template.name}" template${plan.why ? ` — ${plan.why}` : ''}. Open it from the Campaigns page to pick recipients and launch it.`;
            card = { title: 'Campaign Drafted', icon: '🚀', details: { name: campaign.name, template: plan.template.name, status: 'DRAFT' } };
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
        responseText = "Okay — what's the name of the campaign to delete?";
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
        const tpl = await prisma.template.create({
          data: {
            workspaceId,
            waNumberId: (await prisma.waNumber.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }))?.id,
            name: state.templateName, category, language,
            status: 'PENDING', aiGenerated: true, components,
          },
        });
        responseText = `Saved as a PENDING draft (category ${category}). Submit it to Meta from the Templates page to get it approved.${imageHint}`;
        card = { title: 'Template Drafted', icon: '📝', details: { name: tpl.name, category, status: 'PENDING', preview: body, ...(draft?.suggestImage ? { suggestedHeader: 'Image' } : {}) } };
      }
      state = { step: 'IDLE' };
    }
    else if (state.step === 'CAMPAIGN_GATHER_NAME') {
      state.campaignName = text;
      const templates = await prisma.template.findMany({ where: { workspaceId }, select: { name: true } });
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
      let template = await prisma.template.findFirst({ where: { workspaceId, name: { contains: text, mode: 'insensitive' } } });
      let why = '';
      if (!template) {
        const templates = await prisma.template.findMany({
          where: { workspaceId },
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
        const campaign = await prisma.campaign.create({
          data: { workspaceId, name: state.campaignName, templateId: template.id, waNumberId: template.waNumberId, status: 'DRAFT', aiGenerated: true },
        });
        responseText = `Your campaign is saved as a draft using the "${template.name}" template${why ? ` — ${why}` : ''}. Add recipients and launch it from the Campaigns page.`;
        card = { title: 'Campaign Drafted', icon: '🚀', details: { name: campaign.name, template: template.name, status: 'DRAFT' } };
      } else {
        responseText = `I couldn't find a template matching "${text}". Please try again.`;
      }
      state = { step: 'IDLE' };
    }
    else if (state.step === 'DELETE_GATHER_TEMPLATE_NAME') {
      const tpl = await prisma.template.findFirst({ where: { workspaceId, name: { contains: text, mode: 'insensitive' } } });
      if (tpl) { await prisma.template.delete({ where: { id: tpl.id } }); responseText = `Deleted template "${tpl.name}".`; }
      else responseText = `No template matching "${text}" found.`;
      state = { step: 'IDLE' };
    }
    else if (state.step === 'DELETE_GATHER_CAMPAIGN_NAME') {
      const camp = await prisma.campaign.findFirst({ where: { workspaceId, name: { contains: text, mode: 'insensitive' } } });
      if (camp) { await prisma.campaign.delete({ where: { id: camp.id } }); responseText = `Deleted campaign "${camp.name}".`; }
      else responseText = `No campaign matching "${text}" found.`;
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
