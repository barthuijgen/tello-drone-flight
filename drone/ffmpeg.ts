import { serve } from "https://deno.land/std@0.157.0/http/server.ts";
import { Server } from "./websocketserver.ts";

const droneCameraPort = 11111;
const streamWsPort = 8893;

export class FFMPEG {
  started = false;

  constructor(private server: Server) {}

  start() {
    if (this.started) return;
    this.started = true;

    try {
      const handler = async (request: Request): Promise<Response> => {
        if (request.body) {
          for await (const chunk of request.body) {
            this.server.broadcast(chunk);
          }
        }
        return new Response("", { status: 200 });
      };

      serve(handler, { port: streamWsPort });

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

      console.log("Starting FFMPEG server");
      const ffmpeg = Deno.run({
        cmd: args,
        stderr: "piped",
        stdin: "piped",
        stdout: "piped",
      });

      (async () => {
        for await (const output of ffmpeg.stderr.readable) {
          const message = new TextDecoder().decode(output);
          if (!message.startsWith("ffmpeg version ")) {
            console.log(message);
          }
        }
      })();
    } catch (error) {
      console.error(`FFMPEG error`, error);
    }
  }
}
