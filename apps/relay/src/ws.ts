import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import { verifyDetachedHex } from "@nanopay/shared";
import { LIMITS } from "./constants.js";

type PresenceMap = Map<string, Set<WebSocket>>;

export type SellerPresence = {
  addConnection: (pubkey: string, socket: WebSocket) => void;
  removeConnection: (pubkey: string, socket: WebSocket) => void;
  isOnline: (pubkey: string) => boolean;
  listOnline: () => string[];
  notifySeller: (pubkey: string) => void;
};

const hexRegex = /^[0-9a-f]+$/;

const isHexLength = (value: string, min: number, max: number) => {
  if (value.length < min || value.length > max) return false;
  return hexRegex.test(value);
};

const safeSend = (socket: WebSocket, payload: unknown) => {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // ignore send failures
  }
};

export const createSellerPresence = (): SellerPresence => {
  const connections: PresenceMap = new Map();

  const addConnection = (pubkey: string, socket: WebSocket) => {
    const existing = connections.get(pubkey) ?? new Set<WebSocket>();
    existing.add(socket);
    connections.set(pubkey, existing);
  };

  const removeConnection = (pubkey: string, socket: WebSocket) => {
    const existing = connections.get(pubkey);
    if (!existing) return;
    existing.delete(socket);
    if (existing.size === 0) {
      connections.delete(pubkey);
    }
  };

  const isOnline = (pubkey: string) => connections.has(pubkey);

  const listOnline = () => Array.from(connections.keys());

  const notifySeller = (pubkey: string) => {
    const sockets = connections.get(pubkey);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify({ type: "hint.new_job" });
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        // ignore send failures
      }
    }
  };

  return {
    addConnection,
    removeConnection,
    isOnline,
    listOnline,
    notifySeller
  };
};

export const registerSellerWebsocket = async (app: FastifyInstance) => {
  await app.register(websocket);

  app.get("/ws/seller", { websocket: true }, (socket) => {
    const wsSocket =
      (socket as { socket?: WebSocket } | undefined)?.socket ??
      (socket as WebSocket | undefined);
    if (!wsSocket) {
      app.log.error("Missing websocket connection");
      return;
    }
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = new Date(
      Date.now() + LIMITS.wsAuthChallengeTtlSeconds * 1000
    );
    const serverTime = new Date();
    let authed = false;
    let sellerPubkey: string | null = null;

    const closeWithError = (code: string, message: string) => {
      safeSend(wsSocket, { type: "error", code, message });
      if (wsSocket.readyState !== wsSocket.CLOSED) {
        wsSocket.close();
      }
    };

    const expireTimer = setTimeout(() => {
      if (!authed) {
        closeWithError("auth.expired_challenge", "Challenge expired");
      }
    }, LIMITS.wsAuthChallengeTtlSeconds * 1000);

    safeSend(wsSocket, {
      type: "auth.challenge",
      nonce,
      expires_at: expiresAt.toISOString(),
      server_time: serverTime.toISOString()
    });

    const cleanup = () => {
      clearTimeout(expireTimer);
      if (sellerPubkey) {
        app.sellerPresence.removeConnection(sellerPubkey, wsSocket);
      }
    };

    wsSocket.on("close", cleanup);
    wsSocket.on("error", (err) => {
      app.log.error(err);
    });

    wsSocket.on("message", (raw) => {
      let message: { type?: string; pubkey?: string; signature?: string } | null =
        null;
      try {
        const text =
          typeof raw === "string"
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString("utf8")
              : Buffer.from(raw as ArrayBuffer).toString("utf8");
        message = JSON.parse(text);
      } catch {
        closeWithError("invalid_message", "Invalid JSON message");
        return;
      }

      if (!message || typeof message.type !== "string") {
        closeWithError("invalid_message", "Missing message type");
        return;
      }

      if (!authed) {
        if (message.type !== "auth.response") {
          closeWithError("invalid_message", "Unexpected message type");
          return;
        }

        const pubkey = message.pubkey;
        const signature = message.signature;
        if (!pubkey || !isHexLength(pubkey, 64, 64)) {
          closeWithError("auth.invalid_pubkey", "Invalid pubkey");
          return;
        }
        if (!signature || !isHexLength(signature, 128, 128)) {
          closeWithError("auth.invalid_signature", "Invalid signature");
          return;
        }
        if (Date.now() > expiresAt.getTime()) {
          closeWithError("auth.expired_challenge", "Challenge expired");
          return;
        }
        const valid = verifyDetachedHex(nonce, signature, pubkey);
        if (!valid) {
          closeWithError("auth.invalid_signature", "Invalid signature");
          return;
        }

        authed = true;
        sellerPubkey = pubkey;
        clearTimeout(expireTimer);
        app.sellerPresence.addConnection(pubkey, wsSocket);
        safeSend(wsSocket, { type: "auth.ok", seller_pubkey: pubkey });
        return;
      }

      closeWithError("invalid_message", "Unknown message type");
    });
  });
};
