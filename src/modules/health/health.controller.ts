import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Confirma que a API está disponível' })
  check() {
    return {
      status: 'ok',
      service: 'gd-tech-api',
      timestamp: new Date().toISOString(),
    };
  }
}
