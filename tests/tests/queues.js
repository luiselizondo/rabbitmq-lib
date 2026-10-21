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

describe('Queue listenManual', function () {
  this.timeout(20000)

  var config = {
    exchange_name: 'rabbitmq_lib_test',
    // RabbitMQ 4.x brokers reject amqplib's default frame_max (4096), the query
    // parameter negotiates a frame size the broker accepts
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/?frameMax=131072',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  var mqConsumer = new MQ(config)
  var mqSender = new MQ(config)

  var delay = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }

  var createQueuePair = async function () {
    var consumer = new Queue()
    var sender = new Queue()
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
    var pair = await createQueuePair()
    var consumer = pair.consumer
    var sender = pair.sender

    var queueName = 'manualAckTest'
    // queues are durable and survive on the shared broker between runs, start clean
    await consumer.channel.deleteQueue(queueName)

    var received = []
    await consumer.listenManual(queueName, async function (data, message) {
      received.push({
        message: data.message,
        redelivered: message.fields.redelivered
      })
    })

    await sender.send(queueName, {
      message: 'first'
    })

    await sender.send(queueName, {
      message: 'second'
    })

    await delay(500)

    received.length.should.equal(2)
    received[0].should.have.property('message', 'first')
    received[0].should.have.property('redelivered', false)
    received[1].should.have.property('message', 'second')
    received[1].should.have.property('redelivered', false)
  })

  it('Should deliver messages in priority order when the queue has x-max-priority', async function () {
    var pair = await createQueuePair()
    var consumer = pair.consumer
    var sender = pair.sender

    var queueName = 'manualPriorityTest'
    var queueArguments = { 'x-max-priority': 10 }
    await consumer.channel.deleteQueue(queueName)

    // Queue.send asserts the queue with its own queueOptions, so the sender needs
    // the same x-max-priority argument to publish to this queue
    sender.queueOptions = { durable: true, arguments: queueArguments }

    // both messages are sent before the consumer starts so the broker dispatches
    // them in priority order, a running consumer would take the first message
    // regardless of its priority
    await sender.send(queueName, {
      message: 'low priority'
    }, 0, { priority: 1 })

    await sender.send(queueName, {
      message: 'high priority'
    }, 0, { priority: 9 })

    var order = []
    await consumer.listenManual(queueName, async function (data, message) {
      order.push(data.message)
    }, { queueArguments: queueArguments })

    await delay(500)

    order.length.should.equal(2)
    order[0].should.equal('high priority')
    order[1].should.equal('low priority')
  })

  it('Should deliver a message when sendOptions is null (default options apply)', async function () {
    var pair = await createQueuePair()
    var consumer = pair.consumer
    var sender = pair.sender

    var queueName = 'manualNullSendOptions'
    await consumer.channel.deleteQueue(queueName)

    // the sender re-asserts the queue on send: its options must match the
    // consumer's x-max-priority declaration or the broker 406s
    sender.queueOptions = { durable: true, arguments: { 'x-max-priority': 10 } }

    var received = []
    await consumer.listenManual(queueName, async function (data) {
      received.push(data.message)
    }, { queueArguments: { 'x-max-priority': 10 } })

    // explicit null for sendOptions must not crash - default options apply
    await sender.send(queueName, { message: 'null options' }, 0, null)
    await sender.send(queueName, { message: 'no options' })

    await new Promise(function (resolve) { setTimeout(resolve, 300) })

    received.should.have.lengthOf(2)
    received.should.containEql('null options')
    received.should.containEql('no options')
  });

  it('Should drop a failed task by default (onFailure ack) and keep processing the queue', async function () {
    var pair = await createQueuePair()
    var consumer = pair.consumer
    var sender = pair.sender

    var queueName = 'manualDropTest'
    await consumer.channel.deleteQueue(queueName)

    var received = []
    var failures = []
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
      message: 'boom'
    })

    // with a channel-wide prefetch of 1 the second message is only delivered
    // if the failed one was acked
    await sender.send(queueName, {
      message: 'after failure'
    })

    await delay(500)

    received.length.should.equal(1)
    received[0].should.equal('after failure')
    failures.length.should.equal(1)
    failures[0].should.have.property('queueName', queueName)
    failures[0].error.message.should.equal('handler failed on purpose')
  })

  it('Should requeue a failed task once when onFailure is requeue and succeed on the redelivered attempt', async function () {
    var pair = await createQueuePair()
    var consumer = pair.consumer
    var sender = pair.sender

    var queueName = 'manualRequeueTest'
    await consumer.channel.deleteQueue(queueName)

    var attempts = []
    await consumer.listenManual(queueName, async function (data, message) {
      attempts.push({
        message: data.message,
        redelivered: message.fields.redelivered
      })
      if (!message.fields.redelivered) {
        throw new Error('failing on purpose on the first attempt')
      }
    }, { onFailure: 'requeue' })

    await sender.send(queueName, {
      message: 'requeue me'
    })

    await delay(500)

    attempts.length.should.equal(2)
    attempts[0].should.have.property('message', 'requeue me')
    attempts[0].should.have.property('redelivered', false)
    attempts[1].should.have.property('message', 'requeue me')
    attempts[1].should.have.property('redelivered', true)
  })

  it('Should respect a prefetch of one per queue across two queues with globalPrefetch true', async function () {
    var pair = await createQueuePair()
    var consumer = pair.consumer
    var sender = pair.sender

    var queueName1 = 'manualPrefetchQ1'
    var queueName2 = 'manualPrefetchQ2'
    await consumer.channel.deleteQueue(queueName1)
    await consumer.channel.deleteQueue(queueName2)

    var activePerQueue = {}
    var maxPerQueue = {}
    maxPerQueue[queueName1] = 0
    maxPerQueue[queueName2] = 0
    var processed = 0

    var slowHandler = async function (data, message) {
      var queueName = message.fields.routingKey
      activePerQueue[queueName] = (activePerQueue[queueName] || 0) + 1
      if (activePerQueue[queueName] > maxPerQueue[queueName]) {
        maxPerQueue[queueName] = activePerQueue[queueName]
      }
      await delay(200)
      activePerQueue[queueName]--
      processed++
    }

    await consumer.listenManual([queueName1, queueName2], slowHandler, { prefetch: 1, globalPrefetch: true })

    await sender.send(queueName1, {
      message: 'q1 first'
    })

    await sender.send(queueName1, {
      message: 'q1 second'
    })

    await sender.send(queueName2, {
      message: 'q2 first'
    })

    await sender.send(queueName2, {
      message: 'q2 second'
    })

    await delay(2000)

    // RabbitMQ 4.x applies the prefetch count separately to each consumer
    // (channel-wide global qos was removed in 4.0), so each queue processes
    // one message at a time; on RabbitMQ 3.x the same setup also shares the
    // limit across both queues, so at most one message is in flight overall
    processed.should.equal(4)
    maxPerQueue[queueName1].should.equal(1)
    maxPerQueue[queueName2].should.equal(1)
  })
})
