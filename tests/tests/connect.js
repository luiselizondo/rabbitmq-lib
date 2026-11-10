const { expect } = require('chai')
const MQ = require('../../index').MQ

describe('RabbitMQ Connection', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
  }

  it('Should connect to RabbitMQ', function () {
    const mq = new MQ(config)

    return mq.connect()
      .then((connection) => {
        expect(connection).to.be.an('object')
      })
  })

  it('Should reject with an error when passing an invalid connection', async function () {
    const badConfig = {
      exchange_name: 'rabbitmq_lib_test',
      url: 'amqp://rabbitmq:nopass@rabbitmq:5672/',
      connectMaxAttempts: 2,
      delayMS: 10,
    }
    const mq = new MQ(badConfig)
    let emitted = null
    mq.on('error', (error) => {
      emitted = error
    })

    let rejection = null
    try {
      await mq.connect()
    }
    catch (err) {
      rejection = err
    }

    expect(rejection).to.be.an('error')
    expect(emitted).to.be.an('error')
  })
})

describe('MQ URL normalization', function () {
  it('Should append the default frameMax when the URL does not set one', function () {
    const mq = new MQ({ url: 'amqp://u:p@rabbitmq:5672/' })

    expect(mq.RABBITMQ_URL).to.include('frameMax=131072')
    expect(mq.connectionOptions).to.eql({ servername: 'rabbitmq', heartbeat: 10 })
  })

  it('Should keep an existing frameMax and not duplicate the parameter', function () {
    const mq = new MQ({ url: 'amqp://u:p@rabbitmq:5672/?frameMax=65536' })

    expect(mq.RABBITMQ_URL).to.include('frameMax=65536')
    expect(mq.RABBITMQ_URL).to.not.include('frameMax=131072')
    const matches = mq.RABBITMQ_URL.match(/frameMax=/g) || []
    expect(matches.length).to.equal(1)
  })

  it('Should preserve the other query parameters', function () {
    const mq = new MQ({ url: 'amqp://u:p@rabbitmq:5672/?heartbeat=5&locale=en_US' })

    expect(mq.RABBITMQ_URL).to.include('heartbeat=5')
    expect(mq.RABBITMQ_URL).to.include('locale=en_US')
    expect(mq.RABBITMQ_URL).to.include('frameMax=131072')
  })
})

describe('Channel', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
  }

  it('Should create a new channel', function () {
    const mq = new MQ(config)

    return mq.connect()
      .then(() => mq.createChannel())
      .then((channel) => {
        expect(channel).to.be.an('object')
        expect(channel).to.have.property('ch', 1)
      })
  })
})

describe('MQ reconnection', function () {
  const config = {
    exchange_name: 'rabbitmq_lib_test',
    url: 'amqp://rabbitmq:rabbitmq@rabbitmq:5672/',
  }

  const waitFor = (mq, event, timeoutMS = 5000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for "${event}"`)),
        timeoutMS,
      )
      mq.once(event, (payload) => {
        clearTimeout(timer)
        resolve(payload)
      })
    })

  it('Should emit error and disconnected and flip isConnected when the live connection is destroyed', async function () {
    this.timeout(20000)
    const mq = new MQ(config)
    await mq.connect()

    let emittedError = null
    let disconnected = false
    mq.on('error', (error) => {
      emittedError = error
    })
    mq.on('disconnected', () => {
      disconnected = true
    })
    const disconnectedEvent = waitFor(mq, 'disconnected')

    // amqplib exposes the underlying net socket as connection.connection.stream
    mq.connection.connection.stream.destroy(new Error('simulated reset'))
    await disconnectedEvent

    expect(mq.isConnected).to.equal(false)
    expect(emittedError).to.be.an('error')
    expect(disconnected).to.equal(true)
  })

  it('Should resolve undefined from reconnect() while the connection is alive', async function () {
    this.timeout(20000)
    const mq = new MQ(config)
    await mq.connect()

    const result = await mq.reconnect()

    expect(result).to.be.undefined
    await mq.disconnect()
  })

  it('Should reconnect after the connection is lost', async function () {
    this.timeout(20000)
    const mq = new MQ(config)
    await mq.connect()
    const oldConnection = mq.connection

    mq.on('error', () => {})
    const disconnectedEvent = waitFor(mq, 'disconnected')
    let reconnectedWith = null
    mq.on('reconnected', (connection) => {
      reconnectedWith = connection
    })

    oldConnection.connection.stream.destroy(new Error('simulated reset'))
    await disconnectedEvent

    const fresh = await mq.reconnect()

    expect(fresh).to.be.an('object')
    expect(fresh).to.not.equal(oldConnection)
    expect(reconnectedWith).to.equal(fresh)
    expect(mq.isConnected).to.equal(true)
    const channel = await mq.createChannel()
    expect(channel).to.be.an('object')
    await mq.disconnect()
  })

  it('Should reconnect after disconnect()', async function () {
    this.timeout(20000)
    const mq = new MQ(config)
    await mq.connect()
    const oldConnection = mq.connection
    let reconnectedWith = null
    mq.on('reconnected', (connection) => {
      reconnectedWith = connection
    })

    // Stub close() so the broker's own 'close' event never arrives: this keeps
    // the test on the documented disconnect() -> reconnect() path only.
    oldConnection.close = async () => {}

    await mq.disconnect()
    expect(mq.isConnected).to.equal(false)
    const fresh = await mq.reconnect()

    expect(fresh).to.be.an('object')
    expect(fresh).to.not.equal(oldConnection)
    expect(reconnectedWith).to.equal(fresh)
    expect(mq.isConnected).to.equal(true)
    const channel = await mq.createChannel()
    expect(channel).to.be.an('object')
    await mq.disconnect()

    // Release the old connection: restore the real close and close it so it
    // does not linger on the broker after the test.
    delete oldConnection.close
    await oldConnection.close().catch(() => {})
  })

  it('Should throw a clear error from createChannel after disconnect()', async function () {
    this.timeout(20000)
    const mq = new MQ(config)
    await mq.connect()
    await mq.disconnect()

    let rejection = null
    try {
      await mq.createChannel()
    }
    catch (err) {
      rejection = err
    }

    expect(rejection).to.be.an('error')
    expect(rejection).to.not.be.an.instanceOf(TypeError)
    expect(rejection.message).to.match(/No connection/)
  })
})
