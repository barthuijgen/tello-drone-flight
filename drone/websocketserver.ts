import { Evt } from "evt";
import * as log from "log";
import { WebSocketClient, WebSocketServer } from "websocket";
import { Payload } from "../shared/types.ts";

interface ServerOptions {
  port: number;
}

export class Server {
  websocket: WebSocketServer;
  connectionIds: Map<WebSocketClient, string> = new Map();
  connections: Set<WebSocketClient> = new Set();
  onMessage = new Evt<Payload>();

  constructor(options: ServerOptions) {
    this.websocket = new WebSocketServer(options.port);

    this.websocket.on("connection", (ws) => {
      const id = crypto.randomUUID();
      log.info(`WebSocket connected, id: ${id}`);
      this.connections.add(ws);
      this.connectionIds.set(ws, id);

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message);
          log.info("ws>", data);
          this.onMessage.post(data);
        } catch (error) {
          log.info("failed to parse websocket command", error);
        }
      });

      ws.on("close", () => {
        log.info(`Websocket connection closed id: ${id}`);
        this.connections.delete(ws);
        this.connectionIds.delete(ws);
      });

      ws.send(JSON.stringify({ type: "id", payload: id }));
    });
  }

  send(type: string, payload: unknown) {
    this.broadcast(JSON.stringify({ type, payload }));
  }

  broadcast(data: Uint8Array | string) {
    this.connections.forEach((conn) => {
      if (conn.isClosed) return;
      conn.send(data);
    });
  }
}
