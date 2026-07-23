'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  Sparkles,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react'
import { PALETTE_ROUTES, type PaletteRoute } from '@/lib/command-palette-pages'

interface CommandPaletteProps {
  role: string
  isMaster: boolean
  facilityId: string
  /** P47 — admin/bookkeeper/master only: fetch resident/stylist results.
   * Other roles get pages + the Ask-AI handoff (the /api/search route 403s
   * them anyway — prop-gating avoids console noise + rate-bucket burn). */
  canSearchEntities: boolean
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
  // P47 — Cmd-K ↔ assistant merge: pinned handoff row (closes the palette,
  // opens the assistant, auto-sends the typed query).
  | { kind: 'ask-ai'; id: string; route: string; label: string; secondary: string; icon: LucideIcon }

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

export function CommandPalette({ role, isMaster, canSearchEntities }: CommandPaletteProps) {
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
    if (!canSearchEntities || query.length < 2) {
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
  }, [query, canSearchEntities])

  // P47 — the pinned Ask-AI handoff row (always first; Enter with no
  // selection hits it when a query is typed, so "type → Enter" asks the AI
  // whenever nothing else was picked).
  const askAiItem = useMemo<FlatItem>(
    () => ({
      kind: 'ask-ai',
      id: 'ask-ai',
      route: '',
      label: query.trim().length >= 2 ? `Ask the assistant: “${query.trim()}”` : 'Ask the AI assistant',
      secondary: query.trim().length >= 2 ? 'Sends your question to the AI' : 'Questions, bookings, walkthroughs — anything',
      icon: Sparkles,
    }),
    [query],
  )

  const filteredPages = useMemo<PaletteRoute[]>(() => {
    const rolePages = PALETTE_ROUTES.filter((p) => isMaster || p.roles.includes(role))
    if (!query) return rolePages
    const lower = query.toLowerCase()
    return rolePages.filter(
      (p) => p.label.toLowerCase().includes(lower) || p.description.toLowerCase().includes(lower),
    )
  }, [query, role, isMaster])

  const allItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [askAiItem]
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
  }, [askAiItem, filteredPages, results, isMaster])

  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  function selectItem(item: FlatItem) {
    if (item.kind === 'ask-ai') {
      // P47 — hand off to the assistant (auto-sends when a query was typed).
      const prompt = query.trim()
      setOpen(false)
      window.dispatchEvent(
        new CustomEvent('open-assistant', { detail: prompt.length >= 2 ? { prompt } : {} }),
      )
      return
    }
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
      // No selection: prefer the first REAL result (pre-P47 muscle memory);
      // the Ask-AI row (index 0) is one ArrowUp away.
      const idx = activeIndex >= 0 ? activeIndex : allItems.length > 1 ? 1 : 0
      const item = allItems[idx]
      if (item) selectItem(item)
    }
  }

  if (!open) return null
  if (typeof document === 'undefined') return null

  let cursor = 1 // index 0 = the pinned Ask-AI row
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

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[290]"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed z-[300] inset-x-3 top-[calc(var(--app-safe-top,0px)+12px)] md:inset-x-auto md:top-[15%] md:left-1/2 md:-translate-x-1/2 md:w-[560px] md:max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden"
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

        <div className="max-h-[min(360px,60dvh)] overflow-y-auto overscroll-contain">
          {/* P47 — pinned Ask-AI handoff (always index 0) */}
          <div
            data-result-index={0}
            onMouseEnter={() => setActiveIndex(0)}
            onClick={() => selectItem(askAiItem)}
            className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors border-b border-stone-100 ${activeIndex === 0 ? 'bg-[#F9EFF2]' : ''}`}
          >
            <Sparkles size={14} className="text-[#8B2E4A] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[#8B2E4A] truncate">{askAiItem.label}</div>
              <div className="text-xs text-stone-500 truncate">{askAiItem.secondary}</div>
            </div>
          </div>

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
            <div className="px-4 py-6 text-center text-sm text-stone-400">
              No matches for &ldquo;{query}&rdquo; — try asking the assistant above
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
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
