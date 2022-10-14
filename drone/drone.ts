import { Evt } from "evt";
import * as log from "log";
import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";
import { Telemetry } from "../shared/types.ts";

interface Command {
  command: string;
  callback: Evt<string>;
  error: (error: string) => void;
  time: number;
}

export class Drone {
  telemetry: Telemetry | null = null;
  commandBuffer: Command[] = [];
  telemetryEvt = Evt.create<Telemetry>();
  lastTelemetry = 0;
  active = false;
  flying = false;
  streamEnabled = false;

  constructor(public manager: DroneManager, public hostname: string) {
    setInterval(() => {
      if (this.active && Date.now() - this.lastTelemetry > 1000) {
        // Have not received telemetry, drone is not active anymore
        this.active = false;
        this.flying = false;
        this.streamEnabled = false;
      }
    }, 5000);
  }

  async processCommandBuffer() {
    while (this.commandBuffer.length > 0) {
      const command = this.commandBuffer[0];

      if (!this.active && command.command !== "command") {
        log.info("Clearing command buffer, drone inactive", {
          drone: this.hostname,
        });
        this.commandBuffer = [];
        return;
      }

      try {
        await this.manager.sendCommand(this.hostname, command.command);
        const timeoutMap: Record<string, number> = {
          takeoff: 30000,
          command: 5000,
        };
        await command.callback.waitFor(timeoutMap[command.command] || 10000);
      } catch (error) {
        const isTimeout =
          "message" in error && error.message.includes("Evt timeout");
        const reason = isTimeout ? "timeout" : "error";

        log.info(
          `send "${command.command}": ${reason} (${
            Date.now() - command.time
          }ms)`,
          { drone: this.hostname, error: error.message }
        );

        command.callback.post(isTimeout ? "timeout" : "error");
      }

      this.commandBuffer = this.commandBuffer.slice(1);
    }
  }

  onMessage(message: string) {
    if (this.commandBuffer.length > 0) {
      const command = this.commandBuffer[0];
      log.info(
        `[ANSWER] "${command.command}": ${message.trim()} (${
          Date.now() - command.time
        }ms)`,
        { drone: this.hostname }
      );
      this.commandBuffer[0].callback.post(message);
    }
  }

  onTelemetryMessage(message: string) {
    this.active = true;
    this.lastTelemetry = Date.now();
    this.telemetry = message
      .trim()
      .split(";")
      .reduce((memo, string) => {
        const [key, val] = string.split(":");
        if (key) memo[key as keyof Telemetry] = parseFloat(val);
        return memo;
      }, {} as Telemetry);

    if (this.flying && this.telemetry.h === 0) {
      console.log("telemetry.h is 0, not flying anymore.");
      this.flying = false;
    }

    this.telemetryEvt.post(this.telemetry);
  }

  async commandIfNotQueued(command: string): Promise<string | null> {
    if (this.commandBuffer.some((x) => x.command === command)) {
      // console.log(`command ${command} already buffered, ignoring`);
      return null;
    }
    return await this.command(command);
  }

  command(command: string): Promise<string> {
    return new Promise((resolve) => {
      log.info(`buffer command "${command}"`, {
        drone: this.hostname,
      });

      const callback = new Evt<string>();

      callback.attachOnce((response) => {
        response = response.trim();

        if (command === "command" && response === "command") {
          log.error(
            `Unexpected answer on "command", did the drone switch to a different IP?`,
            { drone: this.hostname }
          );
        }

        if (response === "ok") {
          if (command === "command") this.active = true;
          if (command === "streamon") this.streamEnabled = true;
          if (command === "streamoff") this.streamEnabled = false;
          if (command === "takeoff") this.flying = true;
          if (command === "land") this.flying = false;
          resolve("ok");
        } else if (response === "error") {
          log.info("command responded with error", {
            drone: this.hostname,
            command,
          });
          resolve("error");
        } else {
          resolve(response);
        }
      });

      this.commandBuffer.push({
        command,
        callback,
        error: (error: string) => resolve(error),
        time: Date.now(),
      });

      if (this.commandBuffer.length === 1) this.processCommandBuffer();
    });
  }

  async start() {
    await this.command(commands.command());
  }
}
