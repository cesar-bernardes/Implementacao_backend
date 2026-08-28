import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(6) password!: string; }
class RefreshDto { @IsString() refreshToken!: string; }
class FirstAccessDto { @IsString() accessToken!: string; @IsString() @MinLength(8) password!: string; }
class EmailDto { @IsEmail() email!: string; }
class TemporaryFirstAccessDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) temporaryPassword!: string;
  @IsString() @MinLength(8) password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login') login(@Body() body: LoginDto) { return this.auth.login(body.email, body.password); }
  @Post('refresh') refresh(@Body() body: RefreshDto) { return this.auth.refresh(body.refreshToken); }
  @Post('first-access') firstAccess(@Body() body: FirstAccessDto) { return this.auth.definePassword(body.accessToken, body.password); }
  @Post('first-access/temporary') temporaryFirstAccess(@Body() body: TemporaryFirstAccessDto) {
    return this.auth.definePasswordWithTemporary(body.email, body.temporaryPassword, body.password);
  }
  @Post('access-status') accessStatus(@Body() body: EmailDto) { return this.auth.accessStatus(body.email); }
  @Post('first-access/request') requestFirstAccess(@Body() body: EmailDto) {
    return this.auth.requestFirstAccess(body.email, 'https://implementacao-frontend.vercel.app/primeiro-acesso');
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    return this.auth.me(token);
  }
}
