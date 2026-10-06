/** Decorative brand mark; the adjacent heading names the app or screen. */
export function BrandMark({ size = 60 }: { size?: number }) {
  return <img className="brand-mark" src="./vault-icon-v2.svg" width={size} height={size} alt="" aria-hidden="true" />;
}
