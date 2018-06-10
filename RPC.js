var amqp = require('amqplib')
var uuid = require('uuid')
var EventEmitter = require('events')
var url = require('url')

class RPC {
  constructor(config) {
    this.RABBITMQ_URL = config.url;
  }

  _connect () {
    this.REPLY_QUEUE = 'amq.rabbitmq.reply-to';

    var parsedURI = url.parse(this.RABBITMQ_URL)
    return amqp.connect(this.RABBITMQ_URL, { servername: parsedURI.hostname, heartbeat: 5 })
    .then((connection) => {
      this.connection = connection
      return connection.createChannel()
    })
    .then((channel) => {
      this.channel = channel
      channel.responseEmitter = new EventEmitter()
      channel.responseEmitter.setMaxListeners(0);
      channel.consume(this.REPLY_QUEUE,
        (msg) => this.channel.responseEmitter.emit(msg.properties.correlationId, msg.content),
        {noAck: true}
      );

      return channel;
    })
  }

  sendRequest (eventName, message) {
    return this._connect()
    .then(() => {
      return new Promise((resolve) => {
        const correlationId = uuid.v4();
        // listen for the content emitted on the correlationId event
        this.channel.responseEmitter.once(correlationId, resolve);
        var data = new Buffer(JSON.stringify(message))
        this.channel.sendToQueue(eventName, data, {
          correlationId,
          replyTo: this.REPLY_QUEUE
        })
      })
    })
    .then((result) => {
      this.connection.close()
      return result
    })
  }
}

module.exports = RPC
