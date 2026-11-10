const should = require('should')
const Queue = require('../../index').Queue
const MQ = require('../../index').MQ
const EventEmitter = require('events')

describe('Queue Send', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mq = new MQ(config)
  const queue = new Queue(config)

  before(async function () {
    await mq.connect()
    const channel = await mq.createChannel()
    return queue.setChannel(channel)
  })

  after(async function () {
    return await mq.disconnect()
  })

  it('Should be able to send a message to a queue and receive it', async function () {
    try {
      const queueName = 'queueSendMessage'

      queue.on(queueName, function (data) {
        data.should.have.property('message', 'testing queues')
      })

      const listener = await queue.listen(queueName)

      await queue.send(queueName, {
        message: 'testing queues',
      })
    } catch (err) {
      should.not.exist(err)
    }
  })

  it('Should be able to send a message to a queue and receive a generic event', async function () {
    try {
      const queueName = 'genericEvent'

      queue.on('queueEventReceived', function (data) {
        // it can receive multiple events from other tests
        if (data.name === 'genericEvent') {
          data.should.have.property('name', 'genericEvent')
          data.should.have.property('type', 'queue')
          data.should.have.property('data')
          data.data.should.have.property('message', 'testing queues')
        }
      })

      const listener = await queue.listen(queueName)

      await queue.send(queueName, {
        message: 'testing queues',
      })
    } catch (err) {
      should.not.exist(err)
    }
  })

  it('Should be able to send two messages to two different queues and receive them', async function () {
    try {
      const events = new EventEmitter()
      const queueName1 = 'test__queueOne.abc'
      const queueName2 = 'test__queueTwo.abc'

      queue.on(queueName1, function (data) {
        data.should.have.property('message', 'Queue One')
      })

      queue.on(queueName2, function (data) {
        data.should.have.property('message', 'Queue Two')
      })

      const queues = ['test__queueOne.abc', 'test__queueTwo.abc']
      await queue.listen(queues)

      await queue.send(queueName1, {
        message: 'Queue One',
      })

      await queue.send(queueName2, {
        message: 'Queue Two',
      })
    } catch (err) {
      should.not.exist(err)
    }
  })
})
