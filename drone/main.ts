import * as log from "log";
import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";
import { Server } from "./websocketserver.ts";
import { FFMPEG } from "./ffmpeg.ts";
import { FlightManager } from "./flightpath.ts";

log.setup({
  handlers: {
    default: new log.handlers.ConsoleHandler("DEBUG", {
      formatter(log) {
        const data = (
          log.args[0] && typeof log.args[0] === "object" ? log.args[0] : {}
        ) as Record<string, unknown>;

        const { drone, ...rest } = data;
        let msg = drone
          ? `[${log.levelName}][${drone}] ${log.msg} `
          : `[${log.levelName}] ${log.msg} `;

        if (rest) {
          msg += Object.entries(rest)
            .map(([key, val]) => `${key}: ${JSON.stringify(val)}`)
            .join(", ");
        }

        return msg;
      },
    }),
  },
  loggers: {
    default: {
      level: "INFO",
      handlers: ["default"],
    },
  },
});

const manager = new DroneManager();
const server = new Server({ port: 8891 });
const ffmpeg = new FFMPEG(new Server({ port: 8892 }));

manager.updateEvt.attach((state) => server.send("state", state));

server.onMessage.attach((message) => {
  if (message.type === "start") {
    manager.getDrone(message.payload.hostname).start();
  }
  if (message.type === "emergency") {
    if (message.payload.hostname) {
      manager.getDrone(message.payload.hostname).command(commands.emergency());
    } else {
      manager.drones.forEach((drone) => {
        drone.command(commands.emergency());
      });
    }
  }
  if (message.type === "stream") {
    const drone = manager.getDrone(message.payload.hostname);

    if (message.payload.enabled) {
      ffmpeg.start();
      drone.command(commands.streamon());
    } else {
      drone.command(commands.streamoff());
    }
  }
  if (message.type === "command") {
    const drone = manager.getDrone(message.payload.hostname);
    drone.command(message.payload.command);
  }
});

if (Deno.args.includes("--ap")) {
  await manager.connectToAccessPoint("drones_wifi", "drones_wifi");
  Deno.exit();
}

const drone = manager.registerDrone("192.168.8.120");
// await drone.command(commands.command());

if (Deno.args.includes("--fly")) {
  const flightManager = new FlightManager(manager);
  flightManager.setFlightPlan(drone.hostname, [
    { mid: 8, x: 0, y: 0, z: 100 },
    { mid: 8, x: 25, y: 0, z: 100 },
    { mid: 8, x: 0, y: 25, z: 100 },
  ]);
  flightManager.start();
}
