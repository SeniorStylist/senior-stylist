export default function ServiceLogLoading() {
  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="h-4 w-40 skeleton rounded mb-6" />
        <div className="bg-white rounded-2xl border border-stone-200 p-8">
          <div className="h-8 w-56 skeleton rounded mb-2" />
          <div className="h-4 w-full skeleton rounded mb-2" />
          <div className="h-4 w-2/3 skeleton rounded mb-8" />
          <div className="border-2 border-dashed border-stone-200 rounded-xl p-10" />
        </div>
      </div>
    </div>
  )
}
