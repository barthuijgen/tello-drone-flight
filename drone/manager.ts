import { Evt } from "https://deno.land/x/evt@v2.4.2/mod.ts";
import { commands, readCommands } from "./commands.ts";
import { Drone } from "./drone.ts";
import { State } from "../shared/types.ts";

const commandPort = 8889;
const telmetryPort = 8890;
const transport = "udp";

export class DroneManager {
  public drones: Map<string, Drone> = new Map();
  private commandConn: Deno.DatagramConn;
  private telemetryConn: Deno.DatagramConn;
  public updateEvt = new Evt<State>();

  constructor() {
    this.commandConn = Deno.listenDatagram({
      port: commandPort,
      transport,
      hostname: "0.0.0.0",
    });
    this.telemetryConn = Deno.listenDatagram({
      port: telmetryPort,
      transport,
      hostname: "0.0.0.0",
    });
    this.listenToSocket();
    this.listenToTelemetrySocket();

    setInterval(() => {
      this.updateState();
    }, 500);
    // Prevent drones from sleeping by no commands
    setInterval(() => {
      this.drones.forEach(
        (drone) => drone.active && drone.send(readCommands.battery)
      );
    }, 5000);
  }

  getDrone(id: string | number) {
    if (typeof id === "string") {
      const drone = this.drones.get(id);
      if (drone) return drone;
    } else if (typeof id === "number") {
      const drone = Array.from(this.drones.values())[id];
      if (drone) return drone;
    }
    throw Error("invalid id");
  }

  registerDrone(hostname: string) {
    const drone = new Drone(this, hostname);
    this.drones.set(hostname, drone);
    return drone;
  }

  async connectToAccessPoint(ssid: string, pass: string) {
    const drone = this.registerDrone("192.168.10.1");
    await drone.start();
    await drone.send(commands.ap(ssid, pass));
  }

  sendCommand(hostname: string, message: string) {
    try {
      const encoder = new TextEncoder();
      this.commandConn.send(encoder.encode(message), {
        port: commandPort,
        transport,
        hostname,
      });
    } catch (error) {
      console.log("Failed to send command to drone", error);
    }
  }

  updateState() {
    this.updateEvt.post({
      drones: Array.from(this.drones.entries()).map(([hostname, drone]) => ({
        hostname,
        active: drone.active,
        camera: drone.streamEnabled,
        telemetry: drone.telemetry,
      })),
    });
  }

  private async listenToSocket() {
    for await (const data of this.commandConn) {
      const address = data[1];
      if (address.transport === "udp") {
        const drone = this.drones.get(address.hostname);
        if (drone) {
          const decoder = new TextDecoder();
          const message = decoder.decode(data[0]);
          drone.onMessage(message);
        }
      }
    }
  }

  private async listenToTelemetrySocket() {
    for await (const data of this.telemetryConn) {
      const address = data[1];
      if (address.transport === "udp") {
        const drone = this.drones.get(address.hostname);
        if (drone) {
          const decoder = new TextDecoder();
          const message = decoder.decode(data[0]);
          drone.onTelemetryMessage(message);
        }
      }
    }
  }
}
