const { expect } = require('chai')
const MQ = require('../../index').MQ
const Queue = require('../../index').Queue
const EventEmitter = require('events')

describe('Queue Send', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mq1 = new MQ(config)
  const mq2 = new MQ(config)

  const queue = new Queue()
  const sender = new Queue()

  before(async function () {
    await mq1.connect()
    const channelConsumer = await mq1.createChannel()
    queue.setChannel(channelConsumer)

    await mq2.connect()
    const channelSender = await mq2.createChannel()
    sender.setChannel(channelSender)
    return
  })

  after(async function () {
    await mq1.disconnect()
    return await mq2.disconnect()
  })

  it('Should be able to send a message to a queue and receive it', async function () {
    try {
      const queueName = 'queueSendMessage'

      queue.once(queueName, function (data) {
        expect(data).to.have.property('message', 'testing queues')
      })

      const listener = await queue.listen(queueName)

      await sender.send(queueName, {
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

      await sender.send(queueName, {
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

      queue.once(queueName1, function (data) {
        expect(data).to.have.property('message', 'Queue One')
      })

      queue.once(queueName2, function (data) {
        expect(data).to.have.property('message', 'Queue Two')
      })

      const queues = ['test__queueOne.abc', 'test__queueTwo.abc']
      await queue.listen(queues)

      await sender.send(queueName1, {
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

describe('frameMax negotiation', function () {
  it('Should negotiate frameMax from the connection URL query', async function () {
    const mq = new MQ({
      exchange_name: 'rabbitmq_lib_test',
      url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
      connectMaxAttempts: 1,
      connectDelayMS: 100,
    })

    const connection = await mq.connect()
    // RabbitMQ 4.x rejects anything below 8192: if the URL-based frameMax
    // were not applied, the negotiated value would stay 4096 and this
    // assertion (and the connection itself) would fail. The negotiated
    // value lives on the internal connection object.
    expect(connection.connection.frameMax).to.be.at.least(8192)
    await mq.disconnect()
  })
})

describe('Queue listenManual', function () {
  this.timeout(20000)

  const config = {
    exchange_name: 'rabbitmq_lib_test',
    // RabbitMQ 4.x brokers reject amqplib's default frame_max (4096), the query
    // parameter negotiates a frame size the broker accepts
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/?frameMax=131072',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mqConsumer = new MQ(config)
  const mqSender = new MQ(config)

  const delay = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }

  const createQueuePair = async function () {
    const consumer = new Queue()
    const sender = new Queue()
    consumer.setChannel(await mqConsumer.createChannel())
    sender.setChannel(await mqSender.createChannel())
    return { consumer: consumer, sender: sender }
  }

  before(async function () {
    await mqConsumer.connect()
    await mqSender.connect()
    return
  })

  after(async function () {
    await mqConsumer.disconnect()
    return await mqSender.disconnect()
  })

  it('Should ack the message after the handler resolves and keep processing the queue', async function () {
    const pair = await createQueuePair()
    const consumer = pair.consumer
    const sender = pair.sender

    const queueName = 'manualAckTest'
    // queues are durable and survive on the shared broker between runs, start clean
    await consumer.channel.deleteQueue(queueName)

    const received = []
    await consumer.listenManual(queueName, async function (data, message) {
      received.push({
        message: data.message,
        redelivered: message.fields.redelivered,
      })
    })

    await sender.send(queueName, {
      message: 'first',
    })

    await sender.send(queueName, {
      message: 'second',
    })

    await delay(500)

    expect(received).to.have.lengthOf(2)
    expect(received[0]).to.have.property('message', 'first')
    expect(received[0]).to.have.property('redelivered', false)
    expect(received[1]).to.have.property('message', 'second')
    expect(received[1]).to.have.property('redelivered', false)
  })

  it('Should deliver messages in priority order when the queue has x-max-priority', async function () {
    const pair = await createQueuePair()
    const consumer = pair.consumer
    const sender = pair.sender

    const queueName = 'manualPriorityTest'
    const queueArguments = { 'x-max-priority': 10 }
    await consumer.channel.deleteQueue(queueName)

    // Queue.send asserts the queue with its own queueOptions, so the sender needs
    // the same x-max-priority argument to publish to this queue
    sender.queueOptions = { durable: true, arguments: queueArguments }

    // both messages are sent before the consumer starts so the broker dispatches
    // them in priority order, a running consumer would take the first message
    // regardless of its priority
    await sender.send(
      queueName,
      {
        message: 'low priority',
      },
      0,
      { priority: 1 },
    )

    await sender.send(
      queueName,
      {
        message: 'high priority',
      },
      0,
      { priority: 9 },
    )

    const order = []
    await consumer.listenManual(
      queueName,
      async function (data, message) {
        order.push(data.message)
      },
      { queueArguments: queueArguments },
    )

    await delay(500)

    expect(order).to.have.lengthOf(2)
    expect(order[0]).to.equal('high priority')
    expect(order[1]).to.equal('low priority')
  })

  it('Should deliver a message when sendOptions is null (default options apply)', async function () {
    const pair = await createQueuePair()
    const consumer = pair.consumer
    const sender = pair.sender

    const queueName = 'manualNullSendOptions'
    await consumer.channel.deleteQueue(queueName)

    // the sender re-asserts the queue on send: its options must match the
    // consumer's x-max-priority declaration or the broker 406s
    sender.queueOptions = {
      durable: true,
      arguments: { 'x-max-priority': 10 },
    }

    const received = []
    await consumer.listenManual(
      queueName,
      async function (data) {
        received.push(data.message)
      },
      { queueArguments: { 'x-max-priority': 10 } },
    )

    // explicit null for sendOptions must not crash - default options apply
    await sender.send(queueName, { message: 'null options' }, 0, null)
    await sender.send(queueName, { message: 'no options' })

    await new Promise(function (resolve) {
      setTimeout(resolve, 300)
    })

    expect(received).to.have.lengthOf(2)
    expect(received).to.deep.include('null options')
    expect(received).to.deep.include('no options')
  })

  it('Should contain acknowledgement failures when the channel closes mid-task', async function () {
    const pair = await createQueuePair()
    const consumer = pair.consumer
    const sender = pair.sender

    const queueName = 'manualClosedChannel'
    await consumer.channel.deleteQueue(queueName)

    let unhandledRejection = 'none'
    const onUnhandled = function (err) {
      unhandledRejection = err
    }
    process.on('unhandledRejection', onUnhandled)

    // the channel closes while the task runs: the ack that follows throws
    await consumer.listenManual(
      queueName,
      async function () {
        await consumer.channel.close()
      },
      { globalPrefetch: true },
    )

    await sender.send(queueName, { message: 'task during channel close' })
    await new Promise(function (resolve) {
      setTimeout(resolve, 300)
    })

    process.removeListener('unhandledRejection', onUnhandled)
    expect(unhandledRejection).to.equal('none')
  })

  it('Should drop a failed task by default (onFailure ack) and keep processing the queue', async function () {
    const pair = await createQueuePair()
    const consumer = pair.consumer
    const sender = pair.sender

    const queueName = 'manualDropTest'
    await consumer.channel.deleteQueue(queueName)

    const received = []
    const failures = []
    consumer.on('failed', function (info) {
      failures.push(info)
    })

    await consumer.listenManual(queueName, async function (data, message) {
      if (data.message === 'boom') {
        throw new Error('handler failed on purpose')
      }
      received.push(data.message)
    })

    await sender.send(queueName, {
      message: 'boom',
    })

    // with a channel-wide prefetch of 1 the second message is only delivered
    // if the failed one was acked
    await sender.send(queueName, {
      message: 'after failure',
    })

    await delay(500)

    expect(received).to.have.lengthOf(1)
    expect(received[0]).to.equal('after failure')
    expect(failures).to.have.lengthOf(1)
    expect(failures[0]).to.have.property('queueName', queueName)
    expect(failures[0].error.message).to.equal('handler failed on purpose')
  })

  it('Should requeue a failed task once when onFailure is requeue and succeed on the redelivered attempt', async function () {
    const pair = await createQueuePair()
    const consumer = pair.consumer
    const sender = pair.sender

    const queueName = 'manualRequeueTest'
    await consumer.channel.deleteQueue(queueName)

    const attempts = []
    await consumer.listenManual(
      queueName,
      async function (data, message) {
        attempts.push({
          message: data.message,
          redelivered: message.fields.redelivered,
        })
        if (!message.fields.redelivered) {
          throw new Error('failing on purpose on the first attempt')
        }
      },
      { onFailure: 'requeue' },
    )

    await sender.send(queueName, {
      message: 'requeue me',
    })

    await delay(500)

    expect(attempts).to.have.lengthOf(2)
    expect(attempts[0]).to.have.property('message', 'requeue me')
    expect(attempts[0]).to.have.property('redelivered', false)
    expect(attempts[1]).to.have.property('message', 'requeue me')
    expect(attempts[1]).to.have.property('redelivered', true)
  })

  it('Should respect a prefetch of one per queue across two queues with globalPrefetch true', async function () {
    const pair = await createQueuePair()
    const consumer = pair.consumer
    const sender = pair.sender

    const queueName1 = 'manualPrefetchQ1'
    const queueName2 = 'manualPrefetchQ2'
    await consumer.channel.deleteQueue(queueName1)
    await consumer.channel.deleteQueue(queueName2)

    const activePerQueue = {}
    const maxPerQueue = {}
    maxPerQueue[queueName1] = 0
    maxPerQueue[queueName2] = 0
    let processed = 0

    const slowHandler = async function (data, message) {
      const queueName = message.fields.routingKey
      activePerQueue[queueName] = (activePerQueue[queueName] || 0) + 1
      if (activePerQueue[queueName] > maxPerQueue[queueName]) {
        maxPerQueue[queueName] = activePerQueue[queueName]
      }
      await delay(200)
      activePerQueue[queueName]--
      processed++
    }

    await consumer.listenManual([queueName1, queueName2], slowHandler, {
      prefetch: 1,
      globalPrefetch: true,
    })

    await sender.send(queueName1, {
      message: 'q1 first',
    })

    await sender.send(queueName1, {
      message: 'q1 second',
    })

    await sender.send(queueName2, {
      message: 'q2 first',
    })

    await sender.send(queueName2, {
      message: 'q2 second',
    })

    await delay(2000)

    // RabbitMQ 4.x applies the prefetch count separately to each consumer
    // (channel-wide global qos was removed in 4.0), so each queue processes
    // one message at a time; on RabbitMQ 3.x the same setup also shares the
    // limit across both queues, so at most one message is in flight overall
    expect(processed).to.equal(4)
    expect(maxPerQueue[queueName1]).to.equal(1)
    expect(maxPerQueue[queueName2]).to.equal(1)
  })
})

describe('Queue listen failure containment', function () {
  this.timeout(20000)

  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/?frameMax=131072',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mqConsumer = new MQ(config)

  const delay = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }

  before(async function () {
    await mqConsumer.connect()
    return
  })

  after(async function () {
    return await mqConsumer.disconnect()
  })

  it('Should emit failed and ack a non-JSON message instead of throwing out of the consumer', async function () {
    const consumer = new Queue()
    const channel = await mqConsumer.createChannel()
    consumer.setChannel(channel)

    const queueName = 'listenNonJsonTest'
    // queues are durable and survive on the shared broker between runs, start clean
    await channel.deleteQueue(queueName)

    let unhandledRejection = 'none'
    const onUnhandled = function (err) {
      unhandledRejection = err
    }
    process.on('unhandledRejection', onUnhandled)

    const failures = []
    consumer.on('failed', function (info) {
      failures.push(info)
    })

    const received = []
    consumer.on('queueEventReceived', function (info) {
      if (info.name === queueName) received.push(info.data.message)
    })

    await consumer.listen([queueName])

    // raw, non-JSON content published straight onto the channel: JSON.parse
    // inside the consumer throws
    channel.sendToQueue(queueName, Buffer.from('this is not json'))

    await delay(300)

    expect(failures).to.have.lengthOf(1)
    expect(failures[0]).to.have.property('queueName', queueName)
    expect(failures[0]).to.have.property('error')
    expect(failures[0].error).to.be.an.instanceOf(Error)

    // the channel is still alive and the failed message was acked: a valid
    // message published afterwards is processed instead of being stuck behind
    // an unacked one
    channel.sendToQueue(
      queueName,
      Buffer.from(JSON.stringify({ message: 'after failure' })),
    )

    await delay(300)

    process.removeListener('unhandledRejection', onUnhandled)
    expect(unhandledRejection).to.equal('none')
    expect(received).to.eql(['after failure'])
  })
})

describe('Queue listener containment', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mq1 = new MQ(config)
  const mq2 = new MQ(config)

  const queue = new Queue()
  const sender = new Queue()
  let failures = []
  let processed = []
  const queueName = 'listenerContainmentTest'
  const eventName = 'listenerContainmentTest'

  before(async function () {
    failures = []
    processed = []
    await mq1.connect()
    queue.setChannel(await mq1.createChannel())
    await mq2.connect()
    sender.setChannel(await mq2.createChannel())

    queue.on(eventName, function () {
      throw new Error('listener boom')
    })
    queue.on('failed', (failure) => failures.push(failure))
    await queue.listen([queueName])
  })

  after(async function () {
    await queue.channel.deleteQueue(queueName)
    await mq1.disconnect()
    await mq2.disconnect()
  })

  it('Should contain a throwing listener: failed emitted, message consumed, no crash', async function () {
    await sender.send(queueName, { name: 'boom message' })
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(failures).to.have.lengthOf(1)
    expect(failures[0]).to.have.property('queueName', queueName)
    expect(failures[0].error).to.be.an('error')
    expect(failures[0].error.message).to.match(/listener boom/)
  })

  it('Should keep consuming after a throwing listener', async function () {
    queue.removeAllListeners(eventName)
    queue.on(eventName, (data) => processed.push(data))
    await sender.send(queueName, { name: 'healthy message' })
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(processed).to.have.lengthOf(1)
    expect(processed[0]).to.have.property('name', 'healthy message')
  })
})

describe('Queue missing-channel guards and delayed exchange (stub channel)', function () {
  const MISSING_CHANNEL_MESSAGE = /A channel is needed/

  function createRecordingChannel () {
    const calls = []
    const record = (method, args) => calls.push({ method, args })
    const channel = {
      calls,
      assertQueue: async (...args) => {
        record('assertQueue', args)
        return {}
      },
      assertExchange: async (...args) => {
        record('assertExchange', args)
        return {}
      },
      bindQueue: async (...args) => {
        record('bindQueue', args)
        return {}
      },
      prefetch: async (...args) => {
        record('prefetch', args)
      },
      consume: async (...args) => {
        record('consume', args)
        return { consumerTag: 'stub' }
      },
      publish: (...args) => {
        record('publish', args)
        return true
      },
      ack: (...args) => record('ack', args),
      nack: (...args) => record('nack', args),
      callsOf (method) {
        return calls.filter((call) => call.method === method).map((call) => call.args)
      },
    }
    return channel
  }

  describe('missing channel guards', function () {
    let queue
    let missingChannelEvents

    beforeEach(function () {
      queue = new Queue()
      missingChannelEvents = 0
      queue.on('missingChannelOnQueue', () => { missingChannelEvents += 1 })
    })

    it('Should throw a clear error and emit the missing-channel event when listen() is called without a channel', async function () {
      let error
      try {
        await queue.listen('someQueue')
      }
      catch (err) {
        error = err
      }

      expect(error).to.be.an('error')
      expect(error.message).to.match(MISSING_CHANNEL_MESSAGE)
      expect(missingChannelEvents).to.equal(1)
    })

    it('Should throw a clear error and emit the missing-channel event when listenManual() is called without a channel', async function () {
      let error
      try {
        await queue.listenManual('someQueue', async () => {})
      }
      catch (err) {
        error = err
      }

      expect(error).to.be.an('error')
      expect(error.message).to.match(MISSING_CHANNEL_MESSAGE)
      expect(missingChannelEvents).to.equal(1)
    })

    it('Should throw a clear error and emit the missing-channel event when send() is called without a channel', async function () {
      let error
      try {
        await queue.send('someQueue', { hello: 'world' })
      }
      catch (err) {
        error = err
      }

      expect(error).to.be.an('error')
      expect(error.message).to.match(MISSING_CHANNEL_MESSAGE)
      expect(missingChannelEvents).to.equal(0)
    })
  })

  describe('delayed exchange', function () {
    const DELAYED_EXCHANGE_NAME = 'lib.test.delayed'
    const QUEUE_NAME = 'lib.test.delayed.queue'

    it('Should assert and bind the delayed exchange when listen() is called with isDelayed', async function () {
      const channel = createRecordingChannel()
      const queue = new Queue(DELAYED_EXCHANGE_NAME)
      queue.setChannel(channel)

      await queue.listen(QUEUE_NAME, { isDelayed: true })

      const assertExchangeCalls = channel.callsOf('assertExchange')
      expect(assertExchangeCalls).to.have.lengthOf(1)
      expect(assertExchangeCalls[0][0]).to.equal(DELAYED_EXCHANGE_NAME)
      expect(assertExchangeCalls[0][1]).to.equal('x-delayed-message')
      expect(assertExchangeCalls[0][2]).to.deep.equal({
        arguments: { 'x-delayed-type': 'direct' },
      })

      const bindQueueCalls = channel.callsOf('bindQueue')
      expect(bindQueueCalls).to.have.lengthOf(1)
      expect(bindQueueCalls[0]).to.deep.equal([QUEUE_NAME, DELAYED_EXCHANGE_NAME, QUEUE_NAME])

      expect(queue.isDelayed).to.equal(true)
      expect(channel.callsOf('assertQueue')[0][0]).to.equal(QUEUE_NAME)
      expect(channel.callsOf('consume')[0][0]).to.equal(QUEUE_NAME)
    })

    it('Should publish through the delayed exchange with an x-delay header when send() is given a delay', async function () {
      const channel = createRecordingChannel()
      const queue = new Queue(DELAYED_EXCHANGE_NAME)
      queue.setChannel(channel)

      const result = await queue.send(QUEUE_NAME, { hello: 'world' }, 5000)

      expect(result).to.equal(true)

      const assertExchangeCalls = channel.callsOf('assertExchange')
      expect(assertExchangeCalls).to.have.lengthOf(1)
      expect(assertExchangeCalls[0][0]).to.equal(DELAYED_EXCHANGE_NAME)
      expect(assertExchangeCalls[0][1]).to.equal('x-delayed-message')

      const bindQueueCalls = channel.callsOf('bindQueue')
      expect(bindQueueCalls).to.have.lengthOf(1)
      expect(bindQueueCalls[0]).to.deep.equal([QUEUE_NAME, DELAYED_EXCHANGE_NAME, QUEUE_NAME])

      const publishCalls = channel.callsOf('publish')
      expect(publishCalls).to.have.lengthOf(1)
      expect(publishCalls[0][0]).to.equal(DELAYED_EXCHANGE_NAME)
      expect(publishCalls[0][1]).to.equal(QUEUE_NAME)
      expect(publishCalls[0][3]).to.deep.equal({
        persistent: true,
        headers: { 'x-delay': 5000 },
      })
    })
  })
})

describe('Queue listenManual failure containment', function () {
  this.timeout(20000)

  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/?frameMax=131072',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mqConsumer = new MQ(config)

  const delay = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }

  before(async function () {
    await mqConsumer.connect()
    return
  })

  after(async function () {
    return await mqConsumer.disconnect()
  })

  it('Should emit failed, ack a non-JSON message and keep consuming when listenManual receives a non-JSON payload', async function () {
    const consumer = new Queue()
    const channel = await mqConsumer.createChannel()
    consumer.setChannel(channel)

    const queueName = 'manualNonJsonTest'
    // queues are durable and survive on the shared broker between runs, start clean
    await channel.deleteQueue(queueName)

    let unhandledRejection = 'none'
    const onUnhandled = function (err) {
      unhandledRejection = err
    }
    process.on('unhandledRejection', onUnhandled)

    const failures = []
    consumer.on('failed', function (info) {
      failures.push(info)
    })

    const received = []
    await consumer.listenManual(queueName, async function (data) {
      received.push(data.message)
    })

    // raw, non-JSON content published straight onto the channel: JSON.parse
    // inside the consumer throws
    channel.sendToQueue(queueName, Buffer.from('this is not json'))

    await delay(300)

    expect(failures).to.have.lengthOf(1)
    expect(failures[0]).to.have.property('queueName', queueName)
    expect(failures[0]).to.have.property('error')
    expect(failures[0].error).to.be.an.instanceOf(Error)

    // the failed message was acked: a valid message published afterwards is
    // processed instead of being stuck behind an unacked one
    channel.sendToQueue(
      queueName,
      Buffer.from(JSON.stringify({ message: 'after failure' })),
    )

    await delay(300)

    process.removeListener('unhandledRejection', onUnhandled)
    expect(unhandledRejection).to.equal('none')
    expect(received).to.eql(['after failure'])
  })

  it('Should contain an ack failure and emit failed when the channel closes while a listen() listener runs', async function () {
    const consumer = new Queue()
    const sender = new Queue()
    const consumerChannel = await mqConsumer.createChannel()
    consumer.setChannel(consumerChannel)
    sender.setChannel(await mqConsumer.createChannel())

    const queueName = 'listenClosedChannelAck'
    await consumerChannel.deleteQueue(queueName)

    let unhandledRejection = 'none'
    const onUnhandled = function (err) {
      unhandledRejection = err
    }
    process.on('unhandledRejection', onUnhandled)

    const failures = []
    consumer.on('failed', function (info) {
      failures.push(info)
    })

    await consumer.listen([queueName])

    // the channel closes while the listener runs: the ack that follows throws
    consumer.on(queueName, async function () {
      await consumer.channel.close()
    })

    await sender.send(queueName, { message: 'message during channel close' })
    await delay(300)

    process.removeListener('unhandledRejection', onUnhandled)
    expect(unhandledRejection).to.equal('none')
    // Both failures are ack failures: closing the channel inside the async
    // listener makes the ack in the try block throw ('Channel closing'), and
    // the ack inside the catch throws the same way. emit() does not await
    // listeners, so the async listener itself cannot produce a failed event.
    expect(failures).to.have.lengthOf(2)
    expect(failures[0]).to.have.property('queueName', queueName)
    expect(failures[0]).to.have.property('error')
    expect(failures[0].error).to.be.an.instanceOf(Error)
    expect(failures[1]).to.have.property('queueName', queueName)
    expect(failures[1]).to.have.property('error')
    expect(failures[1].error).to.be.an.instanceOf(Error)
  })
})

describe('Queue null-delivery guards', function () {
  this.timeout(20000)

  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/?frameMax=131072',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mq = new MQ(config)

  const delay = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }

  before(async function () {
    await mq.connect()
    return
  })

  after(async function () {
    return await mq.disconnect()
  })

  it('Should ignore a null delivery in listen() when the consumer is cancelled', async function () {
    const consumer = new Queue()
    const channel = await mq.createChannel()
    consumer.setChannel(channel)

    const queueName = 'nullDeliveryListen'
    // queues are durable and survive on the shared broker between runs, start clean
    await channel.deleteQueue(queueName)

    let unhandledRejection = 'none'
    const onUnhandled = function (err) {
      unhandledRejection = err
    }
    process.on('unhandledRejection', onUnhandled)

    const failures = []
    consumer.on('failed', function (info) {
      failures.push(info)
    })

    const received = []
    consumer.on('queueEventReceived', function (info) {
      if (info.name === queueName) received.push(info.data.message)
    })

    await consumer.listen([queueName])

    // deleting the queue from a separate channel cancels the consumer: amqplib
    // then invokes the consumer callback with null, which must be ignored
    // instead of surfacing a spurious failed event
    const adminChannel = await mq.createChannel()
    await adminChannel.deleteQueue(queueName)

    await delay(500)

    process.removeListener('unhandledRejection', onUnhandled)
    expect(unhandledRejection).to.equal('none')
    expect(failures).to.have.lengthOf(0)
    expect(received).to.have.lengthOf(0)
  })

  it('Should ignore a null delivery in listenManual() when the consumer is cancelled', async function () {
    const consumer = new Queue()
    const channel = await mq.createChannel()
    consumer.setChannel(channel)

    const queueName = 'nullDeliveryListenManual'
    await channel.deleteQueue(queueName)

    let unhandledRejection = 'none'
    const onUnhandled = function (err) {
      unhandledRejection = err
    }
    process.on('unhandledRejection', onUnhandled)

    const failures = []
    consumer.on('failed', function (info) {
      failures.push(info)
    })

    const received = []
    await consumer.listenManual(queueName, async function (data) {
      received.push(data.message)
    })

    // same cancellation path as listen(): the existing guard must swallow the
    // null delivery without emitting failed
    const adminChannel = await mq.createChannel()
    await adminChannel.deleteQueue(queueName)

    await delay(500)

    process.removeListener('unhandledRejection', onUnhandled)
    expect(unhandledRejection).to.equal('none')
    expect(failures).to.have.lengthOf(0)
    expect(received).to.have.lengthOf(0)
  })
})
