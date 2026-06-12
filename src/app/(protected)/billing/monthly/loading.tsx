export default function Loading() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="skeleton rounded-2xl h-9 w-64 mb-2" />
      <div className="skeleton rounded-2xl h-4 w-96 mb-5" />
      <div className="skeleton rounded-xl h-10 max-w-xs mb-5" />
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="skeleton rounded-[18px] h-24" />
        ))}
      </div>
    </div>
  )
}
