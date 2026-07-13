import { prisma } from '../lib/prisma.js';
import { llmText, llmJson } from '../lib/llm.js';
import { createWorkflow } from '../services/workflow.service.js';

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

// Build a workflow (trigger + action steps) from the user's description.
async function generateWorkflowSpec(prompt) {
  const system = `Design a simple WhatsApp automation as JSON: {"name": string, "nodes": [{"type":"trigger"|"action","subtype":string,"value":string}]}.
trigger subtypes: keyword, welcome, missed. action subtypes: message, delay, tag, agent.
Start with exactly one trigger, then 1-3 actions. Reply with ONLY the JSON.`;
  const spec = await llmJson(`Automation for: ${prompt}`, system);
  if (spec?.nodes?.length) {
    return {
      name: String(spec.name || 'AI Workflow').slice(0, 80),
      nodes: spec.nodes.slice(0, 5).map((n, i) => ({
        id: `step_${i + 1}`,
        type: n.type === 'trigger' ? 'trigger' : 'action',
        subtype: String(n.subtype || (n.type === 'trigger' ? 'keyword' : 'message')).toLowerCase(),
        value: String(n.value || '').trim(),
      })),
    };
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

// ─── Main chat handler ────────────────────────────────────────────────────────
export const chatWithAi = async (req, res) => {
  try {
    const { message, guided = true } = req.body;
    const userId = req.user.id;
    const requestedWorkspaceId = req.body.workspaceId || req.user.workspaceId;

    let workspaceId = null;
    if (requestedWorkspaceId) {
      const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: requestedWorkspaceId } },
      });
      if (!member) return res.status(403).json({ content: 'You are not a member of that workspace.' });
      workspaceId = requestedWorkspaceId;
    }
    if (!workspaceId) return res.status(400).json({ content: 'No workspace selected.' });

    let session = await prisma.aiSession.findFirst({ where: { userId, workspaceId }, orderBy: { updatedAt: 'desc' } });
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

    // Whether this workspace can actually create/submit templates (has a number).
    const numberCount = await prisma.waNumber.count({ where: { workspaceId } });

    if (state.step === 'IDLE') {
      const intent = await detectIntent(text);

      if (intent === 'CREATE_WORKFLOW') {
        // Build a REAL workflow via the workflow service — no fake success.
        const spec = await generateWorkflowSpec(text);
        const wf = await createWorkflow(workspaceId, { name: spec.name, nodes: spec.nodes, edges: [], isActive: true });
        const triggerStep = spec.nodes.find((n) => n.type === 'trigger');
        // Keyword triggers are actually executed by the inbound handler, so also
        // register an AutomationTrigger so the workflow genuinely runs.
        if (triggerStep?.subtype === 'keyword' && triggerStep.value) {
          const reply = spec.nodes.find((n) => n.type === 'action' && n.subtype === 'message')?.value;
          if (reply) {
            await prisma.automationTrigger.create({
              data: { workspaceId, keyword: triggerStep.value, responseTemplate: reply, isActive: true },
            }).catch(() => {});
          }
        }
        responseText = `Done — I built the "${wf.name}" automation and activated it. ${triggerStep?.subtype === 'keyword' ? `When someone messages "${triggerStep.value}", it will reply automatically.` : 'You can review and edit it under Automation → Workflows.'}`;
        card = { title: 'Workflow Created', icon: '⚙️', details: { name: wf.name, steps: spec.nodes.length, status: 'ACTIVE' } };
        state = { step: 'IDLE' };
        await save();
        return res.json({ content: responseText, card });
      }

      if (intent === 'CREATE_TEMPLATE') {
        if (guided === false) {
          const body = await generateTemplateBody(text);
          if (numberCount === 0) {
            responseText = "I've drafted your template copy below, but you need to connect a WhatsApp number before it can be saved and submitted to Meta.";
            card = { title: 'Template Draft (not saved)', icon: '📝', details: { preview: body } };
          } else {
            const tpl = await prisma.template.create({
              data: {
                workspaceId,
                waNumberId: (await prisma.waNumber.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }))?.id,
                name: `template_${Date.now()}`, category: 'MARKETING', language: 'en_US',
                status: 'PENDING', aiGenerated: true, components: [{ type: 'BODY', text: body }],
              },
            });
            responseText = "I've drafted your template and saved it as PENDING. Submit it to Meta from the Templates page to get it approved before use.";
            card = { title: 'Template Drafted', icon: '📝', details: { name: tpl.name, status: 'PENDING', preview: body } };
          }
          state = { step: 'IDLE' };
          await save();
          return res.json({ content: responseText, card });
        }
        state = { step: 'TEMPLATE_GATHER_NAME', seed: text };
        responseText = "Great — let's create a WhatsApp template. What should we name it? (e.g. appointment_reminder)";
      } else if (intent === 'CREATE_CAMPAIGN') {
        if (guided === false) {
          const template = await prisma.template.findFirst({ where: { workspaceId } });
          if (!template) {
            responseText = "You don't have any templates yet. Say 'create a template' first, then I can build a campaign around it.";
          } else {
            const campaign = await prisma.campaign.create({
              data: { workspaceId, name: `campaign_${Date.now()}`, templateId: template.id, waNumberId: template.waNumberId, status: 'DRAFT', aiGenerated: true },
            });
            responseText = "I've created your campaign as a draft. Open it from the Campaigns page to pick recipients and launch it.";
            card = { title: 'Campaign Drafted', icon: '🚀', details: { name: campaign.name, status: 'DRAFT' } };
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
          `You are ChatFlow Pro's assistant. The user said: "${text}". Reply helpfully in 1-2 sentences, guiding them to create a template, campaign, or automation workflow.`,
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
      // If they describe a goal rather than paste copy, generate it.
      const body = text.includes('{{') || text.length > 120 ? text : await generateTemplateBody(text);
      if (numberCount === 0) {
        responseText = "I've drafted the copy, but connect a WhatsApp number first to save and submit it to Meta.";
        card = { title: 'Template Draft (not saved)', icon: '📝', details: { name: state.templateName, preview: body } };
      } else {
        const tpl = await prisma.template.create({
          data: {
            workspaceId,
            waNumberId: (await prisma.waNumber.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }))?.id,
            name: state.templateName, category: 'MARKETING', language: 'en_US',
            status: 'PENDING', aiGenerated: true, components: [{ type: 'BODY', text: body }],
          },
        });
        responseText = "Saved as a PENDING draft. Submit it to Meta from the Templates page to get it approved.";
        card = { title: 'Template Drafted', icon: '📝', details: { name: tpl.name, status: 'PENDING', preview: body } };
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
      const template = await prisma.template.findFirst({ where: { workspaceId, name: { contains: text, mode: 'insensitive' } } });
      if (template) {
        const campaign = await prisma.campaign.create({
          data: { workspaceId, name: state.campaignName, templateId: template.id, waNumberId: template.waNumberId, status: 'DRAFT', aiGenerated: true },
        });
        responseText = "Your campaign is saved as a draft. Add recipients and launch it from the Campaigns page.";
        card = { title: 'Campaign Drafted', icon: '🚀', details: { name: campaign.name, status: 'DRAFT' } };
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
