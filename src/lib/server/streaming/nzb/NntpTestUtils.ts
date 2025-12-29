/**
 * NNTP connection test utilities.
 *
 * Shared logic for testing NNTP server connections.
 */

import * as net from 'net';
import * as tls from 'tls';

export interface NntpTestResult {
	success: boolean;
	error?: string;
	greeting?: string;
}

/**
 * Test connection to an NNTP server.
 * Performs a basic TCP/TLS connection test with greeting verification and optional authentication.
 */
export async function testNntpConnection(
	host: string,
	port: number,
	useSsl: boolean,
	username?: string | null,
	password?: string | null,
	timeoutMs: number = 10000
): Promise<NntpTestResult> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			socket?.destroy();
			resolve({ success: false, error: 'Connection timeout' });
		}, timeoutMs);

		let socket: net.Socket | tls.TLSSocket;
		let greeting = '';

		const cleanup = () => {
			clearTimeout(timeout);
			socket?.destroy();
		};

		const handleConnect = () => {
			// Wait for greeting
		};

		const handleData = async (data: Buffer) => {
			const response = data.toString();
			greeting += response;

			// Check for NNTP greeting (200 or 201)
			if (greeting.startsWith('200') || greeting.startsWith('201')) {
				// Remove this handler before proceeding to avoid conflicts
				socket.off('data', handleData);

				// If we have credentials, try to authenticate
				if (username && password) {
					try {
						await authenticate(socket, username, password);
						cleanup();
						resolve({ success: true, greeting: greeting.trim() });
					} catch (error) {
						cleanup();
						resolve({
							success: false,
							error: error instanceof Error ? error.message : 'Authentication failed'
						});
					}
				} else if (username && !password) {
					// Username provided but no password
					cleanup();
					resolve({
						success: false,
						error: 'Password is required when username is provided.'
					});
				} else {
					// No credentials - just test connection
					cleanup();
					resolve({ success: true, greeting: greeting.trim() });
				}
			} else if (greeting.includes('400') || greeting.includes('502')) {
				cleanup();
				resolve({ success: false, error: `Server rejected: ${greeting.trim()}` });
			}
		};

		const handleError = (err: Error) => {
			cleanup();
			resolve({ success: false, error: err.message });
		};

		try {
			if (useSsl) {
				socket = tls.connect(
					{
						host,
						port,
						rejectUnauthorized: false // Many NNTP servers use self-signed certs
					},
					handleConnect
				);
			} else {
				socket = net.connect({ host, port }, handleConnect);
			}

			socket.on('data', handleData);
			socket.on('error', handleError);
		} catch (error) {
			clearTimeout(timeout);
			resolve({
				success: false,
				error: error instanceof Error ? error.message : 'Connection failed'
			});
		}
	});
}

/**
 * Authenticate with AUTHINFO USER/PASS.
 */
function authenticate(
	socket: net.Socket | tls.TLSSocket,
	username: string,
	password: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		let authStep = 0;
		let response = '';

		const handleData = (data: Buffer) => {
			response += data.toString();

			if (authStep === 0 && response.includes('\r\n')) {
				// Response to AUTHINFO USER
				if (response.startsWith('381')) {
					// Need password
					authStep = 1;
					response = '';
					socket.write(`AUTHINFO PASS ${password}\r\n`);
				} else if (response.startsWith('281')) {
					// Already authenticated
					socket.off('data', handleData);
					resolve();
				} else {
					socket.off('data', handleData);
					reject(new Error(`Auth failed: ${response.trim()}`));
				}
			} else if (authStep === 1 && response.includes('\r\n')) {
				// Response to AUTHINFO PASS
				socket.off('data', handleData);
				if (response.startsWith('281')) {
					resolve();
				} else if (response.startsWith('381')) {
					// Server still asking for password
					reject(new Error('Invalid credentials. Please check your username and password.'));
				} else if (response.startsWith('482') || response.startsWith('502')) {
					reject(new Error('Authentication failed. Please check your username and password.'));
				} else {
					reject(new Error(`Authentication rejected: ${response.trim()}`));
				}
			}
		};

		socket.on('data', handleData);
		socket.write(`AUTHINFO USER ${username}\r\n`);
	});
}
