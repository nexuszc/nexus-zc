import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

export interface CycleLogData {
  cycle_id: string
  phase: string
  status: 'started' | 'success' | 'error' | 'json_parse_error'
  raw_output?: string
  parsed_data?: any
  error_details?: string
  metadata?: Record<string, any>
}

export class CycleLogger {
  private supabase: SupabaseClient

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  async logCycleStart(cycleId: string, phase: string, metadata?: Record<string, any>) {
    try {
      const { error } = await this.supabase
        .from('system_logs')
        .insert({
          cycle_id: cycleId,
          phase: phase,
          status: 'started',
          metadata: metadata || {},
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Failed to log cycle start:', error)
      }
    } catch (err) {
      console.error('Exception logging cycle start:', err)
    }
  }

  async logCycleSuccess(
    cycleId: string,
    phase: string,
    rawOutput?: string,
    parsedData?: any,
    metadata?: Record<string, any>
  ) {
    try {
      const { error } = await this.supabase
        .from('system_logs')
        .insert({
          cycle_id: cycleId,
          phase: phase,
          status: 'success',
          raw_output: rawOutput,
          parsed_data: parsedData,
          metadata: metadata || {},
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Failed to log cycle success:', error)
      }
    } catch (err) {
      console.error('Exception logging cycle success:', err)
    }
  }

  async logCycleError(
    cycleId: string,
    phase: string,
    errorDetails: string,
    rawOutput?: string,
    metadata?: Record<string, any>
  ) {
    try {
      const { error } = await this.supabase
        .from('system_logs')
        .insert({
          cycle_id: cycleId,
          phase: phase,
          status: 'error',
          raw_output: rawOutput,
          error_details: errorDetails,
          metadata: metadata || {},
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Failed to log cycle error:', error)
      }
    } catch (err) {
      console.error('Exception logging cycle error:', err)
    }
  }

  async logJSONParseFailure(
    cycleId: string,
    phase: string,
    rawOutput: string,
    parseError: Error,
    metadata?: Record<string, any>
  ) {
    try {
      const errorContext = {
        error_message: parseError.message,
        error_name: parseError.name,
        raw_output_length: rawOutput.length,
        raw_output_preview: rawOutput.substring(0, 500),
        raw_output_end: rawOutput.substring(Math.max(0, rawOutput.length - 200)),
        has_opening_brace: rawOutput.trim().startsWith('{') || rawOutput.trim().startsWith('['),
        has_closing_brace: rawOutput.trim().endsWith('}') || rawOutput.trim().endsWith(']'),
        brace_balance: this.checkBraceBalance(rawOutput)
      }

      const { error } = await this.supabase
        .from('system_logs')
        .insert({
          cycle_id: cycleId,
          phase: phase,
          status: 'json_parse_error',
          raw_output: rawOutput,
          error_details: JSON.stringify(errorContext, null, 2),
          metadata: {
            ...(metadata || {}),
            parse_error_type: 'JSON_PARSE_FAILURE'
          },
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Failed to log JSON parse failure:', error)
      }
    } catch (err) {
      console.error('Exception logging JSON parse failure:', err)
    }
  }

  validateAndParseJSON(rawOutput: string, cycleId: string, phase: string): any | null {
    if (!rawOutput || typeof rawOutput !== 'string') {
      this.logJSONParseFailure(
        cycleId,
        phase,
        String(rawOutput),
        new Error('Invalid input: output is null, undefined, or not a string'),
        { validation_step: 'pre_parse_check' }
      )
      return null
    }

    const trimmed = rawOutput.trim()
    
    if (trimmed.length === 0) {
      this.logJSONParseFailure(
        cycleId,
        phase,
        rawOutput,
        new Error('Empty string after trimming'),
        { validation_step: 'empty_check' }
      )
      return null
    }

    const braceBalance = this.checkBraceBalance(trimmed)
    if (braceBalance.curly !== 0 || braceBalance.square !== 0) {
      this.logJSONParseFailure(
        cycleId,
        phase,
        rawOutput,
        new Error(`Unbalanced braces: ${JSON.stringify(braceBalance)}`),
        { validation_step: 'brace_balance_check', brace_balance: braceBalance }
      )
      return null
    }

    try {
      const parsed = JSON.parse(trimmed)
      return parsed
    } catch (error) {
      this.logJSONParseFailure(
        cycleId,
        phase,
        rawOutput,
        error as Error,
        { validation_step: 'json_parse_attempt' }
      )
      return null
    }
  }

  private checkBraceBalance(text: string): { curly: number; square: number; details: string } {
    let curlyOpen = 0
    let curlyClose = 0
    let squareOpen = 0
    let squareClose = 0
    let inString = false
    let escapeNext = false

    for (let i = 0; i < text.length; i++) {
      const char = text[i]

      if (escapeNext) {
        escapeNext = false
        continue
      }

      if (char === '\\') {
        escapeNext = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (inString) continue

      if (char === '{') curlyOpen++
      if (char === '}') curlyClose++
      if (char === '[') squareOpen++
      if (char === ']') squareClose++
    }

    return {
      curly: curlyOpen - curlyClose,
      square: squareOpen - squareClose,
      details: `{: ${curlyOpen}/${curlyClose}, [: ${squareOpen}/${squareClose}`
    }
  }
}

export function createCycleLogger(supabase: SupabaseClient): CycleLogger {
  return new CycleLogger(supabase)
}