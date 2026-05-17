import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { walk } from 'https://deno.land/std@0.168.0/fs/walk.ts'

interface DiagnosticResult {
  status: 'success' | 'warning' | 'error'
  errors: string[]
  warnings: string[]
  recommendations: string[]
  functionFiles: string[]
  importIssues: string[]
  configIssues: string[]
}

async function validateFunctionFiles(): Promise<{ files: string[]; errors: string[] }> {
  const files: string[] = []
  const errors: string[] = []
  
  try {
    const functionsPath = new URL('../', import.meta.url).pathname
    
    for await (const entry of walk(functionsPath, { 
      maxDepth: 2,
      includeFiles: true,
      includeDirs: false,
      exts: ['ts', 'tsx', 'js', 'jsx']
    })) {
      if (entry.isFile && entry.path.includes('index.')) {
        files.push(entry.path)
        
        try {
          const content = await Deno.readTextFile(entry.path)
          
          if (!content.includes('Deno.serve') && !content.includes('serve(')) {
            errors.push(`${entry.name}: Missing Deno.serve handler`)
          }
          
          if (content.includes('export default') && !content.includes('Deno.serve')) {
            errors.push(`${entry.name}: Uses export default instead of Deno.serve`)
          }
        } catch (err) {
          errors.push(`${entry.name}: Failed to read file - ${err.message}`)
        }
      }
    }
  } catch (err) {
    errors.push(`Function validation failed: ${err.message}`)
  }
  
  return { files, errors }
}

async function analyzeImports(): Promise<string[]> {
  const issues: string[] = []
  
  try {
    const functionsPath = new URL('../', import.meta.url).pathname
    
    for await (const entry of walk(functionsPath, {
      maxDepth: 2,
      includeFiles: true,
      exts: ['ts', 'tsx', 'js', 'jsx']
    })) {
      if (entry.isFile) {
        try {
          const content = await Deno.readTextFile(entry.path)
          
          if (content.includes('import') && content.match(/from ['"](?!https?:\/\/)[^'"]*['"]/)) {
            const relativeImports = content.match(/from ['"](\.\.?\/[^'"]*)['"]/g)
            if (relativeImports) {
              issues.push(`${entry.name}: Contains relative imports - ${relativeImports.join(', ')}`)
            }
          }
          
          if (content.includes('require(')) {
            issues.push(`${entry.name}: Uses CommonJS require() instead of ES modules`)
          }
          
          if (content.match(/from ['"]@supabase\/supabase-js['"]/)) {
            if (!content.includes('https://esm.sh/') && !content.includes('https://cdn.skypack.dev/')) {
              issues.push(`${entry.name}: @supabase/supabase-js should be imported from CDN`)
            }
          }
        } catch (err) {
          issues.push(`${entry.name}: Failed to analyze imports - ${err.message}`)
        }
      }
    }
  } catch (err) {
    issues.push(`Import analysis failed: ${err.message}`)
  }
  
  return issues
}

function detectCommonErrorPatterns(content: string, filename: string): string[] {
  const patterns: string[] = []
  
  if (content.includes('process.env') && !content.includes('Deno.env')) {
    patterns.push(`${filename}: Uses process.env instead of Deno.env`)
  }
  
  if (content.includes('__dirname') || content.includes('__filename')) {
    patterns.push(`${filename}: Uses Node.js __dirname/__filename`)
  }
  
  if (content.includes('async') && !content.includes('await') && !content.includes('.then(')) {
    patterns.push(`${filename}: Async function without await or .then()`)
  }
  
  if (content.includes('cors') && !content.includes('Access-Control-Allow-Origin')) {
    patterns.push(`${filename}: CORS handling may be incomplete`)
  }
  
  return patterns
}

async function validateDeploymentConfig(): Promise<string[]> {
  const issues: string[] = []
  
  try {
    const configPath = new URL('../../../supabase/config.toml', import.meta.url).pathname
    
    try {
      const config = await Deno.readTextFile(configPath)
      
      if (!config.includes('[functions]')) {
        issues.push('config.toml: Missing [functions] section')
      }
      
      if (!config.includes('enabled = true')) {
        issues.push('config.toml: Functions may not be enabled')
      }
    } catch {
      issues.push('config.toml: File not found or not readable')
    }
  } catch (err) {
    issues.push(`Config validation failed: ${err.message}`)
  }
  
  return issues
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      })
    }

    const result: DiagnosticResult = {
      status: 'success',
      errors: [],
      warnings: [],
      recommendations: [],
      functionFiles: [],
      importIssues: [],
      configIssues: []
    }

    const { files, errors: fileErrors } = await validateFunctionFiles()
    result.functionFiles = files
    result.errors.push(...fileErrors)

    const importIssues = await analyzeImports()
    result.importIssues = importIssues
    result.warnings.push(...importIssues)

    for (const file of files) {
      try {
        const content = await Deno.readTextFile(file)
        const patterns = detectCommonErrorPatterns(content, file)
        result.warnings.push(...patterns)
      } catch (err) {
        result.errors.push(`Failed to analyze ${file}: ${err.message}`)
      }
    }

    const configIssues = await validateDeploymentConfig()
    result.configIssues = configIssues
    result.warnings.push(...configIssues)

    if (result.errors.length > 0) {
      result.status = 'error'
      result.recommendations.push('Fix critical errors before deploying')
    } else if (result.warnings.length > 0) {
      result.status = 'warning'
      result.recommendations.push('Review warnings to improve function reliability')
    }

    if (result.importIssues.length > 0) {
      result.recommendations.push('Use CDN imports (esm.sh or cdn.skypack.dev) for external packages')
    }

    if (result.errors.some(e => e.includes('Deno.serve'))) {
      result.recommendations.push('All edge functions must use Deno.serve() handler pattern')
    }

    result.recommendations.push('Test functions locally with: supabase functions serve <function-name>')
    result.recommendations.push('Check logs with: supabase functions logs <function-name>')

    return new Response(JSON.stringify(result, null, 2), {