import * as cluster from "cluster"
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
		compiledOptions = options
	} else {
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
			switch (message.type) {
				case MessageType.shutdown:
					const signal = message.signal as string
					if (!isShuttingDown) {
						isShuttingDown = true
						if (shutdown != null) {
							Promise.resolve(shutdown(cluster.worker.id, signal))
								.then(() => {
									process.exit(0) // success
								})
								.catch(error => {
									process.exit(1) // failure
								})
						} else {
							process.exit(0)
						}
					}
					break
				case MessageType.forceShutdown:
					process.exit(1)
					break
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
		//revive
		if (running) cluster.fork()
	})

	function shutdownWorkers(signal: string) {
		if (!running) {
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
		cluster.fork()
	}
}
