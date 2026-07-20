const API_URL = 'http://localhost:4000/api/v1/public';
// Replace this with a real API key generated from the dashboard during testing
const API_KEY = process.env.API_KEY || 'cfp_your_api_key_here';

async function testEndpoint(name, url, options = {}) {
  console.log(`\n--- Testing ${name} ---`);
  try {
    const response = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    const status = response.status;
    let data;
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }
    
    console.log(`Status: ${status}`);
    if (status >= 400 && status !== 401) { // 401 is expected in the invalid key test
      console.error(`Error Payload:`, data);
    } else {
      console.log(`Payload preview:`, JSON.stringify(data).slice(0, 200));
    }
    return { status, data };
  } catch (error) {
    console.error(`Request Failed:`, error.message);
    return { status: 500, error: error.message };
  }
}

async function runTests() {
  console.log('Starting ChatFlowPro Public API Integration Tests...\n');

  // 1. Test missing API key
  await testEndpoint('Missing API Key', '/templates', {
    headers: {}
  });

  // 2. Test invalid API key
  await testEndpoint('Invalid API Key', '/templates', {
    headers: { 'x-api-key': 'cfp_invalid_key_12345' }
  });

  // The rest require a valid API key
  if (API_KEY === 'cfp_your_api_key_here') {
    console.log('\n[WARNING] Please set the API_KEY environment variable to a valid key to run the authenticated tests.');
    console.log('Example: API_KEY=cfp_xxx npm start');
    return;
  }

  const defaultHeaders = { 'x-api-key': API_KEY };

  // 3. Test Templates
  const templates = await testEndpoint('List Templates', '/templates', { headers: defaultHeaders });

  // 4. Test Contacts
  const contacts = await testEndpoint('List Contacts', '/contacts', { headers: defaultHeaders });

  // 5. Test Campaigns
  const campaigns = await testEndpoint('List Campaigns', '/campaigns', { headers: defaultHeaders });

  // 6. Test updating Webhook URL
  await testEndpoint('Update Webhook URL', '/webhooks', {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ webhookUrl: 'https://webhook.site/my-test-webhook' })
  });

  // 7. Test sending a message (Note: requires a verified Meta template and valid recipient)
  // We don't want to actually spam a real number, so we will just test the endpoint structure
  // and expect a 400 or a specific Meta API error if the template/number isn't set up.
  await testEndpoint('Send Template Message', '/messages', {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({
      to: '1234567890',
      type: 'template',
      template: {
        name: 'hello_world',
        language: { code: 'en_US' }
      }
    })
  });

  console.log('\nTests completed.');
}

runTests();
