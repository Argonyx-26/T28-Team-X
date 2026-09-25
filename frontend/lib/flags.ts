// Feature flags: anything unfinished at deploy time is hidden here. Build-time values, so they are safe to read
// on the server and the client. Set NEXT_PUBLIC_FLAG_<NAME>=0 at build time to hide a feature without a code change.
// Each env var is read by its full static name: Next inlines only static `process.env.NEXT_PUBLIC_*` reads into the
// client bundle, so a dynamic key would leave the browser on the default.
const on = (raw: string | undefined, fallback: boolean) =>
  raw === undefined || raw === "" ? fallback : raw !== "0" && raw !== "false";

export const FLAGS = {
  /** /present: the presenter's reset, warm and health page */
  PRESENT: on(process.env.NEXT_PUBLIC_FLAG_PRESENT, true),
  /** F2: snap mode on /teacher/[code]/snap (auto-capture from the rear camera) */
  SNAP: on(process.env.NEXT_PUBLIC_FLAG_SNAP, true),
  /** F3: "Check my homework" on the student screen */
  HOMEWORK: on(process.env.NEXT_PUBLIC_FLAG_HOMEWORK, true),
  /** F9: text-to-speech on the student screens */
  LISTEN: on(process.env.NEXT_PUBLIC_FLAG_LISTEN, true),
  /** F6: /school/[id] and class creation */
  SCHOOL: on(process.env.NEXT_PUBLIC_FLAG_SCHOOL, true),
  /** F5: the red pen drawn on the photo itself */
  PHOTO_PEN: on(process.env.NEXT_PUBLIC_FLAG_PHOTO_PEN, true),
} as const;
