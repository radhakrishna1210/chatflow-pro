import { PrismaClient } from '@prisma/client';
import { evaluateLeadCategory } from '../services/leadSegmentation.service.js';

const prisma = new PrismaClient();

const TEST_CASES = [
  // 1. HOT Candidates
  {
    id: 'TEST-HOT-001',
    name: '[TEST] Rahul Sharma',
    phone: '+919876543210',
    score: 85,
    source: 'Website',
    status: 'NEW',
    formAnswers: { interest: 'Schedule live demo', company_size: '50-200' },
    inboundMessageCount: 3,
    daysSinceLastInbound: 1,
    expectedCategory: 'HOT',
    note: 'Strong score + high intent form + recent customer reply',
  },
  {
    id: 'TEST-HOT-002',
    name: '[TEST] Priya Patel',
    phone: '+919876543211',
    score: 75,
    source: 'Google Ads',
    status: 'CONTACTED',
    formAnswers: { budget: 'Enterprise plan', timeline: 'Immediate purchase' },
    inboundMessageCount: 2,
    daysSinceLastInbound: 2,
    expectedCategory: 'HOT',
    note: 'High score + enterprise pricing intent + customer reply',
  },
  {
    id: 'TEST-HOT-003',
    name: '[TEST] Vikram Malhotra',
    phone: '+919876543212',
    score: 65,
    source: 'Website Form',
    status: 'QUALIFIED',
    formAnswers: { inquiry: 'Urgent custom pricing quote' },
    inboundMessageCount: 4,
    daysSinceLastInbound: 0,
    expectedCategory: 'HOT',
    note: 'Score >= 60 + urgent quote form answer',
  },
  {
    id: 'TEST-HOT-004',
    name: '[TEST] Ananya Gupta',
    phone: '+919876543213',
    score: 45,
    source: 'Demo Form',
    status: 'NEW',
    formAnswers: { request: 'Requesting urgent sales call' },
    inboundMessageCount: 1,
    daysSinceLastInbound: 3,
    expectedCategory: 'HOT',
    note: 'Medium score + high intent form answer + customer reply',
  },
  {
    id: 'TEST-HOT-005',
    name: '[TEST] Suresh Nair',
    phone: '+919876543214',
    score: 70,
    source: 'Inbound Call',
    status: 'CONTACTED',
    formAnswers: null,
    inboundMessageCount: 5,
    daysSinceLastInbound: 1,
    expectedCategory: 'HOT',
    note: 'High score (>= 60) + active engagement',
  },

  // 2. WARM Candidates
  {
    id: 'TEST-WARM-001',
    name: '[TEST] Amit Verma',
    phone: '+919876543215',
    score: 45,
    source: 'Website',
    status: 'CONTACTED',
    formAnswers: { query: 'General product info' },
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'WARM',
    note: 'Medium score + website source',
  },
  {
    id: 'TEST-WARM-002',
    name: '[TEST] Sneha Reddy',
    phone: '+919876543216',
    score: 35,
    source: 'Blog',
    status: 'NEW',
    formAnswers: { topic: 'Interested in features' },
    inboundMessageCount: 1,
    daysSinceLastInbound: 12,
    expectedCategory: 'WARM',
    note: 'Medium score + customer reply',
  },
  {
    id: 'TEST-WARM-003',
    name: '[TEST] Deepak Kumar',
    phone: '+919876543217',
    score: 30,
    source: 'Google Ads',
    status: 'NEW',
    formAnswers: null,
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'WARM',
    note: 'Score >= 25 + high intent channel',
  },
  {
    id: 'TEST-WARM-004',
    name: '[TEST] Neha Joshi',
    phone: '+919876543218',
    score: 28,
    source: 'Event Form',
    status: 'NEW',
    formAnswers: { event: 'Webinar attendee' },
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'WARM',
    note: 'Moderate intent form submission + score 28',
  },
  {
    id: 'TEST-WARM-005',
    name: '[TEST] Rajesh Singhania',
    phone: '+919876543219',
    score: 55,
    source: 'Partner Referral',
    status: 'CONTACTED',
    formAnswers: null,
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'WARM',
    note: 'Medium score (55) without high intent form',
  },

  // 3. COLD Candidates
  {
    id: 'TEST-COLD-001',
    name: '[TEST] Kavita Shah',
    phone: '+919876543220',
    score: 10,
    source: 'Cold Import',
    status: 'NEW',
    formAnswers: { note: 'Just browsing' },
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'COLD',
    note: 'Low score + low intent answer + no engagement',
  },
  {
    id: 'TEST-COLD-002',
    name: '[TEST] Manoj Tiwari',
    phone: '+919876543221',
    score: 15,
    source: 'Directory',
    status: 'UNQUALIFIED',
    formAnswers: null,
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'COLD',
    note: 'Low score + unqualified status + no replies',
  },
  {
    id: 'TEST-COLD-003',
    name: '[TEST] Pooja Agarwal',
    phone: '+919876543222',
    score: 5,
    source: 'Unknown',
    status: 'NEW',
    formAnswers: null,
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'COLD',
    note: 'Minimal score + no engagement',
  },
  {
    id: 'TEST-COLD-004',
    name: '[TEST] Tarun Saxena',
    phone: '+919876543223',
    score: 20,
    source: 'Event List',
    status: 'NEW',
    formAnswers: null,
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'COLD',
    note: 'Low score + event list import',
  },
  {
    id: 'TEST-COLD-005',
    name: '[TEST] Meera Das',
    phone: '+919876543224',
    score: 12,
    source: 'Social Media',
    status: 'NEW',
    formAnswers: { comment: 'General info' },
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'COLD',
    note: 'Low score + general info form answer',
  },

  // 4. Conflicting & Single-Factor Controlled Cases
  {
    id: 'TEST-PAIR-001A',
    name: '[TEST] SingleFactor Lead A (Replied)',
    phone: '+919876543225',
    score: 30,
    source: 'Website',
    status: 'NEW',
    formAnswers: { query: 'Product details' },
    inboundMessageCount: 2,
    daysSinceLastInbound: 2,
    expectedCategory: 'WARM',
    note: 'Pair A: Same score/form/source + positive customer reply',
  },
  {
    id: 'TEST-PAIR-001B',
    name: '[TEST] SingleFactor Lead B (No Reply)',
    phone: '+919876543226',
    score: 30,
    source: 'Website',
    status: 'NEW',
    formAnswers: { query: 'Product details' },
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'WARM',
    note: 'Pair B: Same score/form/source + NO customer reply',
  },
  {
    id: 'TEST-CONFLICT-001',
    name: '[TEST] Conflicting Lead (High Score + Low Intent)',
    phone: '+919876543227',
    score: 75,
    source: 'Website',
    status: 'CONTACTED',
    formAnswers: { note: 'Just browsing' },
    inboundMessageCount: 0,
    daysSinceLastInbound: null,
    expectedCategory: 'HOT',
    note: 'High score (75 >= 60) overrides low intent answer',
  },
];

