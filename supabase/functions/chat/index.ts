

// ââ RESEARCH_SYNTHESIS_GENERATOR ââ
if (msgLower.startsWith('synthesize_research')) {
  const startTime = Date.now();
  try {
    const args = content.slice('synthesize_research'.length).trim();
    const params = new URLSearchParams(args.replace(/\s+/g, '&'));
    const minRelevance = parseFloat(params.get('min_relevance') || '0.85');
    const maxTopics = parseInt(params.get('max_topics') || '15');
    const daysBack = parseInt(params.get('days') || '30');
    
    // Simulate fetching research data (replace with actual data source)
    const mockResearchTopics = [
      { id: 1, title: "AI-driven competitive intelligence platforms", relevance: 0.95, category: "competitive_intel", date: new Date(Date.now() - 2 * 86400000) },
      { id: 2, title: "Real-time market monitoring capabilities", relevance: 0.93, category: "competitive_intel", date: new Date(Date.now() - 5 * 86400000) },
      { id: 3, title: "Operational efficiency automation tools", relevance: 0.92, category: "operations", date: new Date(Date.now() - 3 * 86400000) },
      { id: 4, title: "Strategic planning frameworks for tech", relevance: 0.94, category: "strategy", date: new Date(Date.now() - 1 * 86400000) },
      { id: 5, title: "Customer behavior analytics systems", relevance: 0.91, category: "analytics", date: new Date(Date.now() - 7 * 86400000) },
      { id: 6, title: "Capability gap assessment methodologies", relevance: 0.93, category: "strategy", date: new Date(Date.now() - 4 * 86400000) },
      { id: 7, title: "Competitor product feature tracking", relevance: 0.92, category: "competitive_intel", date: new Date(Date.now() - 6 * 86400000) },
      { id: 8, title: "Process optimization best practices", relevance: 0.90, category: "operations", date: new Date(Date.now() - 8 * 86400000) },
      { id: 9, title: "Data-driven decision making frameworks", relevance: 0.94, category: "analytics", date: new Date(Date.now() - 2 * 86400000) },
      { id: 10, title: "Market positioning strategies", relevance: 0.92, category: "strategy", date: new Date(Date.now() - 5 * 86400000) }
    ];
    
    const cutoffDate = new Date(Date.now() - daysBack * 86400000);
    const filtered = mockResearchTopics
      .filter(t => t.relevance >= minRelevance && t.date >= cutoffDate)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxTopics);
    
    const byCategory = filtered.reduce((acc, topic) => {
      if (!acc[topic.category]) acc[topic.category] = [];
      acc[topic.category].push(topic);
      return acc;
    }, {} as Record<string, typeof filtered>);
    
    let synthesis = `# RESEARCH SYNTHESIS REPORT\n`;
    synthesis += `Generated: ${new Date().toISOString()}\n`;
    synthesis += `Topics Analyzed: ${filtered.length} (min relevance: ${minRelevance})\n\n`;
    
    synthesis += `## EXECUTIVE SUMMARY\n`;
    synthesis += `Identified ${Object.keys(byCategory).length} key strategic clusters from ${filtered.length} high-relevance research topics.\n\n`;
    
    synthesis += `## TOPIC CLUSTERS\n\n`;
    for (const [category, topics] of Object.entries(byCategory)) {
      synthesis += `### ${category.toUpperCase().replace(/_/g, ' ')} (${topics.length} topics)\n`;
      synthesis += `Average Relevance: ${(topics.reduce((sum, t) => sum + t.relevance, 0) / topics.length).toFixed(3)}\n`;
      topics.forEach(t => {
        synthesis += `- [${t.relevance.toFixed(2)}] ${t.title}\n`;
      });
      synthesis += `\n`;
    }
    
    synthesis += `## COMPETITIVE INSIGHTS\n`;
    const compIntel = byCategory['competitive_intel'] || [];
    if (compIntel.length > 0) {
      synthesis += `- ${compIntel.length} competitive intelligence topics identified\n`;
      synthesis += `- Focus areas: real-time monitoring, feature tracking, market positioning\n`;
      synthesis += `- Key gap: Need integrated competitive dashboard\n\n`;
    } else {
      synthesis += `- No competitive intelligence topics in current cluster\n\n`;
    }
    
    synthesis += `## CAPABILITY GAPS\n`;
    synthesis += `Based on topic distribution analysis:\n`;
    const categoryCount = Object.keys(byCategory).length;
    if (!byCategory['analytics']) synthesis += `- CRITICAL: Analytics capabilities underrepresented\n`;
    if (!byCategory['operations']) synthesis += `- HIGH: Operational efficiency tools needed\n`;
    if (compIntel.length > 3) synthesis += `- OPPORTUNITY: High competitive intel focus suggests market monitoring priority\n`;
    synthesis += `\n`;
    
    synthesis += `## RECOMMENDATIONS\n`;
    synthesis += `1. Prioritize top ${Math.min(3, filtered.length)} topics (relevance > 0.93)\n`;
    synthesis += `2. Address capability gaps in underrepresented categories\n`;
    synthesis += `3. Implement automated tracking for competitive intelligence cluster\n`;
    synthesis += `4. Schedule quarterly synthesis review cycle\n\n`;
    
    synthesis += `## NEXT ACTIONS\n`;
    synthesis += `- [ ] Review synthesis with strategy team\n`;
    synthesis += `- [ ] Allocate resources to top 3 priority areas\n`;
    synthesis += `- [ ] Set up monitoring dashboards for tracked topics\n`;
    synthesis += `- [ ] Plan follow-up research for identified gaps\n`;
    
    const responseMs = Date.now() - startTime;
    await logUsage('research_synthesis_generator', true, responseMs, channel);
    earlyReturn(synthesis);
  } catch (error) {
    const responseMs = Date.now() - startTime;
    await logUsage('research_synthesis_generator', false, responseMs, channel);
    earlyReturn(`â Research synthesis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}