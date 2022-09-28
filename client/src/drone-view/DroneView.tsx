import { useEffect } from "react";
import "./drone-view.css";

export const DroneView = ({ x, y, z }: { x: number; y: number; z: number }) => {
  useEffect(() => {});
  return (
    <div className="scene">
      <div
        className="cube"
        style={{
          transform: `translateZ(-5em) rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`,
        }}
      >
        <div className="face front">front</div>
        <div className="face right">right</div>
        <div className="face left">left</div>
        <div className="face back">back</div>
        <div className="face top">top</div>
        <div className="face bottom">bottom</div>
      </div>
    </div>
  );
};
