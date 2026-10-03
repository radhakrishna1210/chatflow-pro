// The AI Agents area's one API family (backend/src/routes/index.js):
//
//   /ai-agents             the agent studio — personas, channels, guidelines, actions
//   /ai-agents/whatsapp    the live WhatsApp AI agent — config, knowledge, deploy, test
//   /ai-agents/autonomous  the autonomous CRM agent — switch, queue, suggestions, per-record history
//
// The server still answers the old /ai-agent and /agent paths for existing
// clients; new code uses these.
export const AI_AGENTS_API = Object.freeze({
  studio: '/ai-agents',
  whatsapp: '/ai-agents/whatsapp',
  autonomous: '/ai-agents/autonomous',
});

// Where the one AI Agents screen lives, and the ?tab= of each of its sections.
// Old deep links (Automation's WhatsApp AI Agent tab, /dashboard/ai-chatbots)
// are redirected here by Dashboard.jsx.
export const AI_AGENTS_PATH = '/dashboard/ai-agent';

export function aiAgentsHref(tab) {
  return tab ? `${AI_AGENTS_PATH}?tab=${encodeURIComponent(tab)}` : AI_AGENTS_PATH;
}
