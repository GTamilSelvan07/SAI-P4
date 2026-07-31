import type { CSSProperties } from "react";

export interface CandidatePalette {
  name: string;
  ring: string;
  fill: string;
  soft: string;
  text: string;
}

export const CANDIDATE_PALETTE: CandidatePalette[] = [
  { name: "slate", ring: "rgb(100 116 139)", fill: "rgb(100 116 139)", soft: "rgb(241 245 249)", text: "rgb(51 65 85)" },
  { name: "teal",  ring: "rgb(20 184 166)",  fill: "rgb(20 184 166)",  soft: "rgb(240 253 250)", text: "rgb(15 118 110)" },
  { name: "amber", ring: "rgb(245 158 11)",  fill: "rgb(245 158 11)",  soft: "rgb(255 251 235)", text: "rgb(146 64 14)" },
];

export function paletteFor(index: number): CandidatePalette {
  return CANDIDATE_PALETTE[index % CANDIDATE_PALETTE.length];
}

interface BadgeProps {
  letter: string;
  paletteIndex: number;
  size?: "orb" | "chip" | "mini";
  filled?: boolean;
  glow?: boolean;
}

export function CandidateBadge({
  letter, paletteIndex, size = "chip", filled = false, glow = false,
}: BadgeProps) {
  const p = paletteFor(paletteIndex);
  const px = size === "orb" ? 64 : size === "mini" ? 28 : 22;
  const innerStroke = size === "orb" ? 2.5 : 2;
  const fontPx = size === "orb" ? 24 : size === "mini" ? 13 : 11;

  const style: CSSProperties = glow
    ? { filter: `drop-shadow(0 0 10px ${p.fill}55) drop-shadow(0 0 2px ${p.fill}88)` }
    : {};

  return (
    <svg width={px} height={px} viewBox="0 0 64 64" style={style} aria-hidden="true">
      <circle
        cx="32" cy="32" r="28"
        fill={filled ? p.fill : p.soft}
        stroke={p.ring} strokeWidth={innerStroke}
      />
      <text
        x="32" y="34"
        textAnchor="middle" dominantBaseline="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        fontWeight={700}
        fontSize={fontPx * (64 / px)}
        fill={filled ? "white" : p.text}
      >
        {letter}
      </text>
    </svg>
  );
}
