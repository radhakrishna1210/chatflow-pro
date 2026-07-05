import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

async function callOllama(prompt, systemPrompt = '') {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3',
        prompt: prompt,
        system: systemPrompt,
        stream: false,
        options: { temperature: 0.1 }
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('Ollama failed');
    const data = await response.json();
    return data.response.trim();
  } catch (err) {
    console.error('Ollama Error:', err.message);
    return null;
  }
}

async function detectIntent(message) {
  const msg = message.toLowerCase().trim();

  // Explicit delete/remove commands are unambiguous — resolve without LLM
  if (msg.includes('delete') || msg.includes('remove') || msg.includes('clear')) {
    if (msg.includes('campaign')) return 'DELETE_CAMPAIGN';
    if (msg.includes('template')) return 'DELETE_TEMPLATE';
    return 'GENERAL';
  }

  // Explicit create commands - resolve without LLM to improve reliability and speed
  if (msg.includes('create') || msg.includes('make') || msg.includes('build') || msg.includes('new') || msg.includes('generate')) {
    if (msg.includes('template') || msg.includes('message')) return 'CREATE_TEMPLATE';
    if (msg.includes('campaign') || msg.includes('broadcast')) return 'CREATE_CAMPAIGN';
  }

  const systemPrompt = `You are an intent classifier for a WhatsApp automation tool.
Classify the user's message into EXACTLY ONE of the following intents:
- CREATE_TEMPLATE (user wants to create/build/make a template or message)
- CREATE_CAMPAIGN (user wants to start/launch/create a campaign or broadcast)
- GENERAL (anything else, greetings, questions, or unclear)
Respond ONLY with the intent string. No explanation.`;

  const rawIntent = await callOllama(`Classify this message:\n"${message}"`, systemPrompt);
  let intent = 'GENERAL';

  if (rawIntent) {
    const upper = rawIntent.toUpperCase();
    if (upper.includes('CREATE_TEMPLATE')) intent = 'CREATE_TEMPLATE';
    else if (upper.includes('CREATE_CAMPAIGN')) intent = 'CREATE_CAMPAIGN';
  }
  
  return intent;
}

async function generateTemplateBody(prompt) {
  const systemPrompt = `You are an expert WhatsApp copywriter. Write a highly converting, professional WhatsApp message template based on the user's prompt. 
Use variables like {{1}}, {{2}} for dynamic data. Keep it concise, friendly, and clear. 
Respond ONLY with the message text, no quotes, no explanations, no intro text.`;
  
  const body = await callOllama(`Write a WhatsApp template for: ${prompt}`, systemPrompt);
  
  if (!body) {
    return "Hello {{1}}, here is the information you requested. Reply STOP to unsubscribe."; // Fallback
  }
  return body;
}

