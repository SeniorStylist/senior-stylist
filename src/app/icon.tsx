import { ImageResponse } from 'next/og'
import { LogoIconSvg } from './logo-icon-svg'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(<LogoIconSvg size={512} />, { width: 512, height: 512 })
}
