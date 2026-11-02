/**
 * rabbitmq-lib entry point.
 *
 * Exposes the four classes of the library:
 * - {@link MQ} — connection and channel lifecycle.
 * - {@link Queue} — durable work queues with optional delay and manual ack.
 * - {@link RPC} — request/response over a queue.
 * - {@link Topic} — topic exchange publish/subscribe.
 *
 * @module rabbitmq-lib
 */
exports.MQ = require('./lib/MQ')
exports.Queue = require('./lib/Queue')
exports.RPC = require('./lib/RPC')
exports.Topic = require('./lib/Topic')
