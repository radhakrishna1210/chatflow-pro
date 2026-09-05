// Meta payload generation, per template type.
//
//   Standard → Utility → Carousel → Catalog → Synchronisation
//
// Run with no server and no database:
//   node scripts/template-payload-check.mjs
//
// Everything here is the real send path — services/templatePayload.service.js,
// the same function workers/campaign.worker.js and the API Playground call.
// The only thing stubbed is minting a phone-scoped media id from stored bytes,
// which is an upload to Meta and the one part of a carousel send that is not
// pure shape work; `resolveMediaId` exists on the builder for exactly that.
//
// Each assertion below corresponds to a defect reproduced before it was fixed:
// a carousel whose static link buttons were sent with an empty `text` (Meta
// 100), a catalog template sent with no `components` at all (Meta 131008), and
// a sync that dropped the stored card images.

import { buildTemplateSendPayload, validateCarouselTemplate } from '../src/services/templatePayload.service.js';
import {
  preserveInternalFields, detectTemplateType, normalizeTemplateComponents, toMetaComponents,
} from '../src/lib/templateStructure.js';
import { contactVariableResolver } from '../src/lib/templateParams.js';

let pass = 0;
let fail = 0;
const results = [];
const section = (n) => results.push(`\n── ${n} ${'─'.repeat(Math.max(0, 52 - n.length))}`);
function check(name, ok, detail) {
  if (ok) pass += 1; else fail += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  <- ${detail}` : ''}`);
}
async function throws(name, fn, matcher) {
  try {
    await fn();
    check(name, false, 'no error was thrown');
  } catch (err) {
    check(name, matcher.test(err.message), `message was "${err.message}"`);
  }
}

// Stands in for the Meta media upload: returns a deterministic id per asset.
const stubMedia = (asset) => Promise.resolve(`media_${asset.id}`);
const build = (template, opts = {}) => buildTemplateSendPayload(template, {
  phoneNumberId: 'PNID', accessToken: 'never-logged', resolveMediaId: stubMedia,
  resolve: contactVariableResolver({ name: 'Priya' }), log: false, ...opts,
});

const contact = { name: 'Priya' };

// ── Fixtures ────────────────────────────────────────────────────────────────

const card = (n, { url = 'https://shop.example.com/offer', example = null, text = 'View offer' } = {}) => ({
  components: [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: [`h${n}`] }, _assetId: `asset${n}` },
    { type: 'BODY', text: `Card ${n} body for {{1}}` },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text, url, ...(example ? { example: [example] } : {}) }] },
  ],
});

const carouselTemplate = (cards) => ({
  id: 'tpl_carousel', name: 'carousel_testing', language: 'en', category: 'MARKETING',
  components: [{ type: 'BODY', text: 'Hi {{1}}, this week only' }, { type: 'CAROUSEL', cards }],
});

const catalogTemplate = (overrides = {}) => ({
  id: 'tpl_catalog', name: 'qa_catalog_test_01', language: 'en', category: 'MARKETING',
  components: [
    { type: 'BODY', text: 'Browse this season’s arrivals.' },
    { type: 'FOOTER', text: 'Reply STOP to unsubscribe' },
    { type: 'BUTTONS', buttons: [{ type: 'CATALOG', text: 'View catalog', ...overrides }] },
  ],
});

