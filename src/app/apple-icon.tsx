import { ImageResponse } from 'next/og'
import { LogoIconSvg } from './logo-icon-svg'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(<LogoIconSvg size={180} />, { width: 180, height: 180 })
}
