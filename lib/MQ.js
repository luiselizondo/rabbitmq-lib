var amqp = require('amqplib')
var uuid = require('uuid')
var EventEmitter = require('events')
var url = require('url')

class MQ extends EventEmitter {
  constructor (config) {
    super()
    this.RABBITMQ_URL = config.url;
    this.connection = null;
    
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

  async connect () {
    try {
      let connection = await amqp.connect(this.RABBITMQ_URL, this.connectionOptions)
      
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
      this.emit('error', err)
      this.isConnected = false
      this.reconnect()
    }
  }

  reconnect () {
    setTimeout(() => {
      return this.retryConnection()
      .then((connection) => {
        this.emit('reconnected', connection)
        return connection
      })
    }, 5000)
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

  retryConnection() {
    if (this.isConnected) {
      console.log('Connection exists, stoping reconnecting process')
      return
    }
    else {
      console.log('Retrying to connect')
      this.connect()
    }
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