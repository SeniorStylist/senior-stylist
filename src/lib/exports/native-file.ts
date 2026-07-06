// Native (Capacitor) file delivery. Blob `<a download>` silently fails inside
// WKWebView/Android WebView, so in the app we write the file to the cache
// directory and open the OS share sheet instead (AirPrint / Save to Files /
// Mail / Drive…). Only ever called when isNativeApp() — plugins are dynamically
// imported so nothing lands in the web bundle.

export async function shareBlobNative(
  blob: Blob,
  filename: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const base64 = await blobToBase64(blob)
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')

    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    })

    await Share.share({
      title: filename,
      files: [written.uri],
    })
    return { ok: true }
  } catch (err) {
    // User dismissing the share sheet rejects on some platforms — treat as success.
    const msg = err instanceof Error ? err.message : String(err)
    if (/cancel/i.test(msg)) return { ok: true }
    console.error('[shareBlobNative] failed:', err)
    return { ok: false, error: 'Could not open the share sheet for this file.' }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1)) // strip data:*;base64,
    }
    reader.readAsDataURL(blob)
  })
}
