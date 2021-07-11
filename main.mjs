#!/usr/bin/env node

import {
	readFile,
	writeFile,
	readdir
} from 'fs/promises';

function vttParse(str) {
	const [head, ...body] = str.split('\n\n');
	const headLines = head.split('\n');
	if (headLines.shift() !== 'WEBVTT') {
		throw new Error('Missing header: WEBVTT')
	}
	const meta = {};
	for (const line of headLines) {
		const [name, ...value] = line.split('=');
		meta[name] = value.join('=');
	}
	const text = [];
	for (const lines of body) {
		const [head, ...rows] = lines.trim().split('\n');
		if (!head) {
			continue;
		}
		const [start, arrow, end, ...styles] = head.split(' ');
		if (arrow !== '-->') {
			throw new Error('Missin: -->');
		}
		text.push({
			start,
			end,
			styles: styles.join(' '),
			rows
		});
	}
	return {
		meta,
		text
	};
}

function vttEncode(vtt) {
	const text = vtt.text.map(text => [
		[`${text.start} --> ${text.end}`, text.styles]
			.filter(Boolean)
			.join(' '),
		...text.rows
	].join('\n')).join('\n\n');
	return [
		'WEBVTT',
		...Object.entries(vtt.meta).map(a => a.join('=')),
		'',
		text,
		''
	].join('\n');
}

function shiftTimestamp(ts, ms) {
	if (ms < 0) {
		throw new Error(`Negative offset: ${ms}`);
	}
	const d = new Date(`2000-01-01 ${ts} GMT`);
	d.setTime(d.getTime() + ms);
	return d.toISOString().split(/[TZ]/)[1];
}

function applyTimestamps(vtt) {
	const tsm = vtt.meta['X-TIMESTAMP-MAP'];
	if (!tsm) {
		return;
	}
	const {LOCAL, MPEGTS} = Object.fromEntries(tsm.split(',').map(s => {
		const [name, ...parts] = s.split(':');
		return [name, parts.join(':')];
	}));
	if (LOCAL && LOCAL !== '00:00:00.000') {
		throw new Error(`Unexpected LOCAL: ${LOCAL}`);
	}
	delete vtt.meta['X-TIMESTAMP-MAP'];
	const offset = (+MPEGTS / 90000) * 1000;
	if (!offset) {
		return;
	}
	for (const t of vtt.text) {
		t.start = shiftTimestamp(t.start, offset);
		t.end = shiftTimestamp(t.end, offset);
	}
}

function timestampSorter(a, b) {
	const ad = new Date(`2000-01-01 ${a.start} GMT`);
	const bd = new Date(`2000-01-01 ${b.start} GMT`);
	return ad.getTime() - bd.getTime();
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 2) {
		throw new Error('Args: dir out.vtt');
	}
	const [inDir, outFile] = args;

	const vtts = (await Promise.all(
		(await readdir(inDir))
			.sort()
			.filter(f => /^[^.]+\.vtt$/.test(f))
			.map(f => readFile(`${inDir}/${f}`, 'utf8'))
	))
		.map(vttParse)
		.filter(o => o.text.length);

	const merged = {
		meta: {},
		text: []
	};
	for (const vtt of vtts) {
		applyTimestamps(vtt);
		merged.text.push(...vtt.text);
	}
	merged.text.sort(timestampSorter);
	await writeFile(outFile, vttEncode(merged));
}
main().catch(err => {
	process.exitCode = 1;
	console.error(err);
});
