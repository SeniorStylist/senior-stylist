export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="skeleton rounded-2xl h-10 w-48 mb-6" />
      <div className="grid md:grid-cols-[360px_1fr] gap-6">
        <div className="space-y-4">
          <div className="skeleton rounded-2xl h-24 w-full" />
          <div className="skeleton rounded-2xl h-10 w-full" />
          <div className="skeleton rounded-2xl h-40 w-full" />
        </div>
        <div className="skeleton rounded-2xl w-full aspect-[8.5/11]" />
      </div>
    </div>
  )
}
