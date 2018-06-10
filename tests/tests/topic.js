var should = require('should')
var MQ = require('../../index')

describe('Topics', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  it("Should be able to publish an object with a string to a topic and listen to it", function (done) {
    var mq = new MQ(config)

    var eventName = 'someEvent';

    mq.on(eventName, function (data) {
      data.message.should.equal('The water is cold')
      done();
    })

    mq.connect()
    .then((connection) => {
      return mq.listenForTopics([eventName])
    })
    .then((connection) => {
      return mq.publishToTopic(eventName, {
        message: 'The water is cold'
      })
    })
  })

  it("Should be able to publish a string to a topic and listen to it but not receive what it's expected", function (done) {
    var mq = new MQ(config)

    var eventName = 'someEvent1';

    mq.on(eventName, function (data) {
      data.message.should.not.equal('The water is not cold')
      done();
    })

    mq.connect()
    .then((connection) => {
      return mq.listenForTopics([eventName])
    })
    .then((connection) => {
      return mq.publishToTopic(eventName, {message: 'The water is cold'})
    })
  })

  it("Should be able to publish an object to a topic and listen to it", function (done) {
    var mq = new MQ(config)

    var eventName = 'someDataEvent';

    mq.on(eventName, function (data) {
      data.should.have.property('message', 'The water is cold')
      data.should.have.property('accountId', '123')
      data.should.have.property('tid')
      done();
    })

    mq.connect()
    .then((connection) => {
      return mq.listenForTopics([eventName])
    })
    .then((connection) => {
      return mq.publishToTopic(eventName, {
        message: 'The water is cold',
        accountId: '123'
      })
    })
  });
})
