# RabbitMQ Abstraction Library
RabbitMQ Lib abstract 3 common uses of RMQ in a very simple API you can use to send messages and consume them. 

Currently it supports Queues, Topics (publish/subscribe) and RPC.

This version also supports delayed message queues using the rabbitmq-delayed-message-exchange plugin.

On Version 2 we made a major rewrite of the module to better handle connections and channels and reuse them as much as possible.

I also split all the functionality in multiple classes you can use without having to load the whole library.

The library uses Node v8.x.x and it is not backwards compatible althought I tried to change as little as possible.

# Usage

Usage is better described on the tests folder. Take a look at each case but keep in mind that RabbitMQ will trigger an event using the instance passed in the constructor, you have to listen to events on that same instance.

Notes about RPC
When defining a listener, you always need to call next() as the second argument of the callback to be executed

# Manual acknowledgement

By default, `listen()` acknowledges a message as soon as it is delivered, so a handler cannot hold a message and tasks run concurrently as they arrive.

`listenManual(queueNames, handler, options)` consumes with manual acknowledgement instead: the `handler` is awaited and the message is acknowledged only after it resolves — the broker holds the next delivery until then, so one task is in flight at a time and a crashed container gets the task redelivered.

`options`:
- `prefetch` (default 1) and `globalPrefetch` (default true): how many unacknowledged messages this consumer may have. With `globalPrefetch: true` the limit is shared across all queues passed in the call.
- `onFailure`: `'ack'` (default) drops a message whose handler throws; `'requeue'` retries it once (via the redelivered flag) before dropping.
- `queueArguments`: extra arguments for `assertQueue` (e.g. `{ 'x-max-priority': 10 }`).

`send(queueName, message, delay, sendOptions)` also accepts `sendOptions.priority` (requires the queue to be declared with `x-max-priority`). Usage examples are in `tests/tests/queues.js` under `Queue listenManual`.

Notes about upgrading:

1. The library is much simpler and modular
2. Use Node v8 or greater
3. All librarys use listen() and send() 