import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";

interface FlightStep {
  mid?: number;
  x: number;
  y: number;
  z: number;
  speed?: number;
  /** waitFor will be polled until true and then execute the step */
  waitFor?: () => boolean;
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
      if (!step) return;
      const drone = this.manager.drones.get(plan.drone);

      const { steps, ..._plan } = plan;
      console.log("execute step", _plan, step);

      // Auto start
      if (!drone?.active) {
        return drone?.command(commands.command());
      }
      // Auto launch
      if (drone?.telemetry?.time === 0 || drone?.telemetry?.h === 0) {
        return drone.command(commands.takeoff());
      }

      drone
        ?.command(
          commands.go(
            step.x,
            step.y,
            step.z,
            step.speed || this.defaultSpeed,
            step.mid
          )
        )
        .then(() => {
          console.log("completed step", plan.executedStep);
          plan.completedStep++;
        });
      plan.executedStep++;
    });
  }
}
