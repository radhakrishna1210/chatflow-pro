import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Set up isolated offline test environment
process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline';
process.env.DIRECT_URL = process.env.DATABASE_URL;

const sentReplies = [];
mock.module('./outbound.service.js', {
  namedExports: {
    sendAutomatedReply: async (args) => {
      sentReplies.push(args);
      return { id: `reply_${sentReplies.length}` };
    },
    markNumberUnreachable: async () => {},
  },
});

mock.module('../queues/workflow.queue.js', {
  namedExports: {
    workflowQueue: {},
    enqueueWorkflowResume: async () => {},
    enqueueReplyReminder: async () => {},
    enqueueDelayedResponseCheck: async () => {},
  },
});

// Mock STT service
mock.module('./stt.service.js', {
  namedExports: {
    cleanAudioMime: (m) => 'audio/ogg',
    transcribeAudioBuffer: async () => 'Hello, tell me about your pricing plans',
    transcribeWhatsAppAudio: async ({ mediaId }) => {
      if (mediaId === 'vn_pricing') {
        return {
          text: 'Hello, tell me about your pricing plans',
          buffer: Buffer.from('mock_audio_bytes'),
          mimeType: 'audio/ogg',
        };
      }
      if (mediaId === 'vn_discount') {
        return {
          text: 'discount',
          buffer: Buffer.from('mock_audio_bytes'),
          mimeType: 'audio/ogg',
        };
      }
      return null;
    },
  },
});

// Mock AI agent reply generator
mock.module('./aiAgent.service.js', {
  namedExports: {
    matchIntent: async () => null,
    generateAgentReply: async (workspaceId, messageBody) => {
      return `Our pricing plans start at $29/mo for Starter and $99/mo for Pro. (Replying to: "${messageBody}")`;
    },
    composeAgentPrompt: () => 'Test persona prompt',
    AGENT_PROMPT_SELECT: { aiAgentName: true, aiAgentPrompt: true },
  },
});

mock.module('./campaignAi.service.js', {
  namedExports: {
    handleCampaignAiInbound: async () => false,
    parseCampaignCtaPayload: () => null,
    cancelCampaignAiSession: async () => {},
    hasActiveCampaignAiSession: async () => false,
  },
});

mock.module('./whatsappForms.service.js', {
  namedExports: {
    handleFormInbound: async () => false,
    cancelOpenSubmission: async () => {},
    hasOpenSubmission: async () => false,
  },
});

const { processWebhook } = await import('./webhook.service.js');
const { prisma } = await import('../lib/prisma.js');

// In-memory fake database
let messages = [];
let conversations = [];
let contacts = [];

prisma.waNumber.findFirst = async ({ where }) => {
  if (where?.metaPhoneNumberId === 'PHONE_NUM_ID_1') {
    return {
      id: 'wa_1',
      workspaceId: 'ws_1',
      metaPhoneNumberId: 'PHONE_NUM_ID_1',
      phoneNumber: '+19876543210',
      encryptedAccessToken: null,
    };
  }
  return null;
};

prisma.contact.findFirst = async () => ({
  id: 'contact_1',
  workspaceId: 'ws_1',
  name: 'Test Customer',
  phoneNumber: '+19876543210',
});

prisma.conversation.findFirst = async () => ({
  id: 'conv_1',
  workspaceId: 'ws_1',
  contactId: 'contact_1',
  waNumberId: 'wa_1',
  status: 'OPEN',
  humanHandoffAt: null,
  lastMessageAt: new Date(),
});

prisma.conversation.update = async () => ({ id: 'conv_1' });
prisma.sequenceEnrollment.updateMany = async () => ({ count: 0 });

prisma.workspace.findUnique = async () => ({
  id: 'ws_1',
  aiAgentEnabled: true,
  autoWelcomeEnabled: false,
  autoOooEnabled: false,
  escalationRules: null,
});

prisma.campaignRecipient = {
  findFirst: async () => null,
  findMany: async () => [],
};

prisma.campaignAiSession = {
  findFirst: async () => null,
  updateMany: async () => ({ count: 0 }),
};

prisma.whatsappFormSubmission = {
  findFirst: async () => null,
};

prisma.whatsappForm = {
  findMany: async () => [],
};

prisma.workflowRun = {
  findFirst: async () => null,
  findMany: async () => [],
};

prisma.workflow = {
  findMany: async () => [],
};

prisma.automationTrigger = {
  findFirst: async () => null,
  findMany: async () => [],
};

prisma.savedView = {
  findFirst: async () => null,
  findMany: async () => [],
};

prisma.intentRule = {
  findMany: async () => [],
};

prisma.message = {
  create: async ({ data }) => {
    const row = { id: `msg_${messages.length + 1}`, ...data };
    messages.push(row);
    return row;
  },
  count: async () => 0,
};

test('Customer voice note triggers STT and delivers text reply from AI agent', async () => {
  sentReplies.length = 0;
  messages.length = 0;

  const webhookPayload = {
    entry: [
      {
        id: 'waba_1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                phone_number_id: 'PHONE_NUM_ID_1',
                display_phone_number: '+19876543210',
              },
              contacts: [{ profile: { name: 'Alice' }, wa_id: '19876543210' }],
              messages: [
                {
                  from: '19876543210',
                  id: 'wamid.VN_TEST_001',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'audio',
                  audio: {
                    id: 'vn_pricing',
                    mime_type: 'audio/ogg; codecs=opus',
                    voice: true,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  await processWebhook(webhookPayload);

  // 1. Verify message was stored with transcribed text
  assert.equal(messages.length, 1, 'Inbound message should be saved');
  const stored = messages[0];
  assert.equal(stored.type, 'AUDIO');
  assert.equal(stored.body, 'Hello, tell me about your pricing plans', 'Message body should contain STT transcription');
  assert.equal(stored.mediaId, 'vn_pricing');

  // 2. Verify AI agent responded via text reply back to WhatsApp
  assert.equal(sentReplies.length, 1, 'An automated text reply should be sent');
  const reply = sentReplies[0];
  assert.equal(reply.toPhone, '19876543210');
  assert.match(reply.body, /Our pricing plans start at \$29\/mo/, 'Reply text should address transcribed question');
  assert.match(reply.body, /Hello, tell me about your pricing plans/, 'Agent should be replying to the transcribed text');
});

test('Customer voice note matching trigger keyword executes keyword reply', async () => {
  sentReplies.length = 0;
  messages.length = 0;

  // Configure trigger for keyword 'DISCOUNT'
  prisma.automationTrigger.findMany = async () => [
    {
      id: 'trig_1',
      keyword: 'discount',
      matchType: 'EXACT',
      responseTemplate: 'Use coupon SAVE20 for 20% off your purchase!',
      isActive: true,
      createdAt: new Date(),
    },
  ];

  const webhookPayload = {
    entry: [
      {
        id: 'waba_1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                phone_number_id: 'PHONE_NUM_ID_1',
                display_phone_number: '+19876543210',
              },
              contacts: [{ profile: { name: 'Bob' }, wa_id: '19876543210' }],
              messages: [
                {
                  from: '19876543210',
                  id: 'wamid.VN_TEST_002',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'audio',
                  audio: {
                    id: 'vn_discount',
                    mime_type: 'audio/ogg; codecs=opus',
                    voice: true,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  await processWebhook(webhookPayload);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, 'discount');

  assert.equal(sentReplies.length, 1);
  assert.equal(sentReplies[0].body, 'Use coupon SAVE20 for 20% off your purchase!');
});

test.after(() => {
  setTimeout(() => process.exit(0), 100);
});

