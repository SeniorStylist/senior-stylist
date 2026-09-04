export default function NewFacilityLoading() {
  return (
    <div className="max-w-3xl mx-auto px-4 pt-6 pb-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="skeleton rounded-2xl w-11 h-11" />
        <div className="space-y-2">
          <div className="skeleton rounded-lg h-6 w-40" />
          <div className="skeleton rounded-lg h-4 w-32" />
        </div>
      </div>
      <div className="skeleton rounded-full h-1.5 w-full" />
      <div className="skeleton rounded-2xl h-64 w-full" />
      <div className="skeleton rounded-2xl h-12 w-40 ml-auto" />
    </div>
  )
}
