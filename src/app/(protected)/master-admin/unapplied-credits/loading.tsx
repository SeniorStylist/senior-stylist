export default function Loading() {
  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="skeleton rounded-2xl h-5 w-44 mb-6" />
        <div className="skeleton rounded-2xl h-8 w-64 mb-2" />
        <div className="skeleton rounded-2xl h-4 w-96 mb-6" />
        <div className="skeleton rounded-[18px] h-16 w-full mb-6" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton rounded-[18px] h-32 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
