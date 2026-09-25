"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * The red pen draws itself with a dash animation from --len to 0. Its stroke must not stretch with the box
 * (vector-effect: non-scaling-stroke), and Chrome then mis-draws `pathLength`, leaving only part of the ellipse.
 * So we measure the path's real on-screen length and hand it to CSS as --len, again whenever the box resizes.
 */
export function usePenLength<T extends SVGGeometryElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const path = ref.current;
    const svg = path?.ownerSVGElement;
    if (!path || !svg) return;
    const measure = () => {
      const m = path.getScreenCTM();
      if (!m) return;
      const total = path.getTotalLength();
      let len = 0;
      let prev = path.getPointAtLength(0).matrixTransform(m);
      for (let i = 1; i <= 64; i++) {
        const p = path.getPointAtLength((total * i) / 64).matrixTransform(m);
        len += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
      path.style.setProperty("--len", String(Math.ceil(len) + 2));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  return ref;
}
