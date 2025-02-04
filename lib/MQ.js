var amqp = require('amqplib')
var EventEmitter = require('events')
var url = require('url')

const delay = (miliseconds) => new Promise(resolve => setTimeout(resolve, miliseconds))

class MQ extends EventEmitter {
  constructor (config) {
    super()
    this.RABBITMQ_URL = config.url;
    this.connection = null;
    this.connectMaxAttempts = config.connectMaxAttempts ?? 50
    this.connectDelayMS = config.delayMS ?? 30000
    
    var parsedURI = url.parse(this.RABBITMQ_URL)
    this.connectionOptions = {
      servername: parsedURI.hostname,
      heartbeat: 10
    }

    this.queueOptions = {
      durable: true
    }

    return this
  }

  async amqpConnect (delayMS = 5000, maxAttempts = 50) {
    let attempts = 0
    while (attempts < maxAttempts) {
      try {
        this.emit('connectionAttempt', attempts)
        return await amqp.connect(this.RABBITMQ_URL, this.connectionOptions)
      } catch (error) {
        attempts ++
        if (attempts == maxAttempts) throw error
        await delay(delayMS)
      }
    }
  }

  async connect () {
    try {
      const connection = await this.amqpConnect(this.connectDelayMS, this.connectMaxAttempts)
      
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
    }
    catch (err) {
      this.isConnected = false
      this.emit('error', err)
    }
  }

  async reconnect () {
    if (this.isConnected) {
      console.log('Connection exists, stoping reconnecting process')
      return
    }
    else {
      console.log('Retrying to connect')
      const connection = await this.connect()
      this.emit('reconnected', connection)
      return connection
    }
  }

  get connection () {
    return this._connection 
  }

  set connection (connection) {
    this._connection = connection
  }

  setConnection (connection) {
    this._connection = connection
  }
  
  async createChannel () {
    try {
      let channel = await this.connection.createChannel()
      return channel
    }
    catch (err) {
      throw err
    }
  }

  async disconnect () {
    try {
      var result = await this.connection.close()
      this._connection = false
      this.emit('connectionClosed')
      return result
    }
    catch (err) {
      throw err
    }
  }
}

module.exports = MQ