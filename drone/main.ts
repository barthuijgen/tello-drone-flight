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

const drone1 = manager.registerDrone("192.168.8.120");
const drone2 = manager.registerDrone("192.168.8.121");
const drone3 = manager.registerDrone("192.168.8.171");

if (Deno.args.includes("--idle")) {
  drone1.start();
  drone2.start();
  drone3.start();
}

/**
 Coord system based on rocket symbol
 +x = forwards
 -x = backwards
 +y = left
 -y = right
 */

if (Deno.args.includes("--fly")) {
  const flightManager = new FlightManager(manager);

  // curve test
  // flightManager.setFlightPlan(drone1.hostname, [
  //   {
  //     command: commands.go(0, 0, 100, 70, 1),
  //   },
  //   {
  //     command: commands.curve(
  //       // coord 1
  //       -100,
  //       -100,
  //       0,
  //       // coord 2
  //       0,
  //       -200,
  //       0,
  //       //speed
  //       50
  //     ),
  //   },
  // ]);

  // mutliple mid test
  // flightManager.setFlightPlan(drone2.hostname, [
  //   { command: commands.go(0, 0, 100, 70, 5) },
  //   { command: commands.go(0, 60, 100, 70, 5) },
  //   { command: commands.go(0, 0, 100, 70, 3) },
  //   { command: commands.go(0, 0, 70, 70, 3) },
  // ]);
  flightManager.setFlightPlan(drone2.hostname, [
    { command: commands.matrixGo(0, 0, 100, 70, 5) },
    { command: commands.matrixGo(0, 0, 100, 70, 3) },
    { command: commands.matrixGo(0, 0, 100, 70, 1) },
    { command: commands.matrixGo(0, 0, 100, 70, 6) },
  ]);

  // const drone1Mid = 1;
  // flightManager.setFlightPlan(drone1.hostname, [
  //   {
  //     command: commands.go(0, 0, 100, flightManager.defaultSpeed, drone1Mid),
  //     waitAtMid: drone1Mid,
  //   },
  //   {
  //     command: commands.go(0, 0, 70, flightManager.defaultSpeed, drone1Mid),
  //     waitFor: (m) => m.plans.get(drone2.hostname)?.completedStep === 0,
  //     waitAtMid: drone1Mid,
  //   },
  //   {
  //     command: commands.go(0, 0, 100, flightManager.defaultSpeed, drone1Mid),
  //     waitFor: (m) => m.plans.get(drone2.hostname)?.completedStep === 1,
  //     waitAtMid: drone1Mid,
  //   },
  //   {
  //     command: commands.go(0, 0, 70, flightManager.defaultSpeed, drone1Mid),
  //     waitFor: (m) => m.plans.get(drone2.hostname)?.completedStep === 2,
  //     waitAtMid: drone1Mid,
  //   },
  // ]);

  // const drone2Mid = 3;
  // flightManager.setFlightPlan(drone2.hostname, [
  //   {
  //     command: commands.go(0, 0, 100, flightManager.defaultSpeed, drone2Mid),
  //     waitAtMid: drone2Mid,
  //   },
  //   {
  //     command: commands.go(0, 0, 70, flightManager.defaultSpeed, drone2Mid),
  //     waitFor: (m) => m.plans.get(drone1.hostname)?.completedStep === 0,
  //     waitAtMid: drone2Mid,
  //   },
  //   {
  //     command: commands.go(0, 0, 100, flightManager.defaultSpeed, drone2Mid),
  //     waitFor: (m) => m.plans.get(drone1.hostname)?.completedStep === 1,
  //     waitAtMid: drone2Mid,
  //   },
  //   {
  //     command: commands.go(0, 0, 70, flightManager.defaultSpeed, drone2Mid),
  //     waitFor: (m) => m.plans.get(drone1.hostname)?.completedStep === 2,
  //     waitAtMid: drone2Mid,
  //   },
  // ]);

  flightManager.start();
}
