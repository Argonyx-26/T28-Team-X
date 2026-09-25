/**
 * The browser-only half of snap mode: opening the camera, sampling the video, encoding a capture, and the
 * shutter feedback. Nothing here is imported by the pure modules.
 */

import { type GrayFrame, toGray } from "./frame";

export const SAMPLE_WIDTH = 160;
export const SAMPLE_HEIGHT = 120;
/** the longest side of the JPEG that goes to the API (the scan screen sends the same size) */
export const CAPTURE_MAX_PX = 1600;

export type CameraFailure = "insecure" | "unsupported" | "denied" | "none" | "busy" | "unknown";

export interface CameraOpen {
  stream: MediaStream;
  /** true when the track reports a rear ("environment") camera; false on a laptop webcam or an unknown camera */
  rear: boolean;
  width: number;
  height: number;
}

/** Opens the rear camera when there is one, else whatever camera the device has. Never throws a raw DOMException. */
export async function openCamera(): Promise<{ ok: true; camera: CameraOpen } | { ok: false; failure: CameraFailure }> {
  if (typeof window === "undefined") return { ok: false, failure: "unsupported" };
  if (!window.isSecureContext) return { ok: false, failure: "insecure" };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, failure: "unsupported" };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    return {
      ok: true,
      camera: {
        stream,
        rear: settings.facingMode === "environment",
        width: settings.width ?? 0,
        height: settings.height ?? 0,
      },
    };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return { ok: false, failure: "denied" };
    if (name === "NotFoundError" || name === "OverconstrainedError") return { ok: false, failure: "none" };
    if (name === "NotReadableError" || name === "AbortError") return { ok: false, failure: "busy" };
    return { ok: false, failure: "unknown" };
  }
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Draws the current video frame into a small canvas and returns its grayscale sample, or null before the first frame. */
export function sampleVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement): GrayFrame | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  return toGray(ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT));
}

/** The full-resolution frame as a JPEG no larger than CAPTURE_MAX_PX on its long side. Kept in memory only. */
export async function grabJpeg(video: HTMLVideoElement): Promise<Blob | null> {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, CAPTURE_MAX_PX / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

/** Phones take 4–12 MB photos; send a 1600 px JPEG instead so it uploads fast on mobile data. (Same as the scan screen.) */
export async function shrink(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, CAPTURE_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

let audio: AudioContext | null = null;

/** Browsers only let a page make sound after a tap or key press; call this from any user gesture. */
export function unlockShutterSound(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // no sound is fine
  }
}

/** A short click (two 30 ms tones) and a 40 ms buzz on every capture. No asset file, and silent when not allowed. */
export function shutterFeedback(): void {
  try {
    navigator.vibrate?.(40);
  } catch {
    // not supported
  }
  if (!audio || audio.state !== "running") return;
  try {
    const t0 = audio.currentTime;
    for (const [freq, at] of [
      [1800, 0],
      [1200, 0.04],
    ] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.03);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.035);
    }
  } catch {
    // a failed beep must never stop a capture
  }
}
