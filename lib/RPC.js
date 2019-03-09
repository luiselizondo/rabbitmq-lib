var amqp = require('amqplib')
var uuid = require('uuid')
var EventEmitter = require('events')
var url = require('url')

class RPC extends EventEmitter {
  constructor(_options) {
    super()
    this.options = Object.assign({
      expiration: '5000',
      persistent: false
    }, _options)
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

  get connection () {
    return this._connection
  }

  set connection (connection) {
    this._connection = connection
  }

  setConnection (connection) {
    this._connection = connection
  }

  async listen (request, callback) {
    try {
      var channel = this.channel
      let queueName = request
      var queue = await channel.assertQueue(queueName)
      await channel.prefetch(1)

      return await channel.consume(queueName, async (message) => {
        var data = JSON.parse(message.content.toString());

        return callback(data, async function (err, result) {
          var response = {
            type: null
          };

          if (err) {
            response.type = 'error'
            response.error = err;
          }

          if (!err && !result) {
            response.type = 'error'
            response.error = "No data found";
          }

          if (result) {
            response.type = 'success'
            response.results = result;
          }

          var result = await channel.sendToQueue(message.properties.replyTo, new Buffer(JSON.stringify(response)), {
            correlationId: message.properties.correlationId
          });

          var ackResult = await channel.ack(message);
          return ackResult
        });
      })
    }
    catch (err) {
      throw err
    }
  }

  async send (eventName, message) {
    try {
      if (!this.connection) {
        throw new Error('A connection is needed, call setConnection() on the instance once')
      }

      this.REPLY_QUEUE = 'amq.rabbitmq.reply-to';
      var channel = await this.connection.createChannel()

      channel.responseEmitter = new EventEmitter()
      channel.responseEmitter.setMaxListeners(0)

      await channel.consume(this.REPLY_QUEUE, (msg) => {
        channel.responseEmitter.emit(msg.properties.correlationId, msg.content)
      }, { noAck: true })

      let sendMessage = new Promise((resolve) => {
        const correlationId = uuid.v4();
        // listen for the content emitted on the correlationId event
        channel.responseEmitter.once(correlationId, resolve);
        var data = new Buffer(JSON.stringify(message))

        // emit the emit event to close the channel
        let resolveAfterTimeout = setTimeout(() => {
          clearTimeout(resolveAfterTimeout)
          channel.responseEmitter.emit(`resolve-promise-on-${correlationId}`)
          return resolve
        }, parseInt(this.options.expiration, 10))

        // listen for the close channel on correlationId event in case we don't get a
        // response from rabbitmq
        channel.responseEmitter.once(`resolve-promise-on-${correlationId}`, resolve)

        return channel.sendToQueue(eventName, data, {
          correlationId,
          replyTo: this.REPLY_QUEUE,
          persistent: this.options.persistent,
          expiration: this.options.expiration
        })
      })

      return sendMessage.then(async (result) => {
        console.log('Result is', result)
        await channel.close()
        return result
      }).catch(err => {
        throw err
      })
    }
    catch (err) {
      console.log(err)
      throw err
    }
  }
}

module.exports = RPC