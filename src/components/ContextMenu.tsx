import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib'

export type MenuItem =
  | { type?: 'item'; label: string; icon?: ReactNode; danger?: boolean; checked?: boolean; onSelect: () => void }
  | { type: 'separator' }
  | { type: 'header'; label: string }

interface MenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null
  open(x: number, y: number, items: MenuItem[]): void
  close(): void
}

export const useContextMenu = create<MenuState>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null })
}))

/** Menu de contexto translúcido no estilo macOS. Montado uma única vez no App. */
export function ContextMenuHost() {
  const { menu, close } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Mantém o menu dentro da janela.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu, close])

  if (!menu) return null
  return (
    <div className="fixed inset-0 z-50" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div
        ref={ref}
        style={{ left: pos.x, top: pos.y }}
        className="absolute min-w-52 rounded-[10px] border border-separator bg-elevated/85 p-[5px] shadow-mac backdrop-blur-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menu.items.map((item, i) => {
          if (item.type === 'separator') return <div key={i} className="mx-2 my-[5px] h-px bg-separator" />
          if (item.type === 'header')
            return (
              <div key={i} className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-label-tertiary">
                {item.label}
              </div>
            )
          return (
            <button
              key={i}
              className={cn(
                'flex h-6 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[13px] hover:bg-accent hover:text-white',
                item.danger && 'text-danger'
              )}
              onClick={() => {
                close()
                item.onSelect()
              }}
            >
              <span className="flex w-4 justify-center [&>svg]:size-3.5">{item.checked ? '✓' : item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
