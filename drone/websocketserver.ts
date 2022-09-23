import { Evt } from "https://deno.land/x/evt@v2.4.2/mod.ts";
import {
  WebSocketClient,
  WebSocketServer,
} from "https://deno.land/x/websocket@v0.1.4/mod.ts";
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
      console.log(`WebSocket connected, id: ${id}`);
      this.connections.add(ws);
      this.connectionIds.set(ws, id);

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message);
          console.log("ws>", data);
          this.onMessage.post(data);
        } catch (error) {
          console.log("failed to parse websocket command", error);
        }
      });

      ws.on("close", () => {
        console.log(`Websocket connection closed id: ${id}`);
        this.connections.delete(ws);
        this.connectionIds.delete(ws);
      });
    });
  }

  send(type: string, payload: unknown) {
    this.broadcast(JSON.stringify({ type, payload }));
  }

  broadcast(data: Uint8Array | string) {
    this.connections.forEach((conn) => {
      // console.log("sending data to", this.connectionIds.get(conn));
      if (conn.isClosed) return;
      conn.send(data);
    });
  }
}
