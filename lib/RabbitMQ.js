var Q = require('q')
var amqp = require('amqplib')
var uuid = require('uuid')
var url = require('url')
var EventEmitter = require('events')

class RabbitMQ extends EventEmitter {
  constructor(config) {
    super()

    this.connection = null;
    this.isConnected = false
    this.EXCHANGE_NAME = config.exchange_name;
    this.RABBITMQ_URL = config.url;
  }

  connect() {
    var parsedURI = url.parse(this.RABBITMQ_URL)

    return amqp.connect(this.RABBITMQ_URL, { servername: parsedURI.hostname, heartbeat: 5 })
    .then((connection) => {
      this.connection = connection;
      this.isConnected = true

      this.emit('connected')

      this.connection.on('error', (error) => {
        this.isConnected = false
        console.log('Connection was closed with error', error)
      })

      this.connection.on('close', (data) => {
        console.log('Connection was closed', data)
        this.isConnected = false
        this.reconnect()

        this.emit('disconnected')
      })

      return connection;
    })
    .catch((err) => {
      // console.log('Error while connecting to RabbitMQ', err)
      this.isConnected = false
      this.reconnect()
      return err
    })
  }

  reconnect() {
    setTimeout(() => {
      return this.retryConnection()
    }, 5000)
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

  disconnect() {
    return this.connection.close()
    .then((connectionClosed) => {
      this.connection = null
      return connectionClosed
    })
    .catch((error) => {
      console.log('Cannot close the connection', error)
    })
  }

  _createChannel() {
    if (!this.isConnected || !this.connection) {
      return Q.fcall(() => {
        throw new Error("No connection to RabbitMQ. Channel cannot be created");
      })
    }

    return this.connection.createChannel()
  }

  publish(eventName, data) {
    return this.publishToTopic(eventName, data)
  }

  // Follows the Topic Pattern described at
  // https://www.rabbitmq.com/tutorials/tutorial-five-javascript.html
  publishToTopic(eventName, message) {
    return this._createChannel()
    .then((channel) => {
      var data = message || {};
      data.tid = uuid();

      return channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
        durable: false
      })
      .then((asserted) => {
        channel.publish(this.EXCHANGE_NAME, eventName, new Buffer(JSON.stringify(data)))
        return channel
      });
    })
    .then((channel) => {
      return channel.close()
    })
    .catch((err) => {
      console.log('Error publising to topic', err)
      return err
    })
  }

  // Follows the Work Queue Pattern describe at
  // https://www.rabbitmq.com/tutorials/tutorial-two-javascript.html
  dispatchToQueue(queueName, data) {
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

  listen(topicsToListenOn) {
    return this.listenForTopics(topicsToListenOn)
  }

  // Follows the Topic Pattern described at
  // https://www.rabbitmq.com/tutorials/tutorial-five-javascript.html
  listenForTopics(topicsToListenOn) {
    return Q.any(topicsToListenOn.map((topic) => {
      return this._listenASingleTopic(topic)
    }))
    .then(function (first) {
      return first
    }, function (error) {
      console.log('Error on listenForTopics', error)
      return error
    });
  }

  // Follows the Topic Pattern described at
  // https://www.rabbitmq.com/tutorials/tutorial-five-javascript.html
  _listenASingleTopic(topicToListenOn) {
    return this._createChannel()
    .then((channel) => {
      channel.assertExchange(this.EXCHANGE_NAME, 'topic', {
        durable: false
      });

      return channel.assertQueue('', {
        exclusive: true
      })
      .then((q) => {
        channel.bindQueue(q.queue, this.EXCHANGE_NAME, topicToListenOn);
        return this._consumeTopics(q.queue, channel)
        .then((result) => {
          return channel
        })
      })
    })
    .then((channel) => {
      return channel
    })
    .catch((err) => {
      console.log('Error while listning for topics')
      throw err
    })
  }

  _consumeTopics(queue, channel) {
    var options = {
      noAck: true
    }

    return channel.consume(queue, (message) => {
  		return this._reactToReceivedMessage(message)
    }, options)
    .then((result) => {
      return result
    })
    .catch((err) => {
      console.log('Error while consuming topic', err)
      return err
    });
  }

  _reactToReceivedMessage (message) {
    var topic = message.fields.routingKey;
    var data = {};

    try {
      data = JSON.parse(message.content.toString());
      this.emit(topic, data);
    } catch (e) {
      console.log('Catching error on event received', e)
    }

    return
  }

  // Follows the Work Queue Pattern describe at
  // https://www.rabbitmq.com/tutorials/tutorial-two-javascript.html
  consumeFromQueues(queuesToListen) {
    return Q.any(queuesToListen.map((queueName) => {
      return this._consumeFromASingleQueue(queueName)
    }))
    .then(function (first) {
      return first
    }, function (error) {
      console.log('Error on consumeFromQueues', error)
      return error
    });
  }

  _consumeFromASingleQueue(queueName) {
    return this._createChannel()
    .then((channel) => {
      return channel.assertQueue(queueName, {
        durable: true
      })
      .then(() => {
        channel.prefetch(1);
        return this._consumeMessagesOnQueue(queueName, channel)
        .then((result) => {
          return channel
        })
      })
    })
  }

  _consumeMessagesOnQueue(queueName, channel) {
    var options = {
      noAck: false
    }

    return channel.consume(queueName, (message) => {
  		this._reactToReceivedMessage(message)
      return channel.ack(message)
    }, options)
    .then((result) => {
      return result
    })
    .catch((err) => {
      console.log('Error while consuming message from queue ' + queueName, err)
      return err
    });
  }

  // Follows the RPC pattern described at
  // https://www.rabbitmq.com/tutorials/tutorial-six-python.html
  sendRequest(requestName, data) {
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
  listenAndAnswerRequest(requestName, callback) {
    return this._createChannel()
    .then((channel) => {
      return channel.assertQueue(requestName, {
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

  _executeAndReply(message, channel, callback) {
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
}

module.exports = RabbitMQ;
