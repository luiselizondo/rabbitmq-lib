var should = require('should')
var MQ = require('../../index').MQ
var Topic = require('../../index').Topic

describe('Topics', function () {
  var config = {
    exchangeName: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  var mq1 = new MQ(config)
  var mq2 = new MQ(config)
  var topic = new Topic(config.exchangeName)
  var sender = new Topic(config.exchangeName)
  
  before(async function () {
    await mq1.connect()
    var channelConsumer = await mq1.createChannel()
    topic.setChannel(channelConsumer)

    await mq2.connect()
    var channelSender = await mq2.createChannel()
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
})

function wait(time) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      return resolve
    }, time)
  })
}