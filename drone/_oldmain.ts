import {
  WebSocketClient,
  WebSocketServer,
} from "https://deno.land/x/websocket/mod.ts";

const port = 8889;
const telmetryPort = 8890;
const webPort = 8887;
const transport = "udp";

interface Telemetry {
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

interface controlState {
  targetMid: number | null;
  active: boolean;
  step: number;
}

const webSocketServer = new WebSocketServer(webPort);
const webSockets: Record<string, WebSocketClient & { id: string }> = {};
const socket = Deno.listenDatagram({
  port,
  transport,
  hostname: "0.0.0.0",
});
const telemetrySocket = Deno.listenDatagram({
  port: telmetryPort,
  transport,
  hostname: "0.0.0.0",
});

class Drone {
  sendBuffer: string[] = [];
  callback: ((message: string) => void) | null = null;
  telemetry: Telemetry | null = null;
  running = false;
  loopTimeout: ReturnType<typeof setTimeout> | null = null;
  controlState = {} as controlState;

  constructor(public ip: string, public id: number) {
    // this.listen();
    // this.telemetryListen();
    // this.readStdin();
    // this.webSocketListen();
  }

  send(message: string) {
    return new Promise((resolve, reject) => {
      console.log(`drone${this.id}>`, message);
      const encoder = new TextEncoder();
      this.callback = (message) => {
        if (message === "ok") {
          resolve("");
        }
        if (message === "error") {
          console.log("Error!!");
          resolve("");
        } else {
          resolve(message);
        }
      };
      socket.send(encoder.encode(message), {
        port,
        transport,
        hostname: this.ip,
      });
    });
  }

  onMessage(message: string) {
    console.log(`drone${this.id}<`, message);
    if (this.callback) {
      this.callback(message);
      this.callback = null;
    }
  }

  onTelemetryMessage(message: string) {
    this.telemetry = message
      .trim()
      .split(";")
      .reduce((memo, string) => {
        const [key, val] = string.split(":");
        if (key) memo[key as keyof Telemetry] = parseFloat(val);
        return memo;
      }, {} as Telemetry);
    // Logging
    Object.values(webSockets).forEach((ws) =>
      ws.send(
        JSON.stringify({
          drone: this.id,
          telemetry: this.telemetry,
          state: this.controlState,
        })
      )
    );
  }

  async start() {
    console.log("Starting drone...");
    await this.send("command");
    await this.send("battery?");
    this.running = true;
    this.loop();
  }

  stop() {
    console.log("Stopping drone...");
    if (this.loopTimeout) clearTimeout(this.loopTimeout);
    this.send("land");
    this.running = false;
  }

  async loop() {
    if (!this.running) return false;
    try {
      await this.tick();
    } catch (_error) {
      this.stop();
    }
    this.loopTimeout = setTimeout(this.loop.bind(this), 100);
  }

