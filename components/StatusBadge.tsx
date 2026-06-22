import { JOB_STATUSES } from '@/lib/config'

export function StatusBadge({ status }: { status: string }) {
  const s = JOB_STATUSES[status as keyof typeof JOB_STATUSES] ?? { label: status, color: '#6B7280', bg: 'rgba(107,114,128,0.12)' }
  return (
    <span className="badge" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  )
}
