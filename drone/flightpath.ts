import { delay } from "https://deno.land/std@0.92.0/async/delay.ts";
import { commands } from "./commands.ts";
import { Drone } from "./drone.ts";
import { DroneManager } from "./manager.ts";

interface WaitForDroneStep {
  drone: string;
  step: number;
}

type WaitFor = WaitForDroneStep;

interface FlightStep {
  command: ReturnType<typeof commands[keyof typeof commands]>;
  waitAtMid?: number | { mid: number; x: number; y: number; z: number };
  speed?: number;
  /** waitFor will be polled until true and then execute the step */
  waitFor?: ((manager: FlightManager) => boolean) | WaitFor[];
  delay?: number;
  delayStart?: number;
}

interface FlightPlan {
  drone: string;
  executedStep: number;
  completedStep: number;
  steps: FlightStep[];
}

export class FlightManager {
  running = false;
  loopTimeout: ReturnType<typeof setTimeout> | null = null;
  plans: Map<string, FlightPlan> = new Map();
  defaultSpeed = 70;

  constructor(public manager: DroneManager) {}

  setFlightPlan(drone: string, steps: FlightStep[]) {
    this.stop();
    this.plans.set(drone, {
      drone: drone,
      executedStep: -1,
      completedStep: -1,
      steps: steps,
    });
  }

  start() {
    this.running = true;
    this.loop();
  }
  stop() {
    this.running = false;
    if (this.loopTimeout) clearTimeout(this.loopTimeout);
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

  tick() {
    this.plans.forEach((plan) => {
      // Steps
      if (plan.executedStep > plan.completedStep) return;
      const nextStep = plan.executedStep + 1;
      const step = plan.steps[nextStep];
      const drone = this.manager.drones.get(plan.drone);
      if (!drone) return;

      if (!step) {
        if (drone.flying) drone.commandIfNotQueued(commands.land());
        return;
      }

      const { steps, ..._plan } = plan;

      // Auto start
      if (!drone.active) {
        return drone.commandIfNotQueued(commands.command());
      }
      // Auto launch
      if (!drone.flying) {
        return drone.commandIfNotQueued(commands.takeoff());
      }

      const doWhileWaiting = () => {
        if (
          drone?.telemetry?.mid &&
          drone.telemetry.mid > -1 &&
          drone.commandBuffer.length === 0
        ) {
          // console.log(
          //   "doWhileWaiting diff mid",
          //   drone.telemetry.mid,
          //   drone.telemetry.x,
          //   drone.telemetry.y
          // );
          if (
            Math.abs(drone.telemetry.x) > 10 ||
            Math.abs(drone.telemetry.y) > 10
          ) {
            drone.command(commands.go(0, 0, 0, 70, drone.telemetry.mid));
          }
        }
      };

      if (typeof step.waitFor === "function") {
        const cond = step.waitFor(this);
        if (cond !== true) return doWhileWaiting();
      } else if (step.waitFor) {
        for (const wait of step.waitFor) {
          const target = this.plans.get(wait.drone);
          if (target?.completedStep !== wait.step) return doWhileWaiting();
        }
      }

      if (step.delay && step.delayStart) {
        const isDelayPassed = Date.now() - step.delayStart > step.delay;
        if (!isDelayPassed) return doWhileWaiting();
      }

      if (step.delay && !step.delayStart) {
        step.delayStart = Date.now();
        return;
      }

      // Step will run this tick
      console.log("execute step", _plan, step);
      plan.executedStep++;

      // diff
      if (drone.telemetry?.mid) {
        const vec3 = {
          x: drone.telemetry.x,
          y: drone.telemetry.y,
          z: drone.telemetry.z,
        };
        console.log("flight step diff mid", drone.telemetry.mid, vec3);
      }

      if (typeof step.command === "object" && step.command.type === "matrix") {
        this.flyToMid(
          drone,
          step.command.mid,
          step.command.z,
          step.command.speed
        ).then((response) => {
          console.log("step compete reponse", response);
          if (response === null || response.includes("error")) {
            console.log("error on step", plan.executedStep);
            plan.executedStep--;
          } else {
            console.log("completed step", plan.executedStep);
            plan.completedStep++;
          }
        });
      }

      if (typeof step.command === "string") {
        drone?.command(step.command).then((response) => {
          console.log("step compete reponse", response);
          if (response.includes("error")) {
            console.log("error on step", plan.executedStep);
            plan.executedStep--;
          } else {
            console.log("completed step", plan.executedStep);
            plan.completedStep++;
          }
        });
      }
    });
  }

  /**
 Coord system based on rocket symbol
 +x = forwards
 -x = backwards
 +y = left
 -y = right
 */

  async flyToMid(drone: Drone, mid: number, z: number, speed: number) {
    const dist = 60;
    const matrix = [
      // 1
      [
        [0, 0], // 1
        [0, -dist], // 2
        [0, -dist * 2], // 3
        [0, -dist * 3], // 4
        [-dist, 0], // 5
        [-dist, -dist], // 6
        [-dist, -dist * 2], // 7
        [-dist, -dist * 3], // 8
      ],
      // 2
      [
        [0, dist], // 1
        [0, 0], // 2
        [0, -dist], // 3
        [0, -dist * 2], // 4
        [-dist, dist], // 5
        [-dist, 0], // 6
        [-dist, -dist], // 7
        [-dist, -dist * 2], // 8
      ],
      // 3
      [
        [0, dist * 2], // 1
        [0, dist], // 2
        [0, 0], // 3
        [0, -dist], // 4
        [-dist, dist * 2], // 5
        [-dist, dist], // 6
        [-dist, 0], // 7
        [-dist, -dist], // 8
      ],
      // 4
      [
        [0, dist * 3], // 1
        [0, dist * 2], // 2
        [0, dist], // 3
        [0, 0], // 4
        [-dist, dist * 3], // 5
        [-dist, dist * 2], // 6
        [-dist, dist], // 7
        [-dist, 0], // 8
      ],
      // 5
      [
        [dist, 0], // 1
        [dist, -dist], // 2
        [dist, -dist * 2], // 3
        [dist, -dist * 3], // 4
        [0, 0], // 5
        [0, -dist], // 6
        [0, -dist * 2], // 7
        [0, -dist * 3], // 8
      ],
      // 6
      [
        [dist, dist], // 1
        [dist, 0], // 2
        [dist, -dist], // 3
        [dist, -dist * 2], // 4
        [0, dist], // 5
        [0, 0], // 6
        [0, -dist], // 7
        [0, -dist * 2], // 8
      ],
      // 7
      [
        [dist, dist * 2], // 1
        [dist, dist], // 2
        [dist, 0], // 3
        [dist, -dist], // 4
        [0, dist * 2], // 5
        [0, dist], // 6
        [0, 0], // 7
        [0, -dist], // 8
      ],
      // 8
      [
        [dist, dist * 3], // 1
        [dist, dist * 2], // 2
        [dist, dist], // 3
        [dist, 0], // 4
        [0, dist * 3], // 5
        [0, dist * 2], // 6
        [0, dist], // 7
        [0, 0], // 8
      ],
    ] as [number, number][][];
    if (drone.telemetry?.mid && drone.telemetry.mid > -1) {
      const target = matrix[drone.telemetry.mid - 1][mid - 1];
      return await drone.command(
        commands.go(target[0], target[1], z, speed, drone.telemetry.mid)
      );
    }
    return null;
  }
}
