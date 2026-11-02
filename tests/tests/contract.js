const should = require('should')
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
    Object.keys(lib).sort().should.eql(['MQ', 'Queue', 'RPC', 'Topic'])
  })

  Object.keys(classes).forEach(function (name) {
    describe(name, function () {
      const Constructor = lib[name]

      it('is a class extending EventEmitter', function () {
        should(Constructor).be.a.Function()
        Constructor.prototype.should.be.instanceof(EventEmitter)
        Constructor.prototype.constructor.should.equal(Constructor)
      })

      it('declares its constructor with arity 1', function () {
        Constructor.length.should.equal(1)
      })

      it('exposes its prototype methods', function () {
        classes[name].forEach(function (method) {
          Constructor.prototype[method].should.be.a.Function()
        })
      })
    })
  })

  describe('RPC defaults', function () {
    it('applies the default expiration and persistent options', function () {
      const rpc = new lib.RPC()

      rpc.options.expiration.should.equal('5000')
      rpc.options.persistent.should.equal(false)
    })
  })
})
