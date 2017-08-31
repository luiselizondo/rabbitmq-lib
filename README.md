# RabbitMQ Abstraction Library

# Usage

```
var MQ = require('rabbitmq-lib');

var config = {
  exchange_name: 'someExchange',
  url: amqp://username:pass@localhost:port/
}

var mq = new MQ(config)

mq.connect()
.then(() => {
  mq.listen(arrayOfEvents)
})
.then(() => {
  mq.consumeFromQueue(arrayOfTasksToConsume)
})
.catch((err) => {
  console.log(err)
})

mq.publish('someEvent', objectWithData)
mq.dispatchToQueue('queueName', objectWithData)
```

RabbitMQ will trigger an event using the instance passed in the constructor, you have to listen to events on that same instance.
