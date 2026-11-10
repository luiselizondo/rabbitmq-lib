const { expect } = require('chai')
const MQ = require('../../index').MQ
const Topic = require('../../index').Topic

describe('Topics', function () {
  const config = {
    exchangeName: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mq1 = new MQ(config)
  const mq2 = new MQ(config)
  const topic = new Topic(config.exchangeName)
  const sender = new Topic(config.exchangeName)

  before(async function () {
    await mq1.connect()
    const channelConsumer = await mq1.createChannel()
    topic.setChannel(channelConsumer)

    await mq2.connect()
    const channelSender = await mq2.createChannel()
    sender.setChannel(channelSender)
    return
  })

  after(async function () {
    await mq1.disconnect()
    return await mq2.disconnect()
  })

  it('Should be able to publish an object with a string to a topic and listen to it', async function () {
    try {
      const eventName = 'someEvent'

      topic.once(eventName, function (data) {
        expect(data.message).to.equal('The water is cold')
      })

      topic.once('topicEventReceived', function (data) {
        expect(data).to.have.property('name', 'someEvent')
        expect(data).to.have.property('type', 'topic')
        expect(data).to.have.property('data')
        expect(data.data).to.have.property('message', 'The water is cold')
      })

      await topic.listen(eventName)

      await sender.publish(eventName, {
        message: 'The water is cold',
      })
    } catch (err) {
      expect(err).to.not.exist
    }
  })

  it('Should be able to publish a string to a topic and listen to the general event', async function () {
    try {
      const eventName = 'someEvent1'

      topic.once('someEvent1', function (data) {
        expect(data).to.have.property('message', 'The water maybe is cold')
      })

      await topic.listen(eventName)

      await sender.publish(eventName, {
        message: 'The water maybe is cold',
      })
    } catch (err) {
      expect(err).to.not.exist
    }
  })

  it('Should be able to publish an object to multiple topics and listen to them', async function () {
    const eventName = 'someDataEvent'
    const eventName1 = 'someOtherDataEvent'

    topic.once(eventName, function (data) {
      expect(data).to.have.property('message', 'The water is cold')
      expect(data).to.have.property('accountId', '123')
      expect(data).to.have.property('tid')
    })

    topic.once(eventName1, function (data) {
      expect(data).to.have.property('message', 'The water is not cold')
      expect(data).to.have.property('accountId', '234')
      expect(data).to.have.property('tid')
    })

    const events = [eventName, eventName1]
    await topic.listen(events)

    await sender.publish(eventName, {
      message: 'The water is cold',
      accountId: '123',
    })

    await sender.publish(eventName1, {
      message: 'The water is not cold',
      accountId: '234',
    })
  })

  it('should not mutate the caller message when publishing (flag 3)', async function () {
    const eventName = 'noMutationEvent'
    const msg = { a: 1 }

    const received = new Promise(function (resolve) {
      topic.once(eventName, function (data) {
        resolve(data)
      })
    })

    const sentPayload = new Promise(function (resolve) {
      sender.once('sent', function (payload) {
        resolve(payload)
      })
    })

    await topic.listen(eventName)
    await sender.publish(eventName, msg)

    expect(msg).to.deep.equal({ a: 1 })
    expect(msg.tid).to.not.exist

    const data = await received
    expect(data).to.have.property('a', 1)
    expect(data.tid).to.be.a('string')

    const payload = await sentPayload
    expect(payload).to.have.property('type', 'topic')
    expect(payload).to.have.property('eventName', eventName)
    expect(payload.message).to.have.property('a', 1)
    expect(payload.message.tid).to.be.a('string')
    expect(payload.message).to.not.equal(msg)
  })

  it('should contain non-JSON payloads and emit failed (flag 15)', async function () {
    const eventName = 'brokenPayloadEvent'
    const unhandled = []
    const onUnhandled = function (err) {
      unhandled.push(err)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      await topic.listen(eventName)

      const failedPayload = new Promise(function (resolve) {
        topic.once('failed', function (payload) {
          resolve(payload)
        })
      })

      const channel = sender.channel
      await channel.assertExchange(sender.EXCHANGE_NAME, 'topic', {
        durable: false,
      })
      channel.publish(
        sender.EXCHANGE_NAME,
        eventName,
        Buffer.from('not-json{'),
        { noAck: true },
      )

      const payload = await failedPayload
      expect(payload).to.have.property('eventName', eventName)
      expect(payload).to.have.property('error')
      expect(payload.error).to.be.an.instanceOf(Error)

      // give any escaped rejection a chance to surface
      await wait(500)
      expect(unhandled).to.have.lengthOf(0)
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
  })
})

function wait (time) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      return resolve()
    }, time)
  })
}

describe('Topic listener containment', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mq1 = new MQ(config)
  const mq2 = new MQ(config)

  const listener = new Topic('listenerContainmentTopic')
  const publisher = new Topic('listenerContainmentTopic')
  let failures = []
  let received = []
  const eventName = 'listenerContainmentEvent'

  before(async function () {
    failures = []
    received = []
    await mq1.connect()
    listener.setChannel(await mq1.createChannel())
    await mq2.connect()
    publisher.setChannel(await mq2.createChannel())

    listener.on(eventName, function () {
      throw new Error('topic listener boom')
    })
    listener.on('failed', (failure) => failures.push(failure))
    await listener.listen([eventName])
  })

  after(async function () {
    await mq1.disconnect()
    await mq2.disconnect()
  })

  it('Should contain a throwing listener: failed emitted, consumer alive', async function () {
    await publisher.publish(eventName, { name: 'boom message' })
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(failures.length).to.equal(1)
    expect(failures[0]).to.have.property('eventName', eventName)
    expect(failures[0].error).to.be.an('error')
    expect(failures[0].error.message).to.match(/topic listener boom/)
  })

  it('Should keep consuming after a throwing listener', async function () {
    listener.removeAllListeners(eventName)
    listener.on(eventName, (data) => received.push(data))
    await publisher.publish(eventName, { name: 'healthy message' })
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(received.length).to.equal(1)
    expect(received[0]).to.have.property('name', 'healthy message')
  })
})
