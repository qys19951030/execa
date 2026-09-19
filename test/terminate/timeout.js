import process from 'node:process';
import test from 'ava';
import {execa, execaSync} from '../../index.js';
import {setFixtureDirectory, FIXTURES_DIRECTORY} from '../helpers/fixtures-directory.js';

setFixtureDirectory();

const isWindows = process.platform === 'win32';

test('timeout kills the subprocess if it times out', async t => {
	const {isTerminated, signal, timedOut, originalMessage, shortMessage, message} = await t.throwsAsync(execa('forever.js', {timeout: 1}));
	t.true(isTerminated);
	t.is(signal, 'SIGTERM');
	t.true(timedOut);
	t.is(originalMessage, undefined);
	t.is(shortMessage, 'Command timed out after 1 milliseconds: forever.js');
	t.is(message, shortMessage);
});

test('timeout kills the subprocess if it times out, in sync mode', async t => {
	const {isTerminated, signal, timedOut, originalMessage, shortMessage, message} = await t.throws(() => {
		execaSync('node', ['forever.js'], {timeout: 1, cwd: FIXTURES_DIRECTORY});
	});
	t.true(isTerminated);
	t.is(signal, 'SIGTERM');
	t.true(timedOut);
	// On Windows, the command is spawned using the absolute path resolved via `PATHEXT`, so it appears in Node.js' own error message
	t.regex(originalMessage, /^spawnSync .*node(?:\.[A-Za-z]+)? ETIMEDOUT$/);
	t.is(shortMessage, `Command timed out after 1 milliseconds: node forever.js\n${originalMessage}`);
	t.is(message, shortMessage);
});

test('timeout does not kill the subprocess if it does not time out', async t => {
	const {timedOut} = await execa('delay.js', ['500'], {timeout: 1e8});
	t.false(timedOut);
});

test('timeout uses killSignal', async t => {
	const {isTerminated, signal, timedOut} = await t.throwsAsync(execa('forever.js', {timeout: 1, killSignal: 'SIGINT'}));
	t.true(isTerminated);
	t.is(signal, 'SIGINT');
	t.true(timedOut);
});

const INVALID_TIMEOUT_REGEXP = /`timeout` option to be a non-negative integer/;

const testTimeoutValidation = (t, timeout, execaMethod) => {
	t.throws(() => {
		execaMethod('empty.js', {timeout});
	}, {message: INVALID_TIMEOUT_REGEXP});
};

test('timeout must not be negative', testTimeoutValidation, -1, execa);
test('timeout must be an integer', testTimeoutValidation, false, execa);
test('timeout must not be negative - sync', testTimeoutValidation, -1, execaSync);
test('timeout must be an integer - sync', testTimeoutValidation, false, execaSync);

test('timedOut is false if timeout is undefined', async t => {
	const {timedOut} = await execa('noop.js');
	t.false(timedOut);
});

test('timedOut is false if timeout is 0', async t => {
	const {timedOut} = await execa('noop.js', {timeout: 0});
	t.false(timedOut);
});

test('timedOut is false if timeout is undefined and exit code is 0 in sync mode', t => {
	const {timedOut} = execaSync('noop.js');
	t.false(timedOut);
});

test('timedOut is false if the timeout happened after a different error occurred', async t => {
	const subprocess = execa('forever.js', {timeout: 1e3});
	const cause = new Error('test');
	subprocess.nodeChildProcess.emit('error', cause);
	const error = await t.throwsAsync(subprocess);
	t.is(error.cause, cause);
	t.false(error.timedOut);
});

test('timeout without gracefulTimeout still forcefully terminates the subprocess with SIGKILL', async t => {
	const subprocess = execa('no-killable.js', {ipc: true, timeout: 1e3, forceKillAfterDelay: 1});
	await subprocess.getOneMessage();
	const {isTerminated, signal, timedOut, isForcefullyTerminated, shortMessage} = await t.throwsAsync(subprocess);
	t.true(isTerminated);
	t.is(signal, 'SIGKILL');
	t.true(timedOut);
	t.true(isForcefullyTerminated);
	t.is(shortMessage, 'Command timed out after 1000 milliseconds and was forcefully terminated after 1 milliseconds: no-killable.js');
});

// `SIGTERM` cannot be caught on Windows, where `taskkill` (without `/F`) is used instead to request a graceful termination.
// TODO: add Windows-specific tests for `gracefulTimeout`.
if (isWindows) {
	test.todo('gracefulTimeout terminates the subprocess gracefully on Windows');
	test.todo('gracefulTimeout forcefully terminates the subprocess on Windows if it does not exit gracefully');
} else {
	test('timeout with gracefulTimeout terminates the subprocess gracefully with SIGTERM', async t => {
		const {exitCode, signal, timedOut, isTerminated, isForcefullyTerminated, shortMessage, message} = await t.throwsAsync(execa('graceful-exit.js', {timeout: 1e3, gracefulTimeout: 5e3}));
		t.true(timedOut);
		t.is(exitCode, 0);
		t.is(signal, undefined);
		t.false(isTerminated);
		t.false(isForcefullyTerminated);
		t.is(shortMessage, 'Command timed out after 1000 milliseconds and was gracefully terminated with SIGTERM within the graceful timeout of 5000 milliseconds: graceful-exit.js');
		t.is(message, shortMessage);
	});

	test('timeout with gracefulTimeout forcefully terminates the subprocess with SIGKILL if it ignores SIGTERM', async t => {
		const subprocess = execa('no-killable.js', {ipc: true, timeout: 1e3, gracefulTimeout: 1e3});
		await subprocess.getOneMessage();
		const {isTerminated, signal, timedOut, isForcefullyTerminated, shortMessage} = await t.throwsAsync(subprocess);
		t.true(isTerminated);
		t.is(signal, 'SIGKILL');
		t.true(timedOut);
		t.true(isForcefullyTerminated);
		t.is(shortMessage, 'Command timed out after 1000 milliseconds and was forcefully terminated with SIGKILL after the graceful timeout of 1000 milliseconds: no-killable.js');
	});
}

test('gracefulTimeout without timeout does not terminate the subprocess', async t => {
	const {timedOut} = await execa('noop.js', {gracefulTimeout: 1});
	t.false(timedOut);
});

const INVALID_GRACEFUL_TIMEOUT_REGEXP = /`gracefulTimeout` option to be a non-negative integer/;

const testGracefulTimeoutValidation = (t, gracefulTimeout, execaMethod) => {
	t.throws(() => {
		execaMethod('empty.js', {gracefulTimeout});
	}, {message: INVALID_GRACEFUL_TIMEOUT_REGEXP});
};

test('gracefulTimeout must not be negative', testGracefulTimeoutValidation, -1, execa);
test('gracefulTimeout must be an integer', testGracefulTimeoutValidation, false, execa);
test('gracefulTimeout must not be negative - sync', testGracefulTimeoutValidation, -1, execaSync);
test('gracefulTimeout must be an integer - sync', testGracefulTimeoutValidation, false, execaSync);

test('gracefulTimeout cannot be used in sync mode', t => {
	t.throws(() => {
		execaSync('empty.js', {gracefulTimeout: 1});
	}, {message: /The "gracefulTimeout" option cannot be used with synchronous methods\./});
});
