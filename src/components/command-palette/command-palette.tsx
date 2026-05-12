'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Loader2,
  Calendar,
  Users,
  FileText,
  Scissors,
  CreditCard,
  BarChart3,
  Wallet,
  Settings,
  Shield,
  BookOpen,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react'
import { PALETTE_ROUTES, type PaletteRoute } from '@/lib/command-palette-pages'

interface CommandPaletteProps {
  role: string
  isMaster: boolean
  facilityId: string
}

interface ResidentResult {
  id: string
  name: string
  roomNumber: string | null
  facilityId: string
  facilityName: string
}

interface StylistResult {
  id: string
  name: string
  stylistCode: string
  facilityId: string | null
  facilityName: string | null
}

type FlatItem =
  | { kind: 'page'; id: string; route: string; label: string; secondary: string; icon: LucideIcon }
  | { kind: 'resident'; id: string; route: string; label: string; secondary: string; icon: LucideIcon }
  | { kind: 'stylist'; id: string; route: string; label: string; secondary: string; icon: LucideIcon }

const PAGE_ICON_MAP: Record<string, LucideIcon> = {
  Calendar,
  Users,
  FileText,
  Scissors,
  CreditCard,
  BarChart3,
  Wallet,
  Settings,
  Shield,
  BookOpen,
}

