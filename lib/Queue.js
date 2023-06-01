var EventEmitter = require('events')

class Queue extends EventEmitter {
  constructor (delayedExchangeName) {
    super()
    
    this.queueOptions = {
      durable: true
    }

    this.DELAYED_EXCHANGE_NAME = delayedExchangeName
    this.isDelayed = false
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

  setIsDelayed (isDelayed) {
    this.isDelayed = isDelayed
  }

  async bindExchange (queueName) {
    if (this.isDelayed && this.DELAYED_EXCHANGE_NAME) {
      await this.channel.assertExchange(this.DELAYED_EXCHANGE_NAME, "x-delayed-message", { arguments: {'x-delayed-type':  "direct"}})
      await this.channel.bindQueue(queueName, this.DELAYED_EXCHANGE_NAME, queueName)
    }
    return
  }

  async listen (queueNames, options = { isDelayed: false}) {
    try {
      var _queueNames = []
      if (Array.isArray(queueNames) && queueNames.length > 0) {
        _queueNames = queueNames
      }
      else {
        _queueNames.push(queueNames)
      }

      var consumeOptions = {
        noAck: false
      }

      if (!this.channel) {
        this.emit('missingChannelOnQueue')
        throw new Error('A channel is needed, call setChannel() on the instance once')
      }

      var channel = this.channel

      if (options.isDelayed) this.setIsDelayed(true)
  
      for (let queueName of _queueNames) {
        var queue = await channel.assertQueue(queueName, this.queueOptions)
        await this.bindExchange(queueName)
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
        }, consumeOptions)
      }

      return channel
    }
    catch (err) {
      throw err
    }
  }

  async send (queueName, message, delay = 0) {
    try {
      let messageOptions = {
        persistent: true
      }

      if (!this.channel) {
        throw new Error('A channel is needed, call setChannel() on the instance once')
      }

      let channel = this.channel
      var data = new Buffer(JSON.stringify(message))

      if (delay > 0) this.setIsDelayed(true)

      let queue = await channel.assertQueue(queueName, this.queueOptions)
      let exchange = ''
      await this.bindExchange(queueName)
      if (this.isDelayed && this.DELAYED_EXCHANGE_NAME) {
        exchange = this.DELAYED_EXCHANGE_NAME
        messageOptions.headers = { 'x-delay': delay }
      }

      let result = await channel.publish(exchange, queueName, data, messageOptions)

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
