export const EXPECTED_CSV_COLUMNS = [
  "order_id",
  "customer_id",
  "order_date",
  "order_amount",
  "status",
] as const;

export type ExpectedCsvColumn = (typeof EXPECTED_CSV_COLUMNS)[number];

export interface RawCsvOrderRow {
  order_id?: string;
  customer_id?: string;
  order_date?: string;
  order_amount?: string;
  status?: string;
  [key: string]: string | undefined;
}

export interface ValidOrder {
  order_id: string;
  customer_id: string;
  order_date: Date;
  order_amount: number;
  status: string;
}

export interface RowValidationError {
  row: number;
  errors: string[];
}

export interface OrderProcessingSummary {
  message: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insertedRows: number;
  duplicateRows: number;
  errors: RowValidationError[];
  gcs_uploaded?: boolean;
}

export interface BatchInsertResult {
  insertedCount: number;
  duplicateCount: number;
}
