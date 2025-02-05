var should = require('should')
var MQ = require('../../index').MQ
var Queue = require('../../index').Queue
var EventEmitter = require('events')

describe('Queue Send', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }
  
  var mq1 = new MQ(config)
  var mq2 = new MQ(config)

  var queue = new Queue()
  var sender = new Queue()
  
  before(async function () {
    await mq1.connect()
    var channelConsumer = await mq1.createChannel()
    queue.setChannel(channelConsumer)

    await mq2.connect()
    var channelSender = await mq2.createChannel()
    sender.setChannel(channelSender)
    return
  })
  
  after(async function () {
    await mq1.disconnect()
    return await mq2.disconnect()
  })

  it("Should be able to send a message to a queue and receive it", async function () {
    try {
      var queueName = 'queueSendMessage';

      queue.once(queueName, function (data) {
        console.log('Message received', data)
        data.should.have.property('message', 'testing queues')
      })
      
      var listener = await queue.listen(queueName)
      
      await sender.send(queueName, {
        message: 'testing queues'
      })
    }
    catch (err) {
      console.log('Error', err)
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
      
      await sender.send(queueName, {
        message: 'testing queues'
      })
    }
    catch (err) {
      console.log('Error', err)
      should.not.exist(err)
    }
  })

  it('Should be able to send two messages to two different queues and receive them', async function () {
    try {
      var events = new EventEmitter()
      var queueName1 = 'test__queueOne.abc'
      var queueName2 = 'test__queueTwo.abc'

      queue.once(queueName1, function (data) {
        console.log('on queue 1', data)
        data.should.have.property('message', 'Queue One')
      })

      queue.once(queueName2, function (data) {
        console.log('on queue 2', data)
        data.should.have.property('message', 'Queue Two')
      })

      var queues = ['test__queueOne.abc', 'test__queueTwo.abc']
      await queue.listen(queues)

      await sender.send(queueName1, {
        message: 'Queue One'
      })

      await queue.send(queueName2, {
        message: 'Queue Two'
      })
    }
    catch (err) {
      console.log('Error', err)
      should.not.exist(err)
    }
  })
})
