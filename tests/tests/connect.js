const should = require('should')
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
        connection.should.be.an.Object()
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

    should(rejection).be.an.Error()
    should(emitted).be.an.Error()
  })
})

describe('MQ URL normalization', function () {
  it('Should append the default frameMax when the URL does not set one', function () {
    const mq = new MQ({ url: 'amqp://u:p@rabbitmq:5672/' })

    mq.RABBITMQ_URL.should.containEql('frameMax=131072')
    mq.connectionOptions.should.eql({ servername: 'rabbitmq', heartbeat: 10 })
  })

  it('Should keep an existing frameMax and not duplicate the parameter', function () {
    const mq = new MQ({ url: 'amqp://u:p@rabbitmq:5672/?frameMax=65536' })

    mq.RABBITMQ_URL.should.containEql('frameMax=65536')
    mq.RABBITMQ_URL.should.not.containEql('frameMax=131072')
    const matches = mq.RABBITMQ_URL.match(/frameMax=/g) || []
    matches.length.should.equal(1)
  })

  it('Should preserve the other query parameters', function () {
    const mq = new MQ({ url: 'amqp://u:p@rabbitmq:5672/?heartbeat=5&locale=en_US' })

    mq.RABBITMQ_URL.should.containEql('heartbeat=5')
    mq.RABBITMQ_URL.should.containEql('locale=en_US')
    mq.RABBITMQ_URL.should.containEql('frameMax=131072')
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
        channel.should.be.an.Object()
        channel.should.have.property('ch', 1)
      })
  })
})
