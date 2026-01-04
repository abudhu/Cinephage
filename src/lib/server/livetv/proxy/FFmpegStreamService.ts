/**
 * FFmpegStreamService - Manages FFmpeg subprocess for IPTV stream proxying.
 * Spawns FFmpeg with codec passthrough and handles process lifecycle.
 */

import { spawn, type ChildProcess } from 'child_process';
import { logger } from '$lib/logging';
import { FFMPEG_PATH, FFMPEG_CONNECT_TIMEOUT_US, FFMPEG_RW_TIMEOUT_US } from './constants';
import type { FFmpegStreamOptions, ActiveStream } from './types';

class FFmpegStreamService {
	private activeStreams: Map<string, ActiveStream> = new Map();
	private killedStreams: Set<string> = new Set(); // Track intentionally killed streams

	/**
	 * Build FFmpeg command arguments for stream proxying.
	 * Uses codec copy (passthrough) with MPEG-TS output for compatibility.
	 */
	private buildArgs(options: FFmpegStreamOptions): string[] {
		const connectTimeout = options.timeout ?? FFMPEG_CONNECT_TIMEOUT_US;
		const rwTimeout = FFMPEG_RW_TIMEOUT_US;
		const args: string[] = [];

		// Add headers before -i if provided (FFmpeg expects format: "Key: Value\r\n")
		if (options.headers && Object.keys(options.headers).length > 0) {
			const headerString = Object.entries(options.headers)
				.map(([key, value]) => `${key}: ${value}`)
				.join('\r\n');
			args.push('-headers', headerString + '\r\n');
		}

		args.push(
			// Reconnect options for live streams - critical for IPTV stability
			'-reconnect',
			'1',
			'-reconnect_streamed',
			'1',
			'-reconnect_at_eof',
			'1', // Reconnect if stream ends unexpectedly
			'-reconnect_on_network_error',
			'1', // Reconnect on network errors
			'-reconnect_delay_max',
			'10', // Max delay between reconnects (seconds)
			// Timeout settings
			'-timeout',
			String(connectTimeout), // Connection timeout
			'-rw_timeout',
			String(rwTimeout), // Read/write timeout for stalled streams
			'-i',
			options.streamUrl,
			'-map',
			'0', // Map all streams
			'-codec',
			'copy', // No transcoding
			'-f',
			'mpegts', // MPEG-TS container
			'-flush_packets',
			'0',
			'-fflags',
			'+nobuffer+discardcorrupt+igndts', // Reduce buffering, discard corrupt, ignore DTS
			'-flags',
			'low_delay', // Low latency mode
			'-copyts', // Preserve timestamps
			'-strict',
			'experimental',
			'-threads',
			'8', // Multi-threading
			'-max_delay',
			'500000', // Max delay before forcing output (0.5 seconds)
			'-avoid_negative_ts',
			'make_zero', // Handle negative timestamps
			'pipe:1' // Output to stdout
		);

		return args;
	}

	/**
	 * Spawn FFmpeg process for stream proxying.
	 * Returns the child process with stdout piped for streaming.
	 */
	spawnStream(options: FFmpegStreamOptions): ChildProcess {
		const args = this.buildArgs(options);

		logger.info('[FFmpegStreamService] Spawning FFmpeg', {
			path: FFMPEG_PATH,
			args: args.join(' ')
		});

		const ffmpegProcess = spawn(FFMPEG_PATH, args, {
			stdio: ['ignore', 'pipe', 'pipe'] // stdin: ignore, stdout: pipe, stderr: pipe
		});

		// Collect stderr to log on close
		let stderrBuffer = '';
		ffmpegProcess.stderr?.on('data', (data: Buffer) => {
			stderrBuffer += data.toString();
		});

		ffmpegProcess.on('close', (code) => {
			// Exit code 255 = killed by signal (SIGTERM), which is expected when we call killStream()
			// Exit code 0 = normal exit (stream ended naturally)
			// Exit codes 1-254 = actual errors worth logging
			if (code !== 0 && code !== null && code !== 255) {
				const lastStderr = stderrBuffer.slice(-500);
				logger.error('[FFmpegStreamService] FFmpeg failed', {
					exitCode: code,
					stderr: lastStderr
				});
			}
		});

		ffmpegProcess.on('error', (error) => {
			logger.error('[FFmpegStreamService] Process spawn error', error);
		});

		return ffmpegProcess;
	}

	/**
	 * Register an active stream for monitoring.
	 */
	registerStream(stream: ActiveStream): void {
		this.activeStreams.set(stream.key, stream);
		logger.info('[FFmpegStreamService] Stream started', {
			key: stream.key,
			channel: stream.channelName,
			clientIp: stream.clientIp
		});
	}

	/**
	 * Unregister a stream (on completion or error).
	 */
	unregisterStream(key: string): void {
		const stream = this.activeStreams.get(key);
		if (stream) {
			this.activeStreams.delete(key);
			const duration = Date.now() - stream.startedAt.getTime();
			logger.info('[FFmpegStreamService] Stream ended', {
				key,
				channel: stream.channelName,
				durationMs: duration
			});
		}
	}

	/**
	 * Kill a stream's FFmpeg process and unregister it.
	 */
	killStream(key: string): void {
		const stream = this.activeStreams.get(key);
		if (stream) {
			logger.info('[FFmpegStreamService] Killing stream', { key });
			this.killedStreams.add(key); // Mark as intentionally killed before SIGTERM
			stream.process.kill('SIGTERM');
			this.unregisterStream(key);
		}
	}

	/**
	 * Check if a stream was intentionally killed (vs unexpected exit).
	 */
	wasIntentionallyKilled(key: string): boolean {
		return this.killedStreams.has(key);
	}

	/**
	 * Clear killed stream tracking (call after handling exit).
	 */
	clearKilledFlag(key: string): void {
		this.killedStreams.delete(key);
	}

	/**
	 * Get all active streams (for monitoring/debugging).
	 */
	getActiveStreams(): ActiveStream[] {
		return Array.from(this.activeStreams.values());
	}

	/**
	 * Get count of active streams.
	 */
	getActiveStreamCount(): number {
		return this.activeStreams.size;
	}

	/**
	 * Kill all active streams (for shutdown).
	 */
	killAll(): void {
		logger.info('[FFmpegStreamService] Killing all streams', {
			count: this.activeStreams.size
		});

		for (const [key, stream] of this.activeStreams) {
			stream.process.kill('SIGTERM');
			logger.debug('[FFmpegStreamService] Killed stream', { key });
		}

		this.activeStreams.clear();
	}
}

// Singleton instance
let instance: FFmpegStreamService | null = null;

export function getFFmpegStreamService(): FFmpegStreamService {
	if (!instance) {
		instance = new FFmpegStreamService();
	}
	return instance;
}

export type { FFmpegStreamService };
