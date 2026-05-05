export function LogoIconSvg({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
    >
      <rect width="512" height="512" rx="96" ry="96" fill="#8B2E4A" />
      <path
        d="M256 430 C140 375 55 250 105 168 C140 100 200 98 256 150 C312 98 372 100 407 168 C457 250 372 375 256 430 Z"
        stroke="white"
        strokeWidth="14"
        fill="none"
      />
      <circle cx="148" cy="112" r="42" stroke="white" strokeOpacity={0.9} strokeWidth="12" fill="#8B2E4A" />
      <circle cx="148" cy="112" r="18" stroke="white" strokeOpacity={0.9} strokeWidth="4" fill="#8B2E4A" />
      <circle cx="184" cy="174" r="33" stroke="white" strokeOpacity={0.9} strokeWidth="10" fill="#8B2E4A" />
      <circle cx="184" cy="174" r="13" stroke="white" strokeOpacity={0.9} strokeWidth="3" fill="#8B2E4A" />
      <line
        x1="202"
        y1="208"
        x2="380"
        y2="320"
        stroke="white"
        strokeOpacity={0.7}
        strokeWidth="11"
        strokeLinecap="round"
      />
      {/* S-curve is the primary brand mark */}
      <path
        d="M200 210 C178 260 212 308 264 310 C316 312 328 368 292 412"
        stroke="white"
        strokeWidth="22"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
