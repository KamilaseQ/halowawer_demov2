import type { SVGProps } from "react";

const S = (p: SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" className="icon" aria-hidden {...p} />;

export const IcoCube = () => (
  <S><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></S>
);
export const IcoWalk = () => (
  <S><circle cx="13" cy="4.2" r="1.7" /><path d="m9.5 21 2.3-6.3 2.7 2.4V21M8 11.5l2.5-3.3 3.5.3 2 3 2.5 1M11.8 14.7l1-6" /></S>
);
export const IcoPlan = () => (
  <S><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /><path d="M3.5 12h7V3.5M14 20.5V14h6.5M10.5 16v4.5" /></S>
);
export const IcoImage = () => (
  <S><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 3.5 3.5L15 14l5 4.5" /></S>
);
export const IcoHome = () => (
  <S><path d="M4 11 12 4.5 20 11" /><path d="M6 9.5V19.5h12V9.5" /></S>
);
export const IcoUp = () => <S><path d="m6 14.5 6-6 6 6" /></S>;
export const IcoDown = () => <S><path d="m6 9.5 6 6 6-6" /></S>;
export const IcoLeft = () => <S><path d="M19 12H5.5M11 6l-6 6 6 6" /></S>;
export const IcoChevL = () => <S><path d="m14.5 6-6 6 6 6" /></S>;
export const IcoChevR = () => <S><path d="m9.5 6 6 6-6 6" /></S>;
export const IcoCamera = () => (
  <S><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3V19H4z" /><circle cx="12" cy="13.3" r="3.3" /></S>
);
export const IcoEyeOff = () => (
  <S><path d="M3 12s3.2-6 9-6c1.6 0 3 .4 4.2 1M21 12s-3.2 6-9 6c-1.6 0-3-.4-4.2-1" /><path d="M9.6 14.4a3.3 3.3 0 0 1 4.7-4.7" /><path d="m4 20 16-16" /></S>
);
export const IcoEye = () => (
  <S><path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="3" /></S>
);
export const IcoPlus = () => <S><path d="M12 5v14M5 12h14" /></S>;
export const IcoMinus = () => <S><path d="M5 12h14" /></S>;
export const IcoX = () => <S><path d="m6 6 12 12M18 6 6 18" /></S>;
export const IcoDoor = () => (
  <S><path d="M6 20.5V4.5h9v16M4 20.5h14" /><path d="M12.5 12.5h.01" /></S>
);
export const IcoPhoto = () => (
  <S><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="m3.5 16 5-4.5 4 3.5 2.5-2 5 4" /></S>
);
export const IcoSun = () => (
  <S><circle cx="12" cy="12" r="3.6" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></S>
);
