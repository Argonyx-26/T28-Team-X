// Feature flags: anything unfinished at deploy time is hidden here. Build-time values, so they are safe to read
// on the server and the client. Set NEXT_PUBLIC_FLAG_<NAME>=0 to hide a feature without a code change.
const flag = (name: string, fallback: boolean) => {
  const raw = process.env[`NEXT_PUBLIC_FLAG_${name}`];
  return raw === undefined ? fallback : raw !== "0" && raw !== "false";
};

export const FLAGS = {
  /** /present: the presenter's reset, warm and health page */
  PRESENT: flag("PRESENT", true),
  /** F2: snap mode on the notebook pile (auto-capture from the rear camera) */
  SNAP: flag("SNAP", false),
  /** F3: "Check my homework" on the student screen */
  HOMEWORK: flag("HOMEWORK", false),
  /** F9: text-to-speech on the student screens */
  LISTEN: flag("LISTEN", false),
  /** F6: /school/[id] and class creation */
  SCHOOL: flag("SCHOOL", false),
  /** F5: the red pen drawn on the photo itself */
  PHOTO_PEN: flag("PHOTO_PEN", false),
} as const;
