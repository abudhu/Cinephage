/**
 * NntpClient - Low-level NNTP client for article retrieval.
 *
 * Provides Promise-based API for NNTP operations.
 * Handles TLS connections and authentication.
 */

import * as net from 'net';
import * as tls from 'tls';
import { logger } from '$lib/logging';
import type { NntpServerConfig, NntpConnectionState, NntpResponse, GroupInfo } from './types';
import { NntpResponseCode } from './types';

/**
 * NNTP protocol line ending.
 */
const CRLF = '\r\n';

/**
 * Default timeout in milliseconds.
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * NntpClient provides low-level NNTP operations.
 */
export class NntpClient {
	private config: NntpServerConfig;
	private socket: net.Socket | tls.TLSSocket | null = null;
	private state: NntpConnectionState = 'disconnected';
	private responseBuffer = '';
	private currentGroup: string | null = null;

	// Pending response handler
	private pendingResolve: ((response: NntpResponse) => void) | null = null;
	private pendingReject: ((error: Error) => void) | null = null;
	private isMultiline = false;
	private multilineData: Buffer[] = [];

	constructor(config: NntpServerConfig) {
		this.config = config;
	}

	/**
	 * Get current connection state.
	 */
	get connectionState(): NntpConnectionState {
		return this.state;
	}

	/**
	 * Check if connected and ready.
	 */
	get isReady(): boolean {
		return this.state === 'ready';
	}

