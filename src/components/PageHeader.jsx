export default function PageHeader({ title, subtitle, actions, children }) {
  const buttons = children ?? actions
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {buttons && <div className="flex items-center gap-2 flex-shrink-0">{buttons}</div>}
    </div>
  )
}
