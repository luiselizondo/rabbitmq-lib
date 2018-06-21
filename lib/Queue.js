var amqp = require('amqplib')
var uuid = require('uuid')
var EventEmitter = require('events')
var url = require('url')

class Queue extends EventEmitter {
  constructor () {
    super()
    
    this.queueOptions = {
      durable: true
    }
  }

  get channel () {
    return this._channel
  }

  set channel (channel) {
    this._channel = channel
  }

  setChannel (channel) {
    this._channel = channel
  }

  async listen (queueNames) {
    try {
      var _queueNames = []
      if (Array.isArray(queueNames) && queueNames.length > 0) {
        _queueNames = queueNames
      }
      else {
        _queueNames.push(queueNames)
      }

      var options = {
        noAck: false
      }

      if (!this.channel) {
        this.emit('missingChannelOnQueue')
        throw new Error('A channel is needed, call setChannel() on the instance once')
      }

      var channel = this.channel

      for (let queueName of _queueNames) {
        var queue = await channel.assertQueue(queueName, this.queueOptions)
        await channel.prefetch(1)

        await channel.consume(queueName, async (message) => {
          try {
            var data = JSON.parse(message.content.toString());
            this.emit(message.fields.routingKey, data)
  
            this.emit('queueEventReceived', {
              data: data,
              type: 'queue',
              name: message.fields.routingKey
            })
  
            channel.ack(message)
          }
          catch (err) {
            throw err
          }
        }, options)
      }

      return channel
    }
    catch (err) {
      throw err
    }
  }

  async send (queueName, message) {
    try {
      let messageOptions = {
        persistent: true
      }

      if (!this.channel) {
        throw new Error('A channel is needed, call setChannel() on the instance once')
      }

      let channel = this.channel
      var data = new Buffer(JSON.stringify(message))
      let queue = await channel.assertQueue(queueName, this.queueOptions)
      let result = await channel.publish('', queueName, data, messageOptions)

      this.emit('sent', {
        type: 'queue',
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
