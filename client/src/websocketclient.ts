import { Evt } from "evt";
import { Payload } from "../../shared/types";

let socket: WebSocket;

export function connect(remoteIp: string) {
  const onMessage = new Evt<Payload>();
  const onStatus = new Evt<"connecting" | "open" | "closed">();

  const reconnect = () => {
    onStatus.post("connecting");
    socket = new WebSocket(remoteIp);

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        onMessage.post(payload);
      } catch (error) {
        console.warn(`Failed to parse websocket message`, event.data);
        console.log(error);
      }
    };
    socket.onopen = () => onStatus.post("open");
    socket.onclose = () => onStatus.post("closed");
  };

  const send = (message: Payload) => {
    socket.send(JSON.stringify(message));
  };

  setInterval(() => {
    if (socket && socket.readyState !== 1) {
      reconnect();
    }
  }, 1000);

  reconnect();

  return { onMessage, onStatus, send };
}
