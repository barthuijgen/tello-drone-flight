import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";
import { Server } from "./websocketserver.ts";
import { FFMPEG } from "./ffmpeg.ts";

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
      manager.getDrone(message.payload.hostname).send(commands.emergency());
    } else {
      manager.drones.forEach((drone) => {
        drone.send(commands.emergency());
      });
    }
  }
  if (message.type === "stream") {
    const drone = manager.getDrone(message.payload.hostname);

    if (message.payload.enabled) {
      ffmpeg.start();
      drone.send(commands.streamon());
    } else {
      drone.send(commands.streamoff());
    }
  }
  if (message.type === "command") {
    const drone = manager.getDrone(message.payload.hostname);
    drone.command(message.payload.command);
  }
});

manager.registerDrone("192.168.87.20");
