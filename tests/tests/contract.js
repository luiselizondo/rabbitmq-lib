const { expect } = require('chai')
const EventEmitter = require('events')

const lib = require('../../index')

describe('public contract', function () {
  const classes = {
    MQ: ['amqpConnect', 'connect', 'reconnect', 'setConnection', 'createChannel', 'disconnect'],
    Queue: ['setChannel', 'setIsDelayed', 'bindExchange', 'listen', 'listenManual', 'send'],
    RPC: ['setChannel', 'setConnection', 'listen', 'send'],
    Topic: ['setChannel', 'listen', 'publish'],
  }

  it('exports exactly MQ, Queue, RPC and Topic', function () {
    expect(Object.keys(lib).sort()).to.eql(['MQ', 'Queue', 'RPC', 'Topic'])
  })

  Object.keys(classes).forEach(function (name) {
    describe(name, function () {
      const Constructor = lib[name]

      it('is a class extending EventEmitter', function () {
        expect(Constructor).to.be.a('function')
        expect(Constructor.prototype).to.be.an.instanceOf(EventEmitter)
        expect(Constructor.prototype.constructor).to.equal(Constructor)
      })

      it('declares its constructor with arity 1', function () {
        expect(Constructor.length).to.equal(1)
      })

      it('exposes its prototype methods', function () {
        classes[name].forEach(function (method) {
          expect(Constructor.prototype[method]).to.be.a('function')
        })
      })
    })
  })

  describe('RPC defaults', function () {
    it('applies the default expiration and persistent options', function () {
      const rpc = new lib.RPC()

      expect(rpc.options.expiration).to.equal('5000')
      expect(rpc.options.persistent).to.equal(false)
    })
  })
})

