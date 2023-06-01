var should = require('should')
var MQ = require('../../index').MQ

describe("RabbitMQ Connection", function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/'
  }

  it("Should connect to RabbitMQ", function () {
    var mq = new MQ(config)

    mq.connect()
    .then((connection) => {
      connection.should.be.an.Object;
    })
  });

  it("Should throw an error when passing an invalid connection", function () {
    config.url = 'amqp://rabbitmq:nopass@rabbitmq:5672/'
    var mq = new MQ(config)

    mq.connect()
    .then((error) => {
      throw error
    })
    .catch((err) => {
      err.should.have.property('name');
      err.should.have.property('message');
    })
  })
})

describe('Channel', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/'
  }

  it("Should create a new channel", function () {
    var mq = new MQ(config)

    mq.connect()
    .then((connection) => {
      return mq.createChannel()
    })
    .then((channel) => {
      channel.should.be.an.Object;
      channel.should.have.property('ch', 1);
    })
  })
})
