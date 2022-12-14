import * as log from "log";
import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";
import { Server } from "./websocketserver.ts";
import { FFMPEG } from "./ffmpeg.ts";
import { FlightManager, FlightStep } from "./flightpath.ts";

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
    if (message.payload.hostname) {
      manager.getDrone(message.payload.hostname).start();
    }
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
    if (message.payload.hostname) {
      const drone = manager.getDrone(message.payload.hostname);

      if (message.payload.enabled) {
        ffmpeg.start();
        drone.command(commands.streamon());
      } else {
        drone.command(commands.streamoff());
      }
    }
  }
  if (message.type === "command") {
    if (message.payload.hostname) {
      const drone = manager.getDrone(message.payload.hostname);
      if (message.payload.command === "land") {
        drone.clearQueueExcept("land");
      }
      drone.command(message.payload.command);
    }
  }
  if (message.type === "flightplan") {
    if (message.payload.plan === 1) {
      flightPlanOne();
    }
    if (message.payload.plan === 2) {
      flightPlanTwo();
    }
    if (message.payload.plan === 3) {
      flightPlanThree();
    }
  }
});

if (Deno.args.includes("--ap")) {
  await manager.connectToAccessPoint("drones_wifi", "drones_wifi");
  Deno.exit();
}

manager.registerDrone("192.168.8.134");
manager.registerDrone("192.168.8.120");
manager.registerDrone("192.168.8.171");
const drones = Array.from(manager.drones.values());
const flightManager = new FlightManager(manager);

if (Deno.args.includes("--idle")) {
  manager.drones.forEach((drone) => drone.start());
}

function flightPlanOne() {
  flightManager.setFlightPlan(drones[0].hostname, [
    {
      command: commands.takeoff(),
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 5),
    },
    ...[2, 6, 1, 5, 2, 6, 1, 5].map(
      (mid, i) =>
        ({
          command: commands.matrixGo(0, 0, 100, 70, mid),
          waitFor: (m) =>
            m.plans.get(drones[1].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[2].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);

  flightManager.setFlightPlan(drones[1].hostname, [
    {
      command: commands.takeoff(),
      waitFor: (m) => m.plans.get(drones[0].hostname)?.completedStep === 1,
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 6),
    },
    ...[3, 7, 2, 6, 3, 7, 2, 6].map(
      (mid, i) =>
        ({
          command: commands.matrixGo(0, 0, 100, 70, mid),
          waitFor: (m) =>
            m.plans.get(drones[0].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[2].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);

  flightManager.setFlightPlan(drones[2].hostname, [
    {
      command: commands.takeoff(),
      waitFor: (m) =>
        m.plans.get(drones[0].hostname)?.completedStep === 1 &&
        m.plans.get(drones[1].hostname)?.completedStep === 1,
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 7),
    },
    ...[4, 8, 3, 7, 4, 8, 3, 7].map(
      (mid, i) =>
        ({
          command: commands.matrixGo(0, 0, 100, 70, mid),
          waitFor: (m) =>
            m.plans.get(drones[0].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[1].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);
  flightManager.start();
}

/////////////////////////////////////////////////////////////////////

function flightPlanTwo() {
  flightManager.setFlightPlan(drones[0].hostname, [
    {
      command: commands.takeoff(),
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 5),
    },
    ...[6, 7, 8, 4, 3, 2, 1, 5].map(
      (mid, i) =>
        ({
          command: commands.matrixGo(0, 0, 100, 70, mid),
          waitFor: (m) =>
            m.plans.get(drones[1].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[2].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);

  flightManager.setFlightPlan(drones[1].hostname, [
    {
      command: commands.takeoff(),
      waitFor: (m) => m.plans.get(drones[0].hostname)?.completedStep === 1,
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 6),
    },
    ...[7, 8, 4, 3, 2, 1, 5, 6].map(
      (mid, i) =>
        ({
          command: commands.matrixGo(0, 0, 100, 70, mid),
          waitFor: (m) =>
            m.plans.get(drones[1].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[2].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);

  flightManager.setFlightPlan(drones[2].hostname, [
    {
      command: commands.takeoff(),
      waitFor: (m) =>
        m.plans.get(drones[0].hostname)?.completedStep === 1 &&
        m.plans.get(drones[1].hostname)?.completedStep === 1,
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 7),
    },
    ...[8, 4, 3, 2, 1, 5, 6, 7].map(
      (mid, i) =>
        ({
          command: commands.matrixGo(0, 0, 100, 70, mid),
          waitFor: (m) =>
            m.plans.get(drones[1].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[2].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);
  flightManager.start();
}

/////////////////////////////////////////////////////////////////////

function flightPlanThree() {
  flightManager.setFlightPlan(drones[0].hostname, [
    {
      command: commands.takeoff(),
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 5),
    },
    ...[100, 150, 200, 150, 100, 100].map(
      (height, i) =>
        ({
          command: commands.matrixGo(0, 0, height, 70, 5),
          waitFor: (m) =>
            m.plans.get(drones[1].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[2].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);

  flightManager.setFlightPlan(drones[1].hostname, [
    {
      command: commands.takeoff(),
      waitFor: (m) => m.plans.get(drones[0].hostname)?.completedStep === 1,
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 6),
    },
    ...[100, 100, 150, 200, 150, 100, 100].map(
      (height, i) =>
        ({
          command: commands.matrixGo(0, 0, height, 70, 6),
          waitFor: (m) =>
            m.plans.get(drones[0].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[2].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);

  flightManager.setFlightPlan(drones[2].hostname, [
    {
      command: commands.takeoff(),
      waitFor: (m) =>
        m.plans.get(drones[0].hostname)?.completedStep === 1 &&
        m.plans.get(drones[1].hostname)?.completedStep === 1,
    },
    {
      command: commands.matrixGo(0, 0, 100, 70, 7),
    },
    ...[100, 100, 100, 150, 200, 150, 100].map(
      (height, i) =>
        ({
          command: commands.matrixGo(0, 0, height, 70, 7),
          waitFor: (m) =>
            m.plans.get(drones[0].hostname)?.completedStep === i + 1 &&
            m.plans.get(drones[1].hostname)?.completedStep === i + 1,
        } as FlightStep)
    ),
  ]);
  flightManager.start();
}

if (Deno.args.includes("--fly")) {
  flightPlanOne();
}
if (Deno.args.includes("--fly2")) {
  flightPlanTwo();
}
if (Deno.args.includes("--fly3")) {
  flightPlanThree();
}

function flightPlanTest() {
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
}
