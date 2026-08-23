// Starter definitions for WhatsApp Forms.
//
// Picking a template pre-fills the builder with a working question set so a
// form can be created without composing every field by hand. They are served
// from here (GET /whatsapp-forms/templates) rather than duplicated in the UI,
// so the presets and the field types the runtime understands stay in step —
// every `type` below must exist in FIELD_TYPES in whatsappForms.service.js.
//
// `categories` seeds the form's own categories; the user can change them.

export const FORM_CATEGORIES = [
  'Lead Generation',
  'Feedback',
  'Survey',
  'Support',
  'Sales',
  'Onboarding',
];

export const FORM_TEMPLATES = [
  {
    id: 'default',
    title: 'Default',
    description: 'A blank form with one open question to build on.',
    categories: [],
    keyword: '',
    completionMessage: "Thanks! We've recorded your response.",
    schema: [
      { label: 'Your answer', type: 'text', required: true, options: [] },
    ],
  },
  {
    id: 'purchase_interest',
    title: 'Collect purchase interest',
    description: 'Qualify a lead: what they want, budget and how to reach them.',
    categories: ['Lead Generation', 'Sales'],
    keyword: 'BUY',
    completionMessage: 'Thanks! Our team will reach out with pricing shortly.',
    schema: [
      { label: 'Which product are you interested in?', type: 'text', required: true, options: [] },
      { label: 'What is your budget range?', type: 'choice', required: true, options: ['Under ₹10,000', '₹10,000–₹50,000', '₹50,000–₹2,00,000', 'Above ₹2,00,000'] },
      { label: 'When are you looking to buy?', type: 'choice', required: true, options: ['Immediately', 'Within a month', 'In 1–3 months', 'Just exploring'] },
      { label: 'Your email address', type: 'email', required: true, options: [] },
    ],
  },
  {
    id: 'get_feedback',
    title: 'Get feedback',
    description: 'Rate the service and capture what would make it better.',
    categories: ['Feedback'],
    keyword: 'FEEDBACK',
    completionMessage: 'Thank you for your feedback — it genuinely helps us improve.',
    schema: [
      { label: 'How would you rate our service?', type: 'choice', required: true, options: ['Excellent', 'Good', 'Average', 'Poor'] },
      { label: 'Would you recommend us to others?', type: 'choice', required: true, options: ['Yes, definitely', 'Maybe', 'No'] },
      { label: 'What could we do better?', type: 'text', required: false, options: [] },
    ],
  },
  {
    id: 'send_survey',
    title: 'Send a survey',
    description: 'Short multi-question survey with a satisfaction score.',
    categories: ['Survey'],
    keyword: 'SURVEY',
    completionMessage: 'Thanks for taking the survey!',
    schema: [
      { label: 'How did you hear about us?', type: 'choice', required: true, options: ['Social media', 'Friend or colleague', 'Search', 'Advertisement', 'Other'] },
      { label: 'How satisfied are you, from 1 to 10?', type: 'number', required: true, options: [] },
      { label: 'Which feature do you use most?', type: 'text', required: false, options: [] },
      { label: 'Any suggestions for us?', type: 'text', required: false, options: [] },
    ],
  },
  {
    id: 'customer_support',
    title: 'Customer support',
    description: 'Triage an issue and collect a callback number.',
    categories: ['Support'],
    keyword: 'SUPPORT',
    completionMessage: "Thanks — we've logged your request and will get back to you shortly.",
    schema: [
      { label: 'What do you need help with?', type: 'choice', required: true, options: ['Order issue', 'Billing', 'Technical problem', 'Something else'] },
      { label: 'Please describe the issue', type: 'text', required: true, options: [] },
      { label: 'How urgent is it?', type: 'choice', required: true, options: ['Urgent', 'Normal', 'Low'] },
      { label: 'Best number to reach you on', type: 'phone', required: true, options: [] },
    ],
  },
];

export function listFormTemplates() {
  return { categories: FORM_CATEGORIES, templates: FORM_TEMPLATES };
}
