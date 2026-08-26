import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { fakeDemoScenario } from '../../fixtures/demo-scenario';
import { gdFrotasTemplateDefinition } from '../../fixtures/gd-frotas-template';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly config: ConfigService) {}
  @Get('scenario')
  @ApiOperation({ summary: 'Cenário fictício baseado na planilha GD Frotas' })
  scenario() {
    if (!this.config.get<boolean>('DEMO_MODE')) throw new NotFoundException();
    return { ...fakeDemoScenario, template: gdFrotasTemplateDefinition };
  }
}
