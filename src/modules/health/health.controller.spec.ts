import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the service status', () => {
    const result = new HealthController().check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('gd-tech-api');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
