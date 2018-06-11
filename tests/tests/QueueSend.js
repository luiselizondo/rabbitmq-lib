var should = require('should')
var Queue = require('../../Queue')

describe('Queue Send', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  it("Should be able to send a message to a queue and receive it", async function () {
    try {
      var queue = new Queue(config)

      var queueName = 'queueSendMessage';

      queue.on(queueName, function (data) {
        console.log('Message received', data)
        data.should.have.property('message', 'testing queues')
      })

      var listener = await queue.listenToQueue(queueName)

      await queue.send(queueName, {
        message: 'testing queues'
      })
    }
    catch (err) {
      console.log(err)
    }
  })

  it('Should be able to send two messages to two different queues and receive them', async function () {
    try {
      var queue = new Queue(config)

      var queueName1 = 'test__queueOne.abc'
      var queueName2 = 'test__queueTwo.abc'

      queue.on(queueName1, function (data) {
        console.log('on queue 1', data)
        data.should.have.property('message', 'Queue One')
      })

      queue.on(queueName2, function (data) {
        console.log('on queue 2', data)
        data.should.have.property('message', 'Queue Two')
      })

      await queue.listenToQueues([queueName1, queueName2])

      await queue.send(queueName1, {
        message: 'Queue One'
      })

      await queue.send(queueName2, {
        message: 'Queue Two'
      })
    }
    catch (err) {
      console.log(err)
      should.not.exist(err)
    }
  })
})
