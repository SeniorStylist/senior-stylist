const PALETTE = [
  { bg: '#EEEDFE', text: '#534AB7' }, // indigo
  { bg: '#E1F5EE', text: '#0F6E56' }, // emerald
  { bg: '#E6F1FB', text: '#185FA5' }, // blue
  { bg: '#F9EFF2', text: '#8B2E4A' }, // burgundy
  { bg: '#FAEEDA', text: '#854F0B' }, // amber
] as const

export function getAvatarColor(name: string): { bg: string; text: string } {
  const letter = name.trim()[0]?.toUpperCase() ?? 'A'
  const idx = letter.charCodeAt(0) - 65
  if (idx < 0 || idx > 25) return { bg: '#F5F5F4', text: '#57534E' }
  return PALETTE[idx % PALETTE.length]
}
