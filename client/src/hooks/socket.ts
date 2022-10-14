import { Evt } from "evt";
import { useCallback, useEffect, useRef, useState } from "react";
import { Payload } from "../../../shared/types";

export function useWebsocketClient(remoteIp: string) {
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "closed"
  );
  const websocketRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(new Evt<Payload>());
  const reconnectTimeoutRef = useRef<any>(null);

  useEffect(() => {
    setStatus("connecting");
    if (websocketRef.current) websocketRef.current.close();
    websocketRef.current = new WebSocket(remoteIp);

    websocketRef.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        onMessageRef.current.post(payload);
      } catch (error) {
        console.warn(`Failed to parse websocket message`, event.data);
        console.log(error);
      }
    };
    websocketRef.current.onopen = () => setStatus("open");
    websocketRef.current.onclose = () => {
      setStatus("closed");
      reconnect();
    };
  }, [remoteIp, reconnectAttempt]);

  useEffect(() => {
    return () => {
      websocketRef.current?.close();
      websocketRef.current = null;
      onMessageRef.current.detach();
    };
  }, []);

  const reconnect = useCallback(() => {
    reconnectTimeoutRef.current = setTimeout(() => {
      if (websocketRef.current?.readyState !== 1) {
        setReconnectAttempt(reconnectAttempt + 1);
      }
    }, 1000);
  }, [reconnectAttempt]);

  const send = useCallback((message: Payload) => {
    websocketRef.current?.send(JSON.stringify(message));
  }, []);

  return { status, onMessage: onMessageRef.current, send };
}
