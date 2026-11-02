const should = require('should')
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

  it("Should be able to publish an object with a string to a topic and listen to it", async function () {
    try {
      var eventName = 'someEvent';

      topic.once(eventName, function (data) {
        console.log('topic received', data)
        data.message.should.equal('The water is cold')
      })

      topic.once('topicEventReceived', function (data) {
        console.log('general topic received', data)
        data.should.have.property('name', 'someEvent')
        data.should.have.property('type', 'topic')
        data.should.have.property('data')
        data.data.should.have.property('message', 'The water is cold')
      })

      await topic.listen(eventName)

      await sender.publish(eventName, {
        message: 'The water is cold'
      })
    }
    catch (err) {
      console.log('Error', err)
      should.not.exist(err)
    }
  })

  it("Should be able to publish a string to a topic and listen to the general event", async function () {
    try {
      var eventName = 'someEvent1';

      topic.once('someEvent1', function (data) {
        console.log('someEvent1 received', data)
        data.should.have.property('message', 'The water maybe is cold')
      })

      await topic.listen(eventName)

      await sender.publish(eventName, {
        message: 'The water maybe is cold'
      })
    }
    catch (err) {
      console.log('Error', err)
      should.not.exist(err)
    }
  })

  it("Should be able to publish an object to multiple topics and listen to them", async function () {
    try {
      var eventName = 'someDataEvent';
      var eventName1 = 'someOtherDataEvent';

      topic.once(eventName, function (data) {
        console.log('First event', data)
        data.should.have.property('message', 'The water is cold')
        data.should.have.property('accountId', '123')
        data.should.have.property('tid')
      })

      topic.once(eventName1, function (data) {
        console.log('Second event', data)
        data.should.have.property('message', 'The water is not cold')
        data.should.have.property('accountId', '234')
        data.should.have.property('tid')
      })

      var events = [eventName, eventName1]
      await topic.listen(events)

      await sender.publish(eventName, {
        message: 'The water is cold',
        accountId: '123'
      })

      await sender.publish(eventName1, {
        message: 'The water is not cold',
        accountId: '234'
      })
    }
    catch (err) {
      console.log('Error', err)
      throw err
    }
  });

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

    msg.should.deepEqual({ a: 1 })
    should.not.exist(msg.tid)

    const data = await received
    data.should.have.property('a', 1)
    data.tid.should.be.a.String()

    const payload = await sentPayload
    payload.should.have.property('type', 'topic')
    payload.should.have.property('eventName', eventName)
    payload.message.should.have.property('a', 1)
    payload.message.tid.should.be.a.String()
    payload.message.should.not.equal(msg)
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
      await channel.assertExchange(sender.EXCHANGE_NAME, 'topic', { durable: false })
      channel.publish(sender.EXCHANGE_NAME, eventName, Buffer.from('not-json{'), { noAck: true })

      const payload = await failedPayload
      payload.should.have.property('eventName', eventName)
      payload.should.have.property('error')
      payload.error.should.be.instanceOf(Error)

      // give any escaped rejection a chance to surface
      await wait(500)
      unhandled.should.have.length(0)
    }
    finally {
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
