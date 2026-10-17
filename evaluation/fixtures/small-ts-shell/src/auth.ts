export function authenticateToken(token?: string): boolean {
  return typeof token === "string" && token.length > 0;
}

export function authorize(token?: string): boolean {
  return authenticateToken(token);
}