try {
  // ── Carousel ──────────────────────────────────────────────────────────────
  section('Carousel');

  const twoCard = carouselTemplate([card(1), card(2)]);
  check('carousel template is detected as CAROUSEL', detectTemplateType(twoCard.components) === 'CAROUSEL');

  const carousel = await build(twoCard);
  const cComp = carousel.components.find((c) => c.type === 'carousel');
  check('two-card carousel produces two cards', cComp?.cards?.length === 2, JSON.stringify(cComp?.cards?.length));
  check('cards keep their order', cComp?.cards?.[0]?.card_index === 0 && cComp?.cards?.[1]?.card_index === 1);
  check(
    'each card carries its own image media id',
    cComp?.cards?.[0]?.components?.[0]?.parameters?.[0]?.image?.id === 'media_asset1'
      && cComp?.cards?.[1]?.components?.[0]?.parameters?.[0]?.image?.id === 'media_asset2',
  );
  check(
    'card body text variables are substituted from the contact',
    cComp?.cards?.[0]?.components?.[1]?.parameters?.[0]?.text === 'Priya',
    JSON.stringify(cComp?.cards?.[0]?.components?.[1]),
  );
  check(
    'message bubble body is still resolved',
    carousel.components.find((c) => c.type === 'body')?.parameters?.[0]?.text === 'Priya',
  );

  // The bug: a static "View offer" link button was sent as an empty text
  // parameter, which Meta rejects with code 100.
  const emptyTextParam = JSON.stringify(carousel).includes('"text":""')
    || JSON.stringify(carousel).includes('"text":" "');
  check('no button parameter is empty or blank in the final payload', !emptyTextParam, JSON.stringify(carousel));
  const staticButtons = cComp.cards.flatMap((c) => c.components.filter((cc) => cc.type === 'button'));
  check(
    'a static link button contributes no parameter component',
    staticButtons.length === 0,
    JSON.stringify(staticButtons),
  );

  // A dynamic link button DOES carry its suffix, on every card, in order.
  const dynamic = carouselTemplate([
    card(1, { url: 'https://shop.example.com/{{1}}', example: 'https://shop.example.com/spring' }),
    card(2, { url: 'https://shop.example.com/{{1}}', example: 'https://shop.example.com/summer' }),
  ]);
  const dynPayload = await build(dynamic);
  const dynCards = dynPayload.components.find((c) => c.type === 'carousel').cards;
  const dynButtons = dynCards.map((c) => c.components.find((cc) => cc.type === 'button'));
  check(
    'a dynamic link button carries its URL suffix',
    dynButtons[0]?.sub_type === 'url' && dynButtons[0]?.parameters?.[0]?.text === 'spring',
    JSON.stringify(dynButtons[0]),
  );
  check(
    'each card keeps its own URL value in order',
    dynButtons[1]?.parameters?.[0]?.text === 'summer',
    JSON.stringify(dynButtons[1]),
  );
  check('dynamic link button is addressed at its own index', dynButtons[0]?.index === '0');

  // A quick reply on a card must carry the button's label as its payload —
  // that is what the webhook reports back on a tap.
  const qr = carouselTemplate([{
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h'] }, _assetId: 'a1' },
      { type: 'BODY', text: 'Card body' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'View offer' }] },
    ],
  }]);
  const qrPayload = await build(qr);
  const qrButton = qrPayload.components.find((c) => c.type === 'carousel')
    .cards[0].components.find((cc) => cc.type === 'button');
  check(
    'a card quick reply carries its label as the payload',
    qrButton?.sub_type === 'quick_reply' && qrButton?.parameters?.[0]?.payload === 'View offer',
    JSON.stringify(qrButton),
  );

  await throws(
    'a card button with no label fails validation before Meta',
    () => build(carouselTemplate([{
      components: [
        { type: 'HEADER', format: 'IMAGE', example: {}, _assetId: 'a1' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: '' }] },
      ],
    }])),
    /no label/i,
  );
  await throws(
    'a dynamic URL with no example fails validation before Meta',
    () => build(carouselTemplate([card(1, { url: 'https://x.example.com/{{1}}' })])),
    /example value/i,
  );
  await throws(
    'a card with no stored image fails validation before Meta',
    () => build(carouselTemplate([{
      components: [
        // Neither stored bytes nor a recoverable approved sample.
        { type: 'HEADER', format: 'IMAGE', example: {} },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Go' }] },
      ],
    }])),
    /stored media/i,
  );
  // A card synced down from Meta keeps no `_assetId`, but Meta is still
  // holding the approved sample the bytes can be recovered from — that card is
  // sendable and must not be refused up front.
  const syncedCard = {
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://scontent.whatsapp.net/v/t61/sample.jpg'] } },
      { type: 'BODY', text: 'Card body' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View offer', url: 'https://shop.example.com/offer' }] },
    ],
  };
  let recoverablePassed = true;
  try { validateCarouselTemplate(carouselTemplate([syncedCard])); } catch { recoverablePassed = false; }
  check('a card whose image can be recovered from Meta passes validation', recoverablePassed);

  await throws(
    'a carousel with no cards fails validation before Meta',
    () => build(carouselTemplate([])),
    /no cards/i,
  );

  // ── Catalog ───────────────────────────────────────────────────────────────
  section('Catalog');

  const cat = catalogTemplate();
  check('catalog template is detected as CATALOG', detectTemplateType(cat.components) === 'CATALOG');

  const catPayload = await build(cat);
  check('catalog payload carries template.components', Array.isArray(catPayload.components), JSON.stringify(catPayload));
  check('catalog components are not empty', catPayload.components.length > 0);
  const catButton = catPayload.components.find((c) => c.type === 'button');
  check(
    'catalog button component is present with sub_type catalog',
    catButton?.sub_type === 'catalog' && catButton?.index === '0',
    JSON.stringify(catButton),
  );
  check(
    'no thumbnail configured means no action parameter (Meta uses the first item)',
    catButton?.parameters === undefined,
    JSON.stringify(catButton),
  );

  const catSku = await build(catalogTemplate({ _thumbnailProductRetailerId: '2lc20305pt' }));
  check(
    'a configured thumbnail product id reaches the action parameter',
    catSku.components.find((c) => c.type === 'button')?.parameters?.[0]?.action?.thumbnail_product_retailer_id === '2lc20305pt',
    JSON.stringify(catSku.components),
  );

  const catVars = {
    ...catalogTemplate(),
    components: [
      { type: 'BODY', text: 'Hi {{1}}, your picks are ready.' },
      { type: 'BUTTONS', buttons: [{ type: 'CATALOG', text: 'View catalog' }] },
    ],
  };
  const catVarPayload = await build(catVars);
  check(
    'a catalog template with body variables sends both body and button components',
    catVarPayload.components.map((c) => c.type).join(',') === 'body,button'
      && catVarPayload.components[0].parameters[0].text === 'Priya',
    JSON.stringify(catVarPayload.components),
  );

  await throws(
    'a catalog button with no label fails validation before Meta',
    () => build(catalogTemplate({ text: '' })),
    /no label/i,
  );

  // ── Standard (regression) ─────────────────────────────────────────────────
  section('Standard — regression');

  const marketing = {
    id: 't1', name: 'spring_sale', language: 'en', category: 'MARKETING',
    components: [
      { type: 'BODY', text: 'Hi {{1}}, {{2}}% off this week.', example: { body_text: [['Priya', '25']] } },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Shop now', url: 'https://shop.example.com/{{1}}', example: ['https://shop.example.com/spring'] }] },
    ],
  };
  const mk = await build(marketing);
  check('standard template is detected as STANDARD', detectTemplateType(marketing.components) === 'STANDARD');
  check(
    'marketing body sends one parameter per {{n}}',
    mk.components[0].type === 'body' && mk.components[0].parameters.length === 2
      && mk.components[0].parameters[0].text === 'Priya' && mk.components[0].parameters[1].text === '25',
    JSON.stringify(mk.components[0]),
  );
  check(
    'marketing link button still carries its dynamic suffix',
    mk.components[1]?.sub_type === 'url' && mk.components[1]?.parameters?.[0]?.text === 'spring',
    JSON.stringify(mk.components[1]),
  );

  const utility = {
    id: 't2', name: 'order_update', language: 'en', category: 'UTILITY',
    components: [{ type: 'BODY', text: 'Your order is on its way.' }],
  };
  const ut = await build(utility);
  check(
    'a utility template with nothing to substitute sends no components',
    ut.components === undefined && ut.name === 'order_update' && ut.language.code === 'en',
    JSON.stringify(ut),
  );

  const quickReply = {
    id: 't3', name: 'reorder', language: 'en', category: 'UTILITY',
    components: [
      { type: 'BODY', text: 'Reorder your usuals?' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Yes please' }, { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '+911234567890' }] },
    ],
  };
  const qrStd = await build(quickReply);
  check(
    'message-bubble quick-reply and phone buttons still send no parameters',
    qrStd.components === undefined,
    JSON.stringify(qrStd),
  );

  check(
    'the assembler never puts credentials in the payload',
    !JSON.stringify([mk, ut, carousel, catPayload]).includes('never-logged'),
  );

  // ── Synchronisation ───────────────────────────────────────────────────────
  section('Synchronisation');

  // What Meta reports back for the same carousel: the approved shape, with no
  // knowledge of the asset ids this product stores alongside it.
  const fromMeta = [
    { type: 'BODY', text: 'Hi {{1}}, this week only' },
    {
      type: 'CAROUSEL',
      cards: [
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h1'] } },
            { type: 'BODY', text: 'Card 1 body for {{1}}' },
            { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View offer', url: 'https://shop.example.com/offer' }] },
          ],
        },
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h2'] } },
            { type: 'BODY', text: 'Card 2 body for {{1}}' },
            { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'View offer', url: 'https://shop.example.com/offer' }] },
          ],
        },
      ],
    },
  ];

  const synced = preserveInternalFields(twoCard.components, fromMeta);
  const syncedCards = synced.find((c) => c.type === 'CAROUSEL').cards;
  check(
    'sync keeps the stored image of every card',
    syncedCards[0].components[0]._assetId === 'asset1' && syncedCards[1].components[0]._assetId === 'asset2',
    JSON.stringify(syncedCards.map((c) => c.components[0])),
  );
  check('sync keeps card order', syncedCards[0].components[1].text.startsWith('Card 1'));
  check(
    'sync keeps card text, buttons and URLs',
    syncedCards[0].components[2].buttons[0].text === 'View offer'
      && syncedCards[0].components[2].buttons[0].url === 'https://shop.example.com/offer',
  );

  // Running it again must change nothing — that is what "idempotent" has to
  // mean here, since sync runs on a schedule.
  const twice = preserveInternalFields(synced, fromMeta);
  check('sync is idempotent', JSON.stringify(twice) === JSON.stringify(synced));

  const stillSendable = await build({ ...twoCard, components: synced });
  check(
    'a synced carousel is still sendable',
    stillSendable.components.find((c) => c.type === 'carousel').cards[0]
      .components[0].parameters[0].image.id === 'media_asset1',
  );

  const syncedCatalog = preserveInternalFields(
    catalogTemplate({ _thumbnailProductRetailerId: '2lc20305pt' }).components,
    [
      { type: 'BODY', text: 'Browse this season’s arrivals.' },
      { type: 'FOOTER', text: 'Reply STOP to unsubscribe' },
      { type: 'BUTTONS', buttons: [{ type: 'CATALOG', text: 'View catalog' }] },
    ],
  );
  check(
    'sync keeps a catalog template’s thumbnail product id',
    syncedCatalog.find((c) => c.type === 'BUTTONS').buttons[0]._thumbnailProductRetailerId === '2lc20305pt',
    JSON.stringify(syncedCatalog),
  );

  check(
    'Meta reporting no components never empties a stored template',
    JSON.stringify(preserveInternalFields(twoCard.components, [])) === JSON.stringify(twoCard.components),
  );

  // An existing catalog template stored before the thumbnail field existed
  // must keep working untouched.
  const legacy = await build(catalogTemplate());
  check('templates stored before this change remain sendable', legacy.components.length === 1);

  // ── Authentication ───────────────────────────────────────────────────────
  //
  // Meta writes the passcode message itself and rejects a template that
  // carries its own. The builder used to submit the marketing shape under this
  // category — authored body, text footer, COPY_CODE coupon button — which
  // passed every local check and came back from Meta as (#100) Invalid
  // parameter. These assertions pin the shape Meta actually accepts, and the
  // rejections that now happen here instead of at review.
  section('Authentication');

  const authComponents = (over = {}) => [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 5 },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
    ...(over.extra || []),
  ];

  const auth = normalizeTemplateComponents('AUTHENTICATION', authComponents());
  check(
    'an authentication template is the exact shape Meta documents',
    JSON.stringify(toMetaComponents(auth)) === JSON.stringify([
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 5 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
    ]),
    JSON.stringify(auth),
  );

  // authentication/authentication.service.js reads exactly these two things
  // back off the stored template before it will send an OTP through it.
  const authButton = auth.find((c) => c.type === 'BUTTONS').buttons[0];
  check(
    'the OTP flow accepts the template the builder produces',
    auth.find((c) => c.type === 'BUTTONS').buttons.length === 1
      && authButton.type === 'OTP' && authButton.otp_type === 'COPY_CODE',
    JSON.stringify(authButton),
  );
  check(
    'the configured expiry is readable as code_expiration_minutes',
    auth.find((c) => c.type === 'FOOTER').code_expiration_minutes === 5,
  );

  // Meta renders no expiry line when the footer is absent, which is valid —
  // so an omitted expiry must not be invented.
  const noExpiry = normalizeTemplateComponents('AUTHENTICATION', [
    { type: 'BODY', add_security_recommendation: false },
    { type: 'BUTTONS', buttons: [{ type: 'OTP' }] },
  ]);
  check(
    'an omitted expiry stays omitted, and the security note can be declined',
    !noExpiry.some((c) => c.type === 'FOOTER')
      && noExpiry[0].add_security_recommendation === false,
    JSON.stringify(noExpiry),
  );
  check(
    'an OTP button with no label gets Meta’s own default',
    noExpiry.find((c) => c.type === 'BUTTONS').buttons[0].text === 'Copy code',
  );

  await throws(
    'the old marketing shape under AUTHENTICATION is rejected here, not at Meta',
    () => normalizeTemplateComponents('AUTHENTICATION', [
      { type: 'BODY', text: '{{1}} is your verification code', example: { body_text: [['123456']] } },
      { type: 'FOOTER', text: 'Expires in 5 minutes. Do not share this code.' },
      { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'Copy code', example: '1234' }] },
    ]),
    /cannot carry body text/i,
  );
  await throws(
    'an authentication template without an OTP button is rejected',
    () => normalizeTemplateComponents('AUTHENTICATION', [{ type: 'BODY' }]),
    /needs exactly one OTP button/i,
  );
  await throws(
    'nothing may sit beside the OTP button',
    () => normalizeTemplateComponents('AUTHENTICATION', [
      { type: 'BODY' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP' }, { type: 'QUICK_REPLY', text: 'Help' }] },
    ]),
    /OTP button and nothing else/i,
  );
  await throws(
    'an authentication template may not carry a header',
    () => normalizeTemplateComponents('AUTHENTICATION', [
      { type: 'HEADER', format: 'TEXT', text: 'Verify' }, { type: 'BODY' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP' }] },
    ]),
    /cannot carry a header/i,
  );
  await throws(
    'an expiry outside Meta’s 1-90 minutes is rejected',
    () => normalizeTemplateComponents('AUTHENTICATION', [
      { type: 'BODY' }, { type: 'FOOTER', code_expiration_minutes: 200 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP' }] },
    ]),
    /between 1 and 90/i,
  );
  await throws(
    'one-tap autofill is refused — it needs an app hash we cannot supply',
    () => normalizeTemplateComponents('AUTHENTICATION', [
      { type: 'BODY' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'ONE_TAP', text: 'Autofill' }] },
    ]),
    /only COPY_CODE/i,
  );
  await throws(
    'an OTP button cannot be smuggled onto a marketing template',
    () => normalizeTemplateComponents('MARKETING', [
      { type: 'BODY', text: 'Sale!' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP' }] },
    ]),
    /only available on authentication templates/i,
  );

  // The coupon button keeps its own, entirely separate meaning.
  const coupon = normalizeTemplateComponents('MARKETING', [
    { type: 'BODY', text: '20% off' },
    { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', text: 'Copy code', example: 'SAVE20' }] },
  ]);
  check(
    'the marketing coupon button is untouched by the OTP button’s arrival',
    JSON.stringify(coupon.find((c) => c.type === 'BUTTONS').buttons[0])
      === JSON.stringify({ type: 'COPY_CODE', text: 'Copy code', example: ['SAVE20'] }),
    JSON.stringify(coupon),
  );
} catch (err) {
  check('suite ran to completion', false, err.stack || err.message);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
