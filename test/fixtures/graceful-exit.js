#!/usr/bin/env node
import process from 'node:process';

process.on('SIGTERM', () => {
	setTimeout(() => {
		process.exit(0);
	}, 200);
});

setTimeout(() => {}, 1e8);
