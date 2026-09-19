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
	subprocess,
	kill,
	timeout,
	gracefulTimeout,
	context,
	controller,
}) => timeout === 0 || timeout === undefined
	? []
	: [killAfterTimeout({
		subprocess,
		kill,
		timeout,
		gracefulTimeout,
		context,
		controller,
	})];

const killAfterTimeout = async ({
	subprocess,
	kill,
	timeout,
	gracefulTimeout,
	context,
	controller: {signal: controllerSignal},
}) => {
	await setTimeout(timeout, undefined, {signal: controllerSignal});
	context.terminationReason ??= 'timeout';

	if (gracefulTimeout === undefined) {
		kill();
		throw new DiscardedError();
	}

	// Prevents the `forceKillAfterDelay` escalation from racing with `gracefulTimeout`
	context.isGracefulTimeout = true;
	gracefulKill(subprocess, kill);
	killOnGracefulTimeout({
		kill,
		gracefulTimeout,
		context,
		controllerSignal,
	});
	throw new DiscardedError();
};

// Ask the subprocess to terminate gracefully, so it can clean up before exiting
const gracefulKill = (subprocess, kill) => {
	if (process.platform === 'win32') {
		gracefulKillWindows(subprocess, kill);
		return;
	}

	kill('SIGTERM');
};

// Windows has no `SIGTERM`. `taskkill` without `/F` asks the process to terminate gracefully,
// e.g. by sending `WM_CLOSE` to its windows. Console processes might not respond to it,
// in which case the subprocess is still forcefully terminated once `gracefulTimeout` expires.
const gracefulKillWindows = (subprocess, kill) => {
	const taskkillFile = getTaskkillFile();
	if (taskkillFile === undefined || subprocess.pid === undefined) {
		kill();
		return;
	}

	// This is best-effort: if `taskkill` fails, fall back to the default termination signal
	execFile(taskkillFile, ['/pid', `${subprocess.pid}`, '/T'], error => {
		if (error) {
			kill();
		}
	});
};

// Forcefully terminate the subprocess if it is still alive once `gracefulTimeout` expires
const killOnGracefulTimeout = async ({kill, gracefulTimeout, context, controllerSignal}) => {
	try {
		await setTimeout(gracefulTimeout, undefined, {signal: controllerSignal});
		if (kill('SIGKILL')) {
			context.isForcefullyTerminated ??= true;
		}
	} catch {}
};
