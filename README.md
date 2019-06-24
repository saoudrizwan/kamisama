<div align="center">
	<img src="https://user-images.githubusercontent.com/7799382/59981707-a0cef080-95d5-11e9-863a-c48dbfdd4d84.png" >
	<h1>kamisama</h1>
	<p align="center">
    <a href="#installation">Installation</a>
  • <a href="#usage">Usage</a>
  • <a href="#license">License</a>
</p>
</div>

Since Node is single threaded, it doesn't automatically take advantage of a multi-core CPU. Clustering allows your app to spawn worker processes each running their own thread on a core, while all sharing the same server port. Node intelligently distributes new connections across the workers in a round-robin fashion, ensuring work load is balanced. kamisama abstracts this boilerplate implementation, and automatically respawns workers if they crash. kamisama also lets you implement a promise based shutdown function to ensure each worker shuts down gracefully (i.e. [finish http requests](https://nodejs.org/api/net.html#net_server_close_callback), [close database connections](https://redis.io/commands/quit), etc.)

**index.js/ts**

```javascript
kamisama({
    workers: 3,
    run: id => {
        console.log(`running worker ${id}`)
    },
    shutdown: async (id, signal) => {
        console.log(`worker ${id} shutting down from ${signal}`)
    },
    timeout: 5000
})
```

**console**

```bash
$ node index.js
running worker 1
running worker 2
running worker 3
```

```bash
^C
worker 1 shutting down from SIGINT
worker 2 shutting down from SIGINT
worker 3 shutting down from SIGINT
```

## Installation

```
npm i kamisama
```

## Usage

You can pass kamisama a run function if you want to create as many workers as there are CPU cores on your machine.

```javascript
kamisama(id => {
    console.log(`running worker ${id}`)
})
```

Keep in mind that running a process per core takes maximum advantage of the machine, so although this is good for production, you should stick with one or two workers during development.

Usually you'd want to use `KamisamaOptions` though, like in the example.

```javascript
kamisama({
    workers?: number
    run: (id: number): void
    shutdown?: (id: number, signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGBREAK" | "SIGUSR2"): any
    timeout?: number
})
```

`workers?: number`

-   The number of worker processes to fork for the cluster.
-   [Heroku provides an appropriate value](https://devcenter.heroku.com/articles/node-concurrency#enabling-concurrency-in-your-app) for this based on your dyno type: `process.env.WEB_CONCURRENCY`
-   Default value: `os.cpus().length` (# of cores in machine's CPU)

`run: (id: number): void`

-   Function called for each worker process. `id` is the worker ID given by the master process.
-   This is where you connect to databases, start your http server, etc.

`shutdown?: (id: number, signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGBREAK" | "SIGUSR2"): any`

-   Function called when the master process receives one of the common [shutdown signals](#what-signals-does-kamisama-listen-to).
-   You must not attach listeners to these shutdown signals in your worker process if you want kamisama's listeners to call your shutdown function.
-   Under the hood kamisama calls `Promise.resolve(shutdown(id, signal))`, so you can use `async`/`await` to shutdown asynchronously.
-   This is where you would [gracefully shutdown](https://hackernoon.com/graceful-shutdown-in-nodejs-2f8f59d1c357) your worker process. This is good practice for web servers, otherwise users' requests would get dropped, database updates would be aborted, and the list goes on.
-   While it's normal practice to use a listener for shutdown signals (i.e. `process.on("SIGINT", shutdown)`) clustering can send duplicate signals, or even more when npm or nodemon are used to run the process. kamisama takes care of this issue and ensures your shutdown function gets called for each worker only once.
-   kamisama also lets you gracefully shutdown workers when nodemon restarts your app on a file change. Although this can be useful to ensure development and production environments behave the same, it may speed up your workflow to disable this. Simply add a conditional for the `SIGUSR2` signal like so:

    ```javascript
    shutdown: (id, signal) => {
        if (signal === "SIGUSR2") return
        // ...
    }
    ```

`timeout?: number`

-   How long to wait (milliseconds) until kamisama should forcefully shutdown worker processes after the shutdown function is called.
-   Default value: `10_000` (10 seconds)

### Master process

kamisama only exposes functions to run in worker processes for the sake of simplicity. If you want to run code in the master process, use the `cluster` module in the same file you use kamisama. (Remember kamisama is just a function that runs in the master process.)

```javascript
if (cluster.isMaster) {
    console.log(`Master process id: ${process.pid}`)
}
```

### What signals does kamisama listen to?

**`SIGINT`**

-   Triggered by `CTRL`+`C` in Terminal

**`SIGTERM`**

-   Generic shutdown signal, usually sent by hosting service (i.e. Heroku)
-   Not supported on Windows

**`SIGHUP`**

-   Usually generated when the console window is closed
-   On Windows Node will be unconditionally terminated about 10 seconds later

**`SIGBREAK`**

-   Delivered on Windows when `Ctrl`+`Break` is pressed

**`SIGUSR2`**

-   [Sent by nodemon](https://github.com/remy/nodemon#controlling-shutdown-of-your-script) when a file has been updated

## License

kamisama uses the [MIT license](https://github.com/saoudrizwan/kamisama/blob/master/LICENSE). Please file an issue if you have any questions or if you'd like to share how you're using kamisama.

## Questions?

Contact me by email <a href="mailto:hello@saoudmr.com">hello@saoudmr.com</a>, or by twitter <a href="https://twitter.com/sdrzn" target="_blank">@sdrzn</a>. Please create an <a href="https://github.com/saoudrizwan/kamisama/issues">issue</a> if you come across a bug or would like a feature to be added.

## Notable Mentions

-   [throng](https://github.com/hunterloftis/throng) was a wonderful starting point and reference
-   [Heroku's](https://devcenter.heroku.com/articles/node-concurrency) [wonderful](https://help.heroku.com/ROG3H81R/why-does-sigterm-handling-not-work-correctly-in-nodejs-with-npm) [docs](https://devcenter.heroku.com/articles/node-redis-workers#worker-process)
-   [Maryna Sokolyan](https://dribbble.com/msokolyan) for the beautiful plum branch
