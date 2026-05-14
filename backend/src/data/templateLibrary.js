// Curated WhatsApp template library. Names are slug-safe (lowercase, underscores)
// because Meta requires that for template names. Bodies use {{1}},{{2}}... variables
// per Meta's WhatsApp Cloud API spec.

export const TEMPLATE_LIBRARY = [
  // ── MARKETING ──────────────────────────────────────────────────────────
  {
    id: 'welcome_new_customer',
    title: 'Welcome — New Customer',
    description: 'Greet a brand-new customer right after signup.',
    useCase: 'Onboarding',
    name: 'welcome_new_customer',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, welcome to {{2}}! 🎉 We\'re excited to have you. Reply HELP anytime if you have questions.', example: { body_text: [['Alex', 'Acme Co']] } },
    ],
  },
  {
    id: 'abandoned_cart_reminder',
    title: 'Abandoned Cart Reminder',
    description: 'Recover lost sales — nudge customers who left items in cart.',
    useCase: 'E-commerce',
    name: 'abandoned_cart_reminder',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hey {{1}}, you left {{2}} in your cart. Complete your order now and get free shipping! Reply YES to checkout.', example: { body_text: [['Alex', 'a Bluetooth Speaker']] } },
    ],
  },
  {
    id: 'flash_sale_announcement',
    title: 'Flash Sale Announcement',
    description: 'Drive urgency with a time-limited offer.',
    useCase: 'Promotions',
    name: 'flash_sale_announcement',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: '🔥 Flash Sale Alert, {{1}}! Get {{2}}% off everything until {{3}}. Shop now before it ends!', example: { body_text: [['Alex', '30', 'midnight']] } },
    ],
  },
  {
    id: 'product_launch',
    title: 'New Product Launch',
    description: 'Announce a new arrival to existing customers.',
    useCase: 'Announcements',
    name: 'product_launch',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Big news, {{1}}! Our new {{2}} just dropped. Be one of the first to try it — exclusive 15% launch discount inside.', example: { body_text: [['Alex', 'Pro Headphones']] } },
    ],
  },
  {
    id: 'win_back_offer',
    title: 'Win-back Offer',
    description: 'Re-engage customers who haven\'t shopped in a while.',
    useCase: 'Retention',
    name: 'win_back_offer',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'We miss you, {{1}}! Here\'s {{2}}% off your next order. Come back and see what\'s new — offer valid for 7 days.', example: { body_text: [['Alex', '20']] } },
    ],
  },

  // ── UTILITY ────────────────────────────────────────────────────────────
  {
    id: 'order_confirmation',
    title: 'Order Confirmation',
    description: 'Confirm an order right after checkout.',
    useCase: 'Transactional',
    name: 'order_confirmation',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, your order #{{2}} has been confirmed. Total: {{3}}. We\'ll notify you when it ships. Thanks for shopping with us!', example: { body_text: [['Alex', 'A1029', '$49.99']] } },
    ],
  },
  {
    id: 'shipping_update',
    title: 'Shipping Update',
    description: 'Let customers know their order is on the way.',
    useCase: 'Logistics',
    name: 'shipping_update',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Good news {{1}}! Your order #{{2}} is on its way. Track it here: {{3}}. Estimated delivery: {{4}}.', example: { body_text: [['Alex', 'A1029', 'https://track.example.com/A1029', 'Tue, May 16']] } },
    ],
  },
  {
    id: 'delivery_confirmation',
    title: 'Delivery Confirmation',
    description: 'Confirm delivery and prompt for a review.',
    useCase: 'Logistics',
    name: 'delivery_confirmation',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Your order #{{1}} has been delivered, {{2}}! Hope you love it. Leave a review and get 10% off your next purchase.', example: { body_text: [['A1029', 'Alex']] } },
    ],
  },
  {
    id: 'appointment_reminder',
    title: 'Appointment Reminder',
    description: 'Reduce no-shows with a friendly reminder.',
    useCase: 'Booking',
    name: 'appointment_reminder',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, this is a reminder of your appointment on {{2}} at {{3}}. Reply CONFIRM to confirm or RESCHEDULE to change.', example: { body_text: [['Alex', 'Tuesday', '3:00 PM']] } },
    ],
  },
  {
    id: 'payment_received',
    title: 'Payment Received',
    description: 'Confirm a successful payment.',
    useCase: 'Transactional',
    name: 'payment_received',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Payment received! Thanks {{1}} — we got your payment of {{2}} for invoice #{{3}}. Receipt: {{4}}', example: { body_text: [['Alex', '$49.99', 'INV-1029', 'https://example.com/r/1029']] } },
    ],
  },
  {
    id: 'support_ticket_opened',
    title: 'Support Ticket Opened',
    description: 'Acknowledge a new support request immediately.',
    useCase: 'Customer Support',
    name: 'support_ticket_opened',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, we got your request (Ticket #{{2}}). Our team typically replies within {{3}} hours. We\'ll be in touch shortly.', example: { body_text: [['Alex', 'T-552', '2']] } },
    ],
  },
  {
    id: 'feedback_request',
    title: 'Feedback Request',
    description: 'Collect feedback after a purchase or interaction.',
    useCase: 'Customer Support',
    name: 'feedback_request',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hey {{1}}, how was your experience with {{2}}? We\'d love a quick rating: {{3}}', example: { body_text: [['Alex', 'our team', 'https://example.com/rate']] } },
    ],
  },

  // ── AUTHENTICATION ────────────────────────────────────────────────────
  {
    id: 'otp_verification',
    title: 'OTP Verification Code',
    description: 'Send a one-time code for login or signup.',
    useCase: 'Security',
    name: 'otp_verification',
    category: 'AUTHENTICATION',
    language: 'en_US',
    components: [
      { type: 'BODY', text: '{{1}} is your verification code. For your security, do not share this code.', example: { body_text: [['123456']] } },
    ],
  },
  {
    id: 'password_reset_code',
    title: 'Password Reset Code',
    description: 'Send a password-reset code on request.',
    useCase: 'Security',
    name: 'password_reset_code',
    category: 'AUTHENTICATION',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Your password reset code is {{1}}. This code expires in 10 minutes. If you didn\'t request this, ignore this message.', example: { body_text: [['438217']] } },
    ],
  },
];

export function findLibraryTemplate(id) {
  return TEMPLATE_LIBRARY.find((t) => t.id === id) || null;
}
