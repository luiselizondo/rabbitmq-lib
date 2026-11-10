const amqp = require('amqplib')
const EventEmitter = require('events')

const delay = (miliseconds) =>
  new Promise((resolve) => setTimeout(resolve, miliseconds))

/**
 * Thin EventEmitter wrapper around amqplib that keeps a single connection,
 * retries the initial connect and re-exposes the broker lifecycle as events.
 *
 * @class MQ
 * @extends EventEmitter
 */
class MQ extends EventEmitter {
  /**
   * Creates an MQ instance and normalizes the connection URL.
   *
   * @param {object} config - Instance configuration.
   * @param {string} config.url - Broker URL, e.g. `amqp://user:pass@host:5672/`.
   * @param {number} [config.connectMaxAttempts=600] - Attempts used by `connect()`.
   * @param {number} [config.delayMS=10000] - Delay between attempts used by `connect()`.
   */
  constructor (config) {
    super()
    this.RABBITMQ_URL = config.url
    this.connection = null
    this.connectMaxAttempts = config.connectMaxAttempts ?? 600
    this.connectDelayMS = config.delayMS ?? 10000

    const parsedURL = new globalThis.URL(this.RABBITMQ_URL)

    // amqplib reads frameMax from the connection URL's query string, NOT from
    // the socket options: RabbitMQ 4.x enforces a minimum frame size of 8192
    // while amqplib defaults to 4096 and the connection is dropped
    // mid-handshake. Append it here unless the URL already sets it — older
    // brokers negotiate the frame size down, so this is safe against every
    // broker version in use.
    if (!parsedURL.searchParams.has('frameMax')) {
      parsedURL.searchParams.append('frameMax', '131072')
    }
    this.RABBITMQ_URL = parsedURL.toString()

    this.connectionOptions = {
      servername: parsedURL.hostname,
      heartbeat: 10,
    }

    this.queueOptions = {
      durable: true,
    }

    return this
  }

  /**
   * Opens a connection, retrying on failure. Emits `connectionAttempt` before
   * every attempt and rethrows the last error once `maxAttempts` is reached.
   *
   * @param {number} [delayMS=5000] - Delay in milliseconds between attempts.
   * @param {number} [maxAttempts=50] - Maximum number of attempts.
   * @returns {Promise<object>} The amqplib connection.
   * @throws {Error} The error of the final failed attempt.
   * @emits MQ#connectionAttempt
   */
  async amqpConnect (delayMS = 5000, maxAttempts = 50) {
    let attempts = 0
    while (attempts < maxAttempts) {
      try {
        this.emit('connectionAttempt', attempts)
        return await amqp.connect(this.RABBITMQ_URL, this.connectionOptions)
      } catch (error) {
        attempts++
        if (attempts === maxAttempts) throw error
        await delay(delayMS)
      }
    }
  }

  /**
   * Connects to the broker and wires its lifecycle events onto this instance.
   *
   * On failure it emits `error` and then rejects with that error (it no longer
   * resolves `undefined`), so callers must handle the rejection.
   *
   * @returns {Promise<object>} The amqplib connection.
   * @throws {Error} When the connection cannot be established after all attempts.
   * @emits MQ#connected
   * @emits MQ#error
   * @emits MQ#disconnected
   * @emits MQ#close
   * @emits MQ#blocked
   * @emits MQ#unblocked
   */
  async connect () {
    try {
      const connection = await this.amqpConnect(
        this.connectDelayMS,
        this.connectMaxAttempts,
      )

      this._connection = connection
      this.isConnected = true

      if (this.isConnected) {
        this.emit('connected', this._connection)
      }

      this._connection.on('error', (error) => {
        this.isConnected = false
        this.emit('error', error)
        this.emit('disconnected')
      })

      this._connection.on('close', () => {
        this.isConnected = false
        this.emit('close')
      })

      this._connection.on('blocked', (data) => {
        this.emit('blocked', data)
      })

      this._connection.on('unblocked', () => {
        this.emit('unblocked')
      })

      return this._connection
    } catch (err) {
      this.isConnected = false
      this.emit('error', err)
      throw err
    }
  }

  /**
   * Reconnects when there is no live connection.
   *
   * Propagates any rejection from `connect()` (see flag 5), so callers must
   * handle a rejected promise. Resolves with `undefined` when a connection
   * already exists.
   *
   * @returns {Promise<object|undefined>} The new connection, or `undefined` when one already exists.
   * @throws {Error} When `connect()` rejects.
   * @emits MQ#reconnected
   * @emits MQ#error
   */
  async reconnect () {
    if (this.isConnected) {
      return
    } else {
      const connection = await this.connect()
      this.emit('reconnected', connection)
      return connection
    }
  }

  /**
   * The current amqplib connection, if any.
   *
   * @returns {object|null} The connection or `null`.
   */
  get connection () {
    return this._connection
  }

  /**
   * Replaces the stored connection without opening a new one.
   *
   * @param {object} connection - An amqplib connection.
   */
  set connection (connection) {
    this._connection = connection
  }

  /**
   * Replaces the stored connection without opening a new one.
   *
   * @param {object} connection - An amqplib connection.
   * @returns {void}
   */
  setConnection (connection) {
    this._connection = connection
  }

  /**
   * Creates a channel on the current connection.
   *
   * @returns {Promise<object>} The amqplib channel.
   * @throws {Error} When no connection exists or the channel cannot be created.
   */
  async createChannel () {
    if (!this.connection) {
      throw new Error('No connection. Call connect() before creating a channel.')
    }
    const channel = await this.connection.createChannel()
    return channel
  }

  /**
   * Closes the current connection and marks this instance as disconnected, so
   * a later `reconnect()` opens a new connection.
   *
   * @returns {Promise<void>} Resolves when the connection is closed.
   * @throws {Error} When no connection exists or closing fails.
   * @emits MQ#connectionClosed
   */
  async disconnect () {
    const result = await this.connection.close()
    this._connection = false
    this.isConnected = false
    this.emit('connectionClosed')
    return result
  }
}

/**
 * @event MQ#connectionAttempt
 * @type {number} - The zero-based attempt index.
 */

/**
 * @event MQ#connected
 * @type {object} - The amqplib connection.
 */

/**
 * @event MQ#error
 * @type {Error}
 */

/**
 * @event MQ#disconnected
 */

/**
 * @event MQ#close
 */

/**
 * @event MQ#blocked
 * @type {object} - The reason reported by amqplib.
 */

/**
 * @event MQ#unblocked
 */

/**
 * @event MQ#reconnected
 * @type {object} - The new amqplib connection.
 */

/**
 * @event MQ#connectionClosed
 */

module.exports = MQ
