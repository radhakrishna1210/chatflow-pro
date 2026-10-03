import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRealtimeBus, REALTIME_CHANNEL, publishRealtime, subscribeRealtime, realtime } from './realtimeBus.js';

// A stand-in for Redis pub/sub: every connection created from one broker hears
// what any of them publishes, which is the property that carries an event from
// a worker process to a web process.
function fakeBroker() {
  const subscribers = new Set();
  const published = [];
  return {
    published,
    publisher(status = 'ready') {
      return {
        status,
        async publish(channel, message) {
          published.push({ channel, message });
          for (const s of subscribers) if (s.channels.has(channel)) setImmediate(() => s.emit('message', channel, message));
          return subscribers.size;
        },
      };
    },
    subscriber() {
      const s = new EventEmitter();
      s.channels = new Set();
      s.subscribe = async (channel) => { s.channels.add(channel); subscribers.add(s); setImmediate(() => s.emit('ready')); };
      s.quit = async () => { subscribers.delete(s); };
      return s;
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('without Redis, events reach the listeners in this process', () => {
  const bus = createRealtimeBus();
  const seen = [];
  bus.subscribe((e) => seen.push(e));
  const sent = bus.publish('wsA', 'message.created', { conversationId: 'c1' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].ws, 'wsA');
  assert.equal(seen[0].type, 'message.created');
  assert.deepEqual(seen[0].data, { conversationId: 'c1' });
  assert.equal(seen[0].id, sent.id);
  assert.ok(typeof sent.id === 'string' && sent.id.length > 0);
});

test('an event published in one process reaches a listener in another through Redis', async () => {
  const broker = fakeBroker();
  // The worker process: publishes, never subscribes.
  const worker = createRealtimeBus({ publisher: broker.publisher(), createSubscriber: () => broker.subscriber() });
  // The web process: holds the browser streams.
  const web = createRealtimeBus({ publisher: broker.publisher(), createSubscriber: () => broker.subscriber() });
  const seen = [];
  web.subscribe((e) => seen.push(e));
  await tick(); await tick();
  assert.equal(web.subscriberReady, true);

  worker.publish('wsA', 'campaign.updated', { campaignId: 'k1', status: 'RUNNING' });
  await tick(); await tick();

  assert.equal(broker.published.length, 1);
  assert.equal(broker.published[0].channel, REALTIME_CHANNEL);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'campaign.updated');
  assert.deepEqual(seen[0].data, { campaignId: 'k1', status: 'RUNNING' });
  await Promise.all([worker.close(), web.close()]);
});

test('a process does not hear its own event twice once its subscription is up', async () => {
  const broker = fakeBroker();
  const bus = createRealtimeBus({ publisher: broker.publisher(), createSubscriber: () => broker.subscriber() });
  const seen = [];
  bus.subscribe((e) => seen.push(e));
  await tick(); await tick();
  bus.publish('wsA', 'message.created', { conversationId: 'c1' });
  await tick(); await tick();
  assert.equal(seen.length, 1);
  await bus.close();
});

test('falls back to in-process delivery while Redis is not connected', () => {
  const broker = fakeBroker();
  const bus = createRealtimeBus({ publisher: broker.publisher('reconnecting'), createSubscriber: () => broker.subscriber() });
  const seen = [];
  bus.subscribe((e) => seen.push(e));
  bus.publish('wsA', 'message.status', { messageId: 'm1', status: 'READ' });
  assert.equal(broker.published.length, 0);
  assert.equal(seen.length, 1);
});

test('a failed PUBLISH is delivered locally instead of being lost', async () => {
  const errors = [];
  const subscriber = new EventEmitter();
  subscriber.subscribe = async () => { setImmediate(() => subscriber.emit('ready')); };
  const bus = createRealtimeBus({
    publisher: { status: 'ready', publish: async () => { throw new Error('READONLY'); } },
    createSubscriber: () => subscriber,
    onError: (e) => errors.push(e.message),
  });
  const seen = [];
  bus.subscribe((e) => seen.push(e));
  await tick(); await tick();
  bus.publish('wsA', 'conversation.updated', { conversationId: 'c1' });
  await tick(); await tick();
  assert.equal(seen.length, 1);
  assert.deepEqual(errors, ['READONLY']);
});

test('publishing never throws, even when a listener does', () => {
  const errors = [];
  const bus = createRealtimeBus({ onError: (e) => errors.push(e.message) });
  const seen = [];
  bus.subscribe(() => { throw new Error('listener broke'); });
  bus.subscribe((e) => seen.push(e));
  assert.doesNotThrow(() => bus.publish('wsA', 'message.created', {}));
  assert.equal(seen.length, 1);
  assert.deepEqual(errors, ['listener broke']);
  assert.equal(bus.publish(null, 'message.created'), null);
  assert.equal(bus.publish('wsA', ''), null);
});

test('a burst on one key is sent once at once and once more, with the latest data, at the end of the window', async () => {
  const bus = createRealtimeBus({ coalesceMs: 30 });
  const seen = [];
  bus.subscribe((e) => seen.push(e));
  for (let i = 1; i <= 5; i += 1) bus.publish('wsA', 'campaign.updated', { campaignId: 'k1', sent: i }, { coalesce: 'k1' });
  // Another campaign is its own window.
  bus.publish('wsA', 'campaign.updated', { campaignId: 'k2', sent: 1 }, { coalesce: 'k2' });
  assert.deepEqual(seen.map((e) => e.data), [{ campaignId: 'k1', sent: 1 }, { campaignId: 'k2', sent: 1 }]);
  await wait(60);
  assert.deepEqual(seen.map((e) => e.data), [
    { campaignId: 'k1', sent: 1 },
    { campaignId: 'k2', sent: 1 },
    { campaignId: 'k1', sent: 5 },
  ]);
  await bus.close();
});

test('a reconnected subscription tells local listeners to resync; foreign or malformed messages are dropped', async () => {
  const subscriber = new EventEmitter();
  subscriber.subscribe = async () => {};
  const bus = createRealtimeBus({ publisher: { status: 'ready', publish: async () => 1 }, createSubscriber: () => subscriber });
  const seen = [];
  bus.subscribe((e) => seen.push(e));

  subscriber.emit('ready'); // first connect: nothing missed yet
  assert.equal(seen.length, 0);
  subscriber.emit('message', REALTIME_CHANNEL, 'not json');
  subscriber.emit('message', REALTIME_CHANNEL, JSON.stringify({ ws: '*', type: 'resync' }));
  subscriber.emit('message', 'some-other-channel', JSON.stringify({ ws: 'wsA', type: 'message.created' }));
  assert.equal(seen.length, 0);

  subscriber.emit('close');
  assert.equal(bus.subscriberReady, false);
  subscriber.emit('ready');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'resync');
  assert.equal(seen[0].ws, '*');
});

test('unsubscribing stops delivery', () => {
  const bus = createRealtimeBus();
  const seen = [];
  const off = bus.subscribe((e) => seen.push(e));
  off();
  bus.publish('wsA', 'message.created', {});
  assert.equal(seen.length, 0);
  assert.equal(bus.listenerCount, 0);
});

test('the process-wide helpers publish typed, id-only events in-process under test', async () => {
  const seen = [];
  const off = subscribeRealtime((e) => seen.push(e));
  realtime.messageCreated('wsA', 'c1', { messageId: 'm1', direction: 'INBOUND' });
  realtime.messageStatus('wsA', 'c1', { messageId: 'm1', status: 'DELIVERED' });
  realtime.conversationUpdated('wsA', 'c1', 'assigned');
  realtime.templateUpdated('wsA', 't1', { status: 'APPROVED' });
  publishRealtime('wsB', 'campaign.updated', { campaignId: 'k1' });
  off();
  assert.deepEqual(seen.map((e) => [e.ws, e.type]), [
    ['wsA', 'message.created'],
    ['wsA', 'message.status'],
    ['wsA', 'conversation.updated'],
    ['wsA', 'template.updated'],
    ['wsB', 'campaign.updated'],
  ]);
  assert.deepEqual(seen[0].data, { conversationId: 'c1', messageId: 'm1', direction: 'INBOUND' });
  assert.deepEqual(seen[1].data, { conversationId: 'c1', messageId: 'm1', status: 'DELIVERED' });
});
