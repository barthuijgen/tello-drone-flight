export function encodeStream(uint8array: Uint8Array) {
  const output = [];

  for (let i = 0, length = uint8array.length; i < length; i++) {
    output.push(String.fromCharCode(uint8array[i]));
  }

  return btoa(output.join(""));
}

export function decodeStream(chars: string) {
  return Uint8Array.from(atob(chars), (c) => c.charCodeAt(0));
}

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const getTimeMinuteSecond = () => {
  return new Date().toTimeString().substr(3, 5);
};
