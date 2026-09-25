import { Hind, Kalam, Noto_Sans_Kannada } from "next/font/google";

const hind = Hind({ weight: ["400", "500", "600", "700"], subsets: ["latin", "devanagari"], variable: "--gg-sans" });
const kalam = Kalam({ weight: ["400", "700"], subsets: ["latin"], variable: "--gg-hand" });
const kannada = Noto_Sans_Kannada({ weight: ["400", "600"], subsets: ["kannada"], variable: "--gg-kn" });

// put on every element that renders dashboard text, including portaled sheets and dialogs
export const fontVars = `${hind.variable} ${kalam.variable} ${kannada.variable}`;
