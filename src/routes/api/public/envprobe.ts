import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/public/envprobe')({
  server: { handlers: { GET: async () => new Response(JSON.stringify(Object.keys(process.env).filter(k=>k.startsWith('JIRA')||k.startsWith('SUPABASE')))) } },
})
