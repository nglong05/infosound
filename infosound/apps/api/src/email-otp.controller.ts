import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, type AuthRequest } from './security';
import { registrationBody, otpResendBody, otpVerifyBody } from './openapi';
import {
  requestRegistration,
  resendRegistration,
  verifyRegistration,
  cancelRegistration,
} from './registration-otp';

@ApiTags('InfoSound registration OTP')
@Controller('api/v1/auth/email-otp')
export class EmailOtpController {
  @Public()
  @Post('request')
  @ApiOperation({ summary: 'Đăng ký tài khoản bằng mật khẩu và gửi OTP xác minh email' })
  @ApiBody({ schema: registrationBody })
  request(@Body() body: unknown, @Req() req: AuthRequest) {
    return requestRegistration(body, req);
  }

  @Public()
  @Post('resend')
  @ApiOperation({ summary: 'Gửi lại OTP, giữ nguyên thông tin đăng ký đã chốt' })
  @ApiBody({ schema: otpResendBody })
  resend(@Body() body: unknown, @Req() req: AuthRequest) {
    return resendRegistration(body, req);
  }

  @Public()
  @Post('verify')
  @ApiOperation({ summary: 'Xác minh đăng ký một lần; không tạo phiên đăng nhập' })
  @ApiBody({ schema: otpVerifyBody })
  verify(@Body() body: unknown, @Req() req: AuthRequest) {
    return verifyRegistration(body, req);
  }

  @Public()
  @Post('cancel')
  @ApiOperation({
    summary: 'Hủy yêu cầu đăng ký bằng opaque handle hiện tại, giải phóng tên tài khoản',
  })
  @ApiBody({ schema: otpResendBody })
  cancel(@Body() body: unknown, @Req() req: AuthRequest) {
    return cancelRegistration(body, req);
  }
}
