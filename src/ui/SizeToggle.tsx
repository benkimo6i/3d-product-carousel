import { useStore } from '../store'
import { setMbpSize } from '../actions'

export function SizeToggle({ className = '' }: { className?: string }) {
  const size = useStore((s) => s.mbpSize)
  return (
    <div className={`size-toggle ${className}`} role="radiogroup" aria-label="MacBook Pro size">
      {(['14', '16'] as const).map((s) => (
        <button key={s} role="radio" aria-checked={size === s} className={size === s ? 'active' : ''} onClick={() => setMbpSize(s)}>
          {s}&Prime;
        </button>
      ))}
      <span className="size-toggle-thumb" style={{ transform: `translateX(${size === '16' ? 100 : 0}%)` }} />
    </div>
  )
}
