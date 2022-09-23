import { Evt } from "https://deno.land/x/evt@v2.4.2/mod.ts";
import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";
import { Telemetry } from "../shared/types.ts";

export class Drone {
  telemetry: Telemetry | null = null;
  commandBuffer: string[] = [];
  commandCallback: ((message: string) => void) | null = null;
  telemetryEvt = Evt.create<Telemetry>();
  active = false;
  streamEnabled = false;

  constructor(public manager: DroneManager, public hostname: string) {}

  onMessage(message: string) {
    console.log(`drone${this.hostname}<`, message);
    if (this.commandCallback) {
      this.commandCallback(message);
      this.commandCallback = null;
    }
  }

  onTelemetryMessage(message: string) {
    this.active = true;
    this.telemetry = message
      .trim()
      .split(";")
      .reduce((memo, string) => {
        const [key, val] = string.split(":");
        if (key) memo[key as keyof Telemetry] = parseFloat(val);
        return memo;
      }, {} as Telemetry);
    this.telemetryEvt.post(this.telemetry);
  }

  send(message: string) {
    return new Promise((resolve) => {
      if (this.commandCallback) {
        console.log("there is already a command queued");
        return;
      }
      if (!this.active && message !== "command") {
        return console.log(
          `drone${this.hostname}>`,
          "First start the drone before using commands"
        );
      }
      console.log(`drone${this.hostname}>`, message);
      this.commandCallback = (response) => {
        if (response === "ok") {
          if (message === "command") this.active = true;
          if (message === "streamon") this.streamEnabled = true;
          if (message === "streamoff") this.streamEnabled = false;
          resolve("");
        }
        if (response === "error") {
          console.log("Error!!");
          resolve("");
        } else {
          resolve(response);
        }
      };

      this.manager.sendCommand(this.hostname, message);
    });
  }

  async start() {
    await this.send(commands.command());
  }
}
