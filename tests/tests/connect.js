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