export function CommandPalette({ role, isMaster }: CommandPaletteProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ residents: ResidentResult[]; stylists: StylistResult[] }>({
    residents: [],
    stylists: [],
  })
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === 'Escape') {
        setOpen((prev) => (prev ? false : prev))
      }
    }
    const openHandler = () => setOpen(true)
    window.addEventListener('keydown', handler)
    window.addEventListener('open-command-palette', openHandler)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('open-command-palette', openHandler)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setActiveIndex(-1)
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setResults({ residents: [], stylists: [] })
      setLoading(false)
    }
  }, [open])

  useEffect(() => {
    if (query.length < 2) {
      setResults({ residents: [], stylists: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        const json = await res.json()
        if (res.ok && json?.data) {
          setResults({
            residents: json.data.residents ?? [],
            stylists: json.data.stylists ?? [],
          })
        }
      } catch {
        /* aborted or network failure → keep prior results */
      } finally {
        setLoading(false)
      }
    }, 150)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  const filteredPages = useMemo<PaletteRoute[]>(() => {
    const rolePages = PALETTE_ROUTES.filter((p) => isMaster || p.roles.includes(role))
    if (!query) return rolePages
    const lower = query.toLowerCase()
    return rolePages.filter(
      (p) => p.label.toLowerCase().includes(lower) || p.description.toLowerCase().includes(lower),
    )
  }, [query, role, isMaster])

  const allItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = []
    for (const p of filteredPages) {
      items.push({
        kind: 'page',
        id: p.id,
        route: p.route,
        label: p.label,
        secondary: p.description,
        icon: PAGE_ICON_MAP[p.icon] ?? FileText,
      })
    }
    for (const r of results.residents) {
      const roomStr = r.roomNumber ? `Room ${r.roomNumber}` : 'No room'
      const secondary = isMaster ? `${roomStr} · ${r.facilityName}` : roomStr
      items.push({
        kind: 'resident',
        id: r.id,
        route: `/residents/${r.id}`,
        label: r.name,
        secondary,
        icon: UserIcon,
      })
    }
    for (const s of results.stylists) {
      const codeStr = s.stylistCode
      const secondary = isMaster && s.facilityName ? `${codeStr} · ${s.facilityName}` : codeStr
      items.push({
        kind: 'stylist',
        id: s.id,
        route: `/stylists/${s.id}`,
        label: s.name,
        secondary,
        icon: Scissors,
      })
    }
    return items
  }, [filteredPages, results, isMaster])

  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  function selectItem(item: FlatItem) {
    router.push(item.route)
    setOpen(false)
  }

  function moveActive(delta: number) {
    setActiveIndex((prev) => {
      if (allItems.length === 0) return -1
      const next = prev < 0 ? (delta > 0 ? 0 : allItems.length - 1) : prev + delta
      const clamped = Math.max(0, Math.min(allItems.length - 1, next))
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-result-index="${clamped}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
      return clamped
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveActive(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const idx = activeIndex >= 0 ? activeIndex : 0
      const item = allItems[idx]
      if (item) selectItem(item)
    }
  }

  if (!open) return null

  let cursor = 0
  const pageOffset = cursor
  cursor += filteredPages.length
  const residentOffset = cursor
  cursor += results.residents.length
  const stylistOffset = cursor

  const showEmpty =
    query.length >= 2 &&
    !loading &&
    filteredPages.length === 0 &&
    results.residents.length === 0 &&
    results.stylists.length === 0

  const showInitial = !query && filteredPages.length === 0

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[290]"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[300] w-[560px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
          <Search size={16} className="text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search residents, stylists, pages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 text-sm text-stone-900 placeholder:text-stone-400 outline-none bg-transparent"
          />
          {loading && <Loader2 size={14} className="text-stone-400 animate-spin shrink-0" />}
          <kbd className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-stone-400 bg-stone-100 rounded border border-stone-200">
            ESC
          </kbd>
        </div>

        <div className="max-h-[360px] overflow-y-auto overscroll-contain">
          {filteredPages.length > 0 && (
            <ResultSection
              title="Pages"
              items={filteredPages.map((p, i) => {
                const globalIndex = pageOffset + i
                const Icon = PAGE_ICON_MAP[p.icon] ?? FileText
                return (
                  <ResultRow
                    key={`page-${p.id}`}
                    icon={<Icon size={14} className="text-stone-400 shrink-0" />}
                    label={p.label}
                    secondary={p.description}
                    active={globalIndex === activeIndex}
                    globalIndex={globalIndex}
                    onHover={() => setActiveIndex(globalIndex)}
                    onClick={() =>
                      selectItem({
                        kind: 'page',
                        id: p.id,
                        route: p.route,
                        label: p.label,
                        secondary: p.description,
                        icon: Icon,
                      })
                    }
                  />
                )
              })}
            />
          )}

          {results.residents.length > 0 && (
            <ResultSection
              title="Residents"
              items={results.residents.map((r, i) => {
                const globalIndex = residentOffset + i
                const roomStr = r.roomNumber ? `Room ${r.roomNumber}` : 'No room'
                const secondary = isMaster ? `${roomStr} · ${r.facilityName}` : roomStr
                return (
                  <ResultRow
                    key={`resident-${r.id}`}
                    icon={<UserIcon size={14} className="text-stone-400 shrink-0" />}
                    label={r.name}
                    secondary={secondary}
                    active={globalIndex === activeIndex}
                    globalIndex={globalIndex}
                    onHover={() => setActiveIndex(globalIndex)}
                    onClick={() =>
                      selectItem({
                        kind: 'resident',
                        id: r.id,
                        route: `/residents/${r.id}`,
                        label: r.name,
                        secondary,
                        icon: UserIcon,
                      })
                    }
                  />
                )
              })}
            />
          )}

          {results.stylists.length > 0 && (
            <ResultSection
              title="Stylists"
              items={results.stylists.map((s, i) => {
                const globalIndex = stylistOffset + i
                const secondary =
                  isMaster && s.facilityName ? `${s.stylistCode} · ${s.facilityName}` : s.stylistCode
                return (
                  <ResultRow
                    key={`stylist-${s.id}`}
                    icon={<Scissors size={14} className="text-stone-400 shrink-0" />}
                    label={s.name}
                    secondary={secondary}
                    active={globalIndex === activeIndex}
                    globalIndex={globalIndex}
                    onHover={() => setActiveIndex(globalIndex)}
                    onClick={() =>
                      selectItem({
                        kind: 'stylist',
                        id: s.id,
                        route: `/stylists/${s.id}`,
                        label: s.name,
                        secondary,
                        icon: Scissors,
                      })
                    }
                  />
                )
              })}
            />
          )}

          {showEmpty && (
            <div className="px-4 py-8 text-center text-sm text-stone-400">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {showInitial && (
            <div className="px-4 py-8 text-center text-sm text-stone-400">
              Start typing to search
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function ResultSection({ title, items }: { title: string; items: React.ReactNode[] }) {
  return (
    <div>
      <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
        {title}
      </div>
      <div>{items}</div>
    </div>
  )
}

function ResultRow({
  icon,
  label,
  secondary,
  active,
  globalIndex,
  onHover,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  secondary: string
  active: boolean
  globalIndex: number
  onHover: () => void
  onClick: () => void
}) {
  return (
    <div
      data-result-index={globalIndex}
      onMouseEnter={onHover}
      onClick={onClick}
      className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors ${active ? 'bg-[#F9EFF2]' : ''}`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-stone-900 truncate">{label}</div>
        <div className="text-xs text-stone-500 truncate">{secondary}</div>
      </div>
    </div>
  )
}