  async tick() {
    if (this.telemetry === null) return;
    const speed = 75;
    const tryOptimise = true;

    // console.log(this.controlState, this.telemetry);
    // console.log(this.controlState.step);

    if (
      this.controlState.active &&
      (this.telemetry.time === 0 || this.telemetry.h === 0)
    ) {
      await this.send("takeoff");
      this.controlState.step = 1;
      // this.controlState.step = 9; // <---- default
    }
    if (
      !this.controlState.active &&
      this.telemetry.time > 0 &&
      this.telemetry.h > 0
    ) {
      console.log(`drone${this.id}`, this.controlState, this.telemetry);
      await this.send("land");
    }

    //  Update control states
    if (
      drones[0].controlState.step === 5 &&
      drones[1].controlState.step === 3 &&
      drones[2].controlState.step === 1
    ) {
      drones[0].controlState.step = 6;
      drones[1].controlState.step = 4;
      drones[2].controlState.step = 2;
    }

    if (
      drones[0].controlState.step === 7 &&
      drones[1].controlState.step === 5 &&
      drones[2].controlState.step === 3
    ) {
      drones[0].controlState.step = 8;
      drones[1].controlState.step = 6;
      drones[2].controlState.step = 4;
    }

    if (
      drones[0].controlState.step === 9 &&
      drones[1].controlState.step === 7 &&
      drones[2].controlState.step === 5
    ) {
      drones[0].controlState.step = 10;
      drones[1].controlState.step = 8;
      drones[2].controlState.step = 6;
    }

    if (
      drones[0].controlState.step === 11 &&
      drones[1].controlState.step === 9 &&
      drones[2].controlState.step === 7
    ) {
      drones[0].controlState.step = 12;
      drones[1].controlState.step = 10;
      drones[2].controlState.step = 8;
    }

    if (
      drones[0].controlState.step === 13 &&
      drones[1].controlState.step === 11 &&
      drones[2].controlState.step === 9
    ) {
      drones[0].controlState.step = 14;
      drones[1].controlState.step = 12;
      drones[2].controlState.step = 10;
    }

    if (
      drones[0].controlState.step === 15 &&
      drones[1].controlState.step === 13 &&
      drones[2].controlState.step === 11
    ) {
      drones[0].controlState.step = 16;
      drones[1].controlState.step = 14;
      drones[2].controlState.step = 12;
    }

    if (
      drones[0].controlState.step === 17 &&
      drones[1].controlState.step === 15 &&
      drones[2].controlState.step === 13
    ) {
      drones[0].controlState.step = 18;
      drones[1].controlState.step = 16;
      drones[2].controlState.step = 14;
    }

    if (
      (drones[0].telemetry?.h || 100) < 10 &&
      drones[1].controlState.step === 17 &&
      drones[2].controlState.step === 15
    ) {
      drones[1].controlState.step = 18;
      drones[2].controlState.step = 16;
    }

    // Move away from start pad
    if (this.controlState.step === 1) {
      await this.send(`go 0 0 100 ${speed} m1`);
      if (this.id < 2) this.controlState.step = 2;
      return;
    }

    if (this.controlState.step === 2) {
      await this.send(`go 180 0 100 ${speed} m1`);
      this.controlState.step = 3;
      return;
    }

    if (this.controlState.step === 3) {
      await this.send(`go 0 0 70 ${speed} m2`);
      if (this.id === 0) this.controlState.step = 4;
      return;
    }

    if (this.controlState.step === 4) {
      await this.send(`go 170 0 70 ${speed} m2`);
      this.controlState.step = 5;
      return;
    }

    if (this.controlState.step === 5) {
      await this.send(`go 0 0 100 ${speed} m3`);
      return;
    }

    if (this.controlState.step === 6) {
      await this.send(`go 0 -145 100 ${speed} m3`);
      this.controlState.step = 7;
      return;
    }

    if (this.controlState.step === 7) {
      await this.send(`go 0 0 100 ${speed} m4`);
      return;
    }

    if (this.controlState.step === 8) {
      await this.send(`go -180 35 100 ${speed} m4`);
      this.controlState.step = 9;
      return;
    }

    if (this.controlState.step === 9) {
      if (
        !tryOptimise ||
        (this.telemetry.mid === 5 &&
          Math.abs(this.telemetry.x) > 15 &&
          Math.abs(this.telemetry.y) > 15)
      ) {
        await this.send(`go 0 0 100 ${speed} m5`);
      }
      return;
    }

    if (this.controlState.step === 10) {
      await this.send(`go -50 -35 100 ${speed} m5`);
      this.controlState.step = 11;
      return;
    }

    if (this.controlState.step === 11) {
      if (
        !tryOptimise ||
        (this.telemetry.mid === 6 &&
          Math.abs(this.telemetry.x) > 15 &&
          Math.abs(this.telemetry.y) > 15)
      ) {
        await this.send(`go 0 0 100 ${speed} m6`);
      }
      return;
    }

    if (this.controlState.step === 12) {
      await this.send(`go 0 70 100 ${speed} m6`);
      this.controlState.step = 13;
      return;
    }

    if (this.controlState.step === 13) {
      if (
        !tryOptimise ||
        (this.telemetry.mid === 7 &&
          Math.abs(this.telemetry.x) > 15 &&
          Math.abs(this.telemetry.y) > 15)
      ) {
        await this.send(`go 0 0 100 ${speed} m7`);
      }
      return;
    }

    if (this.controlState.step === 14) {
      await this.send(`go 75 -40 100 ${speed} m7`);
      this.controlState.step = 15;
      return;
    }

    if (this.controlState.step === 15) {
      if (
        !tryOptimise ||
        (this.telemetry.mid === 5 &&
          Math.abs(this.telemetry.x) > 15 &&
          Math.abs(this.telemetry.y) > 15)
      ) {
        await this.send(`go 0 0 100 ${speed} m5`);
      }
      return;
    }

    if (this.controlState.step === 16) {
      await this.send(`go -50 -35 100 ${speed} m5`);
      this.controlState.step = 17;
      return;
    }

    if (this.controlState.step === 17) {
      if (
        !tryOptimise ||
        (this.telemetry.mid === 6 &&
          Math.abs(this.telemetry.x) > 15 &&
          Math.abs(this.telemetry.y) > 15)
      ) {
        await this.send(`go 0 0 100 ${speed} m6`);
      }
      if (this.id === 2 && (drones[1].telemetry?.h || 100) < 10) {
        this.controlState.step = 18;
      }
      return;
    }

    if (this.controlState.step === 18) {
      await this.send(`go -140 35 100 ${speed} m6`);
      this.controlState.step = 19;
      return;
    }

    if (this.controlState.step === 19) {
      await this.send(`go 0 0 70 ${speed} m8`);
      await this.send("emergency");
      this.stop();
    }
  }
}

const drones = [
  new Drone("192.168.8.190", 0), // 1
  new Drone("192.168.8.119", 1), // 2
  new Drone("192.168.8.137", 2), // 3
];

drones.forEach((x) => x.start());

async function listenToSocket() {
  const decoder = new TextDecoder();
  for await (const data of socket) {
    const message = decoder.decode(data[0]);
    const drone = drones.find((x) => x.ip === (data[1] as any).hostname);
    drone?.onMessage(message);
  }
}
async function listenToTelemetrySocket() {
  const decoder = new TextDecoder();
  for await (const data of telemetrySocket) {
    const message = decoder.decode(data[0]);
    const drone = drones.find((x) => x.ip === (data[1] as any).hostname);
    drone?.onTelemetryMessage(message);
  }
}
listenToSocket();
listenToTelemetrySocket();

webSocketServer.on("connection", (ws) => {
  console.log("ws connected");
  const id = String(Math.floor(Math.random() * 1e10));
  (ws as any).id = id;
  webSockets[id] = ws as any;
  ws.on("message", (message: string) => {
    try {
      const data = JSON.parse(message);
      const drone = drones[data.drone];
      if (data.message === "start") drone.start();
      else if (data.message === "stop") drone.stop();
      else {
        drone.controlState = {
          ...drone.controlState,
          ...data.state,
        };
      }
      console.log("ws>", drone.controlState);
    } catch (error) {
      console.log("failed to parse websocket command", error);
    }
  });
  ws.on("close", () => {
    console.log("ws closed");
    Reflect.deleteProperty(webSockets, id);
  });
});
