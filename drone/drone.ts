import { Evt } from "https://deno.land/x/evt@v2.4.2/mod.ts";
import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";
import { Telemetry } from "../shared/types.ts";

interface Command {
  command: string;
  callback: (message: string) => void;
  error: (error: unknown) => void;
  time: number;
}

export class Drone {
  telemetry: Telemetry | null = null;
  commandBuffer: Command[] = [];
  commandCallback: ((message: string) => void) | null = null;
  telemetryEvt = Evt.create<Telemetry>();
  active = false;
  streamEnabled = false;

  constructor(public manager: DroneManager, public hostname: string) {}

  async processCommandBuffer() {
    while (this.commandBuffer.length > 0) {
      const command = this.commandBuffer[0];

      if (!this.active && command.command !== "command") {
        console.log("Clearing command buffer, drone inactive");
        this.commandBuffer = [];
        return;
      }

      try {
        const result = await this.send(command.command);
        console.log(
          `[drone:${this.hostname}] "${command.command}": ${result} (${
            Date.now() - command.time
          }ms)`
        );
        command.callback(result);
      } catch (error) {
        console.log(
          `[drone:${this.hostname}] "${command.command}": error (${
            Date.now() - command.time
          }ms)`
        );
        console.log(error);
        command.error(error);
      }

      this.commandBuffer = this.commandBuffer.slice(1);
    }
  }

  onMessage(message: string) {
    // console.log(`[drone:${this.hostname}] <`, message);
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

  command(command: string) {
    return new Promise((resolve, reject) => {
      this.commandBuffer.push({
        command,
        callback: resolve,
        error: reject,
        time: Date.now(),
      });
      if (this.commandBuffer.length === 1) this.processCommandBuffer();
    });
  }

  send(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.commandCallback) {
        console.log("there is already a command queued");
        return;
      }

      console.log(`[drone:${this.hostname}] >`, message);
      this.commandCallback = (response) => {
        if (response === "ok") {
          if (message === "command") this.active = true;
          if (message === "streamon") this.streamEnabled = true;
          if (message === "streamoff") this.streamEnabled = false;
          resolve("ok");
        }
        if (response === "error") {
          console.log("Error!!");
          resolve("error");
        } else {
          resolve(response.trim());
        }
      };

      this.manager.sendCommand(this.hostname, message);

      // Drone became unresponsive
      setTimeout(() => {
        this.commandCallback = null;
        reject(new Error("command timed out"));
      }, 10000);
    });
  }

  async start() {
    await this.send(commands.command());
  }
}
