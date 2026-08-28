import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AuthenticatedGuard } from '../auth/authenticated.guard';
import { DemoAdminGuard } from '../organizations/demo-admin.guard';
import { ImplementationsService } from './implementations.service';

class CreateImplementationDto {
  @IsUUID() organizationId!: string;
  @IsUUID() templateVersionId!: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsArray() @IsString({ each: true }) selectedPhaseCodes!: string[];
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsDateString() startedAt?: string;
  @IsOptional() @IsDateString() dueAt?: string;
}

class SaveAnswerDto {
  @IsOptional() @IsIn(['COMPLETED', 'IN_PROGRESS', 'NOT_DONE']) checklistValue?: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_DONE';
  @IsOptional() @IsNumber() numberValue?: number;
  @IsOptional() @IsString() @MaxLength(100) textValue?: string;
  @IsOptional() @IsString() notes?: string;
}

type AuthenticatedRequest = Request & { actor: { id: string; globalRole: string } };

@ApiTags('implementations')
@ApiBearerAuth()
@Controller('implementations')
export class ImplementationsController {
  constructor(private readonly implementations: ImplementationsService) {}

  @Get()
  @UseGuards(AuthenticatedGuard)
  list(@Req() request: AuthenticatedRequest) {
    return this.implementations.listFor(request.actor);
  }

  @Get('options')
  @UseGuards(DemoAdminGuard)
  options() {
    return this.implementations.options();
  }

  @Get(':id')
  @UseGuards(AuthenticatedGuard)
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.implementations.getFor(id, request.actor);
  }

  @Patch(':id/questions/:questionId/answer')
  @UseGuards(AuthenticatedGuard)
  saveAnswer(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() body: SaveAnswerDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.implementations.saveAnswer(id, questionId, body, request.actor);
  }

  @Post()
  @UseGuards(DemoAdminGuard)
  create(@Body() body: CreateImplementationDto) {
    return this.implementations.create(body);
  }
}
