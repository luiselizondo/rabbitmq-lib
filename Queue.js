var amqp = require('amqplib')
var uuid = require('uuid')
var EventEmitter = require('events')
var url = require('url')

class Queue extends EventEmitter {
  constructor (config) {
    super()
    this.RABBITMQ_URL = config.url;
    var parsedURI = url.parse(this.RABBITMQ_URL)
    this.connectionOptions = {
      servername: parsedURI.hostname,
      heartbeat: 5
    }

    this.queueOptions = {
      durable: true
    }

    return this
  }

  async listenToQueues (queueNames) {
    try {
      let connection = await amqp.connect(this.RABBITMQ_URL, this.connectionOptions)
      var channel = await connection.createChannel()

      var options = {
        noAck: false
      }

      for (let queueName of queueNames) {
        var queue = await channel.assertQueue(queueName, this.queueOptions)
        await channel.prefetch(1)

        channel.consume(queueName, (message) => {
          var data = JSON.parse(message.content.toString());
          this.emit(message.fields.routingKey, data)
          channel.ack(message)
        }, options)
      }

      return channel
    }
    catch (err) {
      throw err
    }
  }

  async listenToQueue (queueName) {
    try {
      let connection = await amqp.connect(this.RABBITMQ_URL, this.connectionOptions)
      var channel = await connection.createChannel()

      var queue = await channel.assertQueue(queueName, this.queueOptions)
      await channel.prefetch(1)

      var options = {
        noAck: false
      }

      channel.consume(queueName, (message) => {
        var data = JSON.parse(message.content.toString());
        this.emit(message.fields.routingKey, data)
        channel.ack(message)
      }, options)

      return channel
    }
    catch (err) {
      throw err
    }
  }

  async send (queueName, message) {
    try {
      var messageOptions = {
        persistent: true
      }

      var data = new Buffer(JSON.stringify(message))

      let connection = await amqp.connect(this.RABBITMQ_URL, this.connectionOptions)
      let channel = await connection.createChannel()
      let queue = await channel.assertQueue(queueName, this.queueOptions)
      let result = await channel.publish('', queueName, data, messageOptions)

      setTimeout(() => {
        connection.close()
      }, 150)

      this.emit('sent', {
        queueName: queueName,
        message: message
      })

      return result
    }
    catch (err) {
      throw err
    }
  }
}

module.exports = Queue
