import { ImageResponse } from "next/og";

import { SITE } from "@/lib/site";

export const alt = "GuruGraph: see why they got it wrong. A student's notebook with the wrong step circled in red pen.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Hind for type and Kalam for handwriting, fetched at build time; the image still renders with the default font if that fails.
async function googleFont(family: string, weight: 400 | 700): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, { signal: AbortSignal.timeout(5000) })
    ).text();
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    if (!src) return null;
    return await (await fetch(src, { signal: AbortSignal.timeout(5000) })).arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const [hand, sans, sansRegular] = await Promise.all([
    googleFont("Kalam", 700),
    googleFont("Hind", 700),
    googleFont("Hind", 400),
  ]);
  type Font = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
  const fonts: Font[] = [];
  if (sans) fonts.push({ name: "Hind", data: sans, weight: 700, style: "normal" });
  if (sansRegular) fonts.push({ name: "Hind", data: sansRegular, weight: 400, style: "normal" });
  if (hand) fonts.push({ name: "Kalam", data: hand, weight: 700, style: "normal" });
  const handFont = hand ? "Kalam" : undefined;
  const sansFont = sans ? "Hind" : undefined;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 64,
          gap: 48,
          alignItems: "center",
          background: "#fcfdff",
          backgroundImage:
            "linear-gradient(to right, #e3e9f3 1px, transparent 1px), linear-gradient(to bottom, #e3e9f3 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          color: "#1f2b5c",
          fontFamily: sansFont,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24, width: 560 }}>
          <div style={{ fontSize: 44, fontWeight: 700, fontFamily: handFont }}>{SITE.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", columnGap: 18, fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            <span>See</span>
            <span style={{ background: "linear-gradient(transparent 55%, #f7e96b 55%, #f7e96b 92%, transparent 92%)" }}>
              why
            </span>
            <span>they</span>
            <span>got</span>
            <span>it</span>
            <span>wrong.</span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 400, lineHeight: 1.35, color: "#616874" }}>
            A photo of a notebook becomes the exact wrong step, a plan for the teacher and a lesson in Kannada, Hindi or
            English.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 470,
            padding: "28px 28px 28px 76px",
            borderRadius: 24,
            border: "2px solid #d6dde9",
            background: "#fffef8",
            boxShadow: "0 18px 40px rgba(31,43,92,0.14)",
            position: "relative",
          }}
        >
          <div style={{ position: "absolute", left: 52, top: 0, bottom: 0, width: 3, background: "#f0b4ae" }} />
          {["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"].map((line, i) => (
            <div
              key={line}
              style={{
                display: "flex",
                position: "relative",
                height: 84,
                alignItems: "center",
                fontSize: 44,
                fontFamily: handFont,
                color: "#22307a",
                borderBottom: "2px solid #cfdbee",
              }}
            >
              {line}
              {i === 1 && (
                <svg
                  width="330"
                  height="92"
                  viewBox="0 0 100 40"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", left: -24, top: -4 }}
                >
                  <path
                    d="M8,22 C6,9 32,3 55,4 C80,5 97,11 95,21 C93,32 70,37 48,36 C24,35 5,31 7,19 C8,13 16,9 26,7"
                    fill="none"
                    stroke="#c8372d"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </div>
          ))}
          <div style={{ marginTop: 18, fontSize: 32, color: "#c8372d", fontFamily: handFont, transform: "rotate(-3deg)" }}>
            added the denominators too
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length ? fonts : undefined,
    },
  );
}
