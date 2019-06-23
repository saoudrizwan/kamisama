import cluster from "cluster"
import { cpus } from "os"

export interface RunFunction {
	(id: number): void
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

		run(cluster.worker.id)

		return
	}

	// This is the master process

	let { workers = cpus().length, timeout = 10_000 } = compiledOptions
	let isRunning = true

	cluster.on("exit", () => {
		// revive worker after it died
		if (isRunning) cluster.fork()
	})

	shutdownSignals.forEach(signal => process.on(signal, () => shutdownWorkers(signal)))

	function shutdownWorkers(signal: ShutdownSignal) {
		if (!isRunning) return
		isRunning = false
		const workers = Object.keys(cluster.workers).map(e => cluster.workers[e]) as cluster.Worker[]
		// graceful shutdown
		workers.forEach(worker => worker.send({ type: MessageType.shutdown, signal }))
		// force shutdown when timeout is reached
		setTimeout(() => {
			workers.forEach(worker => worker.send({ type: MessageType.forceShutdown }))
		}, timeout).unref() // unref will not require the Node.js event loop to remain active
	}

	for (let i = 0; i < workers; i++) {
		cluster.fork()
	}
}
