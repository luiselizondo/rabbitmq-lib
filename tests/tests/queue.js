var should = require('should')
var MQ = require('../../index')
var EventEmitter = require('events');
class Events extends EventEmitter {}

describe('Queue', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  it("Should be able to publish an object to a topic and listen to it", function (done) {
    var eventsInstance = new Events();
    var mq = new MQ(eventsInstance, config)

    var queueName = 'someEventOnQueue2';

    eventsInstance.on(queueName, function (data) {
      data.should.have.property('message', 'testing queues')
      done();
    })

    mq.connect()
    .then((connection) => {
      return mq.consumeFromQueue([queueName])
    })
    .then((connection) => {
      return mq.dispatchToQueue(queueName, {
        message: 'testing queues'
      })
    })
    .catch(done)
  })
})
