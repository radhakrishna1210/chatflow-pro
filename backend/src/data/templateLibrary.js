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
  {
    id: 'two_factor_auth_code',
    title: 'Two-Factor Auth Code',
    description: 'Send a 2FA code during a sensitive action.',
    useCase: 'Security',
    name: 'two_factor_auth_code',
    category: 'AUTHENTICATION',
    language: 'en_US',
    components: [
      { type: 'BODY', text: '{{1}} is your two-factor authentication code for {{2}}. Never share this code with anyone, including {{2}} support.', example: { body_text: [['927310', 'Acme Co']] } },
    ],
  },
  {
    id: 'login_alert',
    title: 'New Login Alert',
    description: 'Warn the user when a new device signs into their account.',
    useCase: 'Security',
    name: 'login_alert',
    category: 'AUTHENTICATION',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, a new sign-in to your account was detected from {{2}} on {{3}}. If this wasn\'t you, reset your password immediately.', example: { body_text: [['Alex', 'Chrome on Windows · Mumbai', 'May 14, 9:42 AM']] } },
    ],
  },

  // ── MORE MARKETING ─────────────────────────────────────────────────────
  {
    id: 'discount_code_offer',
    title: 'Discount Code Drop',
    description: 'Send a personal discount code to drive a repeat purchase.',
    useCase: 'Promotions',
    name: 'discount_code_offer',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hey {{1}}, here\'s a treat 🎁 — use code *{{2}}* at checkout for {{3}}% off your next order. Valid until {{4}}.', example: { body_text: [['Alex', 'SAVE15', '15', 'May 31']] } },
    ],
  },
  {
    id: 'birthday_wish',
    title: 'Birthday Wish + Reward',
    description: 'Wish the customer a happy birthday with a small reward.',
    useCase: 'Loyalty',
    name: 'birthday_wish',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: '🎂 Happy birthday, {{1}}! As a thank-you for being with us, enjoy {{2}}% off this week. Use code *{{3}}*.', example: { body_text: [['Alex', '20', 'BDAY20']] } },
    ],
  },
  {
    id: 'event_invite',
    title: 'Event Invitation',
    description: 'Invite a customer to a webinar, sale day, or in-store event.',
    useCase: 'Events',
    name: 'event_invite',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, you\'re invited to {{2}} on {{3}}. RSVP here: {{4}}. Limited seats — first come, first served.', example: { body_text: [['Alex', 'our Summer Launch Event', 'Sat May 18, 6 PM', 'https://example.com/rsvp']] } },
    ],
  },
  {
    id: 'referral_program_invite',
    title: 'Referral Program Invite',
    description: 'Invite the customer to refer a friend for a reward.',
    useCase: 'Loyalty',
    name: 'referral_program_invite',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: '{{1}}, refer a friend and you both get {{2}} off. Share your link: {{3}}', example: { body_text: [['Alex', '₹200', 'https://example.com/r/alex']] } },
    ],
  },
  {
    id: 'restock_notification',
    title: 'Back in Stock',
    description: 'Notify a customer when a wish-listed item is back in stock.',
    useCase: 'E-commerce',
    name: 'restock_notification',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Good news {{1}} — *{{2}}* is back in stock! Grab it before it\'s gone: {{3}}', example: { body_text: [['Alex', 'Pro Headphones (Black)', 'https://example.com/p/headphones']] } },
    ],
  },
  {
    id: 'review_request_followup',
    title: 'Review Request',
    description: 'Ask for a product review a few days after delivery.',
    useCase: 'E-commerce',
    name: 'review_request_followup',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, hope you\'re loving your {{2}}! 🌟 Mind leaving a quick review? It really helps us: {{3}}', example: { body_text: [['Alex', 'Pro Headphones', 'https://example.com/review/A1029']] } },
    ],
  },

  // ── MORE UTILITY ──────────────────────────────────────────────────────
  {
    id: 'cod_order_confirmation',
    title: 'COD Order Confirmation',
    description: 'Confirm a cash-on-delivery order and ask the customer to confirm.',
    useCase: 'Transactional',
    name: 'cod_order_confirmation',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, please confirm your COD order #{{2}} for {{3}}. Reply YES to confirm or NO to cancel within 12 hours.', example: { body_text: [['Alex', 'A1029', '₹2,499']] } },
    ],
  },
  {
    id: 'out_for_delivery',
    title: 'Out for Delivery',
    description: 'Tell the customer the courier is on its way today.',
    useCase: 'Logistics',
    name: 'out_for_delivery',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Your order #{{1}} is out for delivery today and will arrive by {{2}}. Courier: {{3}}. Track: {{4}}', example: { body_text: [['A1029', '7 PM', 'BlueDart', 'https://track.example.com/A1029']] } },
    ],
  },
  {
    id: 'return_approved',
    title: 'Return Approved',
    description: 'Confirm an approved return and next steps.',
    useCase: 'E-commerce',
    name: 'return_approved',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, your return for order #{{2}} is approved. Pick-up scheduled for {{3}}. Please keep the item packed.', example: { body_text: [['Alex', 'A1029', 'Thu May 16']] } },
    ],
  },
  {
    id: 'refund_issued',
    title: 'Refund Issued',
    description: 'Notify the customer when their refund has been processed.',
    useCase: 'Transactional',
    name: 'refund_issued',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, your refund of {{2}} for order #{{3}} has been processed. It should reflect in your account within {{4}} business days.', example: { body_text: [['Alex', '₹2,499', 'A1029', '3-5']] } },
    ],
  },
  {
    id: 'invoice_due_reminder',
    title: 'Invoice Due Reminder',
    description: 'Politely remind a customer that an invoice is due.',
    useCase: 'Billing',
    name: 'invoice_due_reminder',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, a quick reminder that invoice #{{2}} for {{3}} is due on {{4}}. Pay here: {{5}}', example: { body_text: [['Alex', 'INV-1029', '₹2,499', 'May 20', 'https://example.com/pay/INV-1029']] } },
    ],
  },
  {
    id: 'subscription_renewal_reminder',
    title: 'Subscription Renewing',
    description: 'Notify the customer that their subscription renews soon.',
    useCase: 'Billing',
    name: 'subscription_renewal_reminder',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, your {{2}} subscription renews on {{3}} for {{4}}. No action needed — we\'ll bill your saved payment method.', example: { body_text: [['Alex', 'Pro Plan', 'May 20', '₹499/mo']] } },
    ],
  },
  {
    id: 'payment_failed',
    title: 'Payment Failed',
    description: 'Alert the customer that a recurring payment failed.',
    useCase: 'Billing',
    name: 'payment_failed',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, we couldn\'t charge your card for {{2}} (invoice #{{3}}). Please update your payment method to avoid service interruption: {{4}}', example: { body_text: [['Alex', '₹499', 'INV-1030', 'https://example.com/billing']] } },
    ],
  },
  {
    id: 'appointment_confirmation',
    title: 'Appointment Confirmed',
    description: 'Confirm a booking right after it\'s made.',
    useCase: 'Booking',
    name: 'appointment_confirmation',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}. Need to reschedule? Reply RESCHEDULE.', example: { body_text: [['Alex', 'Dr. Sharma', 'Tuesday May 21', '3:00 PM']] } },
    ],
  },
  {
    id: 'kyc_verification_required',
    title: 'KYC / Verification Required',
    description: 'Ask the user to complete KYC or document verification.',
    useCase: 'Onboarding',
    name: 'kyc_verification_required',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, to activate your account we need to verify your identity. Upload your documents here: {{2}}. This usually takes under 5 minutes.', example: { body_text: [['Alex', 'https://example.com/kyc']] } },
    ],
  },
  {
    id: 'support_resolved',
    title: 'Support Ticket Resolved',
    description: 'Confirm a support ticket is closed and ask for feedback.',
    useCase: 'Customer Support',
    name: 'support_resolved',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, ticket #{{2}} has been resolved. How did we do? Rate your experience: {{3}}', example: { body_text: [['Alex', 'T-552', 'https://example.com/rate/T-552']] } },
    ],
  },
];

export function findLibraryTemplate(id) {
  return TEMPLATE_LIBRARY.find((t) => t.id === id) || null;
}
