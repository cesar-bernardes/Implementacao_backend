import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DemoController } from './demo.controller';
describe('DemoController', () => {
  it('returns the scenario only in demo mode', () => {
    const enabled = new DemoController({
      get: () => true,
    } as unknown as ConfigService);
    expect(enabled.scenario().methodology.onlineActivities).toBe(65);
    const disabled = new DemoController({
      get: () => false,
    } as unknown as ConfigService);
    expect(() => disabled.scenario()).toThrow(NotFoundException);
  });
});
