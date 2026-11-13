# rabbitmq-lib

A small abstraction over [amqplib](https://www.npmjs.com/package/amqplib) for the three ways we use RabbitMQ: **work queues**, **topics** (pub/sub) and **RPC**. Each concern is its own class, so you can load only what you need.

- **Version:** 3.0.0
- **Runtime:** Node.js **>= 22** (CommonJS, `require()`)
- **Dependencies:** `amqplib` (^0.10) and `uuid` (^11)

## Install

```sh
npm install rabbitmq-lib
```

## Contents

- [`MQ`](#mq) — connection and channel lifecycle
- [`Queue`](#queue) — durable work queues, delayed messages, manual acknowledgement
- [`Topic`](#topic) — topic exchange publish/subscribe
- [`RPC`](#rpc) — request/response over a queue
- [Upgrading to 3.0](#upgrading-to-30)

Every class extends `EventEmitter`; events are emitted on the instance you created.

`MQ` appends `frameMax=131072` to the connection URL when the URL does not already set it. RabbitMQ 4.x enforces a minimum frame size, and amqplib's default would otherwise drop the connection mid-handshake; older brokers negotiate the frame size down.

---

## MQ

Owns one connection and hands out channels.

```js
const { MQ } = require('rabbitmq-lib')

const mq = new MQ({
  url: 'amqp://user:pass@localhost:5672/',
  connectMaxAttempts: 600, // default
  delayMS: 10000,          // default
})

mq.on('connected', (connection) => console.log('connected'))
mq.on('error', (error) => console.error('connection error', error))
mq.on('disconnected', () => console.log('disconnected'))
mq.on('close', () => console.log('closed'))

async function main () {
  await mq.connect()
  const channel = await mq.createChannel()
  return channel
}
```

### Constructor

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `config.url` | `string` | — | Broker URL, e.g. `amqp://user:pass@host:5672/` |
| `config.connectMaxAttempts` | `number` | `600` | Attempts used by `connect()` |
| `config.delayMS` | `number` | `10000` | Delay between attempts used by `connect()` |

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `connect()` | `Promise<object>` | The amqplib connection. **Rejects** after emitting `error` when the connection cannot be established. |
| `amqpConnect(delayMS = 5000, maxAttempts = 50)` | `Promise<object>` | Lower-level connect loop; emits `connectionAttempt` per attempt and throws the last error. |
| `reconnect()` | `Promise<object\|undefined>` | Connects when there is no live connection; passes any rejection from `connect()` through to the caller. Resolves `undefined` when a connection already exists. |
| `createChannel()` | `Promise<object>` | Creates a channel on the current connection. |
| `disconnect()` | `Promise<void>` | Closes the connection. |
| `setConnection(connection)` | `void` | Replaces the stored connection without opening a new one (also available as the `connection` setter). |
| `connection` (getter) | `object\|null` | The current amqplib connection. |

### Events

| Event | Payload | When |
| --- | --- | --- |
| `connectionAttempt` | `number` (zero-based attempt index) | Before every connection attempt |
| `connected` | amqplib connection | Connection established |
| `error` | `Error` | Connection error or failed `connect()` |
| `disconnected` | — | Underlying connection reported an error |
| `close` | — | Underlying connection closed |
| `blocked` | `object` (reason) | Broker blocked the connection |
| `unblocked` | — | Broker unblocked the connection |
| `reconnected` | amqplib connection | `reconnect()` established a new connection |
| `connectionClosed` | — | `disconnect()` completed |

> `connect()` **rejects** on failure in 3.0.0 (it used to resolve `undefined`). Always handle the rejected promise, and attach an `error` listener so the event does not throw.

---

## Queue

Durable work queues. Consumed payloads are parsed as JSON and re-emitted under their routing key.

```js
const { MQ, Queue } = require('rabbitmq-lib')

const mq = new MQ({ url: 'amqp://localhost:5672/' })
await mq.connect()
const channel = await mq.createChannel()

const queue = new Queue('delayed.exchange') // exchange name is optional
queue.setChannel(channel)

queue.on('my.queue', (data) => console.log('got', data))
queue.on('queueEventReceived', ({ name, data }) => console.log(name, data))
queue.on('failed', ({ queueName, error }) => console.error(queueName, error))

await queue.listen('my.queue')
await queue.send('my.queue', { hello: 'world' })
```

### Constructor

| Param | Type | Description |
| --- | --- | --- |
| `delayedExchangeName` | `string` (optional) | Name of the `x-delayed-message` exchange used when delayed publishing is enabled. Without it, delayed publishing falls back to the default exchange. |

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `listen(queueNames, options = {})` | `Promise<object>` | Declares and consumes one queue or an array of queues with auto-acknowledgement after parsing. Returns the channel. `options.isDelayed` enables delayed publishing. |
| `listenManual(queueNames, handler, options = {})` | `Promise<object>` | Consumes with manual acknowledgement; `handler(data, message)` is awaited before ack. Returns the channel. |
| `send(queueName, message, delay = 0, sendOptions = {})` | `Promise<boolean>` | Publishes `message` as JSON and persistent. `false` means the channel write buffer is full. |
| `setChannel(channel)` | `void` | Replaces the stored channel (also the `channel` setter). |
| `setIsDelayed(isDelayed)` | `void` | Toggles delayed publishing. |
| `bindExchange(queueName)` | `Promise<void>` | Binds the queue to the delayed exchange when delayed publishing is on. |
| `channel` (getter) | `object\|undefined` | The amqplib channel. |

`send()` accepts `sendOptions.priority`; the queue must be declared with `x-max-priority` for it to take effect. A positive `delay` switches the instance to the delayed exchange and adds the `x-delay` header.

`listenManual()` options:

| Option | Default | Description |
| --- | --- | --- |
| `prefetch` | `1` | Channel prefetch count |
| `globalPrefetch` | `true` | Whether the prefetch limit is channel-wide |
| `onFailure` | `'ack'` | `'ack'` drops a message whose handler throws; `'requeue'` retries it once via `nack` (using the `redelivered` flag) before dropping |
| `isDelayed` | `false` | Enables delayed publishing |
| `queueArguments` | `{}` | Extra `assertQueue` arguments, e.g. `{ 'x-max-priority': 10 }` |

`listen()` acknowledges as soon as the message arrives, so handlers run concurrently. `listenManual()` acknowledges only after `handler` resolves, so the broker holds the next delivery and a crashed consumer gets the message redelivered.

### Events

| Event | Payload | When |
| --- | --- | --- |
| `<routingKey>` | parsed payload | Each consumed message (`listen`) |
| `queueEventReceived` | `{ data, type: 'queue', name }` | Each consumed message (`listen`) |
| `sent` | `{ type: 'queue', queueName, message }` | After `send()` publishes |
| `failed` | `{ queueName, error }` | A payload cannot be parsed, a handler throws, or an ack/nack fails (both `listen` and `listenManual`) |
| `missingChannelOnQueue` | — | A method needed a channel but none was set |

---

## Topic

Topic exchange pub/sub. Each `listen()` call declares an exclusive auto-delete queue and binds it to the given event names.

```js
const { MQ, Topic } = require('rabbitmq-lib')

const mq = new MQ({ url: 'amqp://localhost:5672/' })
await mq.connect()
const channel = await mq.createChannel()

const topic = new Topic('my.topic.exchange')
topic.setChannel(channel)

topic.on('user.created', (data) => console.log('user', data))
topic.on('topicEventReceived', ({ name, data }) => console.log(name, data))
topic.on('failed', ({ eventName, error }) => console.error(eventName, error))

await topic.listen(['user.created', 'user.deleted'])
await topic.publish('user.created', { id: 42 })
```

### Constructor

| Param | Type | Description |
| --- | --- | --- |
| `exchangeName` | `string` | Name of the `topic` exchange to declare |

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `listen(eventNames)` | `Promise<object>` | Declares the exchange and an exclusive auto-delete queue, binds every event name and consumes with `noAck: true`. Returns the channel. |
| `publish(eventName, message)` | `Promise<boolean>` | Publishes a **copy** of `message` stamped with a fresh `tid`. `false` means the channel write buffer is full. |
| `setChannel(channel)` | `void` | Replaces the stored channel (also the `channel` setter). |
| `channel` (getter) | `object\|undefined` | The amqplib channel. |

Consumption is fire-and-forget: the queue is consumed with `noAck: true`, so a message is considered delivered as soon as it reaches the socket, and a crashed consumer loses it instead of triggering a redelivery.

`publish()` never mutates the caller's object — only the stamped copy is published and reported in the `sent` event.

### Events

| Event | Payload | When |
| --- | --- | --- |
| `<eventName>` | parsed payload | Each message received under that routing key |
| `topicEventReceived` | `{ data, type: 'topic', name }` | Each message received |
| `sent` | `{ type: 'topic', eventName, message }` | After `publish()`, with the stamped copy |
| `failed` | `{ eventName, error }` | A payload cannot be parsed |

---

## RPC

Request/response over a queue, using the `amq.rabbitmq.reply-to` pseudo-queue. The server needs a channel; the client needs a connection.

```js
const { MQ, RPC } = require('rabbitmq-lib')

const mq = new MQ({ url: 'amqp://localhost:5672/' })
await mq.connect()

// Server
const serverChannel = await mq.createChannel()
const server = new RPC({ expiration: '5000' })
server.setChannel(serverChannel)
server.on('failed', ({ eventName, error }) => console.error(eventName, error))

await server.listen('math.add', async (data, next) => {
  await next(false, data.a + data.b)
})

// Client
const client = new RPC({ expiration: '5000', persistent: false })
client.setConnection(mq.connection)

const raw = await client.send('math.add', { a: 2, b: 3 })
const reply = raw && JSON.parse(raw.toString())
console.log(reply) // { type: 'success', results: 5 }
```

### Constructor

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `expiration` | `string\|number` | `'5000'` | Reply timeout in milliseconds |
| `persistent` | `boolean` | `false` | Whether requests are published as persistent |

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `listen(request, callback)` | `Promise<object>` | Declares and consumes the queue named `request` with `prefetch(1)`. Returns the consumer tag. |
| `send(eventName, message)` | `Promise<Buffer\|undefined>` | Creates a channel per call, publishes the request and resolves with the raw reply `Buffer`, or `undefined` on timeout. |
| `setChannel(channel)` / `setConnection(connection)` | `void` | Set the channel (server) or connection (client). Same as the `channel` / `connection` setters. |
| `channel` (getter) | `object\|undefined` | The amqplib channel. |
| `connection` (getter) | `object\|undefined` | The amqplib connection. |

`listen()` callback signature is `(data, next)`:

- `next(err)` replies `{ type: 'error', error: err }`
- `next(false, null)` or `next()` replies `{ type: 'error', error: 'No data found' }`
- `next(false, result)` replies `{ type: 'success', results: result }`

Parse failures and callback failures are contained: the error is logged, `failed` is emitted and the message is acknowledged, so one bad request cannot tear down the consumer.

### Error serialization

`response.error` is made JSON-safe before the reply is published:

- a string is sent unchanged;
- an `Error` or a plain object is sent as `{ name, message, ...own enumerable properties }`, so `new Error('boom')` arrives as `{ name: 'Error', message: 'boom' }`; the top-level `stack` property is always excluded, even when attached as an own enumerable property — attach only what you intend to send across the wire;
- anything else is sent as its `String()` form.

Consumers should still throw or pass typed errors with contract-compliant `name` values; the service-api error mapping table selects the response from that `name`.

**Timeouts are a normal outcome, not an error.** When no reply arrives within `expiration` milliseconds, `send()` resolves with `undefined`; it does not reject. Only missing configuration and broker failures reject.

### Events

| Event | Payload | When |
| --- | --- | --- |
| `failed` | `{ eventName, error }` | A request cannot be parsed or the handler throws |

---

## Upgrading to 3.0

- **Node.js >= 22 required** (was Node 8). The package is CommonJS.
- **`MQ.connect()` rejects** after emitting `error` instead of resolving `undefined`. `MQ.reconnect()` propagates that rejection, so handle it.
- **New `failed` events.** `Queue.listen()` and `Queue.listenManual()` emit `{ queueName, error }`; `Topic.listen()` and `RPC.listen()` emit `{ eventName, error }`. Consumer failures no longer escape as unhandled rejections.
- **`Topic.publish()` no longer mutates the caller's message.** It publishes a stamped copy (with `tid`) and that copy is what the `sent` event reports.
- **`RPC.send()` still resolves on expiration timeout** (with `undefined`) — it never rejects for a timeout.
- **RabbitMQ 4.x:** `frameMax=131072` is appended to the URL when absent, which is what keeps amqplib's handshake from being dropped.

## License

MIT © Luis Elizondo
