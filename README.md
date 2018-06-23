# RabbitMQ Abstraction Library
RabbitMQ Lib abstract 3 common uses of RMQ in a very simple API you can use to send messages and consume them. 

Currently it supports Queues, Topics (publish/subscribe) and RPC.

On Version 2 we made a major rewrite of the module to better handle connections and channels and reuse them as much as possible.

I also split all the functionality in multiple classes you can use without having to load the whole library.

The library uses Node v8.x.x and it is not backwards compatible althought I tried to change as little as possible.

# Usage

Usage is better described on the tests folder. Take a look at each case but keep in mind that RabbitMQ will trigger an event using the instance passed in the constructor, you have to listen to events on that same instance.

Notes about RPC
When defining a listener, you always need to call next() as the second argument of the callback to be executed

Notes about upgrading:

1. The library is much simpler and modular
2. Use Node v8 or greater
3. All librarys use listen() and send() 