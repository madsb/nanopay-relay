import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import nacl from 'tweetnacl';
import { LIMITS } from '../limits';

const HEX_LOWER_REGEX = /^[0-9a-f]+$/;

const isLowerHex = (value: string, length: number) =>
  value.length === length && HEX_LOWER_REGEX.test(value) && value === value.toLowerCase();

const hexToBytes = (value: string) => {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return bytes;
};

export const registerSellerWs = (
  app: FastifyInstance,
  sellerSockets: Map<string, Set<WebSocket>>
) => {
  app.get('/ws/seller', { websocket: true }, (connection) => {
    const socket = connection.socket as WebSocket;
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + LIMITS.wsChallengeTtlMs);
    let authenticated = false;
    let sellerPubkey: string | null = null;

    const send = (payload: unknown) => socket.send(JSON.stringify(payload));
    const sendError = (code: string, message: string) => {
      send({ type: 'error', code, message });
      socket.close();
    };

    send({
      type: 'auth.challenge',
      nonce,
      expires_at: expiresAt.toISOString(),
      server_time: new Date().toISOString()
    });

    const timeout = setTimeout(() => {
      if (!authenticated) {
        sendError('auth.expired_challenge', 'Challenge expired');
      }
    }, LIMITS.wsChallengeTtlMs + 10);

    socket.on('message', (data) => {
      const raw = typeof data === 'string' ? data : Buffer.from(data as Buffer).toString('utf8');
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return sendError('invalid_json', 'Invalid JSON');
      }

      if (!payload?.type) {
        return sendError('unknown_type', 'Missing message type');
      }

      if (!authenticated) {
        if (payload.type !== 'auth.response') {
          return sendError('unknown_type', 'Unexpected message type');
        }
        if (Date.now() > expiresAt.getTime()) {
          return sendError('auth.expired_challenge', 'Challenge expired');
        }
        if (typeof payload.pubkey !== 'string' || !isLowerHex(payload.pubkey, 64)) {
          return sendError('auth.invalid_pubkey', 'Invalid pubkey');
        }
        if (typeof payload.signature !== 'string' || !isLowerHex(payload.signature, 128)) {
          return sendError('auth.invalid_signature', 'Invalid signature');
        }

        const valid = nacl.sign.detached.verify(
          Buffer.from(nonce, 'utf8'),
          hexToBytes(payload.signature),
          hexToBytes(payload.pubkey)
        );

        if (!valid) {
          return sendError('auth.invalid_signature', 'Invalid signature');
        }

        authenticated = true;
        sellerPubkey = payload.pubkey;
        if (!sellerSockets.has(sellerPubkey)) {
          sellerSockets.set(sellerPubkey, new Set());
        }
        sellerSockets.get(sellerPubkey)?.add(socket);
        clearTimeout(timeout);
        return send({ type: 'auth.ok', seller_pubkey: sellerPubkey });
      }

      return sendError('unknown_type', 'Unexpected message type');
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      if (authenticated && sellerPubkey) {
        const set = sellerSockets.get(sellerPubkey);
        if (set) {
          set.delete(socket);
          if (set.size === 0) {
            sellerSockets.delete(sellerPubkey);
          }
        }
      }
    });
  });
};
