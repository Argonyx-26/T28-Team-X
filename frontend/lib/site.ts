// Public facts about the deployment, in one place. Nothing here is secret.
export const SITE = {
  name: "GuruGraph",
  url: "https://gurugraph-web-215071922486.asia-south1.run.app",
  repo: "https://github.com/Argonyx-26/T28-Team-X",
  apiDocs: "https://gurugraph-api-215071922486.asia-south1.run.app/docs",
  classCode: "7B",
  tagline: "See why they got it wrong.",
  /** the 2-minute demo video; set it here (not on the API) so changing it never restarts the API */
  video: "",
  /** the public Raah status page (one component per agent endpoint) */
  statusPage: "",
  description:
    "Snap a photo of a student's notebook. GuruGraph circles the exact step that went wrong, tells the teacher what to re-teach tomorrow, and gives the child a short lesson in Kannada, Hindi or English.",
} as const;

export const ROUTES = {
  dashboard: `/teacher/${SITE.classCode}`,
  scan: `/teacher/${SITE.classCode}/scan`,
  pile: `/teacher/${SITE.classCode}/pile`,
  worksheet: `/teacher/${SITE.classCode}/worksheet?concept=C4&tag=add_denominators`,
  join: `/join/${SITE.classCode}`,
  asha: `/join/${SITE.classCode}?as=asha`,
  judges: "/judges",
  school: "/school/demo",
  newClass: "/teacher/new",
  present: "/present",
} as const;

export const repoFile = (path: string) => `${SITE.repo}/blob/main/${path}`;
