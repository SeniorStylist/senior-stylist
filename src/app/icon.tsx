import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

// Scissors-inside-heart logomark: gray heart outline + gray scissors + burgundy S-curl
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M50 88C50 88 8 65 8 36C8 21 19 13 32 16C41 18 48 25 50 29C52 25 59 18 68 16C81 13 92 21 92 36C92 65 50 88 50 88Z" fill="none" stroke="white" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="33" cy="39" r="10" fill="none" stroke="white" stroke-width="4"/>
  <circle cx="40" cy="53" r="10" fill="none" stroke="white" stroke-width="4"/>
  <line x1="40" y1="46" x2="72" y2="79" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="47" y1="60" x2="72" y2="71" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M55 67C55 67 63 59 60 53C57 47 51 51 51 44C51 37 59 35 59 35" fill="none" stroke="#F9A8C9" stroke-width="3.5" stroke-linecap="round"/>
</svg>`

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        background: '#8B2E4A',
        width: 512,
        height: 512,
        borderRadius: 96,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <img
        src={`data:image/svg+xml,${encodeURIComponent(MARK_SVG)}`}
        width={400}
        height={400}
        alt=""
      />
    </div>
  )
}
