var should = require('should')
var MQ = require('../../lib/RabbitMQ')
var RPC = require('../../RPC')
var EventEmitter = require('events');
class Events extends EventEmitter {}

describe('Requests', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@localhost:35672/'
  }

  it("Should be able to send a request, answer it and respond to it", function (done) {
    var eventsInstance = new Events();
    var mq = new MQ(config)
    var rpc = new RPC(config)

    var queueName = 'someEventOnQueue4';

    function callbackToExecute(data, next) {
      return next(false, {message: 'Tested ' + data.testKey})
    }

    mq.connect()
    .then((connection) => {
      return mq.listenAndAnswerRequest(queueName, callbackToExecute)
    })
    .then(() => {
      return rpc.sendRequest(queueName, {
        testKey: 'testName'
      })
    })
    .then((data) => {
      var response = JSON.parse(data);
      response.should.have.property('type', 'success')
      response.results.should.have.property('message', 'Tested testName')
      done()
    })
  })
})
