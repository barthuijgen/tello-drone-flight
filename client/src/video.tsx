import { useEffect, useRef } from "react";

declare var JSMpeg: any;

export const VideoSteam = () => {
  const player = useRef<any>(null);

  useEffect(() => {
    const canvas = document.getElementById("video-canvas");
    const url = "ws://" + document.location.hostname + ":8892";
    player.current = new JSMpeg.Player(url, { canvas });

    return () => {
      try {
        player.current?.destroy();
      } catch (error) {
        console.log("JSMpeg cleanup error", error);
      }
    };
  }, []);

  return <canvas id="video-canvas"></canvas>;
};
