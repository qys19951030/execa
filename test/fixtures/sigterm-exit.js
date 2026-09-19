#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs';

// Synchronously flush some buffered data, then exit naturally by clearing the timer,
// which is more reliable than `process.exit()` inside a signal handler
const timer = setTimeout(() => {}, 1e8);

process.on('SIGTERM', () => {
	fs.writeSync(1, 'cleaned up\n');
	clearTimeout(timer);
});