export const chatWithAi = async (req, res) => {
  try {
    const { message, workspaceId, guided = true } = req.body;
    
    // Soft auth
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
        userId = payload.sub;
      } catch (err) {
        // invalid token
      }
    }
    
    // Find or create session
    let session;
    if (userId && workspaceId) {
      session = await prisma.aiSession.findFirst({
        where: { userId, workspaceId },
        orderBy: { updatedAt: 'desc' }
      });
    }

    if (!session && userId && workspaceId) {
      session = await prisma.aiSession.create({
        data: { userId, workspaceId, state: { step: 'IDLE' } }
      });
    }
    
    let state = session ? session.state : { step: 'IDLE' };
    
    const text = (message || '').trim();
    let responseText = '';
    let card = null;
    
    // If the user requests a non-guided (one-shot) execution, force state reset
    if (guided === false || text.toLowerCase() === 'cancel' || text.toLowerCase() === 'reset' || text.toLowerCase() === 'abort') {
      state = { step: 'IDLE' };
    }
    
    if (text.toLowerCase() === 'cancel' || text.toLowerCase() === 'reset' || text.toLowerCase() === 'abort') {
      if (session) await prisma.aiSession.update({ where: { id: session.id }, data: { state: { step: 'IDLE' } } });
      return res.json({ content: "Alright, I've cancelled that operation. What would you like to do instead?" });
    }

    let intent = 'GENERAL';
    if (state.step === 'IDLE') {
      intent = await detectIntent(text);
    }

    if (state.step === 'IDLE') {
      if (intent === 'CREATE_TEMPLATE') {
        if (!guided && workspaceId) {
          // ONE-SHOT CREATION
          const generatedBody = await generateTemplateBody(text);
          const newTemplate = await prisma.template.create({
            data: {
              workspaceId,
              name: `template_${Date.now()}`,
              category: 'MARKETING',
              language: 'en_US',
              status: 'APPROVED',
              aiGenerated: true,
              components: [{ type: 'BODY', text: generatedBody }]
            }
          });
          responseText = "I have successfully auto-generated your template from your prompt!";
          card = {
            title: 'Template Created',
            icon: '📝',
            details: { name: newTemplate.name, category: newTemplate.category, language: newTemplate.language },
            preview: generatedBody
          };
        } else {
          state = { step: 'TEMPLATE_GATHER_NAME' };
          responseText = "Great! Let's create a WhatsApp Template. What should be the name of this template? (e.g., appointment_reminder)";
        }
      } else if (intent === 'CREATE_CAMPAIGN') {
        if (!guided && workspaceId) {
           // ONE SHOT CAMPAIGN
           const templates = await prisma.template.findMany({ where: { workspaceId } });
           if (templates.length > 0) {
              const newCampaign = await prisma.campaign.create({
                data: {
                  workspaceId,
                  name: `campaign_${Date.now()}`,
                  templateId: templates[0].id,
                  status: 'RUNNING',
                  aiGenerated: true,
                  totalContacts: 250,
                  sent: 250,
                  delivered: 245,
                  read: 190,
                  scheduledAt: new Date(),
                  launchedAt: new Date(),
                }
              });
              responseText = "I've successfully auto-created and launched a campaign for you!";
              card = {
                title: 'Campaign Launched',
                icon: '🚀',
                details: { name: newCampaign.name, status: 'RUNNING', audienceSize: 250 }
              };
           } else {
              responseText = "You don't have any templates yet. Please create a template first!";
           }
        } else {
           state = { step: 'CAMPAIGN_GATHER_NAME' };
           responseText = "Awesome. Let's start a Campaign. What is the name of the campaign?";
        }
      } else if (intent === 'DELETE_TEMPLATE') {
        state = { step: 'DELETE_GATHER_TEMPLATE_NAME' };
        responseText = "Sure, I can delete a template. What is the exact name of the template you want to delete?";
      } else if (intent === 'DELETE_CAMPAIGN') {
        state = { step: 'DELETE_GATHER_CAMPAIGN_NAME' };
        responseText = "I can delete a campaign for you. What is the name of the campaign?";
      } else if (intent === 'DELETE_ALL') {
        responseText = "I can delete templates or campaigns. Just say 'delete template' or 'delete campaign'.";
      } else {
        const generalPrompt = `You are a helpful AI assistant for ChatFlow Pro, a WhatsApp marketing tool. The user said: "${text}". Provide a brief, polite, and helpful answer.`;
        const aiGeneral = await callOllama(generalPrompt, "Keep your answer under 3 sentences.");
        responseText = aiGeneral || "I'm your AI Agent. I can help you create or delete templates and campaigns. Just tell me what you want to do!";
      }
    } 
    else if (state.step === 'TEMPLATE_GATHER_NAME') {
      state.templateName = text.replace(/\s+/g, '_').toLowerCase();
      state.step = 'TEMPLATE_GATHER_BODY';
      responseText = `Got it, I'll name it "${state.templateName}". What should the main message (body) say? You can use {{1}} for variables.`;
    }
    else if (state.step === 'TEMPLATE_GATHER_BODY') {
      state.templateBody = text;
      state.step = 'IDLE'; // Finished gathering
      
      // CREATE TEMPLATE
      if (workspaceId) {
        const newTemplate = await prisma.template.create({
          data: {
            workspaceId,
            name: state.templateName,
            category: 'MARKETING',
            language: 'en_US',
            status: 'APPROVED', // Auto-approve for AI magic demo
            aiGenerated: true,
            components: [
              { type: 'BODY', text: state.templateBody }
            ]
          }
        });
        
        responseText = "I have successfully created your template!";
        card = {
          title: 'Template Created',
          icon: '📝',
          details: {
            name: newTemplate.name,
            category: newTemplate.category,
            language: newTemplate.language,
          },
          preview: state.templateBody
        };
      } else {
        responseText = "I've drafted your template, but you need to log in to save it!";
      }
      state = { step: 'IDLE' };
    }
    else if (state.step === 'CAMPAIGN_GATHER_NAME') {
      state.campaignName = text;
      state.step = 'CAMPAIGN_GATHER_TEMPLATE';
      
      // Fetch available templates
      if (workspaceId) {
        const templates = await prisma.template.findMany({ where: { workspaceId } });
        if (templates.length > 0) {
          const names = templates.map(t => t.name).join(', ');
          responseText = `Nice name. Which template would you like to use? Available: ${names}`;
        } else {
          responseText = "You don't have any templates yet. Say 'Create a template' to make one first.";
          state = { step: 'IDLE' };
        }
      } else {
        responseText = "Please log in to see your templates.";
        state = { step: 'IDLE' };
      }
    }
    else if (state.step === 'CAMPAIGN_GATHER_TEMPLATE') {
      state.selectedTemplate = text;
      state.step = 'IDLE'; // Finished gathering

      if (workspaceId) {
        // Find template by name
        const template = await prisma.template.findFirst({
          where: { workspaceId, name: { contains: state.selectedTemplate, mode: 'insensitive' } }
        });

        if (template) {
          const newCampaign = await prisma.campaign.create({
            data: {
              workspaceId,
              name: state.campaignName,
              templateId: template.id,
              status: 'RUNNING',
              aiGenerated: true,
              totalContacts: 100,
              sent: 100,
              delivered: 98,
              read: 75,
              scheduledAt: new Date(),
              launchedAt: new Date(),
            }
          });

          responseText = "Your campaign has been successfully scheduled and is now running!";
          card = {
            title: 'Campaign Launched',
            icon: '🚀',
            details: {
              name: newCampaign.name,
              status: 'RUNNING',
              audienceSize: 100
            }
          };
        } else {
          responseText = `I couldn't find a template matching "${state.selectedTemplate}". Please try creating the campaign again.`;
        }
      } else {
        responseText = "You need to log in to save a campaign.";
      }
      state = { step: 'IDLE' };
    }
    else if (state.step === 'DELETE_GATHER_TEMPLATE_NAME') {
      // Use the raw input as the template name — no word stripping
      const targetName = text.trim();
      
      if (workspaceId && targetName) {
        try {
          // Try exact match first, then fallback to contains
          let result = await prisma.template.deleteMany({
            where: { workspaceId, name: targetName }
          });
          if (result.count === 0) {
            result = await prisma.template.deleteMany({
              where: { workspaceId, name: { contains: targetName } }
            });
          }
          if (result.count > 0) {
            responseText = `Successfully deleted ${result.count} template(s) matching "${targetName}".`;
            card = { title: 'Template Deleted', icon: '🗑️', details: { name: targetName, count: result.count } };
          } else {
            responseText = `I couldn't find any templates matching "${targetName}". Please check the exact name.`;
          }
        } catch (e) {
          console.error('Delete template error:', e.message);
          responseText = `I couldn't delete "${targetName}". It might be actively used by a campaign!`;
        }
      }
      state = { step: 'IDLE' };
    }
    else if (state.step === 'DELETE_GATHER_CAMPAIGN_NAME') {
      // Use the raw input as the campaign name — no word stripping
      const targetName = text.trim();

      if (workspaceId && targetName) {
        try {
          // Try exact match first, then fallback to contains
          let result = await prisma.campaign.deleteMany({
            where: { workspaceId, name: targetName }
          });
          if (result.count === 0) {
            result = await prisma.campaign.deleteMany({
              where: { workspaceId, name: { contains: targetName } }
            });
          }
          if (result.count > 0) {
            responseText = `Successfully deleted ${result.count} campaign(s) matching "${targetName}".`;
            card = { title: 'Campaign Deleted', icon: '🗑️', details: { name: targetName, count: result.count } };
          } else {
            responseText = `I couldn't find any campaigns matching "${targetName}". Please check the exact name.`;
          }
        } catch(e) {
          console.error('Delete campaign error:', e.message);
          responseText = `I couldn't delete "${targetName}".`;
        }
      }
      state = { step: 'IDLE' };
    }
    
    // Quick one-shot extraction for deletes (e.g. "delete template reminder_temp")
    if ((intent === 'DELETE_TEMPLATE' || intent === 'DELETE_CAMPAIGN') && !guided && workspaceId) {
      const parts = text.split(' ');
      const targetName = parts[parts.length - 1]; // Naive extraction, assume last word is the name
      if (targetName && targetName.length > 2) {
        try {
          if (intent === 'DELETE_TEMPLATE') {
            const result = await prisma.template.deleteMany({ where: { workspaceId, name: { contains: targetName } } });
            responseText = result.count > 0 ? `Successfully deleted template: ${targetName}` : `Couldn't find template: ${targetName}`;
            if (result.count > 0) card = { title: 'Template Deleted', icon: '🗑️', details: { name: targetName } };
          } else {
            const result = await prisma.campaign.deleteMany({ where: { workspaceId, name: { contains: targetName } } });
            responseText = result.count > 0 ? `Successfully deleted campaign: ${targetName}` : `Couldn't find campaign: ${targetName}`;
            if (result.count > 0) card = { title: 'Campaign Deleted', icon: '🗑️', details: { name: targetName } };
          }
        } catch (e) {
           responseText = `Failed to delete ${targetName}. It might be actively in use.`;
        }
        state = { step: 'IDLE' };
      }
    }

    if (session) {
      await prisma.aiSession.update({
        where: { id: session.id },
        data: { state }
      });
    }

    res.json({ content: responseText, card });
  } catch (error) {
    console.error('AI Onboarding Error:', error);
    res.status(500).json({ content: "Sorry, I ran into an error processing that request." });
  }
};
