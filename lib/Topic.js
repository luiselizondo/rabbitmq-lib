const uuid = require('uuid')
const EventEmitter = require('events')

/**
 * Topic (pub/sub) helper over an amqplib channel: declares a `topic` exchange,
 * binds an exclusive auto-delete queue per event name and publishes JSON
 * payloads stamped with a `tid` correlation id.
 *
 * Consumption is fire-and-forget: the auto-queue is consumed with `noAck: true`,
 * so the broker considers a message delivered as soon as it is written to the
 * socket and a crashed consumer loses it instead of triggering a redelivery.
 *
 * @class Topic
 * @extends EventEmitter
 */
class Topic extends EventEmitter {
  /**
   * Creates a Topic instance. Nothing is declared or consumed until
   * `listen()` is called with a channel.
   *
   * @param {string} exchangeName - Name of the `topic` exchange to declare.
   */
  constructor (exchangeName) {
    super()
    this.EXCHANGE_NAME = exchangeName

    this.queueOptions = {
      durable: true,
    }

    return this
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
   * Declares the topic exchange, creates an exclusive auto-delete queue, binds
   * it to every event name and starts consuming with `noAck: true`.
   *
   * Each received message is JSON-parsed and re-emitted twice: once under its
   * routing key (i.e. the event name) with the parsed data, and once as the
   * generic `topicEventReceived` event. Payloads that are not valid JSON are
   * contained: the error is logged, `failed` is emitted and the consumer never
   * throws, so one bad message cannot tear down the channel.
   *
   * @param {string|string[]} eventNames - One event name or a list of them.
   * @returns {Promise<object>} The channel the consumer was started on.
   * @throws {Error} When no channel has been set via `setChannel()`.
   * @emits Topic#topicEventReceived - `{ data, type: 'topic', name }` for each message.
   * @emits Topic#failed - `{ eventName, error }` when a payload cannot be parsed.
   */
  async listen (eventNames) {
    let _eventNames = []
    if (Array.isArray(eventNames) && eventNames.length > 0) {
      _eventNames = eventNames
    }
    else {
      _eventNames.push(eventNames)
    }

    if (!this.channel) {
      throw new Error('A channel is needed, call setChannel() on the instance once')
    }

    const channel = this.channel
    await channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
      durable: false,
    })

    const q = await channel.assertQueue('', { exclusive: true })

    for (const eventName of _eventNames) {
      await channel.bindQueue(q.queue, this.EXCHANGE_NAME, eventName)

      const options = {
        noAck: true,
      }

      await channel.consume(q.queue, async (message) => {
        let data
        try {
          data = JSON.parse(message.content.toString())
        }
        catch (err) {
          // Contain the failure: a malformed payload must not reject the
          // consumer callback nor escape as an unhandled rejection.
          console.log(err)
          this.emit('failed', { eventName: message.fields.routingKey, error: err })
          return message
        }

        this.emit(message.fields.routingKey, data)

        this.emit('topicEventReceived', {
          data: data,
          type: 'topic',
          name: message.fields.routingKey,
        })

        return message
      }, options)
    }

    return channel
  }

  /**
   * Publishes `message` to the exchange under `eventName`. The payload is a
   * shallow copy of `message` stamped with a fresh `tid`, so the caller's
   * object is never mutated. Publishing is fire-and-forget (`noAck` consumers,
   * no publisher confirms), hence the resolved value only reports the channel
   * write buffer state.
   *
   * @param {string} eventName - Routing key to publish under.
   * @param {object} [message] - Payload to publish; defaults to `{}`.
   * @returns {Promise<boolean>} `false` when the channel buffer is full, else `true`.
   * @throws {Error} When no channel has been set via `setChannel()`.
   * @emits Topic#sent - `{ type: 'topic', eventName, message }` with the stamped copy.
   */
  async publish (eventName, message) {
    const _data = { ...(message || {}), tid: uuid.v4() }
    const data = Buffer.from(JSON.stringify(_data))

    if (!this.channel) {
      throw new Error('A channel is needed, call setChannel() on the instance once')
    }

    const channel = this.channel
    await channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
      durable: false,
    })

    const result = await channel.publish(this.EXCHANGE_NAME, eventName, data)

    this.emit('sent', {
      type: 'topic',
      eventName: eventName,
      message: _data,
    })

    return result
  }
}

module.exports = Topic
