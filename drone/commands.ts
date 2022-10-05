export const commands = {
  /** entry SDK mode */
  command: () => "command",
  /** auto takeoff */
  takeoff: () => "takeoff",
  /** auto land */
  land: () => "land",
  /** Set video stream on */
  streamon: () => "streamon",
  /** Set video stream off */
  streamoff: () => "streamoff",
  /** Stop all motors immediately */
  emergency: () => "emergency",
  /** fly up with distance x cm x: 20-500 */
  up: (x: number) => `up ${x}`,
  /** fly down with distance x cm x: 20-500 */
  down: (x: number) => `down ${x}`,
  /** fly left with distance x cm x: 20-500 */
  left: (x: number) => `left ${x}`,
  /** fly right with distance x cm x: 20-500 */
  right: (x: number) => `right ${x}`,
  /** fly forward with distance x cm x: 20-500 */
  forward: (x: number) => `forward ${x}`,
  /** fly back with distance x cm x: 20-500 */
  back: (x: number) => `back ${x}`,
  /** rotate x degree clockwise x: 1-3600 */
  cw: (x: number) => `cw ${x}`,
  /** rotate x degree counter-clockwise x: 1-3600 */
  ccw: (x: number) => `ccw ${x}`,
  /**
   * flip direction
   * l (left)
   * r (right)
   * f (forward)
   * b (back)
   */
  flip: (direction: "l" | "r" | "f" | "b") => `flip ${direction}`,
  /**
   * fly to x y z in speed (cm/s)
   * x: 20-500
   * y: 20-500
   * z: 20-500
   * speed: 10-100
   * mid: mission pad id
   */
  go: (x: number, y: number, z: number, speed: number, mid?: number) =>
    `go ${x} ${y} ${z} ${speed}` + (mid ? ` m${mid}` : ""),
  /**
   * fly a curve defined by the
   * current and two given coordinates with speed (cm/s)
   * If the arc radius is not within
   * the range of 0.5-10 meters, it responses false
   * x1, x2: 20-500
   * y1, y2: 20-500
   * z1, z2: 20-500
   * speed: 10-60
   * x/y/z can’t be between -20 – 20 at the same time.
   */
  curve: (
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    speed: number
  ) => `curve ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${speed}`,
  /** set speed to x cm/s x: 10-100 */
  speed: (speed: number) => `speed ${speed}`,
  /**
   *
   * Send RC control via four channels.
   * x: left/right (-100\~100)
   * y: forward/backward (-100\~100)
   * z: up/down (-100\~100)
   * yaw: yaw (-100\~100)
   */
  rc: (x: number, y: number, z: number, yaw: number) =>
    `rc ${x} ${y} ${z} ${yaw}`,
  /** Set Wi-Fi with SSID password, requires reboot */
  wifi: (ssid: string, pass: string) => `wifi ${ssid} ${pass}`,
  /** connect to existing access point */
  ap: (ssid: string, pass: string) => `ap ${ssid} ${pass}`,
};

export const readCommands = {
  /** get current speed (cm/s) 1-100 */
  speed: "speed?",
  /** get current battery percentage 0-100 */
  battery: "battery?",
  /** get current fly time (s) */
  time: "time?",
  /** get height (cm) 0-3000 */
  height: "height?",
  /** get temperature (℃) 0-90 */
  temp: "temp?",
  /** get IMU attitude data (pitch roll yaw) */
  attitude: "attitude?",
  /** get barometer value (m) */
  baro: "baro?",
  /** get IMU angular acceleration data (0.001g) */
  acceleration: "acceleration?",
  /** get distance value from TOF（cm）30-1000 */
  tof: "tof?",
  /** get Wi-Fi SNR */
  wifi: "wifi?",
};
