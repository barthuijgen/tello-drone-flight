import { delay } from "https://deno.land/std@0.92.0/async/delay.ts";
import { commands } from "./commands.ts";
import { DroneManager } from "./manager.ts";

interface WaitForDroneStep {
  drone: string;
  step: number;
}

type WaitFor = WaitForDroneStep;

interface FlightStep {
  command: string;
  waitAtMid?: number | { mid: number; x: number; y: number; z: number };
  speed?: number;
  /** waitFor will be polled until true and then execute the step */
  waitFor?: ((manager: FlightManager) => boolean) | WaitFor[];
  delay?: number;
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
    this.plans.forEach(async (plan) => {
      // Steps
      if (plan.executedStep > plan.completedStep) return;
      const nextStep = plan.executedStep + 1;
      const step = plan.steps[nextStep];
      const drone = this.manager.drones.get(plan.drone);
      if (!step) {
        if (drone?.active) drone.command(commands.land());
        return;
      }

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

      if (typeof step.waitFor === "function") {
        const cond = step.waitFor(this);
        if (cond !== true) return;
      } else if (step.waitFor) {
        for (const wait of step.waitFor) {
          const target = this.plans.get(wait.drone);
          if (target?.completedStep !== wait.step) return;
        }
      }

      // Step will run this tick
      plan.executedStep++;

      if (step.delay) {
        await delay(step.delay);
      }

      // diff
      if (drone.telemetry?.mid) {
        const vec3 = {
          x: drone.telemetry.x,
          y: drone.telemetry.y,
          z: drone.telemetry.z,
        };
        console.log("flight step diff", vec3);
      }

      drone?.command(step.command).then(() => {
        console.log("completed step", plan.executedStep);
        plan.completedStep++;
      });
    });
  }
}
