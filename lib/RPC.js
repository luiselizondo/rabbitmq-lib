const uuid = require('uuid')
const EventEmitter = require('events')

const REPLY_QUEUE = 'amq.rabbitmq.reply-to'

/**
 * Converts a replied error into a shape that survives `JSON.stringify`.
 *
 * Plain `Error` instances lose `name`, `message` and `stack` on the wire
 * because those are non-enumerable own properties. Strings pass through
 * unchanged; objects keep their own enumerable properties and always gain
 * `name` and `message`; anything else becomes its `String()` form.
 *
 * @param {*} err - The error passed to `next()`.
 * @returns {string|object} The wire-safe error value.
 *
 * Own enumerable properties are forwarded verbatim — attach only what you
 * intend to send across the wire. `stack` is always excluded from the wire
 * payload — top-level only, even when attached as an own enumerable property.
 * `toJSON` is also excluded so a hook cannot reshape the serialized error.
 */
const serializeWireError = (err) => {
  if (typeof err === 'string') {
    return err
  }

  if (err && typeof err === 'object') {
    const wireError = {
      ...err,
      name: err.name || err.constructor?.name || 'Error',
      message: err.message,
    }

    delete wireError.stack
    delete wireError.toJSON

    return wireError
  }

  return String(err)
}

/**
 * Request/response (RPC over RabbitMQ) helper.
 *
 * A server instance is given a channel via `setChannel()` and calls
 * `listen(queueName, callback)`; the callback receives the parsed request and a
 * `next(err, result)` function used to answer it. A client instance is given a
 * connection via `setConnection()` and calls `send(eventName, message)`, which
 * publishes to the named queue and resolves with the raw reply `Buffer`.
 *
 * Timeouts are a normal outcome, not an error: when no reply arrives within
 * `options.expiration` milliseconds the promise still resolves (with
 * `undefined`). Only missing configuration and broker failures reject.
 *
 * @class RPC
 * @extends EventEmitter
 */
class RPC extends EventEmitter {
  /**
   * Creates an RPC instance.
   *
   * @param {object} [_options] - Options.
   * @param {string|number} [_options.expiration='5000'] - Reply timeout in milliseconds.
   * @param {boolean} [_options.persistent=false] - Whether requests are published as persistent.
   */
  constructor (_options) {
    super()
    this.options = Object.assign(
      {
        expiration: '5000',
        persistent: false,
      },
      _options,
    )
  }

  /**
   * The amqplib channel used by this instance.
   *
   * @returns {object|undefined} The channel, or `undefined` when unset.
   */
  get channel () {
    return this._channel
  }

  /**
   * Replaces the stored channel without creating a new one.
   *
   * @param {object} channel - An amqplib channel.
   */
  set channel (channel) {
    this._channel = channel
  }

  /**
   * Replaces the stored channel without creating a new one.
   *
   * @param {object} channel - An amqplib channel.
   * @returns {void}
   */
  setChannel (channel) {
    this._channel = channel
  }

  /**
   * The amqplib connection used by this instance.
   *
   * @returns {object|undefined} The connection, or `undefined` when unset.
   */
  get connection () {
    return this._connection
  }

  /**
   * Replaces the stored connection without creating a new one.
   *
   * @param {object} connection - An amqplib connection.
   */
  set connection (connection) {
    this._connection = connection
  }

  /**
   * Replaces the stored connection without creating a new one.
   *
   * @param {object} connection - An amqplib connection.
   * @returns {void}
   */
  setConnection (connection) {
    this._connection = connection
  }

