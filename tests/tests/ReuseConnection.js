var should = require('should')
var Queue = require('../../index').Queue
var MQ = require('../../index').MQ
var EventEmitter = require('events')

describe('Queue Send', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }
  
  var mq = new MQ(config)
  var queue = new Queue(config)
  
  before(async function () {
    await mq.connect()
    var channel = await mq.createChannel()
    return queue.setChannel(channel)
  })
  
  after(async function () {
    return await mq.disconnect()
  })

  it("Should be able to send a message to a queue and receive it", async function () {
    try {
      var queueName = 'queueSendMessage';

      queue.on(queueName, function (data) {
        console.log('Message received', data)
        data.should.have.property('message', 'testing queues')
      })
      
      var listener = await queue.listen(queueName)

      await queue.send(queueName, {
        message: 'testing queues'
      })
    }
    catch (err) {
      console.log(err)
      should.not.exist(err)
    }
  })

  it("Should be able to send a message to a queue and receive a generic event", async function () {
    try {
      var queueName = 'genericEvent';

      queue.on('queueEventReceived', function (data) {
        // it can receive multiple events from other tests
        if (data.name === 'genericEvent') {
          console.log('Generic message received', data)
          data.should.have.property('name', 'genericEvent')
          data.should.have.property('type', 'queue')
          data.should.have.property('data')
          data.data.should.have.property('message', 'testing queues')
        }
      })
      
      var listener = await queue.listen(queueName)

      await queue.send(queueName, {
        message: 'testing queues'
      })
    }
    catch (err) {
      console.log(err)
      should.not.exist(err)
    }
  })

  it('Should be able to send two messages to two different queues and receive them', async function () {
    try {
      var events = new EventEmitter()
      var queueName1 = 'test__queueOne.abc'
      var queueName2 = 'test__queueTwo.abc'

      queue.on(queueName1, function (data) {
        console.log('on queue 1', data)
        data.should.have.property('message', 'Queue One')
      })

      queue.on(queueName2, function (data) {
        data.should.have.property('message', 'Queue Two')
      })

      var queues = ['test__queueOne.abc', 'test__queueTwo.abc']
      await queue.listen(queues)

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
