const { parse, parseLive, sanitize, INTERNAL_REFERENCE } = require('../agentResponse');

describe('agent response steps', () => {
  test('separates a safe reasoning summary from the final answer', () => {
    const result = parse(
      '<egomorph_thought>Ich habe die Kernfrage eingegrenzt.</egomorph_thought>' +
      '<egomorph_final>Das ist die vollständige Antwort.</egomorph_final>',
      { skills: ['internet.research'] }
    );

    expect(result).toEqual({
      thought: 'Ich habe die Kernfrage eingegrenzt.',
      reply: 'Das ist die vollständige Antwort.',
      skills: ['internet.research']
    });
  });

  test('uses a safe summary fallback for models without the response tags', () => {
    expect(parse('Nur die Antwort', { fallbackThought: 'Sicher zusammengefasst.' })).toEqual({
      thought: 'Sicher zusammengefasst.',
      reply: 'Nur die Antwort',
      skills: []
    });
  });

  test('extracts incomplete tagged content while tokens are still streaming', () => {
    expect(parseLive(
      '<egomorph_thought>Quellen werden verglichen.</egomorph_thought><egomorph_final>Die laufende Ant',
      { fallbackThought: 'Analysiert …' }
    )).toEqual({
      thought: 'Quellen werden verglichen.',
      reply: 'Die laufende Ant'
    });
    expect(parseLive('<egomorph_thou', { fallbackThought: 'Analysiert …' }).reply).toBe('');
    expect(parseLive('<egomorph_thought>Live Zusammenfassung</egomorph_thou', { fallbackThought: 'Analysiert …' }).thought).toBe('Live Zusammenfassung');
  });

  test('redacts model-home paths, memory names and protected upload paths', () => {
    const output = sanitize(
      'Siehe /tmp/EgomorphCore/model-home/private.txt, memory.md und upload.md.',
      ['upload.md']
    );

    expect(output).not.toMatch(/model-home|private\.txt|memory\.md|upload\.md/i);
    expect(output).toContain(INTERNAL_REFERENCE);
  });
});
