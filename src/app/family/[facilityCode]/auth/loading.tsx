// Magic-link verification is a redirect flow — content-card skeletons would look
// wrong here, so show an honest "signing you in" state instead.
export default function Loading() {
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
      <p className="text-sm text-stone-500">Signing you in…</p>
    </div>
  )
}
