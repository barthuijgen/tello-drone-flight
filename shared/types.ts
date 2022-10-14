export interface Telemetry {
  mid: number;
  x: number;
  y: number;
  z: number;
  mpry: number;
  pitch: number;
  roll: number;
  yaw: number;
  vgx: number;
  vgy: number;
  vgz: number;
  templ: number;
  temph: number;
  tof: number;
  h: number;
  bat: number;
  baro: number;
  time: number;
  agx: number;
  agy: number;
  agz: number;
}

export interface DroneState {
  hostname: string | null;
  active: boolean;
  telemetry: Telemetry | null;
  camera: boolean;
}

export interface State {
  drones: DroneState[];
}

type PayloadId = { type: "id"; payload: string };
type PayloadState = { type: "state"; payload: State };
type PayloadStart = { type: "start"; payload: { hostname: string | null } };
type PayloadStop = { type: "stop"; payload: { hostname: string | null } };
type PayloadEmergency = { type: "emergency"; payload: { hostname?: string | null } };
type PayloadCommand = {
  type: "command";
  payload: { hostname: string | null; command: string };
};
type PayloadStream = {
  type: "stream";
  payload: { hostname: string | null; enabled: boolean };
};

export type Payload =
  | PayloadId
  | PayloadState
  | PayloadStart
  | PayloadStop
  | PayloadCommand
  | PayloadStream
  | PayloadEmergency;

export type TConnectionStatus = "connecting" | "open" | "closed";