  /**
   * Declares and consumes `request` (used as the queue name) with `prefetch(1)`
   * and answers each message through the callback.
   *
   * The callback signature is `(data, next)` where `data` is the parsed request
   * payload and `next(err, result)` sends the reply:
   * - `next(err)` replies `{ type: 'error', error: err }`;
   * - `next(false, null)` / `next()` replies `{ type: 'error', error: 'No data found' }`;
   * - `next(false, result)` replies `{ type: 'success', results: result }`.
   *
   * Parse failures and callback failures are contained: the error is logged,
   * `failed` is emitted and the message is acknowledged, so one bad request can
   * never tear down the consumer.
   *
   * @param {string} request - Queue name to serve.
   * @param {function(object, function(*, *): Promise<*>): *} callback - Request handler.
   * @returns {Promise<object>} The consumer tag returned by `channel.consume`.
   * @throws {Error} When no channel has been set via `setChannel()`.
   * @emits RPC#failed - `{ eventName, error }` when a request cannot be parsed or handled.
   */
  async listen (request, callback) {
    const channel = this.channel
    if (!channel) {
      throw new Error(
        'A channel is needed, call setChannel() on the instance once',
      )
    }

    const queueName = request
    await channel.assertQueue(queueName)
    await channel.prefetch(1)

    return await channel.consume(queueName, async (message) => {
      let data
      try {
        data = JSON.parse(message.content.toString())

        return await callback(data, async function (err, result) {
          const response = {
            type: null,
          }

          if (err) {
            response.type = 'error'
            response.error = serializeWireError(err)
          }

          if (!err && !result) {
            response.type = 'error'
            response.error = 'No data found'
          }

          if (result) {
            response.type = 'success'
            response.results = result
          }

          await channel.sendToQueue(
            message.properties.replyTo,
            Buffer.from(JSON.stringify(response)),
            {
              correlationId: message.properties.correlationId,
            },
          )

          return await channel.ack(message)
        })
      } catch (err) {
        // Contain the failure: a malformed payload or a throwing handler must
        // not reject the consumer callback nor escape as an unhandled rejection.
        this.emit('failed', { eventName: queueName, error: err })
        return await channel.ack(message)
      }
    })
  }

  /**
   * Sends `message` to the `eventName` queue and waits for the reply.
   *
   * A dedicated channel is created per call and consumes the pseudo-queue
   * `amq.rabbitmq.reply-to`; the reply is matched by a fresh correlation id.
   * The promise resolves with the raw reply `Buffer` (callers `JSON.parse` it),
   * or with `undefined` when no reply arrives within `options.expiration` — a
   * timeout is never a rejection. The channel is always closed and the
   * correlation listener and timeout are always removed. A failure while
   * closing that reply channel never supersedes the request outcome: the
   * caller receives the resolved reply or the recorded rejection, never the
   * close error.
   *
   * @param {string} eventName - Queue name to publish the request to.
   * @param {object} message - Request payload, JSON-serialised before sending.
   * @returns {Promise<Buffer|undefined>} The raw reply, or `undefined` on timeout.
   * @throws {Error} When no connection has been set via `setConnection()`.
   */
  async send (eventName, message) {
    if (!this.connection) {
      throw new Error(
        'A connection is needed, call setConnection() on the instance once',
      )
    }

    this.REPLY_QUEUE = REPLY_QUEUE
    const channel = await this.connection.createChannel()

    channel.responseEmitter = new EventEmitter()
    channel.responseEmitter.setMaxListeners(0)

    await channel.consume(
      this.REPLY_QUEUE,
      (msg) => {
        channel.responseEmitter.emit(msg.properties.correlationId, msg.content)
      },
      { noAck: true },
    )

    try {
      const correlationId = uuid.v4()
      const timeoutEvent = `resolve-promise-on-${correlationId}`
      const data = Buffer.from(JSON.stringify(message))

      return await new Promise((resolve, reject) => {
        let timer = null

        const cleanup = () => {
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          channel.responseEmitter.removeListener(correlationId, onReply)
          channel.responseEmitter.removeListener(timeoutEvent, onTimeout)
        }

        const onReply = (content) => {
          cleanup()
          resolve(content)
        }

        const onTimeout = () => {
          cleanup()
          resolve()
        }

        channel.responseEmitter.once(correlationId, onReply)
        channel.responseEmitter.once(timeoutEvent, onTimeout)

        timer = setTimeout(
          () => {
            channel.responseEmitter.emit(timeoutEvent)
          },
          parseInt(this.options.expiration, 10),
        )

        try {
          channel.sendToQueue(eventName, data, {
            correlationId,
            replyTo: this.REPLY_QUEUE,
            persistent: this.options.persistent,
            expiration: this.options.expiration,
          })
        } catch (err) {
          cleanup()
          reject(err)
        }
      })
    } finally {
      try {
        await channel.close()
      } catch {
        // the channel died before the reply could be published; keep the
        // original rejection instead of masking it with the close error
      }
    }
  }
}

module.exports = RPC
