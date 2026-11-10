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
