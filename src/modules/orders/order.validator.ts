import {
  EXPECTED_CSV_COLUMNS,
  RawCsvOrderRow,
  ValidOrder,
} from "./order.schema.js";

const GENERAL_UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ValidationResult {
  isValid: boolean;
  order?: ValidOrder;
  errors: string[];
}

export class OrderValidator {
  /**
   * Validates CSV headers against the expected schema.
   */
  public static validateHeaders(headers: string[]): {
    isValid: boolean;
    error?: string;
  } {
    if (!headers || headers.length === 0) {
      return {
        isValid: false,
        error: "CSV file header is empty or missing",
      };
    }

    const cleanedHeaders = headers.map((h) => h.replace(/^\uFEFF/, "").trim());

    const uniqueHeaders = new Set(cleanedHeaders);
    if (uniqueHeaders.size !== cleanedHeaders.length) {
      return {
        isValid: false,
        error: "CSV contains duplicate column headers",
      };
    }

    const missingColumns = EXPECTED_CSV_COLUMNS.filter(
      (col) => !uniqueHeaders.has(col),
    );
    if (missingColumns.length > 0) {
      return {
        isValid: false,
        error: `Missing required column(s): ${missingColumns.join(", ")}`,
      };
    }

    const unexpectedColumns = cleanedHeaders.filter(
      (col) => !EXPECTED_CSV_COLUMNS.includes(col as any),
    );
    if (unexpectedColumns.length > 0) {
      return {
        isValid: false,
        error: `Unexpected extra column(s) in CSV header: ${unexpectedColumns.join(", ")}`,
      };
    }

    return { isValid: true };
  }

  /**
   * Validates an individual CSV order row.
   */
  public static validateRow(row: RawCsvOrderRow): ValidationResult {
    const errors: string[] = [];

    // 1. order_id validation (UUID)
    const rawOrderId = row.order_id?.trim();
    if (!rawOrderId) {
      errors.push("order_id is required");
    } else if (!GENERAL_UUID_REGEX.test(rawOrderId)) {
      errors.push(
        "order_id must be a valid UUID format (e.g. 550e8400-e29b-41d4-a716-446655440000)",
      );
    }

    const rawCustomerId = row.customer_id?.trim();
    if (!rawCustomerId || rawCustomerId.length === 0) {
      errors.push("customer_id is required and cannot be empty");
    }

    const rawOrderDate = row.order_date?.trim();
    let parsedDate: Date | undefined;
    if (!rawOrderDate) {
      errors.push("order_date is required");
    } else {
      const timestamp = Date.parse(rawOrderDate);
      if (isNaN(timestamp)) {
        errors.push(
          "order_date must be a valid ISO or parsable date/time string",
        );
      } else {
        parsedDate = new Date(timestamp);
      }
    }

    const rawAmount =
      row.order_amount !== undefined ? String(row.order_amount).trim() : "";
    let parsedAmount: number | undefined;
    if (!rawAmount) {
      errors.push("order_amount is required");
    } else {
      parsedAmount = Number(rawAmount);
      if (isNaN(parsedAmount) || !isFinite(parsedAmount)) {
        errors.push("order_amount must be a valid number");
      } else if (parsedAmount <= 0) {
        errors.push("order_amount must be a positive number greater than 0");
      }
    }

    const rawStatus = row.status?.trim();
    if (!rawStatus || rawStatus.length === 0) {
      errors.push("status is required and cannot be empty");
    }

    if (
      errors.length > 0 ||
      !rawOrderId ||
      !rawCustomerId ||
      !parsedDate ||
      parsedAmount === undefined ||
      !rawStatus
    ) {
      return {
        isValid: false,
        errors,
      };
    }

    return {
      isValid: true,
      errors: [],
      order: {
        order_id: rawOrderId,
        customer_id: rawCustomerId,
        order_date: parsedDate,
        order_amount: parsedAmount,
        status: rawStatus,
      },
    };
  }
}
