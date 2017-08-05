var Q = require('q');
var amqp = require('amqplib');
var uuid = require('uuid');
var url = require('url');

function RabbitMQ(eventsInstance, config) {
  this.events = eventsInstance;
  this.connection = null;
  this.EXCHANGE_NAME = config.exchange_name;
  this.RABBITMQ_URL = config.url;
}

RabbitMQ.prototype.connect = function() {
  var parsedURI = url.parse(this.RABBITMQ_URL)

  return amqp.connect(this.RABBITMQ_URL, { servername: parsedURI.hostname })
  .then((connection) => {
    this.connection = connection;
    return connection;
  })
  .catch((err) => {
    throw err
  })
}

RabbitMQ.prototype.disconnect = function() {
  this.connection.close();
}

RabbitMQ.prototype._createChannel = function() {
  if (!this.connection) {
    throw new Error("No connection to RabbitMQ, returning error");
  }

  return this.connection.createChannel()
}

RabbitMQ.prototype.emit = function(eventName, data) {
  return this.publishToTopic(eventName, data)
}

// Follows the Topic Pattern described at
// https://www.rabbitmq.com/tutorials/tutorial-five-javascript.html
RabbitMQ.prototype.publishToTopic = function(eventName, message) {
  return this._createChannel()
  .then((channel) => {
    if (channel) {
      var data = message || {};
      data.tid = uuid();

      channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
        durable: false
      });

      return channel.publish(this.EXCHANGE_NAME, eventName, new Buffer(JSON.stringify(data)))
    }
    else {
      throw new Error('No connection to RabbitMQ, returning error')
    }
  })
  .catch((err) => {
    throw err
  })
}

// Follows the Work Queue Pattern describe at
// https://www.rabbitmq.com/tutorials/tutorial-two-javascript.html
RabbitMQ.prototype.dispatchToQueue = function(queueName, data) {
  return this._createChannel()
  .then((channel) => {
    return channel.assertQueue(queueName, {
      durable: true
    })
    .then((q) => {
      var message = JSON.stringify(data)
      return channel.sendToQueue(queueName, new Buffer(message), {
        persistent: true
      });
    })
  })
  .catch((error) => {
    throw err
  })
}

RabbitMQ.prototype.listen = function(topicsToListenOn) {
  return this.listenForTopics(topicsToListenOn)
}

// Follows the Topic Pattern described at
// https://www.rabbitmq.com/tutorials/tutorial-five-javascript.html
RabbitMQ.prototype.listenForTopics = function(topicsToListenOn) {
  return this._createChannel()
  .then((channel) => {
    channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
      durable: false
    });

    return channel.assertQueue('', {
      exclusive: true
    })
    .then((q) => {
      this._bindChannelToEachRegisteredEvent(topicsToListenOn, q.queue, channel)
      this._consumeTopics(q.queue, channel)
      return
    })
  })
  .catch((err) => {
    throw err
  })
}

RabbitMQ.prototype._bindChannelToEachRegisteredEvent = function(topicsToListenOn, queue, channel) {
  topicsToListenOn.forEach((topicName) => {
    channel.bindQueue(queue, this.EXCHANGE_NAME, topicName);
  });
}

RabbitMQ.prototype._consumeTopics = function(queue, channel) {
  channel.consume(queue, (message) => {
		var topic = message.fields.routingKey;
    var data = {};

    try {
      data = JSON.parse(message.content.toString());
      this.events.emit(topic, data);
    } catch (e) {
			// console.log('Catching error', e)
		}
  }, {
    noAck: true
  });
}

// Follows the Work Queue Pattern describe at
// https://www.rabbitmq.com/tutorials/tutorial-two-javascript.html
RabbitMQ.prototype.consumeFromQueue = function(queuesToListen) {
  return this._createChannel()
  .then((channel) => {
    queuesToListen.forEach((queueName) => {
      channel.assertQueue(queueName, {
        durable: true
      })

      channel.prefetch(1);

      this._consumeMessagesOnQueue(queueName, channel)
    })
  })
}

RabbitMQ.prototype._consumeMessagesOnQueue = function(queue, channel) {
  channel.consume(queue, (message) => {
    try {
      var data = JSON.parse(message.content.toString());
      this.events.emit(queue, data);
      channel.ack(message)
    } catch (e) {
      console.log(e)
    }
  }, {
    noAck: false
  })
}

// Follows the RPC pattern described at
// https://www.rabbitmq.com/tutorials/tutorial-six-python.html
RabbitMQ.prototype.sendRequest = function(requestName, data) {
  return this._createChannel()
  .then((channel) => {
    return new Promise(function(resolve) {
      var correlationId = uuid();

      function maybeAnswer(message) {
        if (message.properties.correlationId === correlationId) {
          resolve(message.content.toString());
        }
      }

      channel.assertQueue('', {
        exclusive: true
      })
      .then(function(q) {
        return q.queue;
      })
      .then(function(queue) {
        return channel.consume(queue, maybeAnswer, {
          noAck: true
        })
        .then(function() {
          return queue;
        });
      })
      .then(function(queue) {
        channel.sendToQueue(requestName, new Buffer(JSON.stringify(data).toString()), {
          correlationId: correlationId,
          replyTo: queue
        });
      });
    });
  })
}

// Follows the RPC pattern described at
// https://www.rabbitmq.com/tutorials/tutorial-six-python.html
RabbitMQ.prototype.listenAndAnswerRequest = function(requestName, callback) {
  return this._createChannel()
  .then((channel) => {
    channel.assertQueue(requestName, {
      durable: true
    })
    .then(() => {
      channel.prefetch(1);
      return channel.consume(requestName, (message) => {
        return this._executeAndReply(message, channel, callback)
      });
    })
  })
}

RabbitMQ.prototype._executeAndReply = function(message, channel, callback) {
  var data = JSON.parse(message.content.toString());
  return callback(data, function(err, result) {
    var response = {
      type: null
    };

    if (err) {
      response.type = 'failure'
      response.error = err;
    }

    if (!result) {
      response.type = 'failure'
      response.error = new Error("No data found");
    }

    if (result) {
      response.type = 'success'
      response.results = result;
    }

    channel.sendToQueue(message.properties.replyTo, new Buffer(JSON.stringify(response)), {
      correlationId: message.properties.correlationId
    });

    channel.ack(message);
  });
}

module.exports = RabbitMQ;
