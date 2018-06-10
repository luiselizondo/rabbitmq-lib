var should = require('should')
var MQ = require('../../index')

describe('Queue', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  it("Should be able to publish an object to a topic and listen to it", function () {
    var mq = new MQ(config)

    var queueName = 'someEventOnQueue2';

    mq.on(queueName, function (data) {
      data.should.have.property('message', 'testing queues')
    })

    mq.connect()
    .then((connection) => {
      return mq.consumeFromQueues([queueName])
    })
    .then((connection) => {
      return mq.dispatchToQueue(queueName, {
        message: 'testing queues'
      })
    })
  })
})
