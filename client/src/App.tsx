import { useEffect, useMemo, useState } from "react";
import { State } from "../../shared/types";
import { DroneView } from "./drone-view/DroneView";
import { useWebsocketClient } from "./hooks/socket";
import { VideoSteam } from "./video";

export const App = () => {
  const [state, setState] = useState<State>();
  const [commandInput, setCommandInput] = useState("");
  const { send, onMessage, status } = useWebsocketClient("ws://127.0.0.1:8891");

  useEffect(() => {
    onMessage.attach((message) => {
      if (message.type === "state") {
        setState(message.payload);
      }
    });
  }, [onMessage]);

  const hasVideoSteam = useMemo(() => {
    return state?.drones.some((x) => x.camera) ?? false;
  }, [state]);

  return (
    <div>
      <div>Conection: {status}</div>
      {state?.drones.map((drone) => (
        <div key={drone.hostname}>
          <div>Hostname: {drone.hostname}</div>
          <div>Active: {drone.active ? "true" : "false"}</div>
          <div>Camera: {drone.camera ? "true" : "false"}</div>
          <div>
            <input
              type="text"
              onChange={(ev) => setCommandInput(ev.target.value)}
            />
            <button
              onClick={() =>
                send({
                  type: "command",
                  payload: { hostname: drone.hostname, command: commandInput },
                })
              }
            >
              send
            </button>
          </div>

          {!drone.active && (
            <button
              onClick={() =>
                send({ type: "start", payload: { hostname: drone.hostname } })
              }
            >
              Start Drone
            </button>
          )}
          {drone.camera ? (
            <button
              onClick={() =>
                send({
                  type: "stream",
                  payload: { hostname: drone.hostname, enabled: false },
                })
              }
            >
              Stop camera
            </button>
          ) : (
            <button
              onClick={() =>
                send({
                  type: "stream",
                  payload: { hostname: drone.hostname, enabled: true },
                })
              }
            >
              Start camera
            </button>
          )}
          <button
            onClick={() =>
              send({
                type: "emergency",
                payload: { hostname: drone.hostname },
              })
            }
          >
            Emergency
          </button>
          {drone.telemetry && (
            <>
              <DroneView
                x={drone.telemetry.pitch}
                y={-drone.telemetry.yaw}
                z={-drone.telemetry.roll}
              />
              <div>
                <span
                  style={{
                    display: "inline-block",
                    width: "50px",
                    color:
                      drone.telemetry.bat < 20
                        ? "red"
                        : drone.telemetry.bat < 30
                        ? "orange"
                        : drone.telemetry.bat < 40
                        ? "#b4b814"
                        : "inherit",
                  }}
                >
                  Battery
                </span>
                <progress max={100} value={drone.telemetry.bat} />
              </div>
              <div>
                <span
                  style={{
                    display: "inline-block",
                    width: "50px",
                    color:
                      drone.telemetry.temph > 80
                        ? "red"
                        : drone.telemetry.temph > 70
                        ? "orange"
                        : drone.telemetry.temph > 60
                        ? "#b4b814"
                        : "inherit",
                  }}
                >
                  Temp
                </span>
                <progress max={100} value={drone.telemetry.temph} />
              </div>
            </>
          )}
          <pre>{JSON.stringify(drone.telemetry, null, 2)}</pre>
        </div>
      ))}
      {hasVideoSteam && <VideoSteam />}
    </div>
  );
};
