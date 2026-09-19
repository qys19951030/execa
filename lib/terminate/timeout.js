import process from 'node:process';
import {execFile} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
import {DiscardedError} from '../return/final-error.js';
import {getTaskkillFile} from './kill-descendants.js';

// Validate `timeout` option
export const validateTimeout = ({timeout}) => {
	if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0)) {
		throw new TypeError(`Expected the \`timeout\` option to be a non-negative integer, got \`${timeout}\` (${typeof timeout})`);
	}
};

// Validate `gracefulTimeout` option
export const validateGracefulTimeout = ({gracefulTimeout}) => {
	if (gracefulTimeout !== undefined && (!Number.isFinite(gracefulTimeout) || gracefulTimeout < 0)) {
		throw new TypeError(`Expected the \`gracefulTimeout\` option to be a non-negative integer, got \`${gracefulTimeout}\` (${typeof gracefulTimeout})`);
	}
};

// Fails when the `timeout` option is exceeded
export const throwOnTimeout = ({
	kill,
	rawKill,
	subprocess,
	timeout,
	gracefulTimeout,
	context,
	controller,
}) => timeout === 0 || timeout === undefined
	? []
	: [killAfterTimeout({
		kill,
		rawKill,
		subprocess,
		timeout,
		gracefulTimeout,
		context,
		controller,
	})];

const killAfterTimeout = async ({kill, rawKill, subprocess, timeout, gracefulTimeout, context, controller: {signal}}) => {
	await setTimeout(timeout, undefined, {signal});
	context.terminationReason ??= 'timeout';

	if (gracefulTimeout === undefined) {
		kill();
	} else {
		gracefulTerminate({
			kill: rawKill,
			subprocess,
			gracefulTimeout,
			context,
			controllerSignal: signal,
		});
	}

	throw new DiscardedError();
};

// Give the subprocess some time to exit gracefully after `SIGTERM`, then forcefully terminate it with `SIGKILL` if it is still alive after `gracefulTimeout`
const gracefulTerminate = async ({kill, subprocess, gracefulTimeout, context, controllerSignal}) => {
	if (process.platform === 'win32') {
		windowsGracefulTerminate(subprocess);
	} else {
		kill('SIGTERM');
	}

	try {
		await setTimeout(gracefulTimeout, undefined, {signal: controllerSignal});
		if (kill('SIGKILL')) {
			context.isForcefullyTerminated ??= true;
		}
	} catch {}
};

// Windows has no `SIGTERM`: `taskkill` without `/F` requests a graceful termination instead.
// This is best-effort: console processes usually ignore it, in which case the subprocess is forcefully terminated after `gracefulTimeout`.
const windowsGracefulTerminate = subprocess => {
	const taskkillFile = getTaskkillFile();
	if (taskkillFile === undefined || subprocess.pid === undefined) {
		subprocess.kill('SIGTERM');
		return;
	}

	execFile(taskkillFile, ['/pid', `${subprocess.pid}`, '/T'], () => {});
};
