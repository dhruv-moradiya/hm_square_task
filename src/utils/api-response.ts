import { Response } from "express";

export class ApiResponse {
  public static success<T extends object>(
    res: Response,
    data: T,
    statusCode: number = 200,
  ): Response {
    return res.status(statusCode).json(data);
  }

  public static error(
    res: Response,
    errorMessage: string,
    statusCode: number = 400,
    extraDetails?: Record<string, any>,
  ): Response {
    return res.status(statusCode).json({
      error: errorMessage,
      ...(extraDetails || {}),
    });
  }
}
