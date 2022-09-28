import { serve } from "server";
import * as log from "log";
import { Server } from "./websocketserver.ts";

const droneCameraPort = 11111;
const streamWsPort = 8893;

export class FFMPEG {
  startedWebserver = false;
  startedFfmpeg = false;
  process: Deno.Process | null = null;

  constructor(private server: Server) {}

  start() {
    this.startWebserver();
    this.startFfmpeg();
  }

  stop() {
    this.stopFfmpeg();
  }

  startWebserver() {
    if (this.startedWebserver) return;
    this.startedWebserver = true;

    const handler = async (request: Request): Promise<Response> => {
      if (request.body) {
        for await (const chunk of request.body) {
          this.server.broadcast(chunk);
        }
      }
      return new Response("", { status: 200 });
    };
    serve(handler, { port: streamWsPort });
  }

  startFfmpeg() {
    if (this.startedFfmpeg) return;
    this.startedFfmpeg = true;

    try {
      const args = [
        "ffmpeg",
        "-i",
        `udp://0.0.0.0:${droneCameraPort}`,
        "-r",
        "30",
        "-s",
        "960x720",
        "-codec:v",
        "mpeg1video",
        "-b",
        "800k",
        "-f",
        "mpegts",
        `http://127.0.0.1:${streamWsPort}`,
      ];

      log.info("Starting FFMPEG server");
      const ffmpeg = Deno.run({
        cmd: args,
        stderr: "piped",
        stdin: "piped",
        stdout: "piped",
      });

      this.process = ffmpeg;

      (async () => {
        for await (const output of ffmpeg.stderr.readable) {
          const message = new TextDecoder().decode(output);
          if (!message.startsWith("ffmpeg version ")) {
            log.debug(message);
          }
        }
      })();
    } catch (error) {
      log.error(`FFMPEG error`, error);
    }
  }

  stopFfmpeg() {
    this.process?.close();
    this.startedFfmpeg = false;
  }
}
