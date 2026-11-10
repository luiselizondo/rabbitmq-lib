var should = require('should')
var MQ = require('../../index').MQ
var RPC = require('../../index').RPC
var EventEmitter = require('events')
class Events extends EventEmitter {}

describe('RPC Error', function () {
  it('Should throw an error if no connection is set', async function () {
    try {
      var sender = new RPC()

      var data = await sender.send('getSuperhero', {
        name: 'Batman',
      })
    } catch (err) {
      err.should.have.property(
        'message',
        'A connection is needed, call setConnection() on the instance once',
      )
    }
  })
})

describe('Requests', function () {
  var config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  var mq1 = new MQ(config)
  var mq2 = new MQ(config)

  var rpc = new RPC()
  var sender = new RPC()

  before(async function () {
    await mq1.connect()
    var channelConsumer = await mq1.createChannel()
    rpc.setChannel(channelConsumer)

    var connection = await mq2.connect()
    return sender.setConnection(connection)
  })

  after(async function () {
    await mq1.disconnect()
    return await mq2.disconnect()
  })

  it('Should be able to send a request, answer it and respond to it', async function () {
    try {
      var queueName = 'someEventOnQueue4'

      function callbackToExecute (data, next) {
        return next(false, { message: 'Tested ' + data.testKey })
      }

      var listener = await rpc.listen(queueName, callbackToExecute)

      var result = await sender.send(queueName, {
        testKey: 'testName',
      })

      var response = JSON.parse(result)
      response.should.have.property('type', 'success')
      response.results.should.have.property('message', 'Tested testName')
    } catch (err) {
      should.not.exist(err)
    }
  })

  it('Should be able to send a request, and respond with an error', async function () {
    try {
      var queueName = 'requestError'

      function callbackToExecute (data, next) {
        return next('No valid request')
      }

      var listener = await rpc.listen(queueName, callbackToExecute)

      var result = await sender.send(queueName, {
        testKey: 'invalid',
      })

      var response = JSON.parse(result)
      response.should.have.property('type', 'error')
      response.should.have.property('error', 'No valid request')
    } catch (err) {
      should.not.exist(err)
    }
  })

  it('Should be able to send a request, and respond with an error', async function () {
    try {
      var queueName = 'requestError'

      function callbackToExecute (data, next) {
        return next('No valid request')
      }

      var listener = await rpc.listen(queueName, callbackToExecute)

      var result = await sender.send(queueName, {
        testKey: 'invalid',
      })

      var response = JSON.parse(result)
      response.should.have.property('type', 'error')
      response.should.have.property('error', 'No valid request')
    } catch (err) {
      should.not.exist(err)
    }
  })

  it('Should be able to send a request, and respond with an error because of empty results', async function () {
    try {
      var queueName = 'requestError2'

      function callbackToExecute (data, next) {
        return next(false, null)
      }

      var listener = await rpc.listen(queueName, callbackToExecute)

      var result = await sender.send(queueName, {
        testKey: 'invalid',
      })

      var response = JSON.parse(result)
      response.should.have.property('type', 'error')
      response.should.have.property('error', 'No data found')
    } catch (err) {
      should.not.exist(err)
    }
  })

  it('Should resolve (not reject) on expiration timeout and leave no listeners behind', async function () {
    const timeoutRpc = new RPC({ expiration: '200' })
    const connection = await mq2.connect()
    timeoutRpc.setConnection(connection)

    const createdChannels = []
    const originalCreateChannel = connection.createChannel.bind(connection)
    connection.createChannel = async function () {
      const channel = await originalCreateChannel()
      createdChannels.push(channel)
      return channel
    }

    const startedAt = Date.now()
    const result = await timeoutRpc.send('eventNobodyServes', {
      testKey: 'timeout',
    })
    const elapsed = Date.now() - startedAt

    should.not.exist(result)
    elapsed.should.be.below(1000)

    createdChannels.length.should.equal(1)
    const channel = createdChannels[0]
    channel.responseEmitter.eventNames().forEach(function (eventName) {
      channel.responseEmitter.listenerCount(eventName).should.equal(0)
    })
  })

  it('Should contain a non-JSON message: emit failed, ack it and keep consuming', async function () {
    const queueName = 'containmentEvent'
    const channel = await mq1.createChannel()
    const consumerRpc = new RPC()
    consumerRpc.setChannel(channel)

    function callbackToExecute (data, next) {
      return next(false, { message: 'Contained ' + data.testKey })
    }

    await consumerRpc.listen(queueName, callbackToExecute)

    const failures = []
    consumerRpc.on('failed', function (payload) {
      failures.push(payload)
    })

    await channel.sendToQueue(queueName, Buffer.from('not-json-at-all'))

    let waited = 0
    while (failures.length === 0 && waited < 2000) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 25)
      })
      waited += 25
    }

    failures.length.should.equal(1)
    failures[0].should.have.property('eventName', queueName)
    failures[0].error.should.be.instanceof(Error)

    const result = await sender.send(queueName, { testKey: 'afterFailure' })
    const response = JSON.parse(result)
    response.should.have.property('type', 'success')
    response.results.should.have.property('message', 'Contained afterFailure')
  })
})
