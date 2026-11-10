const { expect } = require('chai')
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
  const queue = new Queue()

  before(async function () {
    await mq.connect()
    const channel = await mq.createChannel()
    return queue.setChannel(channel)
  })

  after(async function () {
    // The before hook may have failed to connect (e.g. broker not ready):
    // only disconnect when there is something to disconnect from.
    if (mq.connection) {
      return await mq.disconnect()
    }
  })

  it('Should be able to send a message to a queue and receive it', async function () {
    try {
      const queueName = 'queueSendMessage'

      queue.on(queueName, function (data) {
        expect(data).to.have.property('message', 'testing queues')
      })

      const listener = await queue.listen(queueName)

      await queue.send(queueName, {
        message: 'testing queues',
      })
    } catch (err) {
      expect(err).to.not.exist
    }
  })

  it('Should be able to send a message to a queue and receive a generic event', async function () {
    try {
      const queueName = 'genericEvent'

      queue.on('queueEventReceived', function (data) {
        // it can receive multiple events from other tests
        if (data.name === 'genericEvent') {
          expect(data).to.have.property('name', 'genericEvent')
          expect(data).to.have.property('type', 'queue')
          expect(data).to.have.property('data')
          expect(data.data).to.have.property('message', 'testing queues')
        }
      })

      const listener = await queue.listen(queueName)

      await queue.send(queueName, {
        message: 'testing queues',
      })
    } catch (err) {
      expect(err).to.not.exist
    }
  })

  it('Should be able to send two messages to two different queues and receive them', async function () {
    try {
      const events = new EventEmitter()
      const queueName1 = 'test__queueOne.abc'
      const queueName2 = 'test__queueTwo.abc'

      queue.on(queueName1, function (data) {
        expect(data).to.have.property('message', 'Queue One')
      })

      queue.on(queueName2, function (data) {
        expect(data).to.have.property('message', 'Queue Two')
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
      expect(err).to.not.exist
    }
  })
})
