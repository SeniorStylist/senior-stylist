import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const formData = await request.formData()
    const file = formData.get('image') as File | null
    if (!file) return Response.json({ error: 'No image provided' }, { status: 400 })

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      return Response.json({ error: 'Unsupported image type' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction:
        'You are reading a handwritten salon log sheet from a senior living facility. Extract all appointments you can read. For each appointment return JSON with: { residentName, serviceName, price, stylistName, notes }. Return ONLY a JSON array, no other text. If handwriting is unclear, make your best guess and add unclear: true to that entry.',
    })

    const result = await model.generateContent([
      { inlineData: { data: base64, mimeType: file.type } },
      'Extract all appointments from this log sheet. Return ONLY a JSON array: [{ residentName, serviceName, price, stylistName, notes, unclear? }]',
    ])

    const rawText = result.response.text()

    let entries: unknown[]
    try {
      // Strip markdown code fences if present
      const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
      entries = JSON.parse(cleaned)
      if (!Array.isArray(entries)) throw new Error('Not an array')
    } catch {
      return Response.json({ error: 'Could not parse response from Gemini' }, { status: 422 })
    }

    return Response.json({ data: { entries } })
  } catch (err) {
    console.error('POST /api/log/ocr error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