	/**
	 * Connect to the NNTP server.
	 */
	async connect(): Promise<void> {
		if (this.state !== 'disconnected') {
			throw new Error(`Cannot connect: current state is ${this.state}`);
		}

		this.state = 'connecting';

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.cleanup();
				reject(new Error('Connection timeout'));
			}, DEFAULT_TIMEOUT);

			const onConnect = () => {
				this.state = 'connected';
				// Wait for greeting
			};

			const onData = async (data: Buffer) => {
				try {
					await this.handleData(data);
				} catch (error) {
					this.cleanup();
					reject(error);
				}
			};

			const onError = (err: Error) => {
				clearTimeout(timeout);
				this.cleanup();
				reject(err);
			};

			const onGreeting = async (response: NntpResponse) => {
				clearTimeout(timeout);

				if (
					response.code !== NntpResponseCode.POSTING_ALLOWED &&
					response.code !== NntpResponseCode.POSTING_PROHIBITED
				) {
					this.cleanup();
					reject(new Error(`Unexpected greeting: ${response.code} ${response.message}`));
					return;
				}

				// Authenticate if credentials provided
				if (this.config.username && this.config.password) {
					try {
						await this.authenticate();
						this.state = 'ready';
						resolve();
					} catch (error) {
						this.cleanup();
						reject(error);
					}
				} else {
					this.state = 'ready';
					resolve();
				}
			};

			// Set up one-time greeting handler
			this.pendingResolve = onGreeting;
			this.pendingReject = reject;

			try {
				if (this.config.useSsl) {
					this.socket = tls.connect(
						{
							host: this.config.host,
							port: this.config.port,
							rejectUnauthorized: false // Many NNTP servers use self-signed certs
						},
						onConnect
					);
				} else {
					this.socket = net.connect({ host: this.config.host, port: this.config.port }, onConnect);
				}

				this.socket.on('data', onData);
				this.socket.on('error', onError);
				this.socket.on('close', () => {
					this.state = 'disconnected';
				});
			} catch (error) {
				clearTimeout(timeout);
				this.cleanup();
				reject(error);
			}
		});
	}

	/**
	 * Disconnect from the server.
	 */
	async disconnect(): Promise<void> {
		if (this.socket && this.state === 'ready') {
			try {
				await this.sendCommand('QUIT');
			} catch {
				// Ignore errors during quit
			}
		}
		this.cleanup();
	}

	/**
	 * Authenticate with the server.
	 */
	private async authenticate(): Promise<void> {
		this.state = 'authenticating';

		// Send AUTHINFO USER
		const userResponse = await this.sendCommand(`AUTHINFO USER ${this.config.username}`);

		if (userResponse.code === NntpResponseCode.AUTH_ACCEPTED) {
			// Already authenticated (unusual but possible)
			return;
		}

		if (userResponse.code !== NntpResponseCode.PASSWORD_REQUIRED) {
			throw new Error(`Auth failed: ${userResponse.code} ${userResponse.message}`);
		}

		// Send AUTHINFO PASS
		const passResponse = await this.sendCommand(`AUTHINFO PASS ${this.config.password}`);

		if (passResponse.code !== NntpResponseCode.AUTH_ACCEPTED) {
			throw new Error(`Authentication rejected: ${passResponse.code} ${passResponse.message}`);
		}
	}

	/**
	 * Select a newsgroup.
	 */
	async group(name: string): Promise<GroupInfo> {
		const response = await this.sendCommand(`GROUP ${name}`);

		if (response.code !== NntpResponseCode.GROUP_SELECTED) {
			throw new Error(`Failed to select group: ${response.code} ${response.message}`);
		}

		// Parse: 211 count low high name
		const parts = response.message.split(' ');
		this.currentGroup = name;

		return {
			count: parseInt(parts[0], 10),
			low: parseInt(parts[1], 10),
			high: parseInt(parts[2], 10),
			name: parts[3] || name
		};
	}

	/**
	 * Get article body by message ID.
	 * Returns raw body including yEnc encoding.
	 */
	async body(messageId: string): Promise<Buffer> {
		// Ensure message ID is wrapped in angle brackets
		const id = messageId.startsWith('<') ? messageId : `<${messageId}>`;

		const response = await this.sendMultilineCommand(`BODY ${id}`);

		if (response.code !== NntpResponseCode.BODY_FOLLOWS) {
			throw new Error(`Failed to get body: ${response.code} ${response.message}`);
		}

		return response.data || Buffer.alloc(0);
	}

	/**
	 * Get article (headers + body) by message ID.
	 */
	async article(messageId: string): Promise<Buffer> {
		const id = messageId.startsWith('<') ? messageId : `<${messageId}>`;

		const response = await this.sendMultilineCommand(`ARTICLE ${id}`);

		if (response.code !== NntpResponseCode.ARTICLE_RETRIEVED) {
			throw new Error(`Failed to get article: ${response.code} ${response.message}`);
		}

		return response.data || Buffer.alloc(0);
	}

	/**
	 * Check if article exists (STAT command).
	 */
	async stat(messageId: string): Promise<boolean> {
		const id = messageId.startsWith('<') ? messageId : `<${messageId}>`;

		try {
			const response = await this.sendCommand(`STAT ${id}`);
			return response.code === NntpResponseCode.ARTICLE_SELECTED;
		} catch {
			return false;
		}
	}

	/**
	 * Send a single-line command and wait for response.
	 */
	private sendCommand(command: string): Promise<NntpResponse> {
		return new Promise((resolve, reject) => {
			if (!this.socket || this.state === 'disconnected') {
				reject(new Error('Not connected'));
				return;
			}

			this.pendingResolve = resolve;
			this.pendingReject = reject;
			this.isMultiline = false;

			const timeout = setTimeout(() => {
				this.pendingResolve = null;
				this.pendingReject = null;
				reject(new Error('Command timeout'));
			}, DEFAULT_TIMEOUT);

			const originalResolve = resolve;
			this.pendingResolve = (response) => {
				clearTimeout(timeout);
				originalResolve(response);
			};

			// Mask password in logs
			const logCommand = command.startsWith('AUTHINFO PASS') ? 'AUTHINFO PASS ****' : command;
			logger.debug(`[NNTP] > ${logCommand}`);

			this.socket.write(command + CRLF);
		});
	}

	/**
	 * Send a command that returns multiline response.
	 */
	private sendMultilineCommand(command: string): Promise<NntpResponse> {
		return new Promise((resolve, reject) => {
			if (!this.socket || this.state === 'disconnected') {
				reject(new Error('Not connected'));
				return;
			}

			this.pendingResolve = resolve;
			this.pendingReject = reject;
			this.isMultiline = true;
			this.multilineData = [];

			const timeout = setTimeout(() => {
				this.pendingResolve = null;
				this.pendingReject = null;
				this.isMultiline = false;
				reject(new Error('Command timeout'));
			}, DEFAULT_TIMEOUT * 10); // Longer timeout for multiline

			const originalResolve = resolve;
			this.pendingResolve = (response) => {
				clearTimeout(timeout);
				originalResolve(response);
			};

			logger.debug(`[NNTP] > ${command}`);
			this.socket.write(command + CRLF);
		});
	}

	/**
	 * Handle incoming data from socket.
	 */
	private async handleData(data: Buffer): Promise<void> {
		if (this.isMultiline) {
			// Accumulate multiline data
			this.multilineData.push(data);

			// Check for terminator (.\r\n at end)
			const combined = Buffer.concat(this.multilineData);
			const str = combined.toString('binary');

			if (str.endsWith('\r\n.\r\n')) {
				// Complete multiline response
				this.isMultiline = false;

				// Parse status line from first line
				const firstLineEnd = str.indexOf('\r\n');
				const statusLine = str.slice(0, firstLineEnd);
				const code = parseInt(statusLine.slice(0, 3), 10);
				const message = statusLine.slice(4);

				// Data is everything after status line, minus terminator
				const dataStart = firstLineEnd + 2;
				const dataEnd = combined.length - 5; // Remove \r\n.\r\n
				const bodyData = combined.slice(dataStart, dataEnd);

				const response: NntpResponse = {
					code,
					message,
					data: bodyData
				};

				logger.debug(`[NNTP] < ${code} ${message.slice(0, 50)}... (${bodyData.length} bytes)`);

				if (this.pendingResolve) {
					const resolve = this.pendingResolve;
					this.pendingResolve = null;
					this.pendingReject = null;
					resolve(response);
				}
			}
		} else {
			// Single line response
			this.responseBuffer += data.toString();

			const lineEnd = this.responseBuffer.indexOf('\r\n');
			if (lineEnd !== -1) {
				const line = this.responseBuffer.slice(0, lineEnd);
				this.responseBuffer = this.responseBuffer.slice(lineEnd + 2);

				const code = parseInt(line.slice(0, 3), 10);
				const message = line.slice(4);

				logger.debug(`[NNTP] < ${code} ${message}`);

				const response: NntpResponse = { code, message };

				if (this.pendingResolve) {
					const resolve = this.pendingResolve;
					this.pendingResolve = null;
					this.pendingReject = null;
					resolve(response);
				}
			}
		}
	}

	/**
	 * Clean up connection.
	 */
	private cleanup(): void {
		if (this.socket) {
			this.socket.removeAllListeners();
			this.socket.destroy();
			this.socket = null;
		}
		this.state = 'disconnected';
		this.responseBuffer = '';
		this.currentGroup = null;
		this.pendingResolve = null;
		this.pendingReject = null;
		this.isMultiline = false;
		this.multilineData = [];
	}
}
