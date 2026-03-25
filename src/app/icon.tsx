import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

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
      <span style={{ color: 'white', fontSize: 200, fontWeight: 700 }}>SS</span>
    </div>
  )
}
