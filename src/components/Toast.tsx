export interface ToastData {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}

interface Props {
  toasts: ToastData[]
}

const icons = { success: '✓', error: '✕', info: 'ℹ' }

export default function Toast({ toasts }: Props) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span style={{ fontWeight: 700 }}>{icons[t.type]}</span>
          {t.message}
        </div>
      ))}
    </div>
  )
}
