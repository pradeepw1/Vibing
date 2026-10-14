// Runs in a background thread: paints one surface per message and sends the
// pixels back, so painting never makes the animation stutter.
import { finish, paint, paintClouds, paintMilkyWay } from "./surfaces.js";

self.onmessage = ({ data: { job } }) => {
  const out = finish(job === "clouds" ? paintClouds() : job === "milkyway" ? paintMilkyWay() : paint(job));
  const images = out instanceof ImageData ? { map: out } : out;
  const msg = { job };
  const transfer = [];
  for (const [key, img] of Object.entries(images)) {
    if (!img) continue;
    msg[key] = { width: img.width, height: img.height, data: img.data.buffer };
    transfer.push(img.data.buffer);
  }
  self.postMessage(msg, transfer);
};
