import { HttpException } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super({ code, message, ...(details ? { details } : {}) }, status);
  }
}

export function notFound(): never {
  throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
}
