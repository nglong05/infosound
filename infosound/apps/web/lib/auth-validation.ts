export const PASSWORD_HELP =
  'Ít nhất 8 ký tự, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt. Dấu cách không được tính là ký tự đặc biệt.';
export const USERNAME_HELP = '3–30 ký tự gồm chữ thường, số hoặc dấu gạch dưới (_).';

export function passwordError(password: string): string | undefined {
  if (password.length < 8 || password.length > 128) return 'Mật khẩu phải có từ 8 đến 128 ký tự.';
  if (/[\x00-\x1f\x7f]/.test(password)) return 'Mật khẩu chứa ký tự không được hỗ trợ.';
  if (!/[A-Z]/.test(password)) return 'Mật khẩu cần có ít nhất một chữ hoa.';
  if (!/[a-z]/.test(password)) return 'Mật khẩu cần có ít nhất một chữ thường.';
  if (!/[0-9]/.test(password)) return 'Mật khẩu cần có ít nhất một chữ số.';
  if (!/[^A-Za-z0-9\s]/.test(password))
    return 'Mật khẩu cần có ít nhất một ký tự đặc biệt, không phải dấu cách.';
  return undefined;
}

export function emailError(email: string): string | undefined {
  if (!email.trim()) return 'Nhập địa chỉ email của bạn.';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return 'Nhập một địa chỉ email hợp lệ.';
  return undefined;
}

export function usernameError(username: string): string | undefined {
  return /^[a-z0-9_]{3,30}$/.test(username)
    ? undefined
    : 'Tên người dùng cần 3–30 ký tự, chỉ gồm chữ thường, số và dấu gạch dưới (_).';
}
