import { parseMcpMode } from 'src/engine/api/mcp/utils/parse-mcp-mode.util';

describe('parseMcpMode', () => {
  it('opts in to direct mode only for the exact value "direct"', () => {
    expect(parseMcpMode('direct')).toBe('direct');
  });

  it.each([undefined, '', 'meta', 'Direct', 'direct ', ['direct'], 1])(
    'keeps meta mode for %p',
    (value) => {
      expect(parseMcpMode(value)).toBe('meta');
    },
  );
});
