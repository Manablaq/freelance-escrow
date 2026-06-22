const MAP: Record<string, [string, string]> = {
  OPEN:      ['#8B35FF', 'rgba(139,53,255,0.12)'],
  FUNDED:    ['#00D4FF', 'rgba(0,212,255,0.12)'],
  SUBMITTED: ['#FFB830', 'rgba(255,184,48,0.12)'],
  PAID:      ['#00E5A0', 'rgba(0,229,160,0.12)'],
  DISPUTED:  ['#FF4D6A', 'rgba(255,77,106,0.12)'],
  REFUNDED:  ['#8A9BC1', 'rgba(138,155,193,0.12)'],
  CANCELLED: ['#8A9BC1', 'rgba(138,155,193,0.12)'],
}
export function StatusBadge({ status }: { status: string }) {
  const [color, bg] = MAP[status] ?? ['#8A9BC1', 'rgba(138,155,193,0.12)']
  return <span className="badge" style={{ color, background: bg }}>{status}</span>
}
