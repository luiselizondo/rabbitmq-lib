var amqp = require('amqplib')
var uuid = require('uuid')
var EventEmitter = require('events')
var url = require('url')

class Topic extends EventEmitter {
  constructor (exchangeName) {
    super()
    this.EXCHANGE_NAME = exchangeName

    this.queueOptions = {
      durable: true
    }

    return this
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

  async listen (eventNames) {
    try {
      var _eventNames = []
      if (Array.isArray(eventNames) && eventNames.length > 0) {
        _eventNames = eventNames
      }
      else {
        _eventNames.push(eventNames)
      }

      if (!this.channel) {
        throw new Error('A channel is needed, call setChannel() on the instance once')
      }

      var channel = this.channel
      var assertionResult = await channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
        durable: false
      })

      let q = await channel.assertQueue('', {exclusive: true})

      for (let eventName of _eventNames) {
        await channel.bindQueue(q.queue, this.EXCHANGE_NAME, eventName)

        var options = {
          noAck: true
        }

        await channel.consume(q.queue, async (message) => {
          try {
            var data = JSON.parse(message.content.toString());
            this.emit(message.fields.routingKey, data)
  
            this.emit('topicEventReceived', {
              data: data,
              type: 'topic',
              name: message.fields.routingKey
            })
  
            return message
          }
          catch (err) {
            console.log(err)
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

  async publish (eventName, message) {
    try {
      var _data = message || {};
      _data.tid = uuid();
      var data = new Buffer(JSON.stringify(_data))

      if (!this.channel) {
        throw new Error('A channel is needed, call setChannel() on the instance once')
      }

      let channel = this.channel
      let assertResult = await channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
        durable: false
      })

      var result = await channel.publish(this.EXCHANGE_NAME, eventName, data)

      this.emit('sent', {
        type: 'topic',
        eventName: eventName,
        message: message
      })

      return result
    }
    catch (err) {
      throw err
    }
  }
}

module.exports = Topic