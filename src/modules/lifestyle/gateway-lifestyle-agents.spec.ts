import * as fs from 'fs';
import * as path from 'path';

describe('GatewayLifestyleAgents prompts', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'gateway-lifestyle-agents.ts'),
    'utf8',
  );

  it('does not hardcode drink-water or marital few-shots', () => {
    expect(source).not.toContain('آب خوردن');
    expect(source).not.toContain('عِشْرَةِ النِّسَاءِ');
    expect(source).not.toContain('خستگی');
  });
});

