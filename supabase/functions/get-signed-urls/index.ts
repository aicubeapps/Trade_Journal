import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function collectPaths(screenshots: unknown[]): Array<{ path: string; name: string; label: string }> {
  const result: Array<{ path: string; name: string; label: string }> = []
  if (!Array.isArray(screenshots)) return result
  for (const s of screenshots) {
    if (s && typeof s === 'object') {
      const item = s as Record<string, unknown>
      const dataUrl = item.dataUrl as string | undefined
      if (dataUrl && typeof dataUrl === 'string' && !dataUrl.startsWith('data:')) {
        result.push({
          path: dataUrl,
          name: (item.name as string) ?? '',
          label: (item.label as string) ?? '',
        })
      }
    }
  }
  return result
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Auth
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: userData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !userData?.user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }
  const userId = userData.user.id

  // Parse body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { type, id } = body
  if (!type || (type !== 'trade' && type !== 'weekly')) {
    return jsonResponse({ error: 'Invalid or missing "type". Must be "trade" or "weekly"' }, 400)
  }
  if (!id || typeof id !== 'string') {
    return jsonResponse({ error: 'Missing or invalid "id"' }, 400)
  }

  // Fetch the row, enforcing ownership
  type ScreenshotItem = Record<string, unknown>
  type NoteItem = { screenshots?: ScreenshotItem[] }
  type UpdateItem = { text?: string; at?: string; screenshots?: ScreenshotItem[] }

  let allPaths: Array<{ path: string; name: string; label: string }> = []

  if (type === 'trade') {
    const { data: row, error } = await supabase
      .from('trades')
      .select('id, screenshots, eod_screenshots, followup_screenshots, review_screenshots, trade_notes')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !row) {
      return jsonResponse({ error: 'Trade not found or access denied' }, 403)
    }

    allPaths = [
      ...collectPaths(row.screenshots ?? []),
      ...collectPaths(row.eod_screenshots ?? []),
      ...collectPaths(row.followup_screenshots ?? []),
      ...collectPaths(row.review_screenshots ?? []),
    ]

    const notes: NoteItem[] = Array.isArray(row.trade_notes) ? row.trade_notes : []
    for (const note of notes) {
      allPaths.push(...collectPaths(note.screenshots ?? []))
    }
  } else {
    const { data: row, error } = await supabase
      .from('weeklies')
      .select('id, screenshots, updates')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !row) {
      return jsonResponse({ error: 'Weekly bias entry not found or access denied' }, 403)
    }

    allPaths = [...collectPaths(row.screenshots ?? [])]

    const updates: UpdateItem[] = Array.isArray(row.updates) ? row.updates : []
    for (const update of updates) {
      allPaths.push(...collectPaths(update.screenshots ?? []))
    }
  }

  // Generate signed URLs
  const signedScreenshots: Array<{
    name: string
    label: string
    path: string
    signed_url: string | null
    error?: string
  }> = []

  for (const item of allPaths) {
    const { data, error } = await supabase.storage
      .from('screenshots')
      .createSignedUrl(item.path, 3600)

    if (error) {
      signedScreenshots.push({ ...item, signed_url: null, error: error.message })
    } else {
      signedScreenshots.push({ ...item, signed_url: data.signedUrl })
    }
  }

  const responseKey = type === 'trade' ? 'trade_id' : 'weekly_id'

  return jsonResponse({
    [responseKey]: id,
    type,
    generated_at: new Date().toISOString(),
    expires_in_seconds: 3600,
    screenshot_count: signedScreenshots.filter((s) => s.signed_url).length,
    screenshots: signedScreenshots,
  })
})
