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

// `SIGTERM` cannot be caught on Windows, where `taskkill` is used for graceful termination instead,
// so the `gracefulTimeout` tests are skipped there.
// @todo: add Windows-specific tests for the `gracefulTimeout` option.
const testIfUnix = isWindows ? test.skip : test;

testIfUnix('gracefulTimeout sends SIGTERM first and the subprocess exits gracefully', async t => {
	const {timedOut, isTerminated, isForcefullyTerminated, exitCode, stdout, shortMessage} = await t.throwsAsync(execa('sigterm-exit.js', {timeout: 1e3, gracefulTimeout: 1e4}));
	t.true(timedOut);
	t.false(isTerminated);
	t.false(isForcefullyTerminated);
	t.is(exitCode, 0);
	t.is(stdout, 'cleaned up');
	t.is(shortMessage, 'Command timed out after 1000 milliseconds and was gracefully terminated within a graceful timeout of 10000 milliseconds: sigterm-exit.js');
});

testIfUnix('gracefulTimeout reports the termination signal when the subprocess does not handle SIGTERM', async t => {
	const {timedOut, isTerminated, signal, isForcefullyTerminated, shortMessage} = await t.throwsAsync(execa('forever.js', {timeout: 1e3, gracefulTimeout: 1e4}));
	t.true(timedOut);
	t.true(isTerminated);
	t.is(signal, 'SIGTERM');
	t.false(isForcefullyTerminated);
	t.is(shortMessage, 'Command timed out after 1000 milliseconds and was gracefully terminated with SIGTERM (Termination) within a graceful timeout of 10000 milliseconds: forever.js');
});

testIfUnix('gracefulTimeout escalates to SIGKILL when the subprocess ignores SIGTERM', async t => {
	const subprocess = execa('no-killable.js', {ipc: true, timeout: 1e3, gracefulTimeout: 200});
	await subprocess.getOneMessage();
	const {timedOut, isTerminated, signal, isForcefullyTerminated, shortMessage} = await t.throwsAsync(subprocess);
	t.true(timedOut);
	t.true(isTerminated);
	t.is(signal, 'SIGKILL');
	t.true(isForcefullyTerminated);
	t.is(shortMessage, 'Command timed out after 1000 milliseconds and was forcefully terminated with SIGKILL after a graceful timeout of 200 milliseconds: no-killable.js');
});

testIfUnix('gracefulTimeout is not preempted by forceKillAfterDelay', async t => {
	const subprocess = execa('no-killable.js', {
		ipc: true,
		timeout: 1e3,
		gracefulTimeout: 500,
		forceKillAfterDelay: 50,
	});
	await subprocess.getOneMessage();
	const {timedOut, signal, isForcefullyTerminated, durationMs} = await t.throwsAsync(subprocess);
	t.true(timedOut);
	t.is(signal, 'SIGKILL');
	t.true(isForcefullyTerminated);
	// `SIGKILL` must not be sent before `gracefulTimeout` expires, even though `forceKillAfterDelay` is shorter
	t.true(durationMs >= 1400);
});

test('timeout without gracefulTimeout keeps the same behavior', async t => {
	const {timedOut, signal, isForcefullyTerminated, shortMessage} = await t.throwsAsync(execa('forever.js', {timeout: 1}));
	t.true(timedOut);
	t.is(signal, 'SIGTERM');
	t.false(isForcefullyTerminated);
	t.is(shortMessage, 'Command timed out after 1 milliseconds: forever.js');
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
