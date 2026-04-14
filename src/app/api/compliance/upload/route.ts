import { createClient } from '@/lib/supabase/server'
import { createStorageClient, COMPLIANCE_BUCKET } from '@/lib/supabase/storage'
import { db } from '@/db'
import { complianceDocuments, profiles, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const DOCUMENT_TYPES = ['license', 'insurance', 'w9', 'contractor_agreement', 'background_check'] as const
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

const formSchema = z.object({
  stylistId: z.string().uuid(),
  documentType: z.enum(DOCUMENT_TYPES),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const form = await request.formData()
    const file = form.get('file')
    const parsed = formSchema.safeParse({
      stylistId: form.get('stylistId'),
      documentType: form.get('documentType'),
      expiresAt: form.get('expiresAt') || undefined,
    })
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }
    const { stylistId, documentType, expiresAt } = parsed.data

    if (!(file instanceof File)) {
      return Response.json({ error: 'Missing file' }, { status: 422 })
    }
    if (file.size === 0) return Response.json({ error: 'Empty file' }, { status: 422 })
    if (file.size > MAX_BYTES) return Response.json({ error: 'File exceeds 10MB' }, { status: 422 })
    if (!ALLOWED_MIME.has(file.type)) {
      return Response.json({ error: 'Only PDF, JPG, PNG allowed' }, { status: 422 })
    }

    if (facilityUser.role !== 'admin') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId || profile.stylistId !== stylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stylistId), eq(stylists.facilityId, facilityId)),
      columns: { id: true },
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })

    const ext = MIME_EXT[file.type]
    const path = `${facilityId}/${stylistId}/${documentType}-${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const storage = createStorageClient()
    const { error: uploadErr } = await storage.storage
      .from(COMPLIANCE_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false })
    if (uploadErr) {
      console.error('compliance upload storage error:', uploadErr)
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }

    const [document] = await db
      .insert(complianceDocuments)
      .values({
        stylistId,
        facilityId,
        documentType,
        fileUrl: path,
        fileName: file.name.slice(0, 255),
        expiresAt: expiresAt ?? null,
      })
      .returning()

    return Response.json({ data: { document } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/compliance/upload error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