export async function runSegmentationTestReport() {
  console.log('\n==================================================');
  console.log('CRM LEAD SEGMENTATION TEST SUITE & EVALUATION REPORT');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;
  const reportTable = [];

  for (const tc of TEST_CASES) {
    const submissions = tc.formAnswers ? [{ answers: tc.formAnswers }] : [];
    const evalResult = evaluateLeadCategory({
      score: tc.score,
      source: tc.source,
      submissions,
      inboundMessageCount: tc.inboundMessageCount,
      daysSinceLastInbound: tc.daysSinceLastInbound,
      hasOpenConversation: false,
      optedOut: false,
    });

    const isMatch = evalResult.category === tc.expectedCategory;
    if (isMatch) passed++;
    else failed++;

    reportTable.push({
      ID: tc.id,
      Score: tc.score,
      FormIntent: tc.formAnswers ? JSON.stringify(tc.formAnswers).slice(0, 25) : 'None',
      Replies: tc.inboundMessageCount,
      Source: tc.source,
      Expected: tc.expectedCategory,
      Actual: evalResult.category,
      Result: isMatch ? 'PASS ✅' : 'FAIL ❌',
      Reason: evalResult.reasons.join(' | '),
    });
  }

  console.table(reportTable.map((r) => ({
    ID: r.ID,
    Score: r.Score,
    Expected: r.Expected,
    Actual: r.Actual,
    Result: r.Result,
    Reason: r.Reason.slice(0, 60) + '...',
  })));

  console.log(`\nTEST SUMMARY: Total=${TEST_CASES.length} | PASSED=${passed} | FAILED=${failed}\n`);
  return { passed, failed, total: TEST_CASES.length, reportTable };
}

if (process.argv[1].endsWith('seedLeadSegmentationTestData.js')) {
  runSegmentationTestReport()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error('Test execution error:', err);
      prisma.$disconnect();
    });
}
