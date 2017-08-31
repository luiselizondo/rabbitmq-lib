var should = require('should')
var MQ = require('../../index')

describe("RabbitMQ Connection", function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  it("Should connect to RabbitMQ", function (done) {
    var mq = new MQ(config)

    mq.connect()
    .then((connection) => {
      connection.should.be.an.Object;
      done()
    })
    .catch(done)
  });

  it("Should throw an error when passing an invalid connection", function (done) {
    config.url = 'amqp://rabbitmq:nopass@localhost:35672/'
    var mq = new MQ(config)

    mq.connect()
    .then((error) => {
      throw error
    })
    .catch((err) => {
      err.should.have.property('name');
      err.should.have.property('message');

      done();
    })
  })
})

describe('Channel', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  it("Should create a new channel", function (done) {
    var mq = new MQ(config)

    mq.connect()
    .then((connection) => {
      return mq._createChannel()
    })
    .then((channel) => {
      channel.should.be.an.Object;
      channel.should.have.property('ch', 1);
      done()
    })
    .catch(done)
  })
})
