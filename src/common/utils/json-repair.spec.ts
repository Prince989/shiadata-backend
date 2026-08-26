import { repairJsonString } from './json-repair';

describe('repairJsonString', () => {
  it('strips markdown fences and parses the inner object', () => {
    const raw = '```json\n{"verdict":"صحیح"}\n```';
    expect(JSON.parse(repairJsonString(raw))).toEqual({ verdict: 'صحیح' });
  });

  it('drops leading prose using a balanced brace scan', () => {
    const raw = 'Here is the result: {"a":1,"b":"} still in string"} trailing';
    expect(JSON.parse(repairJsonString(raw))).toEqual({
      a: 1,
      b: '} still in string',
    });
  });

  it('removes trailing commas and smart quotes', () => {
    const raw = '{“name”: “علي”,}';
    expect(JSON.parse(repairJsonString(raw))).toEqual({ name: 'علي' });
  });
});
