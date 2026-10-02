import { z } from 'zod';
import { TRIGGERS, ACTIONS, CONDITIONS, MAX_ACTIONS, validateGraph } from '../services/workflowGraph.js';

// Server-side shape of a workflow's `nodes`. The builder was the only thing
// validating them, so an API client could save a string, null, unknown
// subtypes or more steps than the engine runs. Every node is checked against
// the engine's vocabulary, then the whole graph against validateGraph (one
// trigger, at least one action, values present, condition skips in range,
// at most MAX_ACTIONS steps). Unknown keys are kept: the builder stores its
// canvas position and ids on the node.

const shortText = z.string().max(4096);
const scalar = z.union([shortText, z.number()]);

const common = {
  id: z.union([z.string().max(100), z.number()]).optional(),
  value: scalar.nullable().optional(),
  pos: z.object({ x: z.number(), y: z.number() }).partial().optional(),
};

const subtypeOf = (vocabulary, kind) => z.string().refine((s) => Object.hasOwn(vocabulary, s), {
  message: `Unknown ${kind}. Available: ${Object.keys(vocabulary).join(', ')}`,
});

const triggerNode = z.object({ ...common, type: z.literal('trigger'), subtype: subtypeOf(TRIGGERS, 'trigger') }).passthrough();

const actionNode = z.object({
  ...common,
  type: z.literal('action'),
  subtype: subtypeOf(ACTIONS, 'action'),
  options: z.array(z.union([shortText, z.object({ title: shortText }).passthrough()])).max(10).optional(),
  reminder: shortText.nullable().optional(),
  remindAfter: scalar.nullable().optional(),
}).passthrough();

const conditionNode = z.object({
  ...common,
  type: z.literal('condition'),
  subtype: subtypeOf(CONDITIONS, 'condition'),
  skipIfFalse: z.coerce.number().int().min(1).max(MAX_ACTIONS).optional(),
}).passthrough();

const node = z.discriminatedUnion('type', [triggerNode, actionNode, conditionNode]);

// One trigger plus at most MAX_ACTIONS steps.
export const workflowNodesSchema = z.array(node).min(1).max(MAX_ACTIONS + 1).superRefine((nodes, ctx) => {
  try {
    validateGraph(nodes);
  } catch (err) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: err.message });
  }
});
