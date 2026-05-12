export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="skeleton rounded-2xl h-9 w-48" />
      <div className="skeleton rounded-2xl h-11 w-full max-w-sm" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton rounded-2xl h-14" />
        ))}
      </div>
    </div>
  )
}
