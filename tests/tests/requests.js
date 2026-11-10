const { expect } = require('chai')
const MQ = require('../../index').MQ
const RPC = require('../../index').RPC
const EventEmitter = require('events')
class Events extends EventEmitter {}

describe('RPC Error', function () {
  it('Should throw an error if no connection is set', async function () {
    try {
      const sender = new RPC()

      const data = await sender.send('getSuperhero', {
        name: 'Batman',
      })
    } catch (err) {
      expect(err).to.have.property(
        'message',
        'A connection is needed, call setConnection() on the instance once',
      )
    }
  })
})

describe('Requests', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mq1 = new MQ(config)
  const mq2 = new MQ(config)

  const rpc = new RPC()
  const sender = new RPC()

  before(async function () {
    await mq1.connect()
    const channelConsumer = await mq1.createChannel()
    rpc.setChannel(channelConsumer)

    const connection = await mq2.connect()
    return sender.setConnection(connection)
  })

  after(async function () {
    await mq1.disconnect()
    return await mq2.disconnect()
  })

  it('Should be able to send a request, answer it and respond to it', async function () {
    try {
      const queueName = 'someEventOnQueue4'

      function callbackToExecute (data, next) {
        return next(false, { message: `Tested ${data.testKey}` })
      }

      const listener = await rpc.listen(queueName, callbackToExecute)

      const result = await sender.send(queueName, {
        testKey: 'testName',
      })

      const response = JSON.parse(result)
      expect(response).to.have.property('type', 'success')
      expect(response.results).to.have.property('message', 'Tested testName')
    } catch (err) {
      expect(err).to.not.exist
    }
  })

  it('Should be able to send a request, and respond with an error', async function () {
    try {
      const queueName = 'requestError'

      function callbackToExecute (data, next) {
        return next('No valid request')
      }

      const listener = await rpc.listen(queueName, callbackToExecute)

      const result = await sender.send(queueName, {
        testKey: 'invalid',
      })

      const response = JSON.parse(result)
      expect(response).to.have.property('type', 'error')
      expect(response).to.have.property('error', 'No valid request')
    } catch (err) {
      expect(err).to.not.exist
    }
  })

  it('Should be able to send a request, and respond with an error', async function () {
    try {
      const queueName = 'requestError'

      function callbackToExecute (data, next) {
        return next('No valid request')
      }

      const listener = await rpc.listen(queueName, callbackToExecute)

      const result = await sender.send(queueName, {
        testKey: 'invalid',
      })

      const response = JSON.parse(result)
      expect(response).to.have.property('type', 'error')
      expect(response).to.have.property('error', 'No valid request')
    } catch (err) {
      expect(err).to.not.exist
    }
  })

  it('Should be able to send a request, and respond with an error because of empty results', async function () {
    try {
      const queueName = 'requestError2'

      function callbackToExecute (data, next) {
        return next(false, null)
      }

      const listener = await rpc.listen(queueName, callbackToExecute)

      const result = await sender.send(queueName, {
        testKey: 'invalid',
      })

      const response = JSON.parse(result)
      expect(response).to.have.property('type', 'error')
      expect(response).to.have.property('error', 'No data found')
    } catch (err) {
      expect(err).to.not.exist
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

    expect(result).to.not.exist
    expect(elapsed).to.be.below(1000)

    expect(createdChannels.length).to.equal(1)
    const channel = createdChannels[0]
    channel.responseEmitter.eventNames().forEach(function (eventName) {
      expect(channel.responseEmitter.listenerCount(eventName)).to.equal(0)
    })
  })

  it('Should contain a non-JSON message: emit failed, ack it and keep consuming', async function () {
    const queueName = 'containmentEvent'
    const channel = await mq1.createChannel()
    const consumerRpc = new RPC()
    consumerRpc.setChannel(channel)

    function callbackToExecute (data, next) {
      return next(false, { message: `Contained ${data.testKey}` })
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

    expect(failures.length).to.equal(1)
    expect(failures[0]).to.have.property('eventName', queueName)
    expect(failures[0].error).to.be.an.instanceOf(Error)

    const result = await sender.send(queueName, { testKey: 'afterFailure' })
    const response = JSON.parse(result)
    expect(response).to.have.property('type', 'success')
    expect(response.results).to.have.property('message', 'Contained afterFailure')
  })
})

describe('RPC Guards', function () {
  it('Should throw a clear error when listen() is called without a channel', async function () {
    const rpc = new RPC()

    let rejection = null
    try {
      await rpc.listen('someQueue')
    } catch (err) {
      rejection = err
    }

    expect(rejection).to.be.an.instanceOf(Error)
    expect(rejection.message).to.match(/A channel is needed/)
  })

  it('Should reject with the original publish error when the request cannot be published', async function () {
    const publishError = new Error('publish failed')

    const stubChannel = {
      consume: async function () {
        return { consumerTag: 'stub' }
      },
      sendToQueue: function () {
        throw publishError
      },
      close: async function () {
        throw new Error('close failed')
      },
    }

    const rpc = new RPC()
    rpc.setConnection({
      createChannel: async function () {
        return stubChannel
      },
    })

    let rejection = null
    try {
      await rpc.send('someQueue', { testKey: 'publishFailure' })
    } catch (err) {
      rejection = err
    }

    expect(rejection).to.equal(publishError)
    expect(rejection.message).to.equal('publish failed')
  })
})
