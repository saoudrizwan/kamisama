import * as cluster from "cluster"
import { EventEmitter } from "events"
import { cpus } from "os"

interface RunFunction {
	(id: number): void
}
interface ShutdownFunction {
	(id: number, signal: string): any
}
interface KamisamaOptions {
	workers?: number
	run: RunFunction
	shutdown?: ShutdownFunction
	timeout?: number
}

export default function kamisama(options: KamisamaOptions | RunFunction) {
	let compiledOptions: KamisamaOptions
	if (
		"workers" in options ||
		"lifetime" in options ||
		"timeout" in options ||
		"run" in options ||
		"shutdown" in options
	) {
		console.log("Options passed")
		compiledOptions = options
	} else {
		console.log("No options passed, using run function")
		const run = options as RunFunction
		compiledOptions = { run }
	}

	let { run, shutdown } = compiledOptions
	enum MessageType {
		shutdown = "kamisama-shutdown",
		forceShutdown = "kamisama-force-shutdown"
	}
	/*
	Common shutdown signals

	'SIGINT'
	- Triggered by CTRL + C in Terminal
	- If a listener is installed, its default behavior will be removed (Node.js will no longer exit).

	'SIGTERM'
	- If a listener is installed, its default behavior will be removed (Node.js will no longer exit).
	- Not supported on Windows

	'SIGHUP'
	- Usually generated when the console window is closed
	- If a listener is installed, its default behavior will be removed (Node.js will no longer exit).
	- On Windows Node.js will be unconditionally terminated about 10 seconds later

	'SIGBREAK'
	- delivered on Windows when <Ctrl>+<Break> is pressed

	'SIGUSR2'
	- Sent by nodemon when a file has been updated
	- If you listen to this signal, then you must kill the process yourself for nodemon to assume control and restart the application
	*/
	type ShutdownSignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGBREAK" | "SIGUSR2"
	const shutdownSignals: ShutdownSignal[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK", "SIGUSR2"]

	if (cluster.isWorker) {
		// Create the child process

		// listening to these signals will replace Node's default handlers where the process exits immediately
		shutdownSignals.forEach(signal =>
			process.on(signal, () => console.log(`worker ${cluster.worker.id} received ${signal}`))
		)

		let isShuttingDown = false
		process.on("message", function(message) {
			console.log(`message: ${JSON.stringify(message)}`)
			switch (message.type) {
				case MessageType.shutdown:
					const signal = message.signal as string
					console.log("worker received shutdown message w signal: ", signal)
					if (!isShuttingDown) {
						isShuttingDown = true
						if (shutdown != null) {
							Promise.resolve(shutdown(cluster.worker.id, signal))
								.then(() => {
									console.log("Shutting down after executing shutdown function")
									process.exit(0) // success
								})
								.catch(error => {
									console.error(error)
									process.exit(1) // failure
								})
						} else {
							console.log("Shutting down without shutdown function")
							process.exit(0)
						}
					}
					break
				case MessageType.forceShutdown:
					console.log("Timeout reached, force shutting down!")
					process.exit(1)
					break
				default:
					console.log("worker received unknown message")
			}
		})
		run(cluster.worker.id)
		return
	}

	// This is the master process
	// cpus().length
	let { workers = 2, timeout = 5000 } = compiledOptions

	let running = true

	// listen
	cluster.on("exit", (worker, code, signal) => {
		console.log(`worker ${worker.process.pid} died`)
		//revive
		if (running) cluster.fork()
	})

	function shutdownWorkers(signal: string) {
		console.log(`shutdownWorkers(${signal})`)
		if (!running) {
			console.log("Received signal to shutdown workers again", signal)
			return
		}
		// shutdown
		running = false
		const workers = Object.keys(cluster.workers).map(e => cluster.workers[e])
		//workers.forEach(e => e && e.process.kill())
		workers.forEach(e => e && e.send({ type: MessageType.shutdown, signal }))

		// forcekill
		setTimeout(() => {
			workers.forEach(e => e && e.send({ type: MessageType.forceShutdown }))
		}, timeout).unref()
	}

	shutdownSignals.forEach(signal => process.on(signal, () => shutdownWorkers(signal)))

	// masterfn

	// fork
	for (let i = 0; i < workers; i++) {
		console.log("Forking worker")
		cluster.fork()
	}
}
