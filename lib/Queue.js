const EventEmitter = require('events')

/**
 * Work-queue helper over an amqplib channel: declares durable queues, binds
 * them to the delayed exchange when enabled, consumes JSON payloads and
 * publishes messages with optional delay and priority.
 *
 * @class Queue
 * @extends EventEmitter
 */
class Queue extends EventEmitter {
  /**
   * Creates a Queue instance. Nothing is declared or consumed until
   * `listen()`, `listenManual()` or `send()` is called with a channel.
   *
   * @param {string} [delayedExchangeName] - Name of the `x-delayed-message`
   *   exchange used when `isDelayed` is true. When absent, delayed publishing
   *   silently falls back to the default exchange.
   */
  constructor (delayedExchangeName) {
    super()

    this.queueOptions = {
      durable: true,
    }

    this.DELAYED_EXCHANGE_NAME = delayedExchangeName
    this.isDelayed = false
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
   * Toggles delayed publishing for this instance.
   *
   * @param {boolean} isDelayed - Whether messages should go through the delayed exchange.
   * @returns {void}
   */
  setIsDelayed (isDelayed) {
    this.isDelayed = isDelayed
  }

  /**
   * Binds a queue to the delayed exchange when delayed publishing is enabled.
   * Does nothing otherwise.
   *
   * @param {string} queueName - The queue to bind, used as the routing key too.
   * @returns {Promise<void>} Resolves when the binding is done (or skipped).
   * @throws {Error} When asserting the exchange or binding the queue fails.
   */
  async bindExchange (queueName) {
    if (this.isDelayed && this.DELAYED_EXCHANGE_NAME) {
      await this.channel.assertExchange(this.DELAYED_EXCHANGE_NAME, 'x-delayed-message', {
        arguments: { 'x-delayed-type': 'direct' },
      })
      await this.channel.bindQueue(queueName, this.DELAYED_EXCHANGE_NAME, queueName)
    }
    return
  }

  /**
   * Declares the given queues and consumes them, emitting each parsed message
   * both on the routing key and as `queueEventReceived`.
   *
   * Failures are contained per message: a payload that cannot be parsed is
   * emitted as `failed` and acknowledged instead of rejecting out of the
   * consumer callback. amqplib does not await consumer callbacks, so an
   * escaping rejection would terminate the container.
   *
   * @param {string|string[]} queueNames - A queue name or a non-empty list of them.
   * @param {object} [options={}] - Consume options.
   * @param {boolean} [options.isDelayed=false] - Enables delayed publishing.
   * @returns {Promise<object>} The channel the consumers were created on.
   * @throws {Error} When no channel is set, or a queue cannot be asserted or consumed.
   * @emits Queue#missingChannelOnQueue
   * @emits Queue#failed - when a payload cannot be parsed or a listener throws.
   * @emits Queue#queueEventReceived
   */
  async listen (queueNames, options = {}) {
    let _queueNames = []
    if (Array.isArray(queueNames) && queueNames.length > 0) {
      _queueNames = queueNames
    }
    else {
      _queueNames.push(queueNames)
    }

    const consumeOptions = {
      noAck: false,
    }

    if (!this.channel) {
      this.emit('missingChannelOnQueue')
      throw new Error('A channel is needed, call setChannel() on the instance once')
    }

    const channel = this.channel

    if (options.isDelayed) this.setIsDelayed(true)

    for (const queueName of _queueNames) {
      await channel.assertQueue(queueName, this.queueOptions)
      await this.bindExchange(queueName)
      await channel.prefetch(1)

      await channel.consume(queueName, async (message) => {
        let data
        try {
          data = JSON.parse(message.content.toString())
        }
        catch (err) {
          // same containment as listenManual: the payload is consumed once
          // (auto-ack semantics), so there is no redelivery loop; an ack
          // failure is reported through the same event instead of escaping
          this.emit('failed', { queueName, error: err })
          try {
            channel.ack(message)
          }
          catch (ackErr) {
            this.emit('failed', { queueName, error: ackErr })
          }
          return
        }

        try {
          this.emit(message.fields.routingKey, data)

          this.emit('queueEventReceived', {
            data: data,
            type: 'queue',
            name: message.fields.routingKey,
          })

          channel.ack(message)
        }
        catch (err) {
          // A throwing listener (service dispatcher, validation, any
          // consumer-side bug) must not escape the consumer callback:
          // amqplib does not await it, so an escaping throw is a
          // process-fatal uncaught exception. The message is consumed once
          // (auto-ack semantics: no redelivery loop) and the failure is
          // surfaced through `failed`.
          this.emit('failed', { queueName, error: err })
          try {
            channel.ack(message)
          }
          catch (ackErr) {
            this.emit('failed', { queueName, error: ackErr })
          }
        }
      }, consumeOptions)
    }

    return channel
  }

  /**
   * Declares the given queues and consumes them through a caller-supplied
   * handler, controlling acknowledgement and failure policy.
   *
   * @param {string|string[]} queueNames - A queue name or a list of them.
   * @param {Function} handler - `async (data, message)` invoked with the parsed payload.
   * @param {object} [options={}] - Consume options.
   * @param {number} [options.prefetch=1] - Channel prefetch count.
   * @param {boolean} [options.globalPrefetch=true] - Whether the prefetch is channel-wide.
   * @param {'ack'|'requeue'} [options.onFailure='ack'] - What to do when the handler throws.
   * @param {boolean} [options.isDelayed=false] - Enables delayed publishing.
   * @param {object} [options.queueArguments={}] - Extra queue arguments (e.g. `x-max-priority`).
   * @returns {Promise<object>} The channel the consumers were created on.
   * @throws {Error} When no channel is set, or a queue cannot be asserted or consumed.
   * @emits Queue#missingChannelOnQueue
   * @emits Queue#failed
   */
  async listenManual (queueNames, handler, options = {}) {
    const {
      prefetch = 1,
      globalPrefetch = true,
      onFailure = 'ack',
      isDelayed = false,
      queueArguments = {},
    } = options

    const _queueNames = Array.isArray(queueNames) && queueNames.length > 0 ? queueNames : [queueNames]

    if (!this.channel) {
      this.emit('missingChannelOnQueue')
      throw new Error('A channel is needed, call setChannel() on the instance once')
    }

    const channel = this.channel
    if (isDelayed) this.setIsDelayed(true)

    await channel.prefetch(prefetch, globalPrefetch)

    for (const queueName of _queueNames) {
      await channel.assertQueue(queueName, { durable: true, arguments: queueArguments })
      await this.bindExchange(queueName)

      await channel.consume(queueName, async (message) => {
        if (!message) return

        // Acknowledgement failures (e.g. the channel closing while the task
        // runs) are contained separately from task failures: amqplib does not
        // await consumer callbacks, so an escaping rejection here would
        // terminate the container. A message left unacknowledged by a closed
        // channel is redelivered by the broker.
        const settle = async (action) => {
          try {
            await action()
          } catch (err) {
            this.emit('failed', { queueName, error: err })
          }
        }

        let data
        try {
          data = JSON.parse(message.content.toString())
        } catch (err) {
          this.emit('failed', { queueName, error: err })
          await settle(() => channel.ack(message))
          return
        }

        try {
          await handler(data, message)
        } catch (err) {
          this.emit('failed', { queueName, error: err })
          if (onFailure === 'requeue' && !message.fields.redelivered) {
            await settle(() => channel.nack(message, false, true))
            return
          }
          await settle(() => channel.ack(message))
          return
        }

        await settle(() => channel.ack(message))
      }, { noAck: false })
    }

    return channel
  }

  /**
   * Declares the target queue and publishes a message to it, optionally
   * through the delayed exchange.
   *
   * The message is always serialized as JSON and published persistent; a
   * positive `delay` switches the instance to delayed publishing, in which
   * case the publish goes to the delayed exchange with an `x-delay` header.
   *
   * @param {string} queueName - The queue (and routing key) to publish to.
   * @param {*} message - Any JSON-serializable payload.
   * @param {number} [delay=0] - Delay in milliseconds; above zero enables delayed publishing.
   * @param {object} [sendOptions={}] - Publish options; `null` is treated as `{}`.
   * @param {number} [sendOptions.priority] - Message priority, passed through when set.
   * @returns {Promise<boolean>} `false` when the channel's write buffer is full, `true` otherwise.
   * @throws {Error} When no channel is set, or asserting/binding/publishing fails.
   * @emits Queue#sent
   */
  async send (queueName, message, delay = 0, sendOptions = {}) {
    sendOptions = sendOptions || {}

    const messageOptions = {
      persistent: true,
    }

    if (sendOptions.priority) messageOptions.priority = sendOptions.priority

    if (!this.channel) {
      throw new Error('A channel is needed, call setChannel() on the instance once')
    }

    const channel = this.channel
    const data = Buffer.from(JSON.stringify(message))

    if (delay > 0) this.setIsDelayed(true)

    await channel.assertQueue(queueName, this.queueOptions)
    let exchange = ''
    await this.bindExchange(queueName)
    if (this.isDelayed && this.DELAYED_EXCHANGE_NAME) {
      exchange = this.DELAYED_EXCHANGE_NAME
      messageOptions.headers = { 'x-delay': delay }
    }

    const result = await channel.publish(exchange, queueName, data, messageOptions)

    this.emit('sent', {
      type: 'queue',
      queueName: queueName,
      message: message,
    })

    return result
  }
}

/**
 * @event Queue#missingChannelOnQueue
 * Emitted when a method needs a channel but none was set.
 */

/**
 * @event Queue#queueEventReceived
 * @type {object}
 * @property {*} data - The parsed message payload.
 * @property {'queue'} type - Always `queue`.
 * @property {string} name - The message routing key.
 */

/**
 * @event Queue#sent
 * @type {object}
 * @property {'queue'} type - Always `queue`.
 * @property {string} queueName - The queue the message was published to.
 * @property {*} message - The message as passed by the caller.
 */

/**
 * @event Queue#failed
 * @type {object}
 * @property {string} queueName - The queue whose message failed.
 * @property {Error} error - The parse, handler or acknowledgement error.
 */

module.exports = Queue
