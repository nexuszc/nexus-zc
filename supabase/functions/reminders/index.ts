import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function sendTelegram(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
  })
}

serve(async () => {
  try {
    const { data: dueReminders, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('fired', false)
      .lte('fire_at', new Date().toISOString())

    if (error) throw error

    if (!dueReminders || dueReminders.length === 0) {
      return new Response(JSON.stringify({ fired: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    for (const reminder of dueReminders) {
      await sendTelegram(`⏰ Reminder: ${reminder.message}`)
      await supabase
        .from('reminders')
        .update({ fired: true })
        .eq('id', reminder.id)
    }

    return new Response(JSON.stringify({ fired: dueReminders.length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Reminders error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
