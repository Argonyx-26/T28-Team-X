// The capture logic behind snap mode (F2). Pure and DOM-free: frame.ts (image measures), readiness.ts (the
// auto-capture decision), timing.ts (seconds per notebook) and retry.ts (the read queue's backoff). The
// browser-only pieces (opening the camera, sampling the video, JPEG encoding, shutter feedback) live in browser.ts
// and are imported from there directly, so this entry point stays importable in Node and in tests.
export * from "./frame";
export * from "./readiness";
export * from "./retry";
export * from "./timing";