describe('RPC wire contract', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_contract_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
    connectMaxAttempts: 1,
    connectDelayMS: 100,
  }

  const mqServer = new lib.MQ(config)
  const mqClient = new lib.MQ(config)

  const rpc = new lib.RPC()
  const sender = new lib.RPC()

  before(async function () {
    await mqServer.connect()
    const channel = await mqServer.createChannel()
    rpc.setChannel(channel)

    const connection = await mqClient.connect()
    return sender.setConnection(connection)
  })

  after(async function () {
    await mqServer.disconnect()
    return await mqClient.disconnect()
  })

  async function roundTrip (queueName, handler) {
    await rpc.listen(queueName, handler)
    const result = await sender.send(queueName, { testKey: 'wire' })

    return JSON.parse(result)
  }

  it('Should serialize an Error instance as { name, message } instead of {}', async function () {
    const response = await roundTrip('rpcWireErrorInstance', function (data, next) {
      return next(new Error('boom'))
    })

    expect(response).to.have.property('type', 'error')
    expect(response.error).to.be.an('object')
    expect(response.error).to.have.property('name', 'Error')
    expect(response.error).to.have.property('message', 'boom')
  })

  it('Should pass a thrown string error through unchanged', async function () {
    const response = await roundTrip('rpcWireErrorString', function (data, next) {
      return next('No data found')
    })

    expect(response).to.have.property('type', 'error')
    expect(response.error).to.equal('No data found')
  })

  it('Should preserve every property of a custom error object', async function () {
    const response = await roundTrip('rpcWireErrorObject', function (data, next) {
      return next({
        name: 'VALIDATION_ERROR',
        message: 'bad',
        code: 406,
        error_data: { id: 'x' },
      })
    })

    expect(response).to.have.property('type', 'error')
    expect(response.error).to.eql({
      name: 'VALIDATION_ERROR',
      message: 'bad',
      code: 406,
      error_data: { id: 'x' },
    })
  })

  it('Should never send the stack, even when it is an own enumerable property', async function () {
    const fromError = await roundTrip('rpcWireErrorStackInstance', function (data, next) {
      const error = new Error('boom')
      Object.defineProperty(error, 'stack', { value: 'private stack details', enumerable: true })
      return next(error)
    })

    expect(fromError).to.have.property('type', 'error')
    expect(fromError.error).to.be.an('object')
    expect(fromError.error).to.have.property('message', 'boom')
    expect(fromError.error).to.not.have.property('stack')

    const fromPlainObject = await roundTrip('rpcWireErrorStackObject', function (data, next) {
      return next({ name: 'Error', message: 'boom', stack: 'private stack details' })
    })

    expect(fromPlainObject).to.have.property('type', 'error')
    expect(fromPlainObject.error).to.be.an('object')
    expect(fromPlainObject.error).to.have.property('message', 'boom')
    expect(fromPlainObject.error).to.not.have.property('stack')
  })

  it('Should not let a toJSON hook reintroduce the stack', async function () {
    const response = await roundTrip('rpcWireErrorToJSON', function (data, next) {
      const original = new Error('boom')
      return next({
        name: 'Error',
        message: 'boom',
        toJSON: () => ({ name: 'Error', message: 'boom', stack: original.stack }),
      })
    })

    expect(response).to.have.property('type', 'error')
    expect(response.error).to.be.an('object')
    expect(response.error).to.not.have.property('stack')
    expect(JSON.stringify(response)).to.not.include('Error: boom')

    const fromConstructorCapture = await roundTrip('rpcWireErrorToJSONThis', function (data, next) {
      function LeakyError (message) {
        this.name = 'LeakyError'
        this.message = message
        this.stack = `LeakyError: ${message}\n    at captured-site`
        this.toJSON = () => ({ message: this.message, stack: this.stack })
      }
      return next(new LeakyError('boom'))
    })

    expect(fromConstructorCapture).to.have.property('type', 'error')
    expect(fromConstructorCapture.error).to.be.an('object')
    expect(fromConstructorCapture.error).to.not.have.property('stack')
    expect(JSON.stringify(fromConstructorCapture)).to.not.include('LeakyError: boom')
  })

  it('Should keep the success envelope unchanged', async function () {
    const payload = { message: 'Tested wire', nested: { count: 2 } }
    const response = await roundTrip('rpcWireSuccess', function (data, next) {
      return next(false, payload)
    })

    expect(response).to.have.property('type', 'success')
    expect(response.results).to.eql(payload)
  })
})

describe('Internal wiring', function () {
  it('Should store a manually injected connection via MQ setConnection', function () {
    const mq = new lib.MQ({ url: 'amqp://u:p@h:5672/' })
    const fake = { marker: true }

    expect(mq.connection).to.equal(null)

    mq.setConnection(fake)
    expect(mq.connection).to.equal(fake)

    const fake2 = { marker: 'setter' }
    mq.connection = fake2
    expect(mq.connection).to.equal(fake2)
  })

  it('Should store manually injected channels via the channel setters', function () {
    const fakeChannel = { marker: 'channel' }

    const queue = new lib.Queue('internalWiringDelayedExchange')
    const rpc = new lib.RPC()
    const topic = new lib.Topic('internalWiringTopic')

    expect(queue.channel).to.equal(undefined)
    expect(rpc.channel).to.equal(undefined)
    expect(topic.channel).to.equal(undefined)

    queue.channel = fakeChannel
    rpc.channel = fakeChannel
    topic.channel = fakeChannel

    expect(queue.channel).to.equal(fakeChannel)
    expect(rpc.channel).to.equal(fakeChannel)
    expect(topic.channel).to.equal(fakeChannel)
  })

  it('Should toggle the delayed flag via Queue setIsDelayed', function () {
    const queue = new lib.Queue('internalWiringDelayedExchange')

    expect(queue.isDelayed).to.equal(false)

    queue.setIsDelayed(true)
    expect(queue.isDelayed).to.equal(true)

    queue.setIsDelayed(false)
    expect(queue.isDelayed).to.equal(false)
  })
})
