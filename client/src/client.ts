import { connect } from "./websocketclient";

declare var JSMpeg: any;

class Camera {
  started = false;
  player: any;
  start() {
    if (this.started) return;
    this.started = true;
    const canvas = document.getElementById("video-canvas");
    const url = "ws://" + document.location.hostname + ":8892";
    this.player = new JSMpeg.Player(url, { canvas });
  }
  stop() {
    if (!this.started) return;
    this.started = false;
    this.player.destroy();
  }
}
const camera = new Camera();

(window as any).onStartDrone = (hostname: string) => {
  console.log(hostname);
  client.send({ type: "start", payload: { hostname } });
};

(window as any).onEnableCamera = (hostname: string, enabled: boolean) => {
  client.send({ type: "stream", payload: { hostname, enabled } });
};

const client = connect("ws://127.0.0.1:8891");
client.onStatus.attach((status) => {
  document.getElementById("status")!.innerHTML = `Status: ${status}`;
});
client.onMessage.attach((message) => {
  if (message.type === "state") {
    if (message.payload.drones.some((x) => x.camera)) {
      camera.start();
    } else {
      camera.stop();
    }
    document.querySelector("#telemetry")!.innerHTML = message.payload.drones
      .map(
        (drone) => `
      <div>
      <div>Hostname: ${drone.hostname}</div>
      <div>Active: ${drone.active}</div>
      <div>Camera: ${drone.camera}</div>
      ${
        drone.active
          ? ""
          : `<button onclick="onStartDrone('${drone.hostname}')">Start Drone</button>`
      }
      ${
        drone.camera
          ? `<button onclick="onEnableCamera('${drone.hostname}', false)">Stop Camera</button>`
          : `<button onclick="onEnableCamera('${drone.hostname}', true)">Start Camera</button>`
      }
      <pre>${JSON.stringify(drone.telemetry, null, 2)}</pre>
      </div>`
      )
      .join("");
  }
});

console.log("Client loaded");
