// Policy prose for the legal centre (/legal, /legal/privacy, …).
//
// Kept out of the component so the text can be revised without touching
// layout, and so it is obvious at a glance that every string here is authored
// in this repo — Legal.jsx renders `html` with dangerouslySetInnerHTML, which
// is only safe because nothing on this path is user- or API-supplied.
//
// Adapted from the Spandan "Legal" design's four documents, with the operator
// details changed to this product. The commercial specifics below (refund
// windows, retention periods, contact addresses) came from the design copy and
// are placeholders — they need a legal review before this goes public.

export const LEGAL_ORDER = ['terms', 'privacy', 'refund', 'cookies'];

export const LEGAL_DOCS = {
  terms: {
    title: 'Terms & Conditions',
    eyebrow: 'AGREEMENT',
    effective: '1 Jan 2026',
    updated: '9 Aug 2026',
    toc: [
      '1. Acceptance of terms', '2. The service', '3. Accounts & eligibility',
      '4. Acceptable use', '5. WhatsApp & Meta policies', '6. Fees, wallet & billing',
      '7. Suspension & termination', '8. Liability', '9. Governing law',
    ],
    html: `
<p>These Terms &amp; Conditions ("Terms") govern your access to and use of the Spandan platform, websites, APIs and related services (collectively, the "Service"). By creating an account or using the Service, you agree to these Terms.</p>
<h3>1. Acceptance of terms</h3>
<p>By accessing the Service you confirm that you are authorised to bind the business you represent and that you accept these Terms and our Privacy Policy. If you do not agree, do not use the Service.</p>
<h3>2. The service</h3>
<p>Spandan provides WhatsApp-first customer communication tooling — campaigns, templates, a shared inbox, automation, an AI assistant and analytics — delivered over the WhatsApp Business Platform and other connected channels. Features depend on your subscription plan and may change over time.</p>
<h3>3. Accounts &amp; eligibility</h3>
<ul><li>You must provide accurate business and contact information and keep it current.</li><li>You are responsible for all activity under your workspace, including that of invited team members and API keys.</li><li>You must safeguard your credentials and notify us promptly of any unauthorised access.</li></ul>
<h3>4. Acceptable use</h3>
<p>You agree <strong>not</strong> to use the Service to send spam or unsolicited messages, to transmit unlawful, deceptive, or infringing content, to harvest data without consent, or to circumvent messaging limits or rate controls. You are solely responsible for obtaining valid opt-in consent from every recipient you message.</p>
<h3>5. WhatsApp &amp; Meta policies</h3>
<p>Your use of WhatsApp features is additionally subject to the <strong>WhatsApp Business Messaging Policy</strong> and Meta's Commerce and Business Terms. Template approval, quality ratings, and messaging tier limits are controlled by Meta; we do not guarantee approval or delivery of any given message.</p>
<h3>6. Fees, wallet &amp; billing</h3>
<ul><li>Subscription fees are billed in advance for the plan term you select and are stated exclusive of applicable taxes (GST).</li><li>Conversation and message charges are deducted from your prepaid wallet at the rates shown at send time.</li><li>You authorise us and our payment processor to charge your selected payment method for recurring and wallet top-up amounts.</li></ul>
<h3>7. Suspension &amp; termination</h3>
<p>We may suspend or terminate access for breach of these Terms, non-payment, or activity that risks the security or reputation of the WhatsApp Business Platform. You may cancel at any time from Settings; see our Refund &amp; Cancellation Policy for how balances are handled.</p>
<h3>8. Limitation of liability</h3>
<p>The Service is provided "as is". To the maximum extent permitted by law, our aggregate liability arising out of or relating to the Service is limited to the fees you paid to us in the three (3) months preceding the claim. We are not liable for indirect, incidental, or consequential damages.</p>
<h3>9. Governing law</h3>
<p>These Terms are governed by the laws of India, and the courts of Bengaluru, Karnataka have exclusive jurisdiction over any dispute, subject to any mandatory arbitration the parties agree in writing.</p>`,
  },

  privacy: {
    title: 'Privacy Policy',
    eyebrow: 'YOUR DATA',
    effective: '1 Jan 2026',
    updated: '9 Aug 2026',
    toc: [
      '1. Information we collect', '2. How we use data', '3. Message content',
      '4. Sharing & processors', '5. Data retention', '6. Your rights',
      '7. Security', '8. International transfers',
    ],
    html: `
<p>This Privacy Policy explains how we collect, use, and protect information when you use the Service. We act as a <strong>data processor</strong> for the customer contact data you upload, and as a <strong>data controller</strong> for your own account information.</p>
<h3>1. Information we collect</h3>
<ul><li><strong>Account data</strong> — name, email, phone, company, and billing details.</li><li><strong>Contact data</strong> — the customer phone numbers, names and attributes you import to message.</li><li><strong>Message metadata</strong> — delivery, read and reply status, timestamps, and template usage.</li><li><strong>Usage &amp; device data</strong> — log data, IP address, and product analytics.</li></ul>
<h3>2. How we use data</h3>
<p>We use data to provide and secure the Service, route and deliver messages, power the AI assistant and analytics, process payments, provide support, and meet legal obligations. We do <strong>not</strong> sell your data.</p>
<h3>3. Message content</h3>
<p>Conversation content is processed to deliver messages, generate AI replies, and surface analytics within your workspace. AI features may send message context to our model providers strictly to produce a response; this content is not used to train third-party foundation models.</p>
<h3>4. Sharing &amp; sub-processors</h3>
<p>We share data with vetted sub-processors solely to run the Service, including Meta / WhatsApp (message delivery), our payment gateway, cloud hosting, and our AI model provider. Each is bound by data-protection obligations.</p>
<h3>5. Data retention</h3>
<p>We retain account data for the life of your account and as required for tax and legal purposes. Contact and conversation data are retained while your workspace is active and deleted or anonymised within 90 days of account closure, unless a longer period is legally required.</p>
<h3>6. Your rights</h3>
<p>Subject to applicable law (including India's DPDP Act, 2023), you may request access, correction, or deletion of your personal data, and you may withdraw consent. Submit requests via Help &amp; Support or the contact address on this page.</p>
<h3>7. Security</h3>
<p>We use encryption in transit and at rest, role-based access controls, audit logging, and least-privilege practices. No system is perfectly secure; we will notify affected users and authorities of a qualifying breach as required by law.</p>
<h3>8. International transfers</h3>
<p>Data is primarily processed in India. Where processing occurs elsewhere (e.g. a sub-processor), we apply appropriate safeguards for cross-border transfers.</p>`,
  },

  refund: {
    title: 'Refund & Cancellation',
    eyebrow: 'BILLING',
    effective: '1 Jan 2026',
    updated: '9 Aug 2026',
    toc: [
      '1. Subscription cancellation', '2. Subscription refunds', '3. Wallet balances',
      '4. Message charges', '5. Failed payments', '6. How to request',
    ],
    html: `
<p>This policy explains cancellations and refunds for subscriptions and prepaid wallet balances. It should be read together with our Terms &amp; Conditions.</p>
<h3>1. Subscription cancellation</h3>
<p>You may cancel your subscription at any time from <strong>Settings → Billing</strong>. Cancellation stops the next renewal; your plan remains active until the end of the current paid term.</p>
<h3>2. Subscription refunds</h3>
<ul><li>Subscription fees are generally <strong>non-refundable</strong> once a billing term has begun.</li><li>If you cancel within <strong>7 days</strong> of your first paid subscription and have not sent live campaigns, you may request a full refund of that subscription fee.</li><li>Statutory rights that cannot be waived are unaffected.</li></ul>
<h3>3. Wallet balances</h3>
<p>Unused prepaid wallet balance is refundable on account closure, less any message charges already incurred and non-recoverable payment-gateway fees. Refunds are issued to the original payment method within 7–10 business days.</p>
<h3>4. Message &amp; conversation charges</h3>
<p>Amounts already deducted for delivered messages or opened conversations are <strong>not refundable</strong>, as these reflect costs charged by Meta / WhatsApp and carriers.</p>
<h3>5. Failed payments</h3>
<p>If a renewal payment fails, we retry per our dunning schedule. Persistent failure may pause sending until the balance is settled; no charge is made for a service you did not receive.</p>
<h3>6. How to request a refund</h3>
<p>Raise a request via Help &amp; Support with your workspace name and invoice ID. We respond within 3 business days.</p>`,
  },

  cookies: {
    title: 'Cookie Policy',
    eyebrow: 'TRACKING',
    effective: '1 Jan 2026',
    updated: '9 Aug 2026',
    toc: [
      '1. What cookies are', '2. Categories we use',
      '3. Third-party cookies', '4. Managing cookies',
    ],
    html: `
<p>This Cookie Policy explains how we use cookies and similar technologies on our website and web app.</p>
<h3>1. What cookies are</h3>
<p>Cookies are small text files stored on your device that help a site function and remember your preferences. We also use local storage and similar technologies.</p>
<h3>2. Categories we use</h3>
<ul><li><strong>Strictly necessary</strong> — authentication, session, security and load-balancing. These cannot be switched off.</li><li><strong>Functional</strong> — remember preferences such as language, theme and last-viewed screen.</li><li><strong>Analytics</strong> — help us understand product usage so we can improve it. Aggregated and, where feasible, de-identified.</li></ul>
<h3>3. Third-party cookies</h3>
<p>Some cookies are set by processors that run parts of the Service, such as our payment gateway and product-analytics provider. They are used only to operate and improve the Service.</p>
<h3>4. Managing cookies</h3>
<p>You can control or delete cookies through your browser settings. Blocking strictly necessary cookies may break sign-in and core features. Where required, we present a consent banner for non-essential cookies.</p>`,
  },
};
