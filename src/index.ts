import * as cluster from "cluster"
import { cpus } from "os"

export interface RunFunction {
	(id: number): any
}

export type ShutdownSignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGBREAK" | "SIGUSR2"

export interface ShutdownFunction {
	(id: number, signal: ShutdownSignal): any
}

export interface KamisamaOptions {
	workers?: number
	run: RunFunction
	shutdown?: ShutdownFunction
	timeout?: number
}

export default function kamisama(options: KamisamaOptions | RunFunction) {
	let compiledOptions: KamisamaOptions
	if ("workers" in options || "run" in options || "shutdown" in options || "timeout" in options) {
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
	const shutdownSignals: ShutdownSignal[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK", "SIGUSR2"]

	if (cluster.isWorker) {
		// listening to these signals will replace Node's default handlers where the process exits immediately
		shutdownSignals.forEach(signal => process.on(signal, () => {}))

		let isShuttingDown = false
		process.on("message", function(message) {
			switch (message.type) {
				case MessageType.shutdown:
					if (!isShuttingDown) {
						isShuttingDown = true
						if (shutdown != null) {
							// Promise.resolve can take a value or Promise. If given a Promise, that promise is returned
							Promise.resolve(shutdown(cluster.worker.id, message.signal))
								.then(() => {
									process.exit(0) // success
								})
								.catch(error => {
									console.error(error)
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

		Promise.resolve(run(cluster.worker.id))
			.then(() => {
				process.exit(0)
			})
			.catch(error => {
				console.error(error)
				process.exit(1)
			})

		return
	}

	// This is the master process

	let { workers = cpus().length, timeout = 10_000 } = compiledOptions

	let runningWorkers = 0
	let shutdownSignal: ShutdownSignal | undefined
	let isShuttingDown = false
	let isForceShuttingDown = false

	cluster
		.on("online", worker => {
			runningWorkers++
			if (isShuttingDown) {
				// worker came online during a shutdown, kill it immediately
				if (isForceShuttingDown) {
					worker.send({ type: MessageType.forceShutdown })
				} else {
					worker.send({ type: MessageType.shutdown, signal: shutdownSignal })
				}
			}
		})
		.on("exit", () => {
			runningWorkers--
			if (!isShuttingDown) {
				// revive worker after it died
				cluster.fork()
			} else {
				// if shutting down then exit after last worker died
				if (runningWorkers <= 0) {
					process.exit(0)
				}
			}
		})

	shutdownSignals.forEach(signal => process.on(signal, () => shutdownWorkers(signal)))
	function shutdownWorkers(signal: ShutdownSignal) {
		if (isShuttingDown) return
		isShuttingDown = true
		shutdownSignal = signal
		// graceful shutdown
		Object.keys(cluster.workers)
			.map(e => cluster.workers[e]!)
			.forEach(worker => worker.send({ type: MessageType.shutdown, signal }))
		// force shutdown when timeout is reached
		setTimeout(() => {
			isForceShuttingDown = true
			Object.keys(cluster.workers)
				.map(e => cluster.workers[e]!)
				.forEach(worker => worker.send({ type: MessageType.forceShutdown }))
		}, timeout).unref() // unref will not require the Node.js event loop to remain active
	}

	for (let i = 0; i < workers; i++) {
		cluster.fork()
	}
}
